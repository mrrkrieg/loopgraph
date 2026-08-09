import { describe, expect, it } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "./constants";
import {
  buildLoopEgoGraph,
  buildSemanticTopology,
  createTopologyWarnings,
  getVisibleTopology,
  type TopologyLayer,
  type TopologyNodeType
} from "./graph";
import type { EscalationCase } from "./escalation";
import type { LoopSpec } from "./loop-spec";
import type { LoopRunTrace } from "./trace";

const allLoopLayers: Record<TopologyLayer, boolean> = {
  structure: true,
  data: true,
  action: true,
  verification: true,
  human: true,
  measurement: true,
  runtime: true,
  memory: true
};

describe("semantic loop topology", () => {
  it("builds company, management, department, and workflow containment", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })],
      options: { companyName: "Raisi" }
    });

    expect(topology.nodes.find((node) => node.type === "company")?.label).toBe("Raisi");
    expect(topology.nodes.find((node) => node.type === "management_loop")?.label).toBe(
      "Company Management Loop"
    );
    expect(topology.nodes.find((node) => node.id === "loop:department:marketing")).toMatchObject({
      type: "department_loop",
      label: "Marketing Department Loop"
    });
    expect(topology.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "loop:management",
          target: "loop:department:marketing",
          kind: "contains",
          semantic: true
        }),
        expect.objectContaining({
          source: "loop:department:marketing",
          target: "loop:campaign-learning",
          kind: "contains",
          semantic: true
        })
      ])
    );
  });

  it("builds a direct Hermes Brain -> Department -> Workflow topology when requested", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [
        loopSpec({ id: "marketing-ads", department: "marketing" }),
        loopSpec({ id: "marketing-content-creation", department: "marketing" })
      ],
      options: {
        brainLabel: "Hermes Brain",
        hierarchyMode: "hermes_brain"
      }
    });

    expect(topology.managementLoopId).toBe("company:root");
    expect(topology.metadata).toMatchObject({
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain"
    });
    expect(topology.nodes.find((node) => node.id === "company:root")).toMatchObject({
      type: "company",
      label: "Hermes Brain"
    });
    expect(topology.nodes.some((node) => node.type === "management_loop")).toBe(false);
    expect(topology.nodes.find((node) => node.id === "loop:department:marketing")).toMatchObject({
      type: "department_loop",
      label: "Marketing",
      parentId: "company:root"
    });
    expect(topology.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "company:root",
          target: "loop:department:marketing",
          kind: "contains"
        }),
        expect.objectContaining({
          source: "loop:department:marketing",
          target: "loop:marketing-ads",
          kind: "contains"
        }),
        expect.objectContaining({
          source: "loop:department:marketing",
          target: "loop:marketing-content-creation",
          kind: "contains"
        })
      ])
    );
  });

  it("groups installed app LoopSpecs as Hermes Brain -> Department -> App -> Loops", () => {
    const intake = loopSpec({ id: "sales-lead-intake", department: "sales" });
    const qualification = loopSpec({ id: "sales-lead-qualification", department: "sales" });
    for (const spec of [intake, qualification]) {
      spec.metadata.labels = {
        appId: "loopgraph.sales.qualify-route-inbound-leads",
        appName: "Qualify and Route Inbound Leads",
        appVersion: "1.0.0",
        appDigest: "sha256:fixture",
        installationId: "install.sales-inbound"
      };
    }

    const topology = buildSemanticTopology({
      loopSpecs: [intake, qualification],
      options: { brainLabel: "Hermes Brain", hierarchyMode: "hermes_brain" }
    });

    expect(topology.nodes.find((node) => node.id === "app:loopgraph.sales.qualify-route-inbound-leads")).toMatchObject({
      type: "workflow_loop",
      label: "Qualify and Route Inbound Leads",
      parentId: "loop:department:sales",
      metadata: {
        appNode: true,
        installationId: "install.sales-inbound"
      }
    });
    expect(topology.nodes.find((node) => node.id === "loop:sales-lead-intake")).toMatchObject({
      type: "task_loop",
      parentId: "app:loopgraph.sales.qualify-route-inbound-leads"
    });
    expect(topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "company:root", target: "loop:department:sales", kind: "contains" }),
      expect.objectContaining({ source: "loop:department:sales", target: "app:loopgraph.sales.qualify-route-inbound-leads", kind: "contains" }),
      expect.objectContaining({ source: "app:loopgraph.sales.qualify-route-inbound-leads", target: "loop:sales-lead-intake", kind: "contains" }),
      expect.objectContaining({ source: "app:loopgraph.sales.qualify-route-inbound-leads", target: "loop:sales-lead-qualification", kind: "contains" })
    ]));
    expect(topology.warnings.some((warning) => warning.nodeId === "app:loopgraph.sales.qualify-route-inbound-leads")).toBe(false);
  });

  it("adds local runtime metadata for Hermes graph run controls", () => {
    const spec = loopSpec({ id: "marketing-ads", department: "marketing" });
    spec.metadata.labels = {
      ...(spec.metadata.labels ?? {}),
      sourcePath: "/workspace/.loopgraph/generated/hermes/marketing/marketing_ads/loopgraph.yaml"
    };
    spec.trigger = { type: "event", source: "hermes", event: "business_event" };
    spec.input.fixtures = [
      { id: "happy-path", path: "fixtures/happy-path.json" },
      { id: "risk-escalation", path: "fixtures/risk-escalation.json" }
    ];
    spec.routing = {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct"],
        optionalConditions: []
      }],
      excludes: [],
      inputMapping: { campaignId: "subject.id" },
      priority: 0,
      minimumConfidence: 0.82,
      ambiguityPolicy: "request_human",
      noMatchPolicy: "unhandled",
      fanoutPolicy: { mode: "none", maxRoutes: 1, requiresIndependentProblems: true },
      cooldown: { seconds: 0, dedupeWindowSeconds: 3600 },
      concurrency: { maxActive: 1, strategy: "append_evidence" },
      activationMode: "shadow",
      lifecycleEvents: [],
      requiredConnections: ["ads.read", "crm.read"],
      examples: { shouldRoute: [], shouldNotRoute: [] }
    };

    const topology = buildSemanticTopology({
      loopSpecs: [spec],
      options: {
        brainLabel: "Hermes Brain",
        hierarchyMode: "hermes_brain"
      }
    });

    expect(topology.nodes.find((node) => node.id === "loop:marketing-ads")?.metadata?.runtime).toMatchObject({
      sourcePath: "/workspace/.loopgraph/generated/hermes/marketing/marketing_ads/loopgraph.yaml",
      inputFixtures: [
        { id: "happy-path", path: "fixtures/happy-path.json", label: "Happy Path" },
        { id: "risk-escalation", path: "fixtures/risk-escalation.json", label: "Risk Escalation" }
      ],
      routing: {
        ready: true,
        problemTypes: ["paid_acquisition_efficiency_drop"],
        activationMode: "shadow",
        minimumConfidence: 0.82,
        requiredConnections: ["ads.read", "crm.read"]
      }
    });
  });

  it("rolls latest persisted trace metadata onto workflow loop nodes", () => {
    const older = trace("run_old", "campaign-learning");
    older.startedAt = "2026-07-03T00:00:00.000Z";
    older.completedAt = "2026-07-03T00:00:01.000Z";
    const newer = trace("run_new", "campaign-learning");
    newer.startedAt = "2026-07-03T00:10:00.000Z";
    newer.completedAt = undefined;
    newer.status = "WAITING_FOR_REVIEW";

    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })],
      traces: [older, newer],
      options: {
        brainLabel: "Hermes Brain",
        hierarchyMode: "hermes_brain"
      }
    });

    expect(topology.nodes.find((node) => node.id === "loop:campaign-learning")?.metadata).toMatchObject({
      openReviews: 2,
      lastRunAt: "2026-07-03T00:10:00.000Z",
      latestRun: {
        id: "run_new",
        status: "WAITING_FOR_REVIEW",
        mode: "simulate",
        startedAt: "2026-07-03T00:10:00.000Z"
      }
    });
  });

  it("keeps internal logic hidden in the default company graph", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })],
      traces: [trace("run_1", "campaign-learning")],
      improvements: [{
        id: "imp_1",
        loopId: "campaign-learning",
        title: "Teach loop from failed send"
      }]
    });
    const visible = getVisibleTopology(topology);
    const visibleTypes = new Set(visible.nodes.map((node) => node.type));

    expect(visibleTypes.has("workflow_loop")).toBe(true);
    expect(visibleTypes.has("signal_source")).toBe(false);
    expect(visibleTypes.has("tool_action")).toBe(false);
    expect(visibleTypes.has("verifier")).toBe(false);
    expect(visibleTypes.has("trace")).toBe(false);
    expect(visible.nodes.length).toBeLessThan(topology.nodes.length);
  });

  it("expands a selected loop into its logic, trace, and improvement ego graph", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })],
      traces: [trace("run_1", "campaign-learning")],
      cases: [caseItem("case_1", "run_1", "campaign-learning")],
      improvements: [{
        id: "imp_1",
        loopId: "campaign-learning",
        sourceTraceId: "run_1",
        title: "Add stricter audience check"
      }]
    });
    const ego = buildLoopEgoGraph({
      topology,
      loopId: "campaign-learning",
      enabledLayers: allLoopLayers
    });
    const types = new Set<TopologyNodeType>(ego.nodes.map((node) => node.type));

    expect(ego.centerNodeId).toBe("loop:campaign-learning");
    expect(Array.from(types)).toEqual(
      expect.arrayContaining([
        "workflow_loop",
        "signal_source",
        "integration",
        "tool_action",
        "verifier",
        "human_owner",
        "human_review",
        "metric",
        "trace",
        "escalation_case",
        "improvement_item"
      ])
    );
    expect(ego.nodes.find((node) => node.id === ego.centerNodeId)?.metadata?.ring).toBe("center");
    expect(ego.breadcrumbs.map((node) => node.id)).toEqual([
      "company:root",
      "loop:management",
      "loop:department:marketing",
      "loop:campaign-learning"
    ]);
  });

  it("keeps department focus to parent and direct child loops by default", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [
        loopSpec({ id: "customer-health", department: "customer_success" }),
        loopSpec({ id: "campaign-learning", department: "marketing" })
      ],
      traces: [trace("run_1", "customer-health")]
    });
    const ego = buildLoopEgoGraph({
      topology,
      loopId: "department:customer_success",
      depth: 1
    });
    const nodeIds = new Set(ego.nodes.map((node) => node.id));
    const nodeTypes = new Set<TopologyNodeType>(ego.nodes.map((node) => node.type));

    expect(nodeIds).toEqual(new Set([
      "loop:management",
      "loop:department:customer-success",
      "loop:customer-health"
    ]));
    expect(nodeTypes).toEqual(new Set([
      "management_loop",
      "department_loop",
      "workflow_loop"
    ]));
    expect(ego.edges.every((edge) => edge.kind === "contains")).toBe(true);
  });

  it("expands selected workflow internals by default while leaving runtime opt-in", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })],
      traces: [trace("run_1", "campaign-learning")]
    });
    const selected = buildLoopEgoGraph({ topology, loopId: "campaign-learning" });
    const withRuntime = buildLoopEgoGraph({
      topology,
      loopId: "campaign-learning",
      enabledLayers: { runtime: true }
    });
    const selectedTypes = new Set<TopologyNodeType>(selected.nodes.map((node) => node.type));
    const runtimeTypes = new Set<TopologyNodeType>(withRuntime.nodes.map((node) => node.type));

    expect(selectedTypes.has("workflow_loop")).toBe(true);
    expect(selectedTypes.has("signal_source")).toBe(true);
    expect(selectedTypes.has("integration")).toBe(true);
    expect(selectedTypes.has("tool_action")).toBe(true);
    expect(selectedTypes.has("verifier")).toBe(true);
    expect(selectedTypes.has("human_owner")).toBe(true);
    expect(selectedTypes.has("metric")).toBe(true);
    expect(selectedTypes.has("trace")).toBe(false);
    expect(runtimeTypes.has("trace")).toBe(true);
  });

  it("expands brain map internals by default while leaving runtime opt-in", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })],
      traces: [trace("run_1", "campaign-learning")]
    });
    const brain = getVisibleTopology(topology, { mode: "brain-map" });
    const withRuntime = getVisibleTopology(topology, {
      mode: "brain-map",
      enabledLayers: { runtime: true }
    });
    const brainTypes = new Set<TopologyNodeType>(brain.nodes.map((node) => node.type));
    const runtimeTypes = new Set<TopologyNodeType>(withRuntime.nodes.map((node) => node.type));

    expect(brainTypes.has("workflow_loop")).toBe(true);
    expect(brainTypes.has("signal_source")).toBe(true);
    expect(brainTypes.has("integration")).toBe(true);
    expect(brainTypes.has("tool_action")).toBe(true);
    expect(brainTypes.has("verifier")).toBe(true);
    expect(brainTypes.has("human_owner")).toBe(true);
    expect(brainTypes.has("metric")).toBe(true);
    expect(brainTypes.has("trace")).toBe(false);
    expect(runtimeTypes.has("trace")).toBe(true);
  });

  it("removes edges when their layer nodes are disabled", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })]
    });
    const actionOnly = buildLoopEgoGraph({
      topology,
      loopId: "campaign-learning",
      enabledLayers: {
        data: false,
        action: true,
        verification: false,
        human: false,
        measurement: false,
        runtime: false,
        memory: false
      }
    });
    const dataNodeIds = new Set(
      topology.nodes.filter((node) => node.layer === "data").map((node) => node.id)
    );

    expect(actionOnly.nodes.some((node) => node.layer === "data")).toBe(false);
    expect(actionOnly.nodes.some((node) => node.layer === "action")).toBe(true);
    expect(actionOnly.edges.some((edge) =>
      dataNodeIds.has(edge.source) || dataNodeIds.has(edge.target)
    )).toBe(false);
  });

  it("hides unattached draft loops by default and reports them as orphans", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [
        loopSpec({ id: "campaign-learning", department: "marketing" }),
        loopSpec({ id: "draft-loop" })
      ]
    });
    const visible = getVisibleTopology(topology);

    expect(topology.orphanNodes.map((node) => node.id)).toContain("loop:draft-loop");
    expect(visible.nodes.map((node) => node.id)).not.toContain("loop:draft-loop");
    expect(topology.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_department", nodeId: "loop:draft-loop" })
      ])
    );
  });

  it("returns filter counts and validates filter edges", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })]
    });
    const withData = getVisibleTopology(topology, {
      includeTypes: ["signal_source", "integration"]
    });

    expect(topology.filterCounts.byType.signal_source).toBeGreaterThan(0);
    expect(topology.filterCounts.byLayer.data).toBeGreaterThan(0);
    expect(withData.nodes.some((node) => node.type === "signal_source")).toBe(true);
    expect(withData.edges.every((edge) =>
      withData.nodes.some((node) => node.id === edge.source) &&
      withData.nodes.some((node) => node.id === edge.target)
    )).toBe(true);
  });

  it("marks informational report edges as non-executable", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({ id: "campaign-learning", department: "marketing" })],
      cases: [caseItem("case_1", "run_1", "campaign-learning")]
    });
    const reportEdge = topology.edges.find((edge) => edge.kind === "reports_to");

    expect(reportEdge).toMatchObject({
      semantic: false,
      executable: false,
      style: "dashed"
    });
  });

  it("keeps every default visible node semantically connected except the root", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [
        loopSpec({ id: "campaign-learning", department: "marketing" }),
        loopSpec({ id: "sales-renewal", department: "sales" })
      ]
    });
    const visible = getVisibleTopology(topology);

    for (const node of visible.nodes) {
      if (node.id === visible.rootNodeId) {
        continue;
      }
      expect(visible.edges.some((edge) =>
        edge.semantic && (edge.source === node.id || edge.target === node.id)
      )).toBe(true);
    }
  });

  it("warns about incomplete workflow contracts", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [loopSpec({
        id: "weak-loop",
        department: "product",
        owner: null,
        verification: [],
        metric: null
      })]
    });
    const warningCodes = createTopologyWarnings(topology).map((warning) => warning.code);

    expect(warningCodes).toEqual(expect.arrayContaining([
      "missing_owner",
      "missing_metric",
      "missing_verifier"
    ]));
  });
});

function loopSpec(input: {
  id: string;
  department?: string;
  parentLoopId?: string;
  owner?: { role: string; name?: string } | null;
  verification?: LoopSpec["verification"];
  metric?: string | null;
}): LoopSpec {
  const owner = input.owner === undefined
    ? { role: "marketing_owner", name: "Ari" }
    : input.owner ?? undefined;
  const metric = input.metric === undefined ? "Qualified revenue protected" : input.metric ?? undefined;

  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: input.id,
      name: titleize(input.id),
      version: "1.0.0",
      description: "Keeps the loop aligned with current business signals.",
      labels: metric ? { targetMetric: metric } : {},
      ...(owner ? { owner } : {})
    },
    trigger: { type: "manual", source: "operator", event: "run" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        properties: {
          evidence: { type: "array" }
        }
      }
    },
    context: {
      sources: [
        {
          id: "campaign-events",
          type: "event",
          title: "Campaign events",
          sensitivity: "internal",
          trusted: true,
          precedence: 1
        },
        {
          id: "crm",
          type: "integration",
          adapterId: "hubspot",
          title: "CRM opportunity stage",
          sensitivity: "confidential",
          trusted: true,
          precedence: 2
        }
      ],
      precedence: [],
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: [{
        id: "draft-next-action",
        name: "Draft next action",
        stepType: "draft",
        actor: "agent",
        description: "Draft the safest next action from current signals."
      }]
    },
    tools: [{
      key: "send_campaign_update",
      adapterId: "email",
      label: "Send campaign update",
      writeCapable: true,
      riskLevel: "medium"
    }],
    policy: {
      allowedActions: [{
        toolKey: "send_campaign_update",
        allowed: true,
        requiresApproval: true,
        customerFacing: false,
        riskLevel: "medium"
      }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: input.verification ?? [{
      id: "audience-risk-check",
      type: "policy",
      config: { maxRisk: "medium" }
    }],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["approver"]
    },
    persistence: { idempotency: { enabled: true } },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true
    },
    topology: {
      parentLoopId: input.parentLoopId,
      department: input.department,
      tags: []
    }
  };
}

function trace(id: string, loopId: string): LoopRunTrace {
  return {
    id,
    loopId,
    loopSpecVersion: "1.0.0",
    loopSpecHash: "hash",
    mode: "simulate",
    status: "COMPLETED",
    trigger: {
      type: "manual",
      source: "operator",
      event: "run",
      eventId: "event_1",
      receivedAt: "2026-07-03T00:00:00.000Z"
    },
    idempotencyKey: "idem_1",
    contextSnapshot: {
      id: "ctx_1",
      loopId,
      loopSpecVersion: "1.0.0",
      createdAt: "2026-07-03T00:00:00.000Z",
      contentHash: "ctx_hash",
      tokenEstimate: 0,
      entries: []
    },
    inputs: [],
    proposedActions: [],
    preparedActions: [],
    toolCalls: [],
    policyDecisions: [],
    verificationResults: [],
    escalationCases: [],
    humanReviews: [{
      id: "review_1",
      runId: id,
      status: "open",
      role: "approver",
      approvedFingerprints: [],
      rejectedFingerprints: [],
      createdAt: "2026-07-03T00:00:00.000Z"
    }],
    outputs: [],
    metrics: [{
      name: "Qualified revenue protected",
      value: 42,
      observed: true
    }],
    errors: [],
    startedAt: "2026-07-03T00:00:00.000Z",
    completedAt: "2026-07-03T00:00:01.000Z"
  };
}

function caseItem(id: string, runId: string, loopId: string): EscalationCase {
  return {
    id,
    sourceRunId: runId,
    sourceLoopId: loopId,
    createdAt: "2026-07-03T00:00:00.000Z",
    category: "revenue_risk",
    severity: "P2",
    confidence: 0.82,
    affectedEntities: {},
    summary: "Audience risk requires management awareness",
    evidence: [],
    unresolvedQuestions: [],
    recommendedActions: [],
    decisionsRequired: [],
    routing: {
      primaryOwner: { role: "growth_lead" },
      reviewers: [],
      informed: [],
      escalationDeadline: "2026-07-03T01:00:00.000Z"
    },
    responsePlan: {
      internalActions: [],
      successCriteria: []
    },
    status: "open"
  };
}

function titleize(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
