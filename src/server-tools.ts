/**
 * Shared tool registration for MCP server
 * This module provides a unified way to register all tools across different server types
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findCodeOwner, getPullRequestByCommit } from "./api.js";
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
   * Tool: Create JIRA ticket
   */
  server.registerTool(
    "create_jira_ticket",
    {
      description: 
        "Create a JIRA ticket with AI-generated error analysis and investigation results from investigate_error tool. " +
        "The ticket will include code owner information, related pull requests, and detailed error analysis.",
      inputSchema: {
        summary: z.string().describe(
          "AI-generated Chinese summary that concisely describes the core cause of the error, not a direct paste of error code or stack trace. " +
          "Example: '用户输入未校验导致空指针异常' instead of 'NullPointerException at line 123'"
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
          "AI-generated Chinese error analysis (can be JSON string or object): " +
          '{"errorInfo": "异常类型：{ExceptionType}。堆栈跟踪：{简要堆栈路径，例如：ClassA.methodX(File.java:123) -> ClassB.methodY(File.java:456)}。", ' +
          '"analysis": "根本原因：{用一两句话说明导致异常的直接原因，例如：未对用户输入做空值校验、配置缺失、类型转换错误等}。该问题引入于 {需求编号}。风险：{说明该问题对系统、业务或用户体验的影响，例如：可能导致服务中断、数据丢失、流程失败等}。", ' +
          '"suggestions": "修复建议：{具体、可操作的修复步骤，也可以写伪代码示例，若逻辑简单，可直接给出示例代码}。"}'
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
      description: "Investigate an error by finding the code owner and related pull requests. Returns complete investigation data in JSON format that can be used with create_jira_ticket.",
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
