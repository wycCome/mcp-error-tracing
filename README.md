# Error Tracker MCP Server

基于 Model Context Protocol (MCP) 的错误追踪服务器，自动化处理代码错误：查找代码责任人（Bitbucket）→ 获取 PR 信息 → 创建 JIRA 任务。

## 快速开始

### 1. 安装与编译

```bash
npm install
npm run build
```

### 2. 配置环境变量

创建 `.env` 文件（参考 `.env.example`）：

```bash
# 服务器配置
HTTP_PORT=3000                    # HTTP 模式端口（默认 3000）
COMPATIBLE_PORT=3001              # 兼容模式端口（默认 3001）
DEFAULT_BRANCH=main               # 默认调查分支（默认 main）

# Bitbucket 配置
BITBUCKET_USERNAME=your_username
BITBUCKET_PASSWORD=your_password
BITBUCKET_BASE_URL=https://your-bitbucket-server.com
BITBUCKET_PROJECT=your_project
BITBUCKET_REPO=your_repo
PR_TARGET_BRANCH=main             # PR 目标分支过滤（默认 main）

# JIRA 配置
JIRA_USERNAME=your_username
JIRA_PASSWORD=your_password
JIRA_BASE_URL=https://your-jira-server.com
JIRA_PROJECT_KEY=YOUR_PROJECT
JIRA_ISSUE_TYPE_ID=10101
JIRA_PRIORITY_ID=10000
JIRA_COMPONENT_ID=12505
```

### 3. 选择运行模式

| 模式 | 适用场景 | 启动命令 |
|------|---------|----------|
| **stdio** | 本地使用（Claude Desktop） | `npm start` |
| **HTTP** | 远程部署（新客户端） | `npm run start:http` |
| **兼容** | 远程部署（新旧客户端） | `npm run start:compatible` |

## 核心功能

| 工具 | 功能说明 |
|------|----------|
| `find_code_owner` | 通过文件路径和行号查找代码最后修改者 |
| `get_pull_request` | 根据 commit ID 查找相关 Pull Request |
| `investigate_error` | 自动调查错误（查找责任人 + PR 信息） |
| `create_jira_ticket` | 基于调查结果创建并分配 JIRA 任务 |
| `track_error_full` | 完整流程：调查 → 分析 → 创建 JIRA（一键完成） |

## 客户端配置

### 方式一：stdio 模式（本地使用 - Claude Desktop）

编辑配置文件：
- **MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "error-tracker": {
      "command": "node",
      "args": ["-r", "dotenv/config", "/绝对路径/error/build/index.js"]
    }
  }
}
```

> 💡 需在项目根目录创建 `.env` 文件配置环境变量

### 方式二：HTTP 模式（远程服务器）

#### Streamable HTTP (推荐 - 新协议)

适用于支持 MCP 2025-03-26 协议的客户端：

```json
{
  "mcpServers": {
    "error-tracker": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

#### SSE 模式（兼容 - 旧协议）

适用于仅支持 MCP 2024-11-05 协议的客户端：

```json
{
  "mcpServers": {
    "error-tracker": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

**端口说明**：
- HTTP 模式默认端口：`3000`（通过 `.env` 中 `HTTP_PORT` 配置）
- 兼容模式默认端口：`3001`（通过 `.env` 中 `COMPATIBLE_PORT` 配置）
- 启动命令：`npm run start:http`（仅新协议）或 `npm run start:compatible`（新旧协议都支持）

**协议选择**：
- 新客户端 → 使用 `/mcp` 端点（Streamable HTTP）
- 旧客户端 → 使用 `/sse` 端点（传统 SSE）
- 不确定 → 使用兼容模式服务器（`npm run start:compatible`）同时支持两种

## 使用示例

### 场景1：查找代码责任人

```
请帮我查找这个文件第161行是谁写的：
src/main/java/com/example/service/UserService.java
```

### 场景2：完整错误追踪

```
我遇到空指针异常：
文件: src/main/java/com/example/service/UserService.java
行号: 161

错误信息：
java.lang.NullPointerException: Cannot invoke method on null object
    at UserService.checkUser(UserService.java:161)

请创建 JIRA 任务，标题"修复空指针异常"，标签 "bug" "urgent"
```

## 远程部署

### Docker 部署

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
pm2 start npm --name "error-tracker" -- run start:compatible
pm2 save && pm2 startup
```

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 认证失败 | 检查 `.env` 文件中的用户名和密码 |
| 找不到文件 | 确保文件路径相对于仓库根目录，检查 `DEFAULT_BRANCH` 配置 |
| 端口占用 | 修改 `.env` 中的 `HTTP_PORT` 或 `COMPATIBLE_PORT` |

## 技术架构

- **传输模式**：stdio / Streamable HTTP / 兼容模式（详见 [ARCHITECTURE.md](./ARCHITECTURE.md)）
- **开发调试**：调试技巧和贡献指南见 [DEVELOPMENT.md](./DEVELOPMENT.md)
- **技术栈**：TypeScript + MCP SDK + Express + Axios

## 许可证

MIT
