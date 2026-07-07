import { describe, expect, it } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "./constants";
import {
  buildLoopEgoGraph,
  buildSemanticTopology,
  createTopologyWarnings,
  getVisibleTopology,
  type TopologyNodeType
} from "./graph";
import type { EscalationCase } from "./escalation";
import type { LoopSpec } from "./loop-spec";
import type { LoopRunTrace } from "./trace";

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
    const ego = buildLoopEgoGraph({ topology, loopId: "campaign-learning" });
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
