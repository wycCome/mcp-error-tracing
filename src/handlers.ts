import { findCodeOwner, getPullRequestByCommit, createJiraTicket } from "./api.js";
import type { ErrorInvestigationResult, ErrorAnalysisData } from "./types.js";

/**
 * Investigate error - find code owner and related PRs
 * This returns data for AI analysis before creating JIRA ticket
 */
export async function investigateError(
  filePath: string,
  lineNumber: number,
  branch: string = "release/1.5"
): Promise<ErrorInvestigationResult> {
  // Step 1: Find code owner
  const owner = await findCodeOwner(filePath, lineNumber, branch);

  // Step 2: Get PR info (filter by owner and MERGED status)
  const prInfo = await getPullRequestByCommit(owner.commitId, owner.name, "MERGED");

  // Step 3: Extract PR links
  const relatedPRLinks = prInfo.values.map(pr => pr.links.self[0].href);

  return {
    codeOwner: owner,
    pullRequests: prInfo,
    relatedPRLinks,
    filePath,
    lineNumber,
    branch,
  };
}

/**
 * Format JIRA description with error info and investigation results
 */
export function formatJiraDescription(
  errorAnalysis: string | ErrorAnalysisData,
  investigation: ErrorInvestigationResult
): string {
  const { codeOwner, pullRequests, filePath, lineNumber, branch } = investigation;
  
  // 解析或使用 errorAnalysis（包含错误信息、报错分析、修改建议）
  let errorData: ErrorAnalysisData;
  
  if (typeof errorAnalysis === 'string') {
    // 如果是字符串，尝试解析 JSON
    try {
      errorData = JSON.parse(errorAnalysis);
    } catch {
      // 如果不是 JSON，当作普通错误信息处理
      errorData = { errorInfo: errorAnalysis, analysis: "未使用大模型分析", suggestions: "未使用大模型分析" };
    }
  } else {
    // 如果已经是对象，直接使用
    errorData = errorAnalysis;
  }
  
  // 格式化错误信息部分
  let description = "h2. 错误信息\r\n{code:java}\r\n" + (errorData.errorInfo || errorAnalysis) + "\r\n{code}\r\n\r\n";
  description += "h2. 报错分析\r\n" + (errorData.analysis || "未使用大模型分析") + "\r\n\r\n";
  description += "h2. 修改建议\r\n" + (errorData.suggestions || "未使用大模型分析") + "\r\n\r\n";
  description += "----\r\n\r\n";

  description += "h2. 代码位置\r\n";
  description += "* 文件: {{" + filePath + "}}\r\n";
  description += "* 行号: {{" + lineNumber + "}}\r\n";
  description += "* 分支: {{" + branch + "}}\r\n\r\n";

  description += "h2. 代码责任人\r\n";
  description += "* 作者: " + codeOwner.author + "\r\n";
  description += "* 邮箱: " + codeOwner.email + "\r\n";
  description += "* Commit: {{" + codeOwner.commitId + "}}\r\n";
  description += "* [查看Commit|" + process.env.BITBUCKET_BASE_URL + "/projects/" + process.env.BITBUCKET_PROJECT?.toUpperCase() + "/repos/" + process.env.BITBUCKET_REPO + "/commits/" + codeOwner.commitId + "]\r\n\r\n";

  // PR 信息已经在 investigateError 中过滤过了（只包含责任人的 MERGED PR）
  if (pullRequests.values.length > 0) {
    description += "h2. 相关 Pull Request\r\n";
    pullRequests.values.forEach(pr => {
      description += "* PR #" + pr.id + " - " + pr.state + "\r\n";
      description += "** 标题: " + pr.title + "\r\n";
      description += "** 作者: " + pr.author.user.displayName + "\r\n";
      description += "** [查看详情|" + pr.links.self[0].href + "]\r\n";
    });
  }

  // 如果有堆栈代码上下文，添加到描述中（供参考）
  if (investigation.stackFramesWithCode && investigation.stackFramesWithCode.length > 0) {
    description += "\r\n----\r\n\r\n";
    description += "h2. 堆栈代码上下文（已由 AI 分析）\r\n";
    description += "{panel:title=💡 提示|borderStyle=solid|borderColor=#ccc|titleBGColor=#e3fcef}\r\n";
    description += "以下代码片段已由 AI 模型分析，用于确定真实的错误根源。上述分析和建议基于对这些代码的理解。\r\n";
    description += "{panel}\r\n\r\n";
    
    investigation.stackFramesWithCode.forEach((frameWithCode, index) => {
      const { frame, code, startLine, endLine } = frameWithCode;
      description += "{code:title=" + (index + 1) + ". " + frame.className + "." + frame.methodName + " (" + frame.filePath + ":" + frame.lineNumber + ")|collapse=true|linenumbers=true|firstline=" + startLine + "}\r\n";
      description += code + "\r\n";
      description += "{code}\r\n\r\n";
    });
  }

  return description;
}

/**
 * Create JIRA ticket with investigation data
 */
export async function createJiraTicketWithInvestigation(
  summary: string,
  investigationData: string | ErrorInvestigationResult,
  assignee: string,
  errorAnalysis: string | ErrorAnalysisData,
  labels: string[] = []
) {
  // 解析或验证 investigationData
  let investigation: ErrorInvestigationResult;
  
  if (typeof investigationData === 'string') {
    // 如果是字符串，尝试解析 JSON
    try {
      investigation = JSON.parse(investigationData);
    } catch (error) {
      throw new Error(
        `无效的 investigationData 格式：无法解析 JSON 字符串。` +
        `请确保传入的是 investigate_error 工具返回的完整、未经修改的 JSON 字符串，` +
        `解决方法：\n` +
        `1. 检查之前是否已调用 investigate_error，如果有，请使用其返回的完整结果（JSON 字符串或对象）\n` +
        `2. 如果之前的结果丢失或不完整，请重新调用 investigate_error 工具获取最新数据\n` +
        `3. 不要手动构造 investigationData，必须使用 investigate_error 的原始返回值`
      );
    }
  } else {
    // 如果已经是对象，直接使用
    investigation = investigationData;
  }

  // 验证数据结构完整性
  const missingFields = [];
  if (!investigation.codeOwner) missingFields.push('codeOwner');
  if (!investigation.pullRequests) missingFields.push('pullRequests');
  
  if (missingFields.length > 0) {
    throw new Error(
      `无效的调查数据结构：缺少 ${missingFields.join('、')} 字段。` +
      `investigationData 必须是 investigate_error 工具返回的完整数据。\n` +
      `解决方法：\n` +
      `1. 检查之前是否已调用 investigate_error，如果有，请使用其返回的完整结果（JSON 字符串或对象）\n` +
      `2. 如果之前的结果丢失或不完整，请重新调用 investigate_error 工具获取最新数据\n` +
      `3. 不要手动构造 investigationData，必须使用 investigate_error 的原始返回值`
    );
  }

  // 使用解析后的对象和 errorAnalysis 格式化 JIRA 描述
  const finalDescription = formatJiraDescription(errorAnalysis, investigation);

  // 创建 JIRA ticket
  return createJiraTicket(summary, finalDescription, assignee, labels);
}
