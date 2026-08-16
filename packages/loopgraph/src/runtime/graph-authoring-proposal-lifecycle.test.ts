import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "../core";
import { startGraphEditorProposalLifecycle } from "./loop-opportunity-engine";
import { FileLoopOpportunityStore } from "./loop-opportunity-store";
import { initLoopgraphWorkspace, writeLoopgraphWorkspace } from "./workspace";

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

  it.each([
    ["improve_loop", "update", ["feedback-clustering"]],
    ["split_loop", "split", ["feedback-clustering"]],
    ["merge_loops", "merge", ["feedback-clustering", "release-learning"]],
    ["retire_loop", "retire", ["feedback-clustering"]]
  ] as const)("creates a governed %s change set", async (kind, operation, targetLoopIds) => {
    const projectRoot = await mkdtemp(
      path.join(tmpdir(), `loopgraph-graph-${operation}-`)
    );
    await initLifecycleWorkspace(projectRoot);

    const result = await startGraphEditorProposalLifecycle({
      projectRoot,
      transactionId: `graph_edit_${operation}_1`,
      operationKey: `operation_${operation}_1`,
      workspaceId: "local",
      companyId: "local",
      actorId: "loopgraph-ui",
      department: "product",
      kind,
      problemType: `graph_lifecycle_${operation}`,
      title: `${operation} product loops`,
      summary: `Observed outcomes justify a governed ${operation} proposal.`,
      targetLoopIds: [...targetLoopIds],
      createdAt: "2026-08-15T12:00:00.000Z"
    });

    expect(result.opportunity).toMatchObject({ kind, targetLoopIds });
    expect(result.graphChangeSet.changes).toEqual([
      expect.objectContaining({ operation, targetLoopIds })
    ]);
    expect(result.designTask).toMatchObject({
      reason: "improvement",
      status: "needs_input"
    });
  });

  it("rejects an incomplete merge before writing the lifecycle", async () => {
    const projectRoot = await mkdtemp(
      path.join(tmpdir(), "loopgraph-graph-invalid-merge-")
    );
    await initLoopgraphWorkspace({ projectRoot, displayName: "Invalid Merge" });

    await expect(startGraphEditorProposalLifecycle({
      projectRoot,
      transactionId: "graph_edit_invalid_merge",
      operationKey: "operation_invalid_merge",
      workspaceId: "local",
      companyId: "local",
      actorId: "loopgraph-ui",
      department: "product",
      kind: "merge_loops",
      problemType: "graph_lifecycle_merge",
      title: "Merge one loop",
      summary: "This proposal is structurally incomplete.",
      targetLoopIds: ["feedback-clustering"],
      createdAt: "2026-08-15T12:00:00.000Z"
    })).rejects.toThrow("must identify at least two workflow loops");
  });

  it("rejects cross-department targets before writing an opportunity", async () => {
    const projectRoot = await mkdtemp(
      path.join(tmpdir(), "loopgraph-graph-cross-department-")
    );
    const workspace = await initLoopgraphWorkspace({
      projectRoot,
      displayName: "Cross Department Merge"
    });
    await writeLoopgraphWorkspace({
      ...workspace,
      registeredSpecs: [
        registeredLoop("feedback-clustering", "Feedback Clustering", "product"),
        registeredLoop("lead-qualification", "Lead Qualification", "sales")
      ]
    }, projectRoot);

    await expect(startGraphEditorProposalLifecycle({
      projectRoot,
      transactionId: "graph_edit_cross_department",
      operationKey: "operation_cross_department",
      workspaceId: "local",
      companyId: "local",
      actorId: "loopgraph-ui",
      department: "product",
      kind: "merge_loops",
      problemType: "graph_lifecycle_merge",
      title: "Merge feedback and lead qualification",
      summary: "This proposal crosses accountable department ownership.",
      targetLoopIds: ["feedback-clustering", "lead-qualification"],
      createdAt: "2026-08-15T12:00:00.000Z"
    })).rejects.toThrow("cannot merge loops across department ownership");

    const store = new FileLoopOpportunityStore(path.join(projectRoot, ".loopgraph"));
    await expect(store.listOpportunities()).resolves.toEqual([]);
  });
});

async function initLifecycleWorkspace(projectRoot: string): Promise<void> {
  const workspace = await initLoopgraphWorkspace({
    projectRoot,
    displayName: "Graph Lifecycle Company",
    now: new Date("2026-08-15T11:00:00.000Z")
  });
  await Promise.all([
    writeRegisteredLoop(projectRoot, "feedback-clustering", "Feedback Clustering", "product"),
    writeRegisteredLoop(projectRoot, "release-learning", "Release Learning", "product")
  ]);
  await writeLoopgraphWorkspace({
    ...workspace,
    registeredSpecs: [
      registeredLoop("feedback-clustering", "Feedback Clustering", "product"),
      registeredLoop("release-learning", "Release Learning", "product")
    ]
  }, projectRoot);
}

async function writeRegisteredLoop(
  projectRoot: string,
  id: string,
  name: string,
  department: "product" | "sales"
): Promise<void> {
  const specPath = path.join(
    projectRoot,
    ".loopgraph",
    "generated",
    department,
    id,
    "loopgraph.yaml"
  );
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(testLoopSpec(id, name), null, 2)}\n`);
}

function registeredLoop(
  id: string,
  name: string,
  department: "product" | "sales"
) {
  return {
    id,
    name,
    path: `.loopgraph/generated/${department}/${id}/loopgraph.yaml`,
    department,
    addedAt: "2026-08-15T11:00:00.000Z"
  };
}

function testLoopSpec(id: string, name: string) {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: { id, name, version: "1.0.0" },
    trigger: { type: "manual", source: "test", event: "run" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: [
          "decisionSummary",
          "proposedActions",
          "evidence",
          "policyInputs",
          "verificationRequest"
        ],
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
        description: "Collect evidence before proposing a change."
      }]
    },
    tools: [],
    policy: { allowedActions: [], forbiddenActions: [], escalationRules: [] },
    verification: [],
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
    }
  };
}
