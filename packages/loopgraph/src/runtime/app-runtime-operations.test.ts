import { describe, expect, it, vi } from "vitest";
import type {
  BusinessProblem,
  EventReceipt,
  ObservedOutcome,
  RouteCommit,
  RouteJob,
  RoutingAttempt,
  ValueLedgerEntry
} from "../core";
import type { LoopSpecRegistryStore, StoredLoopSpecArtifact } from "./loop-spec-store";
import type { OutcomeStore } from "./outcome-store";
import type { RoutingStore } from "./routing-store";
import {
  LOOPGRAPH_APP_RUNTIME_OPERATION_CATALOG,
  LoopgraphAppRuntimeOperationRegistry,
  type AppRuntimeOperationRequest
} from "./app-runtime-operations";

const NOW = new Date("2026-08-21T12:00:00.000Z");

describe("Loopgraph App runtime operation registry", () => {
  it("exposes only the three bounded read handlers and rejects dynamic operation names", async () => {
    const fixture = createRegistry();
    expect(LOOPGRAPH_APP_RUNTIME_OPERATION_CATALOG.map((entry) => entry.operation)).toEqual([
      "graph.read",
      "routing-decisions.read",
      "outcomes-value.read"
    ]);
    await expect(fixture.registry.execute(request({ operation: "filesystem.read", input: {} })))
      .rejects.toThrow(/not registered/);
    await expect(fixture.registry.execute(request({ operation: "graph-change.propose", input: {} })))
      .rejects.toThrow(/not registered/);
  });

  it("returns a bounded topology summary without exposing LoopSpec routine or context bodies", async () => {
    const product = artifact("product-feedback", "Product Feedback", "product", "recommend");
    const marketing = artifact("marketing-campaign", "Campaign Learning", "marketing", "shadow");
    const fixture = createRegistry({ artifacts: [product, marketing] });

    const response = await fixture.registry.execute(request({
      operation: "graph.read",
      input: { departments: ["product"], limit: 10 }
    }));

    expect(response.result).toMatchObject({
      workspaceId: "workspace-main",
      companyId: "company-main",
      totalLoops: 2,
      returnedLoops: 1,
      loops: [{
        id: "product-feedback",
        department: "product",
        activationMode: "recommend",
        requiredCapabilities: ["support.feedback.read"]
      }]
    });
    expect(JSON.stringify(response.result)).not.toContain("private context");
    expect(response.resultDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("scopes routing history to the verified company object by default and strips provider payloads", async () => {
    const fixture = createRegistry({
      problems: [
        problem("problem-current", "account", "account-42"),
        problem("problem-other", "account", "account-99"),
        { ...problem("problem-cross-tenant", "account", "account-42"), companyId: "company-other" }
      ],
      receipts: [receipt("event-current", "account", "account-42")],
      attempts: [{
        id: "attempt-current",
        eventId: "event-current",
        catalogVersion: "catalog-v1",
        action: "route",
        status: "committed",
        decision: {
          schemaVersion: "routing-decision/v1alpha1",
          eventId: "event-current",
          catalogVersion: "catalog-v1",
          action: "route",
          existingProblemId: "problem-current",
          selectedRoutes: [{
            loopId: "customer-health",
            role: "primary",
            confidence: 0.96,
            reasonSummary: "Renewal evidence requires the customer health loop.",
            evidenceRefs: [],
            inputMapping: {},
            priority: 1
          }],
          alternatives: [],
          modelMetadata: { hiddenPrompt: "must not be returned" },
          policyVersion: "routing-v1"
        },
        validationErrors: [],
        hermesMetadata: { rawProviderPayload: "must not be returned" },
        createdAt: NOW.toISOString()
      }]
    });

    const response = await fixture.registry.execute(request({
      operation: "routing-decisions.read",
      input: {}
    }));

    expect(response.result).toMatchObject({
      scope: "object",
      returnedProblems: 1,
      decisions: [{
        problem: { id: "problem-current" },
        decision: { action: "route", selectedRoutes: [{ loopId: "customer-health" }] }
      }]
    });
    expect(JSON.stringify(response.result)).not.toContain("rawProviderPayload");
    expect(JSON.stringify(response.result)).not.toContain("hiddenPrompt");
  });

  it("reads observed outcomes and net value only through tenant-scoped store filters", async () => {
    const outcome = {
      schemaVersion: "observed-outcome/v1alpha1" as const,
      id: "outcome-1",
      workspaceId: "workspace-main",
      companyId: "company-main",
      departmentId: "product",
      loopId: "product-feedback",
      metricDefinitionId: "metric-1",
      metricKey: "activation_rate",
      unit: "percent",
      desiredDirection: "increase" as const,
      evaluationWindow: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-20T00:00:00.000Z" },
      baseline: { value: 20, sampleIds: ["sample-1"] },
      observed: { value: 28, sampleIds: ["sample-2"] },
      absoluteDelta: 8,
      relativeDeltaPct: 40,
      status: "improved" as const,
      truthStatus: "observed" as const,
      confidence: 0.94,
      evidenceSufficiency: { sufficient: true, reasons: [] },
      guardrails: [], runIds: [], problemIds: [], evidenceRefs: [],
      evaluatedAt: NOW.toISOString()
    };
    const ledger = {
      schemaVersion: "value-ledger-entry/v1alpha1" as const,
      id: "value-1",
      workspaceId: "workspace-main",
      companyId: "company-main",
      departmentId: "product",
      loopId: "product-feedback",
      window: outcome.evaluationWindow,
      grossSavedMinutes: 120,
      hiddenCostMinutes: { review: 10, rework: 0, botsitting: 0, escalation: 0, governance: 0 },
      observedCostMinutes: 10,
      netSavedMinutes: 110,
      truthStatus: "observed" as const,
      calculationVersion: "loop-value/v1alpha1" as const,
      observedOutcomeIds: ["outcome-1"], runIds: [], reviewIds: [], evidenceRefs: [],
      recordedAt: NOW.toISOString()
    };
    const fixture = createRegistry({ outcomes: [outcome], ledger: [ledger] });

    const response = await fixture.registry.execute(request({
      operation: "outcomes-value.read",
      input: { loopIds: ["product-feedback"], truthStatuses: ["observed"], limit: 5 }
    }));

    expect(fixture.outcomeStore.listObservedOutcomes).toHaveBeenCalledWith({
      workspaceId: "workspace-main",
      companyId: "company-main"
    });
    expect(response.result).toMatchObject({
      returnedOutcomes: 1,
      returnedValueEntries: 1,
      outcomes: [{ status: "improved", observed: 28 }],
      valueLedger: [{ netSavedMinutes: 110, truthStatus: "observed" }]
    });
  });
});

function createRegistry(input: {
  artifacts?: StoredLoopSpecArtifact[];
  problems?: BusinessProblem[];
  receipts?: EventReceipt[];
  attempts?: RoutingAttempt[];
  commits?: RouteCommit[];
  jobs?: RouteJob[];
  outcomes?: ObservedOutcome[];
  ledger?: ValueLedgerEntry[];
} = {}) {
  const artifacts = input.artifacts ?? [];
  const loopSpecStore = {
    persistence: "file",
    getWorkspace: vi.fn(async () => ({
      revision: 1,
      workspace: {
        schemaVersion: "loopgraph-workspace/v1alpha1",
        registeredSpecs: artifacts.map((entry) => entry.entry),
        updatedAt: NOW.toISOString()
      }
    })),
    listActiveLoopSpecs: vi.fn(async () => artifacts)
  } as unknown as LoopSpecRegistryStore;
  const routingStore = {
    listBusinessProblems: vi.fn(async () => input.problems ?? []),
    listEventReceipts: vi.fn(async () => input.receipts ?? []),
    listRoutingAttempts: vi.fn(async () => input.attempts ?? []),
    listRouteCommits: vi.fn(async () => input.commits ?? []),
    listRouteJobs: vi.fn(async () => input.jobs ?? [])
  } as unknown as RoutingStore;
  const outcomeStore = {
    listObservedOutcomes: vi.fn(async () => input.outcomes ?? []),
    listValueLedgerEntries: vi.fn(async () => input.ledger ?? [])
  } as unknown as OutcomeStore;
  return {
    loopSpecStore,
    routingStore,
    outcomeStore,
    registry: new LoopgraphAppRuntimeOperationRegistry({
      projectRoot: "/tmp/loopgraph-runtime-operation-test",
      loopSpecStore,
      routingStore,
      outcomeStore
    })
  };
}

function request(input: Partial<AppRuntimeOperationRequest> & Pick<AppRuntimeOperationRequest, "operation" | "input">): AppRuntimeOperationRequest {
  return {
    requestId: "runtime-request-123",
    workspaceId: "workspace-main",
    companyId: "company-main",
    installationId: "management-app",
    appId: "official.management.company-os",
    artifactDigest: `sha256:${"a".repeat(64)}`,
    loopId: "management-review",
    loopVersionHash: `sha256:${"b".repeat(64)}`,
    capability: "loopgraph.topology.read",
    routeJobId: "job-management-review",
    agentInstanceId: "hermes-management",
    companyObject: { type: "account", id: "account-42" },
    now: NOW,
    ...input
  };
}

function artifact(id: string, name: string, department: string, activationMode: "shadow" | "recommend"): StoredLoopSpecArtifact {
  return {
    loopId: id,
    versionHash: `${id}-version-hash`,
    entry: { id, name, department, path: `.loopgraph/loops/${id}.yaml`, addedAt: NOW.toISOString() },
    spec: {
      apiVersion: "loopgraph/v1alpha1",
      kind: "Loop",
      metadata: { id, name, version: "1.0.0", description: "private context" },
      trigger: { type: "event", config: {} },
      input: { schema: { type: "object" } },
      output: { schema: { type: "object" } },
      context: { sources: [], precedence: [], redactionPolicy: "restricted_only" },
      routine: { steps: [{ id: "private", name: "private context", kind: "reason", config: {} }] },
      tools: [{ key: "feedback", adapterId: "capability:support.feedback.read", risk: "read" }],
      policy: { allowedActions: [], forbiddenActions: [], escalationRules: [] },
      verification: [],
      approval: { mode: "none" },
      persistence: { idempotency: { enabled: true } },
      trace: { captureContextSnapshot: true, captureToolInputOutput: false, evidenceRequired: true },
      topology: { department },
      routing: {
        schemaVersion: "loop-routing-contract/v1alpha1",
        problemTypes: [`${department}.problem`],
        accepts: [{ sourcePattern: "*", eventTypePattern: "*", subjectTypes: [], requiredFields: [], optionalConditions: [] }],
        excludes: [], inputMapping: {}, priority: 1, minimumConfidence: 0.8,
        ambiguityPolicy: "request_human", noMatchPolicy: "unhandled",
        fanoutPolicy: { mode: "none", maxRoutes: 1, requiresIndependentProblems: true },
        permittedSupportingLoopIds: [], cooldown: { seconds: 0, dedupeWindowSeconds: 0 },
        concurrency: { maxActive: 1, strategy: "append_evidence" }, activationMode,
        lifecycleEvents: [], requiredConnections: [], examples: { shouldRoute: [], shouldNotRoute: [] }
      }
    },
    fixtures: {}, source: "import", createdAt: NOW.toISOString()
  } as unknown as StoredLoopSpecArtifact;
}

function problem(id: string, subjectType: string, subjectId: string): BusinessProblem {
  return {
    id,
    workspaceId: "workspace-main",
    companyId: "company-main",
    problemType: "customer.renewal_risk",
    subject: { type: subjectType, id: subjectId },
    summary: "Renewal risk needs review.",
    severity: "high",
    status: "routed",
    correlationId: `${id}-correlation`,
    dedupeKey: `${id}-dedupe`,
    evidenceEventIds: id === "problem-current" ? ["event-current"] : [],
    primaryLoopId: "customer-health",
    supportingLoopIds: [], routeCommitIds: [], outcomeRefs: [],
    openedAt: NOW.toISOString(), updatedAt: NOW.toISOString()
  };
}

function receipt(eventId: string, subjectType: string, subjectId: string): EventReceipt {
  return {
    id: `receipt-${eventId}`,
    eventId,
    eventHash: `${eventId}-hash`,
    status: "received",
    firstSeenAt: NOW.toISOString(), lastSeenAt: NOW.toISOString(),
    event: {
      schemaVersion: "event-envelope/v1alpha1",
      id: eventId,
      workspaceId: "workspace-main",
      companyId: "company-main",
      source: "salesforce",
      sourceRoute: "hermes.salesforce",
      sourceDeliveryId: `${eventId}-delivery`,
      eventType: "renewal.risk_detected",
      occurredAt: NOW.toISOString(), receivedAt: NOW.toISOString(),
      subject: { type: subjectType, id: subjectId },
      correlationId: `${eventId}-correlation`,
      sensitivity: "internal",
      hopCount: 0,
      normalizedPayload: { access_token: "must not be returned" },
      evidenceRefs: [],
      trust: { signatureVerified: true, signer: "salesforce", untrustedFields: [] }
    }
  };
}
