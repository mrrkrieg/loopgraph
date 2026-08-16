import { describe, expect, it, vi } from "vitest";
import { contentHash } from "../core";
import type {
  DesignRun,
  GraphChangeApprovalReceipt,
  GraphChangeSet,
  HermesDesignTask,
  LoopDesignProposalSet,
  LoopOpportunity
} from "../core";
import type { DiscoveryDesignStore } from "./discovery-design-store";
import { applyApprovedHermesGraphChangeSet } from "./graph-change-application";
import type { HermesDesignStore } from "./hermes-design-store";
import type { LoopOpportunityStore } from "./loop-opportunity-store";
import { graphChangeSetHash } from "./semantic-graph-state";
import type { SemanticGraphStore } from "./semantic-graph-store";

describe("governed Hermes graph application", () => {
  it("derives the approval, design run, and proposal IDs from durable records", async () => {
    const records = fixtures();
    const apply = vi.fn(async () => ({
      transaction: { id: "transaction_1", status: "committed" },
      changeSet: { ...records.changeSet, status: "applied" }
    })) as never;

    await applyApprovedHermesGraphChangeSet({
      projectRoot: "/tmp/loopgraph-apply",
      changeSetId: records.changeSet.id,
      initiatedBy: "operator_1",
      now: new Date("2026-08-16T13:00:00.000Z")
    }, stores(records, apply));

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      changeSetId: records.changeSet.id,
      approvalReceiptId: records.approval.id,
      designRunId: records.designRun.id,
      acceptedProposalIds: ["proposal_improve"],
      expectedApprovalEvidenceRefs: [
        `design-run:${records.designRun.id}`,
        `design-output:${records.designRun.outputHash}`,
        "loop-design-proposal:proposal_improve"
      ],
      initiatedBy: "operator_1"
    }), expect.any(Object));
  });

  it("rejects a receipt that is not bound to the exact Hermes proposal set", async () => {
    const records = fixtures();
    records.approval = {
      ...records.approval,
      evidenceRefs: [`design-run:${records.designRun.id}`]
    };
    const apply = vi.fn();

    await expect(applyApprovedHermesGraphChangeSet({
      changeSetId: records.changeSet.id,
      initiatedBy: "operator_1"
    }, stores(records, apply as never))).rejects.toThrow(
      "No accountable approval receipt matches the exact Hermes design and graph change"
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects proposal content changed after the Hermes design run was sealed", async () => {
    const records = fixtures();
    records.proposalSet = {
      ...records.proposalSet,
      globalAssumptions: ["Content changed after review"]
    };
    const apply = vi.fn();

    await expect(applyApprovedHermesGraphChangeSet({
      changeSetId: records.changeSet.id,
      initiatedBy: "operator_1"
    }, stores(records, apply as never))).rejects.toThrow(
      "Hermes design output hash does not match the stored proposal content"
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("fails closed when a UI change set contains ambiguous operation-to-proposal mapping", async () => {
    const records = fixtures();
    records.changeSet = {
      ...records.changeSet,
      changes: [
        ...records.changeSet.changes,
        { ...records.changeSet.changes[0]!, id: "change_second" }
      ]
    };

    await expect(applyApprovedHermesGraphChangeSet({
      changeSetId: records.changeSet.id,
      initiatedBy: "operator_1"
    }, stores(records, vi.fn() as never))).rejects.toThrow(
      "requires one semantic operation per graph change set"
    );
  });
});

type Fixture = ReturnType<typeof fixtures>;

function fixtures() {
  const changeSet = {
    schemaVersion: "graph-change-set/v1alpha1",
    id: "graph_change_improve",
    version: 1,
    opportunityId: "opportunity_improve",
    workspaceId: "main",
    companyId: "company_1",
    baseGraphHash: "base_graph_hash",
    designTaskId: "task_improve",
    designRunId: "design_run_improve",
    status: "approved",
    changes: [{
      id: "change_improve",
      department: "product",
      operation: "update",
      targetLoopIds: ["feedback_triage"],
      proposedLoopCount: 1,
      title: "Improve Feedback Triage",
      rationale: "Recurring feedback is not becoming product decisions.",
      expectedOutcome: "Reduce feedback-to-decision time.",
      evidenceRefs: ["problem:feedback-delay"],
      requiresExplicitApproval: true
    }],
    approvalReceiptIds: ["approval_improve"],
    createdAt: "2026-08-16T10:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z"
  } as GraphChangeSet;
  const opportunity = {
    id: changeSet.opportunityId,
    graphChangeSetId: changeSet.id,
    workspaceId: changeSet.workspaceId,
    companyId: changeSet.companyId,
    designTaskId: changeSet.designTaskId
  } as LoopOpportunity;
  const task = {
    id: changeSet.designTaskId,
    sessionId: "session_improve",
    companyId: changeSet.companyId,
    department: "product",
    originOpportunityId: opportunity.id,
    status: "completed",
    designRunIds: [changeSet.designRunId]
  } as HermesDesignTask;
  const designRun = {
    id: changeSet.designRunId,
    sessionId: task.sessionId,
    departmentType: task.department,
    finalProposalIds: ["proposal_improve"]
  } as DesignRun;
  const proposalSet = {
    sessionId: task.sessionId,
    departmentType: task.department,
    validationSummary: { valid: true, errors: [] },
    proposals: [{ proposalId: "proposal_improve" }]
  } as unknown as LoopDesignProposalSet;
  designRun.outputHash = `out_${contentHash(proposalSet)}`;
  const approval = {
    id: "approval_improve",
    subjectType: "graph_change",
    decision: "approved",
    changeSetId: changeSet.id,
    changeSetHash: graphChangeSetHash(changeSet),
    baseGraphHash: changeSet.baseGraphHash,
    approvedChangeIds: ["change_improve"],
    evidenceRefs: [
      `design-run:${designRun.id}`,
      `design-output:${designRun.outputHash}`,
      "loop-design-proposal:proposal_improve"
    ],
    decidedAt: "2026-08-16T12:00:00.000Z"
  } as GraphChangeApprovalReceipt;
  return { changeSet, opportunity, task, designRun, proposalSet, approval };
}

function stores(records: Fixture, apply: never) {
  const opportunityStore = {
    persistence: "file",
    getGraphChangeSet: async (id: string) =>
      id === records.changeSet.id ? records.changeSet : undefined,
    getOpportunity: async (id: string) =>
      id === records.opportunity.id ? records.opportunity : undefined
  } as unknown as LoopOpportunityStore;
  const hermesDesignStore = {
    persistence: "file",
    getTask: async (id: string) => id === records.task.id ? records.task : undefined
  } as unknown as HermesDesignStore;
  const designStore = {
    persistence: "file",
    getDesignRun: async (id: string) =>
      id === records.designRun.id ? records.designRun : undefined,
    getProposalSet: async (id: string) =>
      id === records.designRun.id ? records.proposalSet : undefined
  } as unknown as DiscoveryDesignStore;
  const store = {
    persistence: "file",
    getApproval: async (id: string) =>
      id === records.approval.id ? records.approval : undefined
  } as unknown as SemanticGraphStore;
  return { opportunityStore, hermesDesignStore, designStore, store, apply };
}
