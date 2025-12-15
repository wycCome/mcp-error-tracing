# 开发指南

本文档面向需要维护、调试或扩展项目的开发者。

## 开发环境

### 必需工具

- Node.js 18+
- TypeScript 5.3+
- Git

### 本地开发流程

```bash
# 1. 克隆并安装
git clone <repository>
cd error
npm install

# 2. 配置环境
cp .env.example .env
# 编辑 .env 填入配置

# 3. 开发模式（热重载）
npm run dev              # stdio 模式
npm run dev:http         # HTTP 模式
npm run dev:compatible   # 兼容模式

# 4. 编译和运行
npm run build
npm start
```

## 项目结构

```
src/
├── index.ts              # stdio 模式入口
├── http-server.ts        # HTTP 模式入口
├── compatible-server.ts  # 兼容模式入口
├── server-tools.ts       # 工具注册（共享）
├── stack-analyzer.ts     # 堆栈分析和代码上下文提取
├── api.ts                # 外部 API 调用
├── handlers.ts           # 业务逻辑
├── config.ts             # 配置加载
└── types.ts              # TypeScript 类型
```

**关键设计**：
- `server-tools.ts` 提供统一的工具注册函数
- 所有入口文件调用 `registerTools(server)` 注册工具
- 业务逻辑完全独立于传输层

## 调试技巧

### 1. 启用详细日志

```typescript
// 在代码中添加
const DEBUG = process.env.DEBUG === "true";
if (DEBUG) console.log("调试信息", data);
```

```bash
DEBUG=true npm run dev
```

### 2. 使用 VS Code 调试

创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Compatible Server",
      "program": "${workspaceFolder}/build/compatible-server.js",
      "preLaunchTask": "npm: build",
      "envFile": "${workspaceFolder}/.env"
    }
  ]
}
```

### 3. 测试单个工具

创建测试脚本 `test-tool.sh`：

```bash
#!/bin/bash
SESSION_ID="test-$(uuidgen)"

# 初始化
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"initialize\",
    \"params\": {
      \"protocolVersion\": \"2025-03-26\",
      \"capabilities\": {},
      \"clientInfo\": {\"name\": \"test\", \"version\": \"1.0.0\"}
    },
    \"id\": 1
  }" | jq .

# 调用工具
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"find_code_owner\",
      \"arguments\": {
        \"filePath\": \"src/test.java\",
        \"lineNumber\": 10
      }
    },
    \"id\": 2
  }" | jq .
```

### 4. 查看 HTTP 请求

```bash
# 使用 tcpdump 抓包
sudo tcpdump -i lo0 -A 'tcp port 3000'

# 或使用 Wireshark 图形化分析
```

## 常见问题

### 问题 1: 会话泄漏

**症状**：内存持续增长

**解决方案**：添加会话超时清理

```typescript
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24小时
const sessionActivity = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [sid, lastActivity] of sessionActivity.entries()) {
    if (now - lastActivity > SESSION_TIMEOUT) {
      transports[sid]?.close();
      delete transports[sid];
      sessionActivity.delete(sid);
    }
  }
}, 60 * 60 * 1000);
```

### 问题 2: SSE 连接断开

**原因**：网络代理缓冲、防火墙超时

**解决方案**：发送心跳

```typescript
setInterval(() => {
  for (const transport of Object.values(transports)) {
    if (transport instanceof SSEServerTransport) {
      res.write(": heartbeat\n\n");
    }
  }
}, 30000);
```

### 问题 3: CORS 错误

**解决方案**：添加 CORS 中间件

```bash
npm install cors
```

```typescript
import cors from 'cors';
app.use(cors());
```

## 性能优化

### 1. 连接限制

```typescript
const MAX_CONNECTIONS = 100;
app.use((req, res, next) => {
  if (Object.keys(transports).length >= MAX_CONNECTIONS) {
    res.status(503).json({ error: "Too many connections" });
    return;
  }
  next();
});
```

### 2. 请求限流

```bash
npm install express-rate-limit
```

```typescript
import rateLimit from "express-rate-limit";

app.use("/mcp", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));
```

### 3. 响应压缩

```bash
npm install compression
```

```typescript
import compression from "compression";
app.use(compression());
```

## 部署指南

### Docker 部署

`Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "-r", "dotenv/config", "build/compatible-server.js"]
```

```bash
docker build -t error-tracker-mcp .
docker run -d -p 3000:3000 --env-file .env error-tracker-mcp
```

### PM2 部署

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start npm --name "error-tracker" -- run start:compatible

# 查看日志
pm2 logs error-tracker

# 设置开机自启
pm2 startup
pm2 save
```

### Nginx 反向代理

```nginx
upstream mcp_server {
    server localhost:3000;
}

server {
    listen 80;
    server_name mcp.example.com;

    location / {
        proxy_pass http://mcp_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

## 监控和健康检查

### 添加健康检查端点

```typescript
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    activeSessions: Object.keys(transports).length,
    memory: process.memoryUsage()
  });
});
```

### Prometheus 指标（可选）

```bash
npm install prom-client
```

```typescript
import { register, Counter, Gauge } from "prom-client";

const requestCounter = new Counter({
  name: "mcp_requests_total",
  help: "Total requests",
  labelNames: ["method", "status"]
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});
```

## 测试

### 运行自动化测试

```bash
# 启动服务器
npm run start:compatible

# 在另一个终端运行测试
./test-compatible-server.sh
```

### 负载测试

```bash
npm install -g autocannon

# 测试
autocannon -c 10 -d 30 \
  -m POST \
  -H "Content-Type: application/json" \
  -b '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' \
  http://localhost:3000/mcp
```

## 贡献指南

### 添加新工具

1. 在 `server-tools.ts` 添加工具注册：

```typescript
server.registerTool("my_new_tool", {
  description: "工具描述",
  inputSchema: {
    param1: z.string().describe("参数说明")
  }
}, async ({ param1 }) => {
  // 实现逻辑
  return {
    content: [{ type: "text", text: result }]
  };
});
```

2. 在 `handlers.ts` 添加业务逻辑（如需要）
3. 在 `api.ts` 添加外部 API 调用（如需要）
4. 更新 `types.ts` 添加类型定义
5. 更新 README.md 文档

### 代码规范

- 使用 TypeScript 严格模式
- 添加 JSDoc 注释
- 遵循现有代码风格
- 提交前运行 `npm run build` 确保编译通过

### Pull Request 流程

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 开启 Pull Request

## 故障恢复

### 服务崩溃恢复

使用 PM2 自动重启：

```bash
pm2 start npm --name error-tracker -- run start:compatible
pm2 save
```

### 内存泄漏排查

```bash
# 生成 heap snapshot
node --expose-gc --inspect build/compatible-server.js

# 在 Chrome DevTools 分析
# 1. 打开 chrome://inspect
# 2. 点击 "Take heap snapshot"
# 3. 对比不同时间点的 snapshot
```

## 维护清单

### 日常检查
- [ ] 错误日志
- [ ] 活动会话数
- [ ] CPU/内存使用

### 每周任务
- [ ] 性能指标分析
- [ ] 慢请求审查
- [ ] 依赖安全扫描

### 每月任务
- [ ] 依赖更新：`npm audit` → `npm update`
- [ ] 性能基准测试
- [ ] 配置备份

## 参考资源

- [MCP 规范](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Express 文档](https://expressjs.com/)
- [项目架构](./ARCHITECTURE.md)
