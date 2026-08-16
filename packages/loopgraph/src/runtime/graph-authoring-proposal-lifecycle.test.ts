import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startGraphEditorProposalLifecycle } from "./loop-opportunity-engine";
import { FileLoopOpportunityStore } from "./loop-opportunity-store";
import { initLoopgraphWorkspace } from "./workspace";

describe("graph editor proposal lifecycle", () => {
  it("opens an idempotent opportunity, change set, and Hermes design task", async () => {
    const projectRoot = await mkdtemp(
      path.join(tmpdir(), "loopgraph-graph-proposal-")
    );
    await initLoopgraphWorkspace({
      projectRoot,
      displayName: "Graph Proposal Company",
      now: new Date("2026-08-15T11:00:00.000Z")
    });
    const input = {
      projectRoot,
      transactionId: "graph_edit_product_1",
      operationKey: "operation_product_1",
      workspaceId: "local",
      companyId: "local",
      actorId: "loopgraph-ui",
      department: "product",
      kind: "create_loop" as const,
      problemType: "graph_editor_feedback_learning_coverage",
      title: "Design Feedback Learning",
      summary: "Cluster repeated feedback and return release evidence.",
      targetLoopIds: [],
      createdAt: "2026-08-15T12:00:00.000Z"
    };

    const first = await startGraphEditorProposalLifecycle(input);
    const second = await startGraphEditorProposalLifecycle(input);

    expect(first).toMatchObject({
      opportunity: {
        status: "design_requested",
        department: "product",
        kind: "create_loop"
      },
      graphChangeSet: {
        status: "proposed",
        changes: [{ operation: "add", requiresExplicitApproval: true }]
      },
      designTask: {
        reason: "loop_opportunity",
        status: "needs_input",
        requestedBy: "loopgraph-ui"
      },
      nextAction: "answer_questions"
    });
    expect(second.opportunity.id).toBe(first.opportunity.id);
    expect(second.graphChangeSet.id).toBe(first.graphChangeSet.id);
    expect(second.designTask.id).toBe(first.designTask.id);

    const store = new FileLoopOpportunityStore(
      path.join(projectRoot, ".loopgraph")
    );
    await expect(store.listOpportunities()).resolves.toHaveLength(1);
    await expect(store.listGraphChangeSets()).resolves.toHaveLength(1);
  });
});
