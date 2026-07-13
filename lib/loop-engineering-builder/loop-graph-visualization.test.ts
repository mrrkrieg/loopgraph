import { describe, expect, it } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "loopgraph/core";
import { buildLoopEgoGraph, buildSemanticTopology } from "loopgraph/core";
import type { LoopSpec } from "loopgraph/core";
import { buildSemanticTopologyVisualGraph, buildTemplateLoopGraph } from "./loop-graph-visualization";
import { getTemplateCatalog } from "./templates";

describe("loop graph visualization builder", () => {
  it("creates a complete visual graph for every template", () => {
    for (const template of getTemplateCatalog()) {
      const graph = buildTemplateLoopGraph(template);
      const nodeIds = new Set(graph.nodes.map((node) => node.id));
      const kinds = new Set(graph.nodes.map((node) => node.kind));

      expect(nodeIds.has(`template:${template.id}:loop`)).toBe(true);
      expect(kinds.has("data_source")).toBe(true);
      expect(kinds.has("action")).toBe(true);
      expect(kinds.has("verification")).toBe(true);
      expect(kinds.has("owner")).toBe(true);
      expect(kinds.has("review")).toBe(true);
      expect(kinds.has("metric")).toBe(true);
      expect(graph.edges.length).toBeGreaterThanOrEqual(6);

      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    }
  });

  it("adds a trigger node for selected workflow loop visuals", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [visualLoopSpec()]
    });
    const ego = buildLoopEgoGraph({
      topology,
      loopId: "campaign-learning"
    });
    const graph = buildSemanticTopologyVisualGraph(ego);
    const triggerNode = graph.nodes.find((node) => node.kind === "trigger");

    expect(triggerNode).toMatchObject({
      id: "trigger:loop:campaign-learning",
      label: "operator run",
      metadata: {
        triggerFor: "loop:campaign-learning",
        parentId: "loop:campaign-learning",
        semanticType: "trigger"
      }
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: triggerNode?.id,
          target: "loop:campaign-learning",
          kind: "triggers"
        })
      ])
    );
  });

  it("adds trigger nodes for all workflow loops when requested", () => {
    const topology = buildSemanticTopology({
      loopSpecs: [
        visualLoopSpec(),
        visualLoopSpec({
          id: "customer-health",
          name: "Customer Health Loop",
          department: "customer_success"
        })
      ]
    });
    const graph = buildSemanticTopologyVisualGraph(topology, {
      includeWorkflowTriggers: true
    });
    const triggerNodes = graph.nodes.filter((node) => node.kind === "trigger");

    expect(triggerNodes.map((node) => node.id).sort()).toEqual([
      "trigger:loop:campaign-learning",
      "trigger:loop:customer-health"
    ]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "trigger:loop:customer-health",
          target: "loop:customer-health",
          kind: "triggers"
        })
      ])
    );
  });
});

function visualLoopSpec(input: {
  id?: string;
  name?: string;
  department?: string;
} = {}): LoopSpec {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: input.id ?? "campaign-learning",
      name: input.name ?? "Campaign Learning Loop",
      version: "1.0.0",
      description: "Keeps campaign execution aligned with current business signals.",
      labels: { targetMetric: "Qualified revenue protected" },
      owner: { role: "marketing_owner", name: "Ari" }
    },
    trigger: { type: "manual", source: "operator", event: "run" },
    input: { schema: { type: "object" } },
    output: { schema: { type: "object" } },
    context: {
      sources: [{
        id: "campaign-events",
        type: "event",
        title: "Campaign events",
        sensitivity: "internal",
        trusted: true,
        precedence: 1
      }],
      precedence: [],
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: [{
        id: "draft-next-action",
        name: "Draft next action",
        description: "Draft the safest next action from current signals.",
        stepType: "draft",
        actor: "agent"
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
    verification: [{
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
      department: input.department ?? "marketing",
      tags: []
    }
  };
}
