import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "loopgraph/core";
import {
  initLoopgraphWorkspace,
  loadRoutingCardsFromProject,
  readLoopgraphWorkspace,
  writeLoopgraphWorkspace
} from "loopgraph/runtime";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("semantic graph transaction API", () => {
  it("requires authentication and applies an approved lifecycle transaction to the active project", async () => {
    const projectRoot = await createGraphProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    vi.stubEnv("LOOPGRAPH_WORKER_API_TOKEN", "graph-api-token");

    const unauthorized = await GET(new Request("https://loopgraph.local/api/graph/transactions"));
    expect(unauthorized.status).toBe(401);

    const approvalResponse = await postGraphAction({
      action: "lifecycle_approve",
      projectRoot: "/tmp/caller-must-not-control-project",
      loopId: "marketing_ads",
      nextStatus: "paused",
      actorId: "operator_1",
      actorRole: "owner",
      policyVersion: "graph-policy/v1",
      reason: "Pause routing while campaign evidence is repaired.",
      evidenceRefs: ["review:pause_marketing_ads"]
    });
    const approval = await approvalResponse.json();
    expect(approvalResponse.status).toBe(202);
    expect(approval).toMatchObject({
      receipt: {
        subjectType: "lifecycle",
        loopId: "marketing_ads",
        nextLifecycleStatus: "paused",
        decision: "approved"
      }
    });

    const applyResponse = await postGraphAction({
      action: "lifecycle_set",
      loopId: "marketing_ads",
      nextStatus: "paused",
      approvalReceiptId: approval.receipt.id,
      initiatedBy: "operator_1"
    });
    const applied = await applyResponse.json();
    expect(applyResponse.status).toBe(202);
    expect(applied).toMatchObject({
      transaction: {
        kind: "lifecycle",
        status: "committed"
      }
    });

    const routes = await loadRoutingCardsFromProject({ projectRoot });
    expect(routes).toEqual([
      expect.objectContaining({
        loopId: "marketing_ads",
        loopStatus: "disabled"
      })
    ]);

    const historyResponse = await GET(new Request("https://loopgraph.local/api/graph/transactions", {
      headers: { authorization: "Bearer graph-api-token" }
    }));
    const history = await historyResponse.json();
    expect(historyResponse.status).toBe(200);
    expect(history).toMatchObject({
      transactions: [expect.objectContaining({ id: applied.transaction.id })],
      approvals: [expect.objectContaining({ id: approval.receipt.id })]
    });
  });
});

async function postGraphAction(body: Record<string, unknown>) {
  return POST(new Request("https://loopgraph.local/api/graph/transactions", {
    method: "POST",
    headers: {
      authorization: "Bearer graph-api-token",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  }));
}

async function createGraphProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-graph-api-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "graph-api-test" }));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
  await initLoopgraphWorkspace({ projectRoot });
  const workspace = await readLoopgraphWorkspace(projectRoot);
  await writeLoopgraphWorkspace({
    ...workspace,
    registeredSpecs: [{
      id: "marketing_ads",
      name: "Ads",
      path: path.relative(projectRoot, specPath),
      department: "marketing",
      addedAt: "2026-07-29T12:00:00.000Z"
    }]
  }, projectRoot);
  return projectRoot;
}

function marketingAdsSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "marketing_ads",
      name: "Ads",
      version: "1.0.0",
      description: "Improve qualified acquisition efficiency."
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{
        id: "observe",
        name: "Observe",
        stepType: "observe",
        actor: "system",
        description: "Observe campaign signals."
      }]
    },
    tools: [{
      key: "draft_review",
      adapterId: "manual",
      label: "Draft review",
      writeCapable: false,
      riskLevel: "low"
    }],
    policy: {
      allowedActions: [{
        toolKey: "draft_review",
        allowed: true,
        requiresApproval: false,
        riskLevel: "low"
      }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["owner"]
    },
    persistence: { idempotency: { enabled: true } },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true
    },
    topology: { department: "marketing" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct"]
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow"
    }
  };
}
