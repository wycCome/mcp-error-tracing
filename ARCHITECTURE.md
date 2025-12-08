# 系统架构文档

本文档描述 Error Tracker MCP Server 的整体架构设计和技术实现。

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    客户端层 (Clients)                        │
├─────────────────────────────────────────────────────────────┤
│  Claude Desktop  │  Web Clients  │  CLI Tools               │
│  (stdio)         │  (HTTP/SSE)   │  (HTTP)                  │
└───────┬──────────┴───────┬───────┴──────────────────────────┘
        │                  │
        ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   传输层 (Transport)                         │
├─────────────────────────────────────────────────────────────┤
│  stdio Transport  │  Streamable HTTP  │  Legacy SSE         │
│  (index.ts)       │  (http-server.ts) │  (compatible-srv)   │
└───────┬───────────┴───────┬───────────┴─────────────────────┘
        │                   │
        └───────────┬───────┘
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  核心层 (MCP Server)                         │
├─────────────────────────────────────────────────────────────┤
│  McpServer (SDK)                                            │
│  • Tool Registration (server-tools.ts)                      │
│  • Request Routing                                          │
│  • Session Management                                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│               业务逻辑层 (Business Logic)                     │
├─────────────────────────────────────────────────────────────┤
│  handlers.ts           │  api.ts            │  types.ts     │
│  • investigateError    │  • findCodeOwner   │  • 类型定义   │
│  • formatJiraDesc      │  • getPullRequest  │               │
│  • createTicket        │  • createJira      │               │
└────────────────────┬───┴────────────────────┴───────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              外部服务层 (External APIs)                       │
├─────────────────────────────────────────────────────────────┤
│  Bitbucket API         │  JIRA API                          │
│  • /blame             │  • POST /issue                      │
│  • /commits/PR        │  • PUT /issue                       │
└─────────────────────────────────────────────────────────────┘
```

## 三种传输模式对比

### 1. stdio 传输 (index.ts)

**适用场景**：本地桌面应用（Claude Desktop）

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

**特点**：
- ✅ 最简单、最安全
- ✅ 无需网络配置
- ✅ 进程间直接通信
- ❌ 仅支持单一客户端
- ❌ 无法远程访问

### 2. Streamable HTTP (http-server.ts)

**适用场景**：远程部署、现代客户端

```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);
```

**端点**：
- `POST /mcp` - 初始化会话 + 发送请求
- `GET /mcp` - SSE 流（服务器推送）
- `DELETE /mcp` - 终止会话

**特点**：
- ✅ 支持多客户端
- ✅ 会话管理
- ✅ 服务器推送（SSE）
- ✅ 符合最新协议（2025-03-26）

### 3. 兼容模式 (compatible-server.ts)

**适用场景**：需同时支持新旧客户端

```typescript
// 同时支持两种传输
app.all("/mcp", streamableHttpHandler);      // 新协议
app.get("/sse", legacySseHandler);           // 旧协议
app.post("/messages", legacyMessagesHandler); // 旧协议
```

**特点**：
- ✅ 向后兼容
- ✅ 支持协议降级
- ✅ 平滑迁移
- ⚠️ 实现复杂度较高

## 数据流程

### 错误追踪完整流程

```
用户请求
   │
   ▼
┌─────────────────┐
│ 1. investigate  │  调用 investigate_error
│    Error        │  • filePath: src/Service.java
└────────┬────────┘  • lineNumber: 123
         │
         ▼
┌─────────────────┐
│ 2. Find Owner   │  Bitbucket Blame API
│                 │  → commit ID + author
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. Get PR       │  Bitbucket PR API
│                 │  → PR title + links
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. Create JIRA  │  JIRA API
│    Ticket       │  • 自动填充描述
└────────┬────────┘  • 分配给责任人
         │
         ▼
    JIRA Ticket
    (PROJECT-1234)
```

### Streamable HTTP 通信流程

```
客户端                     服务器
  │                          │
  │  1. POST /mcp (init)     │
  ├─────────────────────────>│
  │  [Mcp-Session-Id: xxx]   │
  │<─────────────────────────┤
  │                          │
  │  2. GET /mcp (SSE)       │
  ├─────────────────────────>│
  │  [SSE Stream]            │
  │<═════════════════════════│
  │                          │
  │  3. POST /mcp (call)     │
  ├─────────────────────────>│
  │  [Response via SSE]      │
  │<═════════════════════════│
  │                          │
  │  4. DELETE /mcp          │
  ├─────────────────────────>│
  │  [200 OK]                │
  │<─────────────────────────┤
```

## 会话管理

### 会话存储结构

```typescript
type TransportType = StreamableHTTPServerTransport | SSEServerTransport;
const transports: Record<string, TransportType> = {};

// 创建会话
transports[sessionId] = transport;

// 类型验证
if (existingTransport instanceof StreamableHTTPServerTransport) {
  // 处理 Streamable HTTP 请求
} else if (existingTransport instanceof SSEServerTransport) {
  // 处理 SSE 请求
}

// 清理会话
transport.onclose = () => {
  delete transports[sessionId];
};
```

### 会话隔离

- 每个会话独立的 Transport 实例
- 会话 ID 用于路由请求
- 运行时类型检查防止协议混用
- 连接关闭自动清理

## 工具注册架构

### 统一注册函数 (server-tools.ts)

```typescript
export function registerTools(server: McpServer): void {
  server.registerTool("find_code_owner", {
    description: "...",
    inputSchema: { ... },
  }, async (args) => {
    // 业务逻辑
  });
  
  // ... 注册其他工具
}
```

**优势**：
- 所有传输模式共享相同的工具实现
- 便于维护和测试
- 添加新工具无需修改传输层

## 错误处理策略

### 层级化错误处理

```
Level 1: 传输层
  ├─ 捕获网络错误
  ├─ 会话验证
  └─ 返回 HTTP 状态码

Level 2: MCP Server
  ├─ JSON-RPC 协议错误
  ├─ 工具参数验证
  └─ 返回标准错误响应

Level 3: 业务逻辑
  ├─ API 调用失败
  ├─ 数据格式错误
  └─ 返回 content + isError

Level 4: 外部 API
  ├─ 认证错误
  ├─ 网络超时
  └─ 抛出具体异常
```

## 配置管理 (config.ts)

```typescript
export function loadConfig() {
  return {
    bitbucket: {
      username: process.env.BITBUCKET_USERNAME,
      password: process.env.BITBUCKET_PASSWORD,
      // ...
    },
    jira: {
      username: process.env.JIRA_USERNAME,
      // ...
    }
  };
}
```

**环境变量加载**：
- 使用 `dotenv` 自动加载 `.env` 文件
- 启动时通过 `-r dotenv/config` 注入
- 支持运行时环境变量覆盖

## 部署架构

### 单机部署

```
┌──────────────────┐
│  Nginx (80/443)  │ SSL 终止
└────────┬─────────┘
         │
┌────────▼─────────┐
│  Node.js Server  │ Port 3000
│  (PM2 管理)      │
└────────┬─────────┘
         │
         ▼
   External APIs
```

### 负载均衡部署

```
      ┌────────────┐
      │ Load Bal.  │
      └──────┬─────┘
             │
    ┌────────┼────────┐
    │        │        │
    ▼        ▼        ▼
┌────────┐┌────────┐┌────────┐
│Server 1││Server 2││Server 3│
└────────┘└────────┘└────────┘

注意：当前使用内存会话存储
如需跨实例共享，需实现 Redis
```

## 性能特征

### 资源消耗

- **内存**：基础占用 ~50MB，每会话 +1-2KB
- **CPU**：事件驱动，空闲时几乎为 0
- **网络**：长连接 + SSE 流，带宽消耗低

### 并发能力

- stdio 模式：单一客户端
- HTTP 模式：理论上无限制（受系统资源限制）
- 建议：单实例 100-500 并发连接

## 扩展性

### 添加新工具

1. 在 `server-tools.ts` 中注册工具
2. 在 `handlers.ts` 中实现业务逻辑
3. 在 `api.ts` 中添加外部 API 调用（如需）
4. 在 `types.ts` 中定义类型

**无需修改传输层代码**

### 添加新传输方式

1. 创建新的服务器入口文件（如 `src/websocket-server.ts`）
2. 实现对应的 Transport
3. 调用 `registerTools(server)` 注册工具
4. 添加启动脚本到 `package.json`

## 安全考虑

### 认证

- Bitbucket/JIRA 使用 Basic Auth
- 密码通过环境变量传递
- 建议使用 App Password 而非主密码

### 网络安全

- stdio 模式：最安全（本地进程）
- HTTP 模式：
  - 建议使用 HTTPS（Nginx 代理）
  - 考虑添加 API Key 认证
  - 配置 CORS 策略
  - 实施速率限制

### 数据隐私

- 错误信息可能包含敏感数据
- 建议配置日志脱敏
- JIRA 任务权限由 JIRA 系统控制

## 总结

本架构采用**分层设计**，实现了：

1. **传输层抽象** - 业务逻辑与传输方式解耦
2. **向后兼容** - 支持多种协议版本
3. **易于扩展** - 添加新工具和传输方式简单
4. **生产就绪** - 完整的错误处理和会话管理
5. **类型安全** - TypeScript 静态检查 + 运行时验证

详细开发指南请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)。
