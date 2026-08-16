import { describe, expect, it } from "vitest";
import type { GraphEditorProposalLifecycleReference } from "loopgraph/runtime";
import type { BrainGraph } from "./graph-types";
import {
  applyProposalLifecycleOverlay,
  pendingGraphProposalLifecycles
} from "./proposal-lifecycle-overlay";

describe("proposal lifecycle graph overlay", () => {
  it("annotates every registered target of a pending merge without changing topology", () => {
    const graph = sampleGraph();
    const lifecycle = reference({
      opportunityId: "opportunity_merge",
      kind: "merge_loops",
      title: "Merge Feedback Triage + Product Problem",
      targetLoopIds: ["feedback_triage", "product_problem"]
    });

    const result = applyProposalLifecycleOverlay({ graph, lifecycles: [lifecycle] });

    expect(result.nodes).toHaveLength(graph.nodes.length);
    expect(result.edges).toEqual(graph.edges);
    expect(result.nodes.find((node) => node.loopId === "feedback_triage")?.metadata)
      .toMatchObject({ pendingGraphChangeCount: 1 });
    expect(result.nodes.find((node) => node.loopId === "product_problem")?.metadata)
      .toMatchObject({
        pendingGraphChanges: [{
          opportunityId: "opportunity_merge",
          kind: "merge_loops",
          nextAction: "answer_questions"
        }]
      });
  });

  it("deduplicates retries and excludes completed or rejected changes", () => {
    const older = reference({ updatedAt: "2026-08-15T10:00:00.000Z" });
    const newest = reference({ updatedAt: "2026-08-15T12:00:00.000Z" });
    const implemented = reference({
      opportunityId: "implemented",
      status: "implemented"
    });
    const rejected = reference({
      opportunityId: "rejected",
      graphChangeSetStatus: "rejected"
    });

    expect(pendingGraphProposalLifecycles([
      older,
      implemented,
      rejected,
      newest
    ])).toEqual([newest]);
  });
});

function reference(
  overrides: Partial<GraphEditorProposalLifecycleReference> = {}
): GraphEditorProposalLifecycleReference {
  return {
    opportunityId: "opportunity_improve",
    kind: "improve_loop",
    status: "design_requested",
    title: "Improve Feedback Triage",
    department: "product",
    targetLoopIds: ["feedback_triage"],
    graphChangeSetId: "change_set_improve",
    graphChangeSetStatus: "proposed",
    designTaskId: "design_improve",
    discoverySessionId: "discovery_improve",
    updatedAt: "2026-08-15T11:00:00.000Z",
    nextAction: "answer_questions",
    ...overrides
  };
}

function sampleGraph(): BrainGraph {
  return {
    nodes: [
      {
        id: "loop:feedback_triage",
        type: "workflow_loop",
        label: "Feedback Triage",
        loopId: "feedback_triage",
        status: "ready",
        radius: 36,
        color: "#fff",
        stroke: "#111"
      },
      {
        id: "loop:product_problem",
        type: "workflow_loop",
        label: "Product Problem",
        loopId: "product_problem",
        status: "ready",
        radius: 36,
        color: "#fff",
        stroke: "#111"
      }
    ],
    edges: [{
      id: "feedback-to-product",
      source: "loop:feedback_triage",
      target: "loop:product_problem",
      type: "loop_supports_loop",
      semantic: true,
      executable: false,
      width: 1,
      color: "#111",
      opacity: 1
    }],
    diagnostics: {
      sourceNodeCount: 2,
      visibleNodeCount: 2,
      hiddenNodeIds: [],
      removedEdges: [],
      warnings: []
    }
  };
}
