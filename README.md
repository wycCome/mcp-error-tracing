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
| `get_method_code` | 获取错误行所在的完整方法代码，为 AI 提供上下文用于根因分析（自动识别方法边界，支持多层堆栈智能定位） |
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

### 智能分析堆栈定位根本原因
示例提示：

```
这是一个完整的错误堆栈，请逐层获取错误行所在方法的完整代码：

java.lang.NullPointerException: Cannot invoke method on null object
    at com.example.utils.StringUtil.isEmpty(StringUtil.java:45)
    at com.example.service.UserService.validateUser(UserService.java:161)
    at com.example.controller.LoginController.login(LoginController.java:89)
    at com.example.gateway.ApiGateway.handleRequest(ApiGateway.java:203)

找到最可能的位置后，对错误进行调查，然后结合代码对错误进行分析，最后创建 JIRA。
```

说明：模型会智能分析堆栈：
1. 自动获取堆栈中多层方法的完整代码
2. 结合代码逻辑判断根本原因（调用者参数不合规 vs 工具类缺陷）
3. 定位到最可能出错的业务代码层，而非最底层的工具方法
4. 余下步骤参见"先让模型分析，再落任务"

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

## 未来功能规划 (TODO)

### 🎯 深度分析增强

- [ ] **trace_error_root_cause_chain** - 错误根因链追踪
  - 场景：深度追踪多层调用链，找到真正的根源而非表面现象
  - 功能：
    - 解析完整堆栈的每一层方法代码
    - AI 分析每层的职责和可能的问题点
    - 定位最初的根因（如参数来源、数据状态异常）
    - 生成分层分析报告，标注真正的 root cause
  - 价值：避免只看最底层错误行，找到业务逻辑层的源头问题

### 🤖 自动化修复增强

- [ ] **auto_fix_and_commit** - 自动修复代码并提交
  - 场景：AI 分析错误后自动生成修复代码，创建 PR 并指派给代码责任人
  - 完整流程：
    1. 调用 `get_method_code` 获取错误代码上下文
    2. 调用 `investigate_error` 定位代码责任人
    3. AI 生成修复代码（基于 errorAnalysis 中的 codeExample）
    4. AI 生成对应的单元测试代码
    5. 自动创建特性分支（如 `fix/NPE-UserService-161`）
    6. 修改源文件和测试文件并提交到新分支
    7. 创建 Pull Request，指定 reviewer 为代码责任人
    8. PR 描述自动关联 JIRA 工单号
  - 价值：端到端自动化（发现问题 → 修复 → 测试 → 代码审查），大幅减少人工介入

### 📊 智能辅助功能

- [ ] **analyze_business_error_by_changes** - 业务错误代码变更分析
  - 场景：无堆栈信息的业务逻辑错误（如理算金额错误、数据不一致），通过分析最近代码变更定位问题
  - 典型流程：
    1. 业务人员发现异常（如：某客户理算金额少了 100 元）
    2. 运维描述现象给 AI："理算模块最近出现金额计算错误，折扣未正确应用"
    3. AI 自动分析指定业务模块的最近提交记录（可自定义时间范围，默认 7 天）
    4. 对比代码变更点与业务现象的关联性
    5. 输出可疑提交列表 + 责任人 + 变更说明
  - 价值：解决无堆栈信息的业务逻辑问题，特别适合数据计算、状态流转等隐性错误

- [ ] **search_similar_errors** - 历史错误查询
  - 检查该错误是否曾经出现过，参考历史修复方案
  
- [ ] **batch_analyze_errors** - 批量错误分析
  - 一次性分析多个相关错误，判断是否同一根因
  
- [ ] **analyze_error_impact** - 错误影响范围评估
  - 分析错误方法的调用链，评估影响的业务模块

- [ ] **calculate_error_priority** - 智能优先级评估
  - 基于错误类型、历史频率、影响范围自动计算优先级

### � 保险业务专项功能

- [ ] **analyze_financial_impact** - 资金影响评估
  - 场景：计算错误（保费、理算、佣金）导致的潜在资金损失
  - 分析内容：
    - 识别涉及金额计算的错误（如折扣计算、费率应用）
    - 估算影响的保单/订单数量
    - 计算潜在资金差异（多收/少收）
    - 生成财务对账建议和数据修复脚本
  - 价值：快速评估错误的财务风险，优先处理高金额影响的问题

- [ ] **check_compliance_risk** - 合规风险检查
  - 场景：错误是否影响监管报送、精算要求、偿付能力计算
  - 检查维度：
    - 错误代码路径是否涉及监管报表生成模块
    - 是否影响偿二代/IFRS17关键指标计算
    - 是否违反保险业务规则（如年龄限制、保额上限）
  - 输出：合规风险等级 + 需通知的合规团队成员
  - 价值：避免监管处罚，保证合规性

- [ ] **trace_product_version** - 产品版本追溯
  - 场景：保险产品多版本共存，需确定哪个产品版本引入的bug
  - 功能：
    - 识别错误代码关联的产品配置版本
    - 追溯产品条款变更历史
    - 定位产品版本上线时间与错误出现时间的关联
    - 输出受影响的产品版本列表和客户群体
  - 价值：精准定位影响范围，避免误伤其他产品版本

- [ ] **generate_insurance_test_cases** - 保险场景测试用例生成
  - 场景：针对修复的bug自动生成保险业务测试用例
  - 生成内容：
    - 边界值测试（年龄、保额、期限边界）
    - 组合场景测试（附加险、豁免条款组合）
    - 异常数据测试（空值、超限值）
    - 回归测试用例（历史类似错误场景）
  - 价值：提高测试覆盖率，减少线上回归

- [ ] **detect_data_inconsistency** - 数据一致性检测
  - 场景：保单、理赔、财务数据在不同系统间可能不一致
  - 检测范围：
    - 保单状态与流程节点的一致性
    - 保费计算结果与财务入账的一致性
    - 理赔金额与核赔结论的一致性
  - 输出：数据不一致明细 + 疑似错误来源 + 修复SQL脚本
  - 价值：避免数据质量问题引发的财务和合规风险

### 📈 运营分析功能

- [ ] **analyze_error_trends** - 错误趋势分析
  - 场景：按产品线/模块/时间维度统计错误趋势，发现高风险区域
  - 分析维度：
    - 按产品线统计（寿险、财险、健康险各自的错误率）
    - 按业务模块统计（承保、理赔、保全的错误热点）
    - 按时间趋势统计（版本发布后的错误激增）
  - 输出：可视化报表 + 高风险模块预警 + 重构建议
  - 价值：指导资源投入方向，提前预防高风险区域

- [ ] **build_error_knowledge_base** - 错误知识库沉淀
  - 场景：自动沉淀常见保险业务错误的解决方案
  - 功能：
    - 自动分类错误类型（费率应用错误、年龄校验错误等）
    - 关联历史修复方案和PR
    - AI总结通用解决模式
    - 生成新人培训案例库
  - 价值：避免重复踩坑，加速新人成长

- [ ] **generate_data_fix_script** - 数据修复脚本生成
  - 场景：生产环境错误数据需要批量修正
  - 功能：
    - 基于错误分析生成修复SQL
    - 自动生成回滚SQL（以防修复错误）
    - 影响范围评估（修复多少条数据）
    - 生成验证查询语句
  - 价值：安全、高效地修复生产数据

### �🔧 现有工具增强

- [ ] **get_method_code** 增强
  - 支持 `includeCallers`: 同时返回调用该方法的代码
  - 支持 `contextLevel`: 控制上下文深度（1-3层）
  
- [ ] **investigate_error** 增强
  - 支持 `blameFullMethod`: 对整个方法进行 blame
  - 支持 `includeRecentContributors`: 返回该文件近期所有贡献者

## 许可证

MIT
