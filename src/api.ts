import axios from "axios";
import { loadConfig } from "./config.js";
import type {
  BlameResponse,
  PullRequestResponse,
  SimplifiedPullRequest,
  CodeOwnerInfo,
  PullRequestResult,
  JiraTicketResult,
  CommitsResponse,
  CommitsResult,
} from "./types.js";

const config = loadConfig();

/**
 * Find code owner by file path and line number using Bitbucket blame API
 */
export async function findCodeOwner(
  filePath: string,
  lineNumber: number,
  branch: string = "release/1.5"
): Promise<CodeOwnerInfo> {
  const { bitbucket } = config;
  const auth = Buffer.from(`${bitbucket.username}:${bitbucket.password}`).toString("base64");

  const url = `${bitbucket.baseUrl}/rest/api/1.0/projects/${bitbucket.project}/repos/${bitbucket.repo}/browse/${filePath}`;
  
  try {
    const response = await axios.get<BlameResponse>(url, {
      params: {
        at: branch,
        start: lineNumber,
        limit: 1,
        blame: true,
        noContent: true,
      },
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (response.data.values && response.data.values.length > 0) {
      const blame = response.data.values[0];
      return {
        commitId: blame.commitId,
        author: blame.author.displayName || blame.author.name,
        name: blame.author.name,
        email: blame.author.emailAddress,
      };
    }

    throw new Error("No blame information found for this line");
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorDetails = error.response?.data?.errors?.[0]?.message || error.response?.statusText || error.message;
      throw new Error(
        `Bitbucket API error: ${error.response?.status} - ${errorDetails}\n` +
        `请求的 URL: ${url}\n` +
        `分支: ${branch}\n` +
        `文件路径: ${filePath}\n` +
        `提示: 请检查 .env 中的 BITBUCKET_PROJECT, BITBUCKET_REPO 配置是否正确，以及分支名和文件路径是否存在`
      );
    }
    throw error;
  }
}

/**
 * Get pull request information by commit ID from Bitbucket
 */
export async function getPullRequestByCommit(
  commitId: string,
  filterByAuthor?: string,
  filterByState?: string
): Promise<PullRequestResult> {
  const { bitbucket } = config;
  const auth = Buffer.from(`${bitbucket.username}:${bitbucket.password}`).toString("base64");

  const url = `${bitbucket.baseUrl}/rest/api/1.0/projects/${bitbucket.project}/repos/${bitbucket.repo}/commits/${commitId}/pull-requests`;

  try {
    const response = await axios.get<PullRequestResponse>(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    // 映射为简化的 PR 信息
    let simplifiedValues: SimplifiedPullRequest[] = response.data.values.map(pr => ({
      id: pr.id,
      title: pr.title,
      description: pr.description,
      state: pr.state,
      toRefDisplayId: pr.toRef.displayId,
      author: {
        user: {
          name: pr.author.user.name,
          emailAddress: pr.author.user.emailAddress,
          id: pr.author.user.id,
          displayName: pr.author.user.displayName,
        },
      },
      links: {
        self: pr.links.self,
      },
    }));

    // 应用过滤条件
    if (filterByAuthor) {
      simplifiedValues = simplifiedValues.filter(pr => pr.author.user.name === filterByAuthor);
    }
    if (filterByState) {
      simplifiedValues = simplifiedValues.filter(pr => pr.state === filterByState);
    }
    // 只保留 toRef.displayId 为配置的目标分支的 PR
    simplifiedValues = simplifiedValues.filter(pr => pr.toRefDisplayId === config.bitbucket.prTargetBranch);

    return {
      size: simplifiedValues.length,
      limit: response.data.limit,
      isLastPage: response.data.isLastPage,
      values: simplifiedValues,
      start: response.data.start,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Bitbucket API error: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create a JIRA ticket
 */
export async function createJiraTicket(
  summary: string,
  description: string,
  assignee: string,
  labels: string[] = []
): Promise<JiraTicketResult> {
  const { jira } = config;
  const auth = Buffer.from(`${jira.username}:${jira.password}`).toString("base64");

  const url = `${jira.baseUrl}/rest/api/2/issue`;

  const payload = {
    fields: {
      project: { key: jira.projectKey },
      summary,
      description,
      issuetype: { id: jira.issueTypeId },
      priority: { id: jira.priorityId },
      components: [{ id: jira.componentId }],
      labels,
      customfield_10206: 40.0,
      assignee: { name: assignee },
    },
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    });

    return {
      key: response.data.key,
      url: `${jira.baseUrl}/browse/${response.data.key}`,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorData = error.response?.data;
      throw new Error(`JIRA API error: ${error.response?.status} - ${JSON.stringify(errorData)}`);
    }
    throw error;
  }
}

/**
 * Get commits by directory path from Bitbucket
 * @param path - Directory path in the repository (e.g., 'cbs_claim_catalog/cbs_claim/src/main/java/cbs/claim/application')
 * @param options - Query options
 * @returns Simplified commit information (filtered by time in code)
 */
export async function getCommitsByPath(
  path: string,
  options: {
    daysAgo?: number;
    limit?: number;
    excludeMerges?: boolean;
    branch?: string;
  } = {}
): Promise<CommitsResult> {
  const { bitbucket } = config;
  const auth = Buffer.from(`${bitbucket.username}:${bitbucket.password}`).toString("base64");

  const {
    daysAgo = 7,
    limit = 50,
    excludeMerges = true,
    branch = config.server.defaultBranch,
  } = options;

  const url = `${bitbucket.baseUrl}/rest/api/1.0/projects/${bitbucket.project}/repos/${bitbucket.repo}/commits`;

  const params: Record<string, any> = {
    path,
    limit,
  };

  if (branch) {
    params.until = branch;
  }

  if (excludeMerges) {
    params.merges = "exclude";
  }

  try {
    const response = await axios.get<CommitsResponse>(url, {
      params,
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    // 计算时间阈值
    const now = Date.now();
    const timeThreshold = now - daysAgo * 24 * 60 * 60 * 1000;

    // 简化返回数据，只保留需要的字段，并按时间过滤
    const simplifiedValues = response.data.values
      .filter(commit => commit.authorTimestamp >= timeThreshold)
      .map(commit => ({
        id: commit.id,
        authorName: commit.author.name,
        authorEmail: commit.author.emailAddress,
        authorDisplayName: commit.author.displayName,
        authorTimestamp: commit.authorTimestamp,
      }));

    // 格式化日期
    const formatDate = (timestamp: number) => {
      const date = new Date(timestamp);
      return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
    };

    const fromDate = formatDate(timeThreshold);
    const toDate = formatDate(now);
    const recordCount = simplifiedValues.length;

    return {
      size: recordCount,
      limit: response.data.limit,
      isLastPage: response.data.isLastPage,
      start: response.data.start,
      timeRange: {
        from: fromDate,
        to: toDate,
        daysAgo,
      },
      summary: `${fromDate}到${toDate} 共${recordCount}条记录`,
      values: simplifiedValues,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorDetails = error.response?.data?.errors?.[0]?.message || error.response?.statusText || error.message;
      throw new Error(
        `Bitbucket Commits API error: ${error.response?.status} - ${errorDetails}\n` +
        `请求的 URL: ${url}\n` +
        `路径: ${path}\n` +
        `提示: 请检查目录路径是否存在于仓库中`
      );
    }
    throw error;
  }
}
