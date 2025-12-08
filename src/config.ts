/**
 * Configuration for Bitbucket and JIRA APIs
 */
export interface Config {
  server: {
    httpPort: number;
    compatiblePort: number;
    defaultBranch: string;
  };
  bitbucket: {
    username: string;
    password: string;
    baseUrl: string;
    project: string;
    repo: string;
    prTargetBranch: string;
  };
  jira: {
    username: string;
    password: string;
    baseUrl: string;
    projectKey: string;
    issueTypeId: string;
    priorityId: string;
    componentId: string;
  };
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  return {
    server: {
      httpPort: process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : 3000,
      compatiblePort: process.env.COMPATIBLE_PORT ? parseInt(process.env.COMPATIBLE_PORT, 10) : 3001,
      defaultBranch: process.env.DEFAULT_BRANCH || 'main',
    },
    bitbucket: {
      username: process.env.BITBUCKET_USERNAME || '',
      password: process.env.BITBUCKET_PASSWORD || '',
      baseUrl: process.env.BITBUCKET_BASE_URL || 'https://your-bitbucket-server.com',
      project: process.env.BITBUCKET_PROJECT || 'your_project',
      repo: process.env.BITBUCKET_REPO || 'your_repo',
      prTargetBranch: process.env.PR_TARGET_BRANCH || 'main',
    },
    jira: {
      username: process.env.JIRA_USERNAME || '',
      password: process.env.JIRA_PASSWORD || '',
      baseUrl: process.env.JIRA_BASE_URL || 'https://your-jira-server.com',
      projectKey: process.env.JIRA_PROJECT_KEY || 'YOUR_PROJECT',
      issueTypeId: process.env.JIRA_ISSUE_TYPE_ID || '10101',
      priorityId: process.env.JIRA_PRIORITY_ID || '10000',
      componentId: process.env.JIRA_COMPONENT_ID || '12505',
    },
  };
}
