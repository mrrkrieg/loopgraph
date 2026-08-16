import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileHermesDesignStore } from "./hermes-design-store";
import { createGraphEditorTransaction } from "./graph-authoring-store";
import {
  graphEditorTransactionReceipt,
  projectGraphEditorTransactionReceipts
} from "./graph-authoring-read-model";
import { startGraphEditorProposalLifecycle } from "./loop-opportunity-engine";
import { FileLoopOpportunityStore } from "./loop-opportunity-store";
import { initLoopgraphWorkspace } from "./workspace";

describe("graph authoring receipt projection", () => {
  it("restores the persisted Hermes handoff after a graph page reload", async () => {
    const projectRoot = await mkdtemp(
      path.join(tmpdir(), "loopgraph-graph-receipt-")
    );
    await initLoopgraphWorkspace({
      projectRoot,
      displayName: "Graph Receipt Company",
      now: new Date("2026-08-15T11:00:00.000Z")
    });
    const loopgraphRoot = path.join(projectRoot, ".loopgraph");
    const opportunityStore = new FileLoopOpportunityStore(loopgraphRoot);
    const designStore = new FileHermesDesignStore(loopgraphRoot);
    const transaction = createGraphEditorTransaction({
      transactionId: "graph_edit_persisted_1",
      workspaceId: "local",
      companyId: "local",
      actorId: "loopgraph-ui",
      expectedTopologyHash: "topology_hash_1",
      operations: [{
        kind: "propose_node",
        temporaryId: "draft:product-signal-review",
        nodeType: "workflow_loop",
        label: "Product Signal Review",
        departmentId: "product",
        purpose: "Turn repeated product evidence into an accountable decision."
      }],
      now: new Date("2026-08-15T12:00:00.000Z")
    });
    const lifecycle = await startGraphEditorProposalLifecycle({
      projectRoot,
      transactionId: transaction.id,
      operationKey: "operation_product_signal_review",
      workspaceId: transaction.workspaceId,
      companyId: transaction.companyId,
      actorId: transaction.actorId,
      department: "product",
      kind: "create_loop",
      problemType: "graph_editor_product_signal_review_coverage",
      title: "Design Product Signal Review",
      summary: "Turn repeated product evidence into an accountable decision.",
      targetLoopIds: [],
      createdAt: transaction.createdAt
    }, {
      designStore,
      opportunityStore
    });

    const [receipt] = await projectGraphEditorTransactionReceipts({
      transactions: [transaction],
      opportunityStore,
      designStore
    });

    expect(receipt).toEqual({
      transaction,
      proposalLifecycle: [{
        opportunityId: lifecycle.opportunity.id,
        graphChangeSetId: lifecycle.graphChangeSet.id,
        designTaskId: lifecycle.designTask.id,
        discoverySessionId: lifecycle.designTask.sessionId,
        nextAction: "answer_questions"
      }]
    });
  });

  it("does not correlate a lifecycle across company boundaries", async () => {
    const transaction = createGraphEditorTransaction({
      transactionId: "graph_edit_company_boundary",
      workspaceId: "main",
      companyId: "company_a",
      actorId: "operator_a",
      expectedTopologyHash: "topology_hash_a",
      operations: [{ kind: "move_node", nodeId: "company", x: 10, y: 20 }],
      now: new Date("2026-08-15T12:00:00.000Z")
    });
    const opportunityStore = {
      persistence: "distributed" as const,
      listOpportunities: async () => [{
        schemaVersion: "loop-opportunity/v1alpha1" as const,
        id: "opportunity_other_company",
        fingerprint: "fingerprint_other_company",
        generation: 1,
        workspaceId: "main",
        companyId: "company_b",
        department: "product" as const,
        kind: "create_loop" as const,
        status: "design_requested" as const,
        problemType: "coverage_gap",
        title: "Other company proposal",
        summary: "Must not correlate.",
        targetLoopIds: [],
        problemIds: [],
        signalIds: ["signal_other_company"],
        signals: [{
          id: "signal_other_company",
          type: "improvement_signal" as const,
          sourceRef: `graph-editor:${transaction.id}:operation_1`,
          workspaceId: "main",
          companyId: "company_b",
          occurredAt: "2026-08-15T12:00:00.000Z",
          summary: "Must not correlate.",
          severity: "medium" as const,
          evidenceRefs: [],
          metrics: {}
        }],
        score: {
          total: 100,
          recurrence: 10,
          businessImpact: 25,
          coverageGap: 25,
          evidenceConfidence: 15,
          humanFriction: 0,
          riskPenalty: 0,
          explanation: ["Explicit proposal"]
        },
        thresholds: { qualify: 0, autoDesign: 0 },
        firstObservedAt: "2026-08-15T12:00:00.000Z",
        lastObservedAt: "2026-08-15T12:00:00.000Z",
        createdAt: "2026-08-15T12:00:00.000Z",
        updatedAt: "2026-08-15T12:00:00.000Z"
      }],
      saveOpportunity: async () => undefined,
      getOpportunity: async () => undefined,
      saveGraphChangeSet: async () => undefined,
      getGraphChangeSet: async () => undefined,
      listGraphChangeSets: async () => []
    };
    const designStore = new FileHermesDesignStore(
      await mkdtemp(path.join(tmpdir(), "loopgraph-other-company-tasks-"))
    );

    await expect(projectGraphEditorTransactionReceipts({
      transactions: [transaction],
      opportunityStore,
      designStore
    })).resolves.toEqual([graphEditorTransactionReceipt(transaction)]);
  });
});
