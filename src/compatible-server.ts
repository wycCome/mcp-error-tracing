#!/usr/bin/env node

/**
 * Backwards-compatible MCP Server
 * 
 * This server supports both transport protocols:
 * 1. Streamable HTTP (protocol version 2025-03-26) - Modern transport
 * 2. HTTP + SSE (protocol version 2024-11-05) - Legacy transport for compatibility
 * 
 * Endpoints:
 * - /mcp (GET/POST/DELETE) - Streamable HTTP transport
 * - /sse (GET) - Legacy SSE transport stream establishment
 * - /messages (POST) - Legacy SSE transport message endpoint
 */

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./server-tools.js";
import { loadConfig } from "./config.js";

// Type for transport storage (both types)
type TransportType = StreamableHTTPServerTransport | SSEServerTransport;

/**
 * Create and configure MCP server instance
 * Shared between both transport types
 */
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
 * Start backwards-compatible HTTP server
 */
async function main() {
  const config = loadConfig();
  const PORT = config.server.compatiblePort;

  const app = createMcpExpressApp();

  // Store transports by session ID
  // Both transport types are stored in the same map
  const transports: Record<string, TransportType> = {};

  //=============================================================================
  // STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-03-26)
  //=============================================================================

  /**
   * Handle all Streamable HTTP requests on /mcp endpoint
   * Supports GET (SSE stream), POST (initialization and requests), DELETE (termination)
   */
  app.all("/mcp", async (req: Request, res: Response) => {
    console.log(`Received ${req.method} request to /mcp (Streamable HTTP)`);

    try {
      // Extract session ID from headers
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Existing session - validate transport type
        const existingTransport = transports[sessionId];
        if (existingTransport instanceof StreamableHTTPServerTransport) {
          // Correct transport type - reuse it
          transport = existingTransport;
        } else {
          // Wrong transport type (SSE trying to use Streamable HTTP)
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: Session exists but uses a different transport protocol (SSE)"
            },
            id: null
          });
          return;
        }
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        // New initialization request - create new Streamable HTTP transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            console.log(`Streamable HTTP session initialized: ${sessionId}`);
            transports[sessionId] = transport;
          },
          onsessionclosed: (sessionId) => {
            console.log(`Streamable HTTP session closed: ${sessionId}`);
            delete transports[sessionId];
          },
        });

        // Set up cleanup on transport close
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.log(`Transport closed for session ${sid}, cleaning up`);
            delete transports[sid];
          }
        };

        // Connect server to new transport
        const server = getServer();
        await server.connect(transport);
      } else {
        // Invalid request - no valid session or not an initialization
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided"
          },
          id: null
        });
        return;
      }

      // Handle the request with the transport
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling Streamable HTTP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    }
  });

  //=============================================================================
  // DEPRECATED HTTP+SSE TRANSPORT (PROTOCOL VERSION 2024-11-05)
  //=============================================================================

  /**
   * GET /sse - Establish SSE stream for legacy clients
   * This is the deprecated SSE transport
   */
  app.get("/sse", async (req: Request, res: Response) => {
    console.log("Received GET request to /sse (Legacy SSE transport)");

    try {
      // Create new SSE transport
      // The transport will generate its own session ID
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;

      // Store the transport
      transports[sessionId] = transport;
      console.log(`SSE session created: ${sessionId}`);

      // Clean up on connection close
      res.on("close", () => {
        console.log(`SSE connection closed for session: ${sessionId}`);
        delete transports[sessionId];
      });

      // Connect server to transport
      const server = getServer();
      await server.connect(transport);
    } catch (error) {
      console.error("Error establishing SSE connection:", error);
      if (!res.headersSent) {
        res.status(500).send("Error establishing SSE connection");
      }
    }
  });

  /**
   * POST /messages - Handle messages for legacy SSE clients
   * Query parameter: sessionId
   */
  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    console.log(`Received POST to /messages for session: ${sessionId}`);

    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: Missing sessionId query parameter"
        },
        id: null
      });
      return;
    }

    const existingTransport = transports[sessionId];
    
    if (!existingTransport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Not Found: No transport found for sessionId"
        },
        id: null
      });
      return;
    }

    if (existingTransport instanceof SSEServerTransport) {
      // Correct transport type - handle the message
      try {
        await existingTransport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error("Error handling SSE POST message:", error);
        if (!res.headersSent) {
          res.status(500).send("Error processing message");
        }
      }
    } else {
      // Wrong transport type (Streamable HTTP trying to use SSE)
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: Session exists but uses a different transport protocol (Streamable HTTP)"
        },
        id: null
      });
    }
  });

  //=============================================================================
  // SERVER LIFECYCLE
  //=============================================================================

  // Start the server
  app.listen(PORT, () => {
    console.log(`Backwards-compatible MCP server listening on port ${PORT}`);
    console.log(`
==============================================
SUPPORTED TRANSPORT OPTIONS:

1. Streamable HTTP (Protocol version: 2025-03-26) ✨ RECOMMENDED
   Endpoint: /mcp
   Methods: GET, POST, DELETE
   Usage: 
     - Initialize with POST to /mcp
     - Establish SSE stream with GET to /mcp
     - Send requests with POST to /mcp
     - Terminate session with DELETE to /mcp

2. HTTP + SSE (Protocol version: 2024-11-05) ⚠️  DEPRECATED
   Endpoints: /sse (GET) and /messages (POST)
   Usage:
     - Establish SSE stream with GET to /sse
     - Send requests with POST to /messages?sessionId=<id>

Server URL: http://localhost:${PORT}
==============================================
`);
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down server...");

    // Close all active transports
    for (const sessionId in transports) {
      try {
        console.log(`Closing transport for session ${sessionId}`);
        await transports[sessionId].close();
        delete transports[sessionId];
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }

    console.log("Server shutdown complete");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
