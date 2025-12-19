/**
 * Shared tool registration for MCP server
 * This module provides a unified way to register all tools across different server types
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findCodeOwner, getPullRequestByCommit, getCommitsByPath } from "./api.js";
import { investigateError, createJiraTicketWithInvestigation } from "./handlers.js";
import { loadConfig } from "./config.js";
import * as z from "zod";

/**
 * Register all MCP tools on the given server instance
 * This function is shared across stdio, HTTP, and compatible server implementations
 */
export function registerTools(server: McpServer): void {
  const config = loadConfig();
  const defaultBranch = config.server.defaultBranch;

  /**
   * Tool: Find code owner
   */
  server.registerTool(
    "find_code_owner",
    {
      description: "Find the code owner and commit ID for a specific file and line number using Bitbucket blame API",
      inputSchema: {
        filePath: z.string().describe("The relative path to the file in the repository"),
        lineNumber: z.number().describe("The line number where the error occurred"),
        branch: z.string().default(defaultBranch).describe(`The branch name (default: ${defaultBranch})`),
      },
    },
    async ({ filePath, lineNumber, branch }) => {
      const result = await findCodeOwner(filePath, lineNumber, branch);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  /**
   * Tool: Get pull request
   */
  server.registerTool(
    "get_pull_request",
    {
      description: "Get pull request information by commit ID from Bitbucket",
      inputSchema: {
        commitId: z.string().describe("The commit ID to search for pull requests"),
      },
    },
    async ({ commitId }) => {
      const result = await getPullRequestByCommit(commitId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  /**
   * Tool: Get commits by path
   */
  server.registerTool(
    "get_commits_by_path",
    {
      description: "Get commits for a specific directory path from Bitbucket. Filters commits by time (default: last 7 days). Useful for analyzing recent changes in a module or package.",
      inputSchema: {
        path: z.string().describe("The directory path in the repository (e.g., 'cbs_claim_catalog/cbs_claim/src/main/java/cbs/claim/application')"),
        daysAgo: z.number().default(7).describe("Number of days to look back for commits (default: 7)"),
        limit: z.number().default(50).describe("Maximum number of commits to return (default: 50)"),
        excludeMerges: z.boolean().default(true).describe("Exclude merge commits (default: true)"),
        branch: z.string().default(defaultBranch).describe(`The branch to query from (default: ${defaultBranch})`),
      },
    },
    async ({ path, daysAgo, limit, excludeMerges, branch }) => {
      const result = await getCommitsByPath(path, {
        daysAgo,
        limit,
        excludeMerges,
        branch,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  /**
   * Tool: Get method code context
   */
  server.registerTool(
    "get_method_code",
    {
      description: 
        "Get the complete code of the method containing the error line from the stack trace. " +
        "Intelligently identifies method boundaries and returns the complete method code (preserving original formatting) for AI error analysis. " +
        "\n\n💡 TIP: This tool provides essential context for error analysis. After getting the method code, " +
        "you can perform deeper analysis and then call investigate_error to find responsible developers, " +
        "followed by create_jira_ticket to complete the workflow.",
      inputSchema: {
        filePath: z.string().describe("The relative path to the file in the repository (e.g., com/example/service/UserService.java)"),
        lineNumber: z.number().describe("The line number where the error occurred"),
        branch: z.string().default(defaultBranch).describe(`The branch name (default: ${defaultBranch})`),
      },
    },
    async ({ filePath, lineNumber, branch }) => {
      const { getCodeContext } = await import("./stack-analyzer.js");
      const result = await getCodeContext(filePath, lineNumber, branch);
      
      // 构建清晰的返回格式
      const response = {
        filePath,
        branch,
        methodRange: {
          startLine: result.startLine,
          endLine: result.endLine,
          totalLines: result.endLine - result.startLine + 1,
        },
        errorLocation: {
          line: lineNumber,
          relativePosition: lineNumber - result.startLine + 1,
        },
        code: result.code,
      };
      
      // 为每一行代码添加真实行号注释
      const codeLines = result.code.split('\n');
      const codeWithLineNumbers = codeLines.map((line, index) => {
        const actualLineNumber = result.startLine + index;
        return `${line}  // 第${actualLineNumber}行`;
      }).join('\n');
      
      // 获取错误行的具体代码
      const errorLineIndex = lineNumber - result.startLine;
      const errorLineCode = codeLines[errorLineIndex] || '(无法获取该行代码)';
      
      // 构建友好的文本格式输出
      const formattedOutput = [
        `文件: ${filePath}`,
        `分支: ${branch}`,
        `方法范围: 第 ${result.startLine}-${result.endLine} 行 (共 ${result.endLine - result.startLine + 1} 行)`,
        `错误位置: 第 ${lineNumber} 行 (方法内第 ${lineNumber - result.startLine + 1} 行)`,
        `错误代码: ${errorLineCode.trim()}`,
        ``,
        `完整方法代码:`,
        `${'='.repeat(80)}`,
        codeWithLineNumbers,
        `${'='.repeat(80)}`,
      ].join('\n');
      
      return {
        content: [
          {
            type: "text",
            text: formattedOutput,
          },
        ],
        _meta: response, // 保留结构化数据供程序使用
      };
    }
  );

  /**
   * Tool: Create JIRA ticket
   */
  server.registerTool(
    "create_jira_ticket",
    {
      description: 
        "Create a JIRA ticket with AI-generated error analysis and investigation results from investigate_error tool. " +
        "The ticket will include code owner information, related pull requests, and detailed error analysis. " +
        "\n\n💡 FOR BEST RESULTS:\n" +
        "• Use get_method_code first to obtain complete method code for thorough analysis\n" +
        "• Generate a detailed errorAnalysis object based on the method code context\n" +
        "• Call investigate_error to retrieve code owner and PR information\n" +
        "• Then use this tool to create a comprehensive JIRA ticket with all the gathered data",
      inputSchema: {
        summary: z.string().describe(
          "AI-generated Chinese JIRA title that precisely identifies the issue with specific technical details. " +
          "\n\n📋 REQUIRED FORMAT: '{业务模块} - {具体对象/变量/方法名称}{问题描述}' " +
          "\n\n✅ EXCELLENT EXAMPLES (包含具体变量/对象名):" +
          "\n• '案件不予受理 - claimCaseEntity对象空指针异常'" +
          "\n• '用户资料查询 - getUserById返回值未校验空指针'" +
          "\n• '订单支付 - discountAmount变量null导致计算错误'" +
          "\n• '库存扣减 - productStock并发更新数据不一致'" +
          "\n\n❌ AVOID THESE (过于笼统):" +
          "\n✗ '用户资料查询 - 空指针异常' (哪个对象空指针？)" +
          "\n✗ '订单支付 - 金额错误' (哪个变量？什么错误？)" +
          "\n✗ 'NullPointerException at line 123' (无业务上下文)" +
          "\n\n💡 HOW TO CREATE:" +
          "\n1. 业务模块：从类名/方法名推断 (ClaimNoRegisterCase → 案件不予受理)" +
          "\n2. 具体对象：从错误分析中提取准确的变量/对象名 (claimCaseEntity, user, orderInfo)" +
          "\n3. 问题类型：简洁描述 (空指针异常, 类型转换错误, 并发冲突)" +
          "\n4. 长度控制：建议不超过30个汉字，确保 JIRA 列表可读性"
        ),
        investigationData: z.union([z.string(), z.any()]).describe(
          "REQUIRED: Complete data returned by investigate_error tool (can be JSON string or object). " +
          "If previous call result is lost or incomplete, call investigate_error again to retrieve it. " +
          "Do NOT manually construct this data."
        ),
        assignee: z.string().describe(
          "JIRA assignee username, get this value from investigationData.codeOwner.name"
        ),
        errorAnalysis: z.union([z.string(), z.any()]).describe(
          "AI-generated Chinese error analysis (can be JSON string or object). " +
          "MUST be based on the complete method code from get_method_code tool. " +
          "\n\n⚠️ DEEP ANALYSIS REQUIRED - Go beyond surface symptoms:\n" +
          "For errors like NullPointerException, don't just say 'object is null'. Investigate:\n" +
          "• WHY is the object null? (missing initialization, failed query, incorrect parameter)\n" +
          "• WHERE did the null value originate? (method parameter, database query, external API call)\n" +
          "• WHAT conditions led to this state? (missing validation, edge case, race condition)\n" +
          "• WHEN was this bug introduced? (related PR/commit if identifiable from code)\n" +
          "\n\n📋 REQUIRED JSON FORMAT:\n" +
          "{\n" +
          '  "errorInfo": "异常类型：{ExceptionType}。堆栈跟踪：{简要堆栈路径，例如：ClassA.methodX(File.java:123) -> ClassB.methodY(File.java:456)}。",\n' +
          '  "analysis": "根本原因深度分析：\\n' +
          '1. 直接原因（必需）：{描述错误的表面现象，例如：第123行调用 user.getName() 时 user 对象为 null}\\n' +
          '2. 深层原因（必需）：{追溯 null 的来源，例如：user 来自第115行的 getUserById(userId) 方法，该方法在数据库中未找到记录时返回 null 而非抛出异常}\\n' +
          '3. 根源分析（可选）：{如能判断，说明为什么会出现这种情况，例如：前端传入的 userId 可能是无效值，或者用户已被删除但缓存未更新}\\n' +
          '4. 问题引入（可选）：{如能从代码或 PR 中判断，说明是哪个需求/版本引入，例如：疑似在 PR#1234 重构时移除了空值检查}\\n' +
          '5. 影响范围（可选）：{如能评估，说明该问题对系统、业务或用户的影响，例如：用户访问个人资料页面时直接报错 500}",\n' +
          '  "suggestions": {\n' +
          '    "fixDescription": "修复建议的文字说明",\n' +
          '    "codeExample": "具体的修复代码示例（将在 JIRA 中以代码块格式展示）"\n' +
          '  }\n' +
          '}'
        ),
        labels: z.array(z.string()).optional().default([]).describe("Labels to add to the ticket (optional)"),
      },
    },
    async ({ summary, investigationData, assignee, errorAnalysis, labels }) => {
      const result = await createJiraTicketWithInvestigation(
        summary,
        investigationData,
        assignee,
        errorAnalysis,
        labels
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  /**
   * Tool: Investigate error
   */
  server.registerTool(
    "investigate_error",
    {
      description: 
        "Investigate an error by finding the code owner and related pull requests. " +
        "Returns complete investigation data in JSON format that can be used with create_jira_ticket. " +
        "\n\n💡 BEST PRACTICE: For comprehensive error analysis, consider calling get_method_code first to understand the code context, " +
        "then use this tool to identify the responsible developer based on the error line location.",
      inputSchema: {
        filePath: z.string().describe("The relative path to the file in the repository"),
        lineNumber: z.number().describe("The line number where the error occurred"),
        branch: z.string().default(defaultBranch).describe(`The branch name (default: ${defaultBranch})`),
      },
    },
    async ({ filePath, lineNumber, branch }) => {
      const result = await investigateError(filePath, lineNumber, branch);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  /**
   * Tool: Track error (full workflow)
   */
  server.registerTool(
    "track_error_full",
    {
      description: "Complete workflow: find code owner, get PR info, and create JIRA ticket for an error",
      inputSchema: {
        filePath: z.string().describe("The relative path to the file in the repository"),
        lineNumber: z.number().describe("The line number where the error occurred"),
        branch: z.string().default(defaultBranch).describe(`The branch name (default: ${defaultBranch})`),
        errorMessage: z.string().describe("The full error message"),
        summary: z.string().describe("The title for the JIRA ticket"),
        labels: z.array(z.string()).optional().default([]).describe("Labels to add to the ticket"),
      },
    },
    async ({ filePath, lineNumber, branch, errorMessage, summary, labels }) => {
      // Step 1: Investigate error
      const investigation = await investigateError(
        filePath,
        lineNumber,
        branch
      );

      // Step 2: Create JIRA ticket (pass object directly, no serialization needed)
      const jiraTicket = await createJiraTicketWithInvestigation(
        summary,
        investigation,
        investigation.codeOwner.name,
        errorMessage,
        labels
      );

      const result = {
        codeOwner: investigation.codeOwner,
        pullRequest: investigation.pullRequests,
        jiraTicket,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
