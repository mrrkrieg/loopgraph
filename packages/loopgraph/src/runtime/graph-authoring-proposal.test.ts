import { describe, expect, it } from "vitest";
import type {
  GraphEditorTransaction,
  SemanticTopology,
  TopologyNode
} from "../core";
import { buildGraphEditorProposalIntents } from "./graph-authoring-proposal";

describe("graph editor proposal intents", () => {
  it("turns a workflow node proposal into an explicit loop design intent", () => {
    const transaction = graphTransaction([{
      kind: "propose_node",
      temporaryId: "draft:retention",
      nodeType: "workflow_loop",
      label: "Retention Risk",
      departmentId: "customer_success",
      purpose: "Identify accounts that need intervention."
    }]);

    expect(buildGraphEditorProposalIntents({
      transaction,
      topology: topology()
    })).toEqual([expect.objectContaining({
      transactionId: transaction.id,
      department: "customer_success",
      kind: "create_loop",
      problemType: "graph_editor_retention_risk_coverage",
      title: "Design Retention Risk",
      summary: "Identify accounts that need intervention."
    })]);
  });

  it("turns a valid relationship proposal into a targeted loop improvement", () => {
    const transaction = graphTransaction([{
      kind: "propose_edge",
      sourceId: "department:product",
      targetId: "loop:feedback-clustering",
      relation: "department_contains_loop",
      reason: "Product should own the customer feedback learning contract."
    }]);

    expect(buildGraphEditorProposalIntents({
      transaction,
      topology: topology()
    })).toEqual([expect.objectContaining({
      department: "product",
      kind: "improve_loop",
      problemType: "graph_relationship_department_contains_loop",
      targetLoopIds: ["feedback-clustering"]
    })]);
  });

  it("rejects edges that do not map to a workflow change", () => {
    expect(() => buildGraphEditorProposalIntents({
      transaction: graphTransaction([{
        kind: "propose_edge",
        sourceId: "brain",
        targetId: "department:product",
        relation: "brain_routes_to",
        reason: "Direct structural edge."
      }]),
      topology: topology()
    })).toThrow("must connect Hermes Brain to a workflow loop");
  });
});

function graphTransaction(
  operations: GraphEditorTransaction["operations"]
): GraphEditorTransaction {
  return {
    schemaVersion: "graph-editor-transaction/v1alpha1",
    id: "graph_edit_test",
    workspaceId: "local",
    companyId: "local",
    actorId: "loopgraph-ui",
    expectedTopologyHash: "aaaaaaaaaaaaaaaa",
    operations,
    status: "proposal_pending",
    createdAt: "2026-08-15T12:00:00.000Z"
  };
}

function topology(): SemanticTopology {
  const nodes: TopologyNode[] = [
    node({ id: "brain", type: "company", label: "Hermes Brain" }),
    node({
      id: "department:product",
      type: "department_loop",
      label: "Product",
      department: "product"
    }),
    node({
      id: "loop:feedback-clustering",
      type: "workflow_loop",
      label: "Feedback Clustering",
      loopId: "feedback-clustering",
      department: "product"
    })
  ];
  return {
    id: "topology_test",
    version: 1,
    rootNodeId: "brain",
    managementLoopId: "brain",
    metadata: {
      companyName: "Test Company",
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain",
      sourceLabel: "test",
      generatedAt: "2026-08-15T12:00:00.000Z",
      loopSpecCount: 1,
      departments: ["product"]
    },
    nodes,
    edges: [],
    orphanNodes: [],
    warnings: [],
    filterCounts: {
      total: nodes.length,
      visibleByDefault: nodes.length,
      orphans: 0,
      byType: {} as SemanticTopology["filterCounts"]["byType"],
      byLayer: {} as SemanticTopology["filterCounts"]["byLayer"],
      byDepartment: { product: 2 },
      byStatus: {} as SemanticTopology["filterCounts"]["byStatus"]
    }
  };
}

function node(
  input: Pick<TopologyNode, "id" | "type" | "label"> &
    Partial<TopologyNode>
): TopologyNode {
  return {
    layer: "structure",
    status: "active",
    weight: 1,
    visibleByDefault: true,
    isExpandable: true,
    ...input
  };
}
