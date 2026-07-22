import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_PLAN_SCHEMA_VERSION,
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  loopRoutingContractSchema,
  type ConnectionPlan,
  type LoopSpec
} from "../core";
import type { StorageAdapter } from "../sdk/adapters";
import { isGitHubAdapterConfigured } from "./context-compiler";
import { evaluateLiveExecutionGate, executeLoop } from "./executor";

const originalExecuteEnabled = process.env.LOOPGRAPH_EXECUTE_ENABLED;

afterEach(() => {
  if (originalExecuteEnabled === undefined) {
    delete process.env.LOOPGRAPH_EXECUTE_ENABLED;
  } else {
    process.env.LOOPGRAPH_EXECUTE_ENABLED = originalExecuteEnabled;
  }
  vi.restoreAllMocks();
});

describe("execute path configuration", () => {
  it("detects when GitHub adapter env is missing", () => {
    const original = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_OWNER: process.env.GITHUB_OWNER,
      GITHUB_REPO: process.env.GITHUB_REPO
    };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_OWNER;
    delete process.env.GITHUB_REPO;
    expect(isGitHubAdapterConfigured()).toBe(false);
    process.env.GITHUB_TOKEN = original.GITHUB_TOKEN;
    process.env.GITHUB_OWNER = original.GITHUB_OWNER;
    process.env.GITHUB_REPO = original.GITHUB_REPO;
  });

  it("detects when GitHub adapter env is present", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_OWNER = "acme";
    process.env.GITHUB_REPO = "demo";
    expect(isGitHubAdapterConfigured()).toBe(true);
  });
});

describe("live execution gate", () => {
  it("requires a Hermes routing contract before live execution", async () => {
    const spec = hermesLoopSpec();
    delete (spec as Partial<LoopSpec>).routing;

    const gate = await evaluateLiveExecutionGate({ spec });

    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("routing_contract_required");
  });

  it("blocks shadow loops even when the global execute flag is enabled", async () => {
    process.env.LOOPGRAPH_EXECUTE_ENABLED = "true";
    const spec = hermesLoopSpec({ activationMode: "shadow" });

    await expect(executeLoop({
      spec,
      triggerPayload: { eventId: "evt_1" },
      eventId: "evt_1",
      storage: stubStorage()
    })).rejects.toThrow(/activationMode=shadow/);
  });

  it("requires external provider webhooks to terminate at Hermes", async () => {
    const spec = hermesLoopSpec({
      activationMode: "execute_with_approval",
      trigger: { type: "webhook", source: "github", event: "issues.opened" }
    });

    const gate = await evaluateLiveExecutionGate({ spec });

    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("webhooks_must_enter_through_hermes");
  });

  it("requires approval and fingerprint binding for risky live writes", async () => {
    const spec = hermesLoopSpec({
      activationMode: "execute_with_approval",
      toolRiskLevel: "medium",
      actionRiskLevel: "medium",
      requiresApproval: false
    });

    const gate = await evaluateLiveExecutionGate({ spec });

    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("risky_write_requires_approval");
    expect(gate.reasons.map((reason) => reason.code)).toContain("risky_policy_requires_approval");
  });

  it("requires separate approval for customer-facing actions", async () => {
    const spec = hermesLoopSpec({
      activationMode: "execute_with_approval",
      customerFacing: true,
      separateCustomerFacingApproval: false,
      requiresApproval: true
    });

    const gate = await evaluateLiveExecutionGate({ spec });

    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("customer_facing_separation_required");
  });

  it("keeps autonomous mode limited to low-risk non-customer-facing actions", async () => {
    const spec = hermesLoopSpec({
      activationMode: "autonomous_low_risk",
      toolRiskLevel: "medium",
      actionRiskLevel: "medium",
      requiresApproval: true
    });

    const gate = await evaluateLiveExecutionGate({ spec });

    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("autonomous_write_risk_too_high");
  });

  it("requires declared live connectors to be connected outside simulation", async () => {
    const spec = hermesLoopSpec({
      activationMode: "execute_with_approval",
      requiredConnections: ["ads.performance"]
    });

    const gate = await evaluateLiveExecutionGate({
      spec,
      connectionPlan: connectionPlan({ status: "manual_fallback", environment: "simulate" })
    });

    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toContain("connection_not_ready_for_live_execution");
  });

  it("allows execute_with_approval when routing, policy, and connector gates are ready", async () => {
    const spec = hermesLoopSpec({
      activationMode: "execute_with_approval",
      requiredConnections: ["ads.performance"],
      requiresApproval: true,
      separateCustomerFacingApproval: true
    });

    const gate = await evaluateLiveExecutionGate({
      spec,
      connectionPlan: connectionPlan({ status: "connected", environment: "sandbox" }),
      now: new Date("2026-07-21T12:30:00.000Z")
    });

    expect(gate.allowed).toBe(true);
    expect(gate.checkedAt).toBe("2026-07-21T12:30:00.000Z");
    expect(gate.requiredActions).toEqual([]);
    expect(gate.connectorChecks).toEqual([{
      capability: "ads.performance",
      requiredFor: "routing",
      status: "connected",
      connectedRuntimeInstances: [{
        instanceId: "conn_google_ads",
        manifestId: "google_ads",
        environment: "sandbox"
      }]
    }]);
  });
});

function hermesLoopSpec(input: {
  activationMode?: "shadow" | "recommend" | "simulate" | "execute_with_approval" | "autonomous_low_risk";
  trigger?: LoopSpec["trigger"];
  toolRiskLevel?: "low" | "medium" | "high" | "critical";
  actionRiskLevel?: "low" | "medium" | "high" | "critical";
  requiresApproval?: boolean;
  customerFacing?: boolean;
  separateCustomerFacingApproval?: boolean;
  requiredConnections?: string[];
} = {}): LoopSpec {
  const toolRiskLevel = input.toolRiskLevel ?? "medium";
  const actionRiskLevel = input.actionRiskLevel ?? toolRiskLevel;
  const requiresApproval = input.requiresApproval ?? actionRiskLevel !== "low";
  const customerFacing = input.customerFacing ?? false;

  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "marketing_ads_live_gate",
      name: "Marketing Ads Live Gate",
      version: "1.0.0",
      description: "Hermes-routed ads optimization loop."
    },
    trigger: input.trigger ?? { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [], redactionPolicy: "restricted_only" },
    routine: {
      steps: [{
        id: "assess",
        name: "Assess",
        stepType: "assess",
        actor: "agent",
        description: "Assess the Hermes-normalized business event."
      }]
    },
    tools: [{
      key: "apply_ads_budget_change",
      adapterId: "google_ads",
      label: "Apply ads budget change",
      writeCapable: true,
      riskLevel: toolRiskLevel
    }],
    policy: {
      allowedActions: [{
        toolKey: "apply_ads_budget_change",
        allowed: true,
        requiresApproval,
        customerFacing,
        riskLevel: actionRiskLevel
      }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: input.separateCustomerFacingApproval ?? true,
      allowedRoles: ["approver"]
    },
    persistence: { idempotency: { enabled: true } },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: false
    },
    topology: {
      department: "marketing",
      tags: ["hermes"]
    },
    routing: loopRoutingContractSchema.parse({
      problemTypes: ["marketing.ads.performance"],
      accepts: [{
        sourcePattern: "*",
        eventTypePattern: "*",
        subjectTypes: ["campaign"],
        requiredFields: ["normalizedPayload.signal"]
      }],
      inputMapping: { signal: "normalizedPayload.signal" },
      activationMode: input.activationMode ?? "execute_with_approval",
      requiredConnections: input.requiredConnections ?? []
    })
  };
}

function connectionPlan(input: {
  status: "missing" | "manual_fallback" | "connected" | "degraded";
  environment: "simulate" | "sandbox" | "live";
}): ConnectionPlan {
  return {
    schemaVersion: CONNECTION_PLAN_SCHEMA_VERSION,
    projectRootId: "project_test",
    generatedAt: "2026-07-21T12:00:00.000Z",
    summary: {
      totalCapabilities: 1,
      missingCapabilities: input.status === "missing" ? 1 : 0,
      manualFallbackCapabilities: input.status === "manual_fallback" ? 1 : 0,
      connectedCapabilities: input.status === "connected" ? 1 : 0,
      readyForRouting: input.status === "connected",
      readyForSimulation: true,
      readyForExecution: input.status === "connected"
    },
    items: [{
      capability: "ads.performance",
      status: input.status,
      requiredFor: ["routing", "execution"],
      loops: [{
        loopId: "marketing_ads_live_gate",
        loopName: "Marketing Ads Live Gate",
        department: "marketing",
        requiredFor: "execution",
        reason: "Required to execute ads changes."
      }],
      manualFallbacks: input.status === "manual_fallback" ? ["Upload a redacted CSV export."] : [],
      requiredFromUser: [],
      suggestedConnectors: [],
      compatibleConnections: input.status === "missing"
        ? []
        : [{
            instanceId: "conn_google_ads",
            manifestId: "google_ads",
            status: input.status,
            environment: input.environment
          }],
      webhookRouteHints: [],
      authority: {
        hermesReceivesEvents: true,
        loopgraphCanRead: true,
        loopgraphCanWrite: true,
        notes: []
      },
      blockingFor: input.status === "connected" ? [] : ["execution"],
      sourceRefs: ["test"]
    }],
    warnings: []
  };
}

function stubStorage(): StorageAdapter {
  return {
    saveRun: vi.fn(),
    getRun: vi.fn(),
    saveReview: vi.fn(),
    saveEscalationCase: vi.fn(),
    getEscalationCase: vi.fn(),
    listRuns: vi.fn(),
    listCases: vi.fn()
  };
}
