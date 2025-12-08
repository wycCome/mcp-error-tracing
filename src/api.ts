import axios from "axios";
import { loadConfig } from "./config.js";
import type {
  BlameResponse,
  PullRequestResponse,
  SimplifiedPullRequest,
  CodeOwnerInfo,
  PullRequestResult,
  JiraTicketResult,
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
      throw new Error(`Bitbucket API error: ${error.response?.status} - ${error.message}`);
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
