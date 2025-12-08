/**
 * Type definitions for Bitbucket and JIRA APIs
 */

/**
 * Interface for blame response from Bitbucket
 */
export interface BlameResponse {
  size: number;
  limit: number;
  isLastPage: boolean;
  start: number;
  values: Array<{
    author: {
      name: string;
      emailAddress: string;
      displayName: string;
      id: number;
      active: boolean;
      slug: string;
      type: string;
    };
    authorTimestamp: number;
    committer: {
      name: string;
      emailAddress: string;
      displayName: string;
    };
    committerTimestamp: number;
    commitHash: string;
    commitId: string;
    displayCommitHash: string;
    commitDisplayId: string;
    fileName: string;
    lineNumber: number;
    spannedLines: number;
  }>;
}

/**
 * Interface for PR response from Bitbucket (full response)
 */
export interface PullRequestResponse {
  size: number;
  limit: number;
  isLastPage: boolean;
  values: Array<{
    id: number;
    version: number;
    title: string;
    description: string;
    state: string;
    open: boolean;
    closed: boolean;
    createdDate: number;
    updatedDate: number;
    closedDate?: number;
    fromRef: {
      id: string;
      displayId: string;
      latestCommit: string;
      repository: {
        slug: string;
        id: number;
        name: string;
        description: string;
        hierarchyId: string;
        scmId: string;
        state: string;
        statusMessage: string;
        forkable: boolean;
        project: {
          key: string;
          id: number;
          name: string;
          description: string;
          public: boolean;
          type: string;
          links: {
            self: Array<{ href: string }>;
          };
        };
        public: boolean;
        links: {
          clone: Array<{ href: string; name: string }>;
          self: Array<{ href: string }>;
        };
      };
    };
    toRef: {
      id: string;
      displayId: string;
      latestCommit: string;
      repository: {
        slug: string;
        id: number;
        name: string;
        description: string;
        hierarchyId: string;
        scmId: string;
        state: string;
        statusMessage: string;
        forkable: boolean;
        project: {
          key: string;
          id: number;
          name: string;
          description: string;
          public: boolean;
          type: string;
          links: {
            self: Array<{ href: string }>;
          };
        };
        public: boolean;
        links: {
          clone: Array<{ href: string; name: string }>;
          self: Array<{ href: string }>;
        };
      };
    };
    locked: boolean;
    author: {
      user: {
        name: string;
        emailAddress: string;
        id: number;
        displayName: string;
        active: boolean;
        slug: string;
        type: string;
        links: {
          self: Array<{ href: string }>;
        };
      };
      role: string;
      approved: boolean;
      status: string;
    };
    reviewers: Array<{
      user: {
        name: string;
        emailAddress: string;
        id: number;
        displayName: string;
        active: boolean;
        slug: string;
        type: string;
        links: {
          self: Array<{ href: string }>;
        };
      };
      lastReviewedCommit?: string;
      role: string;
      approved: boolean;
      status: string;
    }>;
    participants: Array<{
      user: {
        name: string;
        emailAddress: string;
        id: number;
        displayName: string;
        active: boolean;
        slug: string;
        type: string;
        links: {
          self: Array<{ href: string }>;
        };
      };
      role: string;
      approved: boolean;
      status: string;
    }>;
    properties: {
      resolvedTaskCount: number;
      commentCount?: number;
      openTaskCount: number;
      mergeResult?: {
        outcome: string;
        current: boolean;
      };
    };
    links: {
      self: Array<{
        href: string;
      }>;
    };
  }>;
  start: number;
}

/**
 * Simplified PR information
 */
export interface SimplifiedPullRequest {
  id: number;
  title: string;
  description: string;
  state: string;
  toRefDisplayId: string;
  author: {
    user: {
      name: string;
      emailAddress: string;
      id: number;
      displayName: string;
    };
  };
  links: {
    self: Array<{
      href: string;
    }>;
  };
}

/**
 * Code owner information
 */
export interface CodeOwnerInfo {
  commitId: string;
  author: string; // display name if available
  name: string;   // raw Bitbucket username
  email: string;
}

/**
 * Pull request result
 */
export interface PullRequestResult {
  size: number;
  limit: number;
  isLastPage: boolean;
  values: SimplifiedPullRequest[];
  start: number;
}

/**
 * JIRA ticket result
 */
export interface JiraTicketResult {
  key: string;
  url: string;
}

/**
 * Error analysis data structure
 */
export interface ErrorAnalysisData {
  errorInfo?: string;
  analysis?: string;
  suggestions?: string;
}

/**
 * Error investigation result (for AI analysis)
 */
export interface ErrorInvestigationResult {
  codeOwner: CodeOwnerInfo;
  pullRequests: PullRequestResult;
  relatedPRLinks: string[];
  filePath: string;
  lineNumber: number;
  branch: string;
}

/**
 * Full error tracking result
 */
export interface ErrorTrackingResult {
  codeOwner: CodeOwnerInfo;
  pullRequest: PullRequestResult;
  jiraTicket: JiraTicketResult;
}
