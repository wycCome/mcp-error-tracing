#!/usr/bin/env node

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./server-tools.js";
import { loadConfig } from "./config.js";

/**
 * MCP Server with Streamable HTTP transport
 */

// Create MCP server instance using high-level API
const getServer = () => {
  const server = new McpServer({
    name: "error-tracker-mcp",
    version: "1.0.0",
  });

  // Register all tools
  registerTools(server);

  return server;
};

/**
 * Start HTTP server
 */
async function main() {
  const config = loadConfig();
  const PORT = config.server.httpPort;

  const app = createMcpExpressApp();

  // Store transports by session ID
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  // MCP POST endpoint
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    
    if (sessionId) {
      console.error(`Received MCP request for session: ${sessionId}`);
    }

    try {
      let transport: StreamableHTTPServerTransport;
      
      if (sessionId && transports[sessionId]) {
        // Reuse existing transport for this session
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request - create new transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            console.error(`New session initialized: ${sessionId}`);
            transports[sessionId] = transport;
          },
          onsessionclosed: (sessionId) => {
            console.error(`Session closed: ${sessionId}`);
            delete transports[sessionId];
          },
        });

        // Set up cleanup on transport close
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.error(`Transport closed for session ${sid}, cleaning up`);
            delete transports[sid];
          }
        };

        // Connect server to transport
        const server = getServer();
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid request: missing session ID or not an initialize request",
          },
          id: null,
        });
        return;
      }

      // Handle the request with the transport
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  // Handle GET requests for SSE streams
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    console.error(`Establishing SSE stream for session ${sessionId}`);
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Handle DELETE requests for session termination
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    console.error(`Received session termination request for session ${sessionId}`);

    try {
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling session termination:", error);
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination");
      }
    }
  });

  // Start the server
  app.listen(PORT, () => {
    console.error(`Error Tracker MCP HTTP Server listening on port ${PORT}`);
    console.error(`Server URL: http://localhost:${PORT}/mcp`);
  });

  // Handle server shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down server...");

    // Close all active transports
    for (const sessionId in transports) {
      try {
        console.error(`Closing transport for session ${sessionId}`);
        await transports[sessionId].close();
        delete transports[sessionId];
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }

    console.error("Server shutdown complete");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
