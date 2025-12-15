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
| `get_method_code` | 智能获取错误行所在方法的完整代码（自动识别方法边界） |
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

### 场景2：获取错误上下文代码

```
请获取这个错误行所在方法的完整代码：
文件: src/main/java/com/example/service/UserService.java
行号: 161
```

### 场景3：完整错误追踪

```
我遇到空指针异常：
文件: src/main/java/com/example/service/UserService.java
行号: 161

错误信息：
java.lang.NullPointerException: Cannot invoke method on null object
    at UserService.checkUser(UserService.java:161)

请创建 JIRA 任务，标题"修复空指针异常"，标签 "bug" "urgent"
```

## 使用场景与轻量提示

JIRA 相关参数通常在 `.env` 中配置，日常使用只需给出最少的上下文即可。把错误堆栈直接粘贴给 AI，模型会自动识别并调用合适的工具。

提示约定：除非你明确提供标题，模型会基于错误上下文自动生成合适的 JIRA 标题与描述。

### 快速一键闭环（不需要分析）
示例提示：

```
我这有个错误，请你直接完成责任人定位、关联 PR 并创建 JIRA：

文件: src/main/java/com/example/service/UserService.java
行号: 161

错误堆栈：
java.lang.NullPointerException: Cannot invoke method on null object
  at UserService.checkUser(UserService.java:161)

JIRA：标题「修复空指针异常」，标签「bug」「urgent」。
```

说明：模型会自动进行代码所有者定位和 PR 检索，并用 `.env` 中的 JIRA 配置创建任务，无需显式写出工具名称。

### 先让模型分析，再落任务
示例提示：

```
请先根据下面的错误做简要原因分析与修复建议，然后帮我创建一个 JIRA：

文件: src/main/java/com/example/service/UserService.java
行号: 161

错误堆栈：
java.lang.NullPointerException: Cannot invoke method on null object
  at UserService.checkUser(UserService.java:161)

JIRA：标题「修复空指针异常（含原因分析）」即可。
```

说明：模型会输出结构化的分析结论（原因/影响/建议）并在创建 JIRA 时自动带上摘要；无需指定工具名，模型会自行选择步骤。

### 深度分析错误上下文
示例提示：

```
我需要分析这个异常的根本原因，请先获取完整方法代码：

文件: src/main/java/com/example/service/UserService.java
行号: 161

然后分析可能的异常原因并给出修复建议。
```

说明：模型会自动调用 `get_method_code` 工具获取完整方法代码，然后基于完整上下文进行分析，比仅有堆栈信息更准确。

### 其他常见场景

- 多文件/多位置排查（模块级）：

```
用户登录偶发失败，请按模块排查并指出最可能的改动来源：
模块: auth、session、gateway
错误堆栈（多段粘贴即可）：
...
```

- 批量错误收敛并统一创建任务：

```
我有三处相似的 NPE，请合并分析并创建一个总任务，附上三个具体文件与行号作为子任务描述：
1) auth/UserService.java:161
2) session/SessionManager.java:45
3) gateway/LoginController.java:102
错误堆栈已在上文粘贴。
```

- 只分派给代码责任人（不创建 JIRA）：

```
请定位这段错误的代码责任人并把结论返回给我，不需要创建 JIRA：
文件: src/main/java/com/example/service/UserService.java
行号: 161
错误堆栈：...
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
