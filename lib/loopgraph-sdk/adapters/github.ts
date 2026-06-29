import type {
  ActionResult,
  CommitPreparedActionInput,
  IntegrationAdapter,
  PreparedActionInput,
  PreparedActionResult,
  VariableValue
} from "../adapters";
import { contentHash } from "../../loopgraph-core/hash";

type GitHubConfig = {
  token: string;
  owner: string;
  repo: string;
};

function getConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN ?? process.env.LOOPGRAPH_GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER ?? process.env.LOOPGRAPH_GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO ?? process.env.LOOPGRAPH_GITHUB_REPO;
  if (!token || !owner || !repo) {
    throw new Error("GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO are required for GitHubAdapter");
  }
  return { token, owner, repo };
}

async function githubRequest(path: string, init?: RequestInit) {
  const config = getConfig();
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }
  return response.json();
}

export const githubAdapter: IntegrationAdapter = {
  id: "github",
  name: "GitHub",
  version: "1.0.0",
  getConfigSchema: () => ({ type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } } }),
  getAuthSchema: () => ({ type: "object", properties: { token: { type: "string" } } }),
  listVariables: () => [
    { key: "issue.body", label: "Issue body", description: "Issue body text", type: "string", sensitivity: "internal" },
    { key: "issue.labels", label: "Issue labels", description: "Issue labels", type: "string", sensitivity: "public" },
    { key: "repo.policy", label: "Repo policy", description: "Repository policy note", type: "string", sensitivity: "internal" }
  ],
  listActions: () => [
    { key: "propose_labels", label: "Propose labels", description: "Add labels to issue", writeCapable: true, riskLevel: "medium" },
    { key: "draft_response", label: "Draft response", description: "Comment on issue", writeCapable: true, riskLevel: "medium" }
  ],
  listSignals: () => [{ key: "issues.opened", label: "Issue opened" }],

  async readVariable(key, fixture: Record<string, unknown>) {
    const issue = fixture.issue as Record<string, unknown> | undefined;
    const repo = fixture.repo as Record<string, unknown> | undefined;
    const issueNumber = Number(issue?.number ?? fixture.issueNumber ?? 0);
    let value: unknown = null;

    if (key === "issue.body" && issueNumber) {
      const issue = await githubRequest(`/issues/${issueNumber}`);
      value = issue.body;
    } else if (key === "issue.labels" && issueNumber) {
      const issue = await githubRequest(`/issues/${issueNumber}`);
      value = (issue.labels ?? []).map((label: { name: string }) => label.name);
    } else if (key === "repo.policy") {
      value = repo?.policy ?? "Repository policy unavailable";
    } else {
      value = getByPath(fixture, key.replace(/^issue\./, "issue."));
    }

    return {
      key,
      value,
      retrievedAt: new Date().toISOString(),
      freshness: "realtime",
      trusted: key !== "issue.body"
    } satisfies VariableValue;
  },

  async prepareAction(input: PreparedActionInput): Promise<PreparedActionResult> {
    return {
      id: `prepared_${input.toolKey}`,
      toolKey: input.toolKey,
      label: input.toolKey,
      payload: input.payload,
      fingerprint: contentHash(input.payload),
      riskLevel: input.toolKey === "draft_response" ? "medium" : "medium",
      requiresApproval: true,
      customerFacing: input.toolKey === "draft_response"
    };
  },

  async commitPreparedAction(input: CommitPreparedActionInput): Promise<ActionResult> {
    const approved = input.approvedFingerprints.includes(input.preparedAction.fingerprint);
    if (!approved) {
      return { status: "rejected", message: "Fingerprint not approved", fingerprint: input.preparedAction.fingerprint };
    }

    const issueNumber = Number(input.preparedAction.payload.issueNumber ?? input.preparedAction.payload.issue_number ?? 0);
    if (!issueNumber) {
      return { status: "rejected", message: "Missing issueNumber in payload", fingerprint: input.preparedAction.fingerprint };
    }

    if (input.preparedAction.toolKey === "propose_labels") {
      const labels = (input.preparedAction.payload.labels as string[]) ?? [];
      await githubRequest(`/issues/${issueNumber}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels })
      });
      return { status: "mock_committed", message: `Labels applied to #${issueNumber}`, fingerprint: input.preparedAction.fingerprint };
    }

    if (input.preparedAction.toolKey === "draft_response") {
      await githubRequest(`/issues/${issueNumber}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: String(input.preparedAction.payload.body ?? "") })
      });
      return { status: "mock_committed", message: `Comment posted on #${issueNumber}`, fingerprint: input.preparedAction.fingerprint };
    }

    return { status: "rejected", message: `Unsupported tool ${input.preparedAction.toolKey}`, fingerprint: input.preparedAction.fingerprint };
  },

  async healthCheck() {
    try {
      await githubRequest("");
      return { ok: true, message: "GitHub repository reachable" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "GitHub health check failed" };
    }
  }
};

function getByPath(source: Record<string, unknown>, pathValue: string) {
  return pathValue.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}
