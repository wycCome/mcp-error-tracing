#!/usr/bin/env node

/**
 * 客户端示例 - 演示如何连接到兼容服务器
 * 
 * 此示例展示了：
 * 1. 尝试连接 Streamable HTTP (推荐)
 * 2. 如果失败，降级到传统 SSE
 * 3. 调用 MCP 工具
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

type TransportType = "streamable-http" | "sse";

/**
 * 向后兼容的连接函数
 * 按照 MCP 规范的向后兼容策略
 */
async function connectWithBackwardsCompatibility(
  baseUrl: string
): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  transportType: TransportType;
}> {
  console.log("🔄 尝试连接到 MCP 服务器...\n");

  // 步骤 1: 优先尝试 Streamable HTTP (现代协议)
  console.log("1️⃣  尝试 Streamable HTTP 传输 (协议版本: 2025-03-26)");
  
  const client = new Client({
    name: "example-client",
    version: "1.0.0",
  });

  client.onerror = (error) => {
    console.error("❌ 客户端错误:", error.message);
  };

  try {
    const streamableUrl = new URL(baseUrl);
    streamableUrl.pathname = "/mcp";
    
    console.log(`   连接到: ${streamableUrl.href}`);
    
    const streamableTransport = new StreamableHTTPClientTransport(streamableUrl);
    await client.connect(streamableTransport);

    console.log("✅ 成功使用 Streamable HTTP 传输连接\n");
    
    return {
      client,
      transport: streamableTransport,
      transportType: "streamable-http",
    };
  } catch (error) {
    console.log(`⚠️  Streamable HTTP 连接失败: ${error instanceof Error ? error.message : String(error)}\n`);

    // 步骤 2: 降级到传统 SSE (旧协议)
    console.log("2️⃣  降级到传统 SSE 传输 (协议版本: 2024-11-05)");
    
    try {
      const sseUrl = new URL(baseUrl);
      sseUrl.pathname = "/sse";
      
      console.log(`   连接到: ${sseUrl.href}`);
      
      const sseTransport = new SSEClientTransport(sseUrl);
      const sseClient = new Client({
        name: "example-client",
        version: "1.0.0",
      });

      await sseClient.connect(sseTransport);

      console.log("✅ 成功使用传统 SSE 传输连接\n");
      
      return {
        client: sseClient,
        transport: sseTransport,
        transportType: "sse",
      };
    } catch (sseError) {
      console.error(
        `\n❌ 两种传输方式都失败:\n` +
        `   1. Streamable HTTP: ${error}\n` +
        `   2. SSE: ${sseError}`
      );
      throw new Error("无法使用任何可用的传输方式连接到服务器");
    }
  }
}

/**
 * 演示如何使用连接的客户端
 */
async function demonstrateUsage(
  client: Client,
  transportType: TransportType
) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📋 使用 ${transportType === "streamable-http" ? "Streamable HTTP" : "传统 SSE"} 传输演示 MCP 功能`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  try {
    // 1. 列出可用工具
    console.log("1️⃣  获取可用工具列表...");
    const toolsResult = await client.listTools();
    
    console.log(`✅ 找到 ${toolsResult.tools.length} 个工具:\n`);
    toolsResult.tools.forEach((tool, index) => {
      console.log(`   ${index + 1}. ${tool.name}`);
      console.log(`      ${tool.description || "无描述"}`);
    });

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // 2. 调用示例工具 (使用 investigate_error)
    console.log("2️⃣  调用工具示例: investigate_error");
    console.log("   参数:");
    console.log("   - filePath: src/main/java/example/Service.java");
    console.log("   - lineNumber: 42\n");

    try {
      const result = await client.callTool({
        name: "investigate_error",
        arguments: {
          filePath: "src/main/java/example/Service.java",
          lineNumber: 42,
          branch: "release/1.5"
        },
      });

      console.log("✅ 工具调用成功！");
      console.log("\n📊 返回结果:");
      
      // Type guard for content array
      const content = result.content as Array<{ type: string; text?: string }> | undefined;
      if (content && content.length > 0) {
        const firstContent = content[0];
        if (firstContent.type === "text" && firstContent.text) {
          try {
            const parsed = JSON.parse(firstContent.text);
            console.log(JSON.stringify(parsed, null, 2));
          } catch {
            console.log(firstContent.text);
          }
        }
      }
    } catch (error) {
      // 工具调用失败是预期的（因为可能没有实际的 Bitbucket 配置）
      console.log("⚠️  工具调用失败（这是预期的，如果没有配置 Bitbucket）:");
      console.log(`   ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (error) {
    console.error("❌ 演示过程中出错:", error);
  }
}

/**
 * 主函数
 */
async function main() {
  const serverUrl = process.env.SERVER_URL || "http://localhost:3000";
  
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║  MCP 兼容客户端示例                            ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log(`🌐 服务器地址: ${serverUrl}\n`);

  try {
    // 连接到服务器（自动向后兼容）
    const { client, transportType } = await connectWithBackwardsCompatibility(serverUrl);

    // 演示功能
    await demonstrateUsage(client, transportType);

    // 关闭连接
    console.log("👋 关闭连接...");
    await client.close();
    console.log("✅ 连接已关闭\n");

    console.log("╔════════════════════════════════════════════════╗");
    console.log("║  演示完成！                                    ║");
    console.log("╚════════════════════════════════════════════════╝");

  } catch (error) {
    console.error("\n❌ 致命错误:", error);
    process.exit(1);
  }
}

// 运行主函数
main().catch((error) => {
  console.error("未捕获的错误:", error);
  process.exit(1);
});
