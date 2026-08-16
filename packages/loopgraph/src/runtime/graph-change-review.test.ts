import { describe, expect, it, vi } from "vitest";
import { contentHash } from "../core";
import type {
  DesignRun,
  GraphChangeSet,
  HermesDesignTask,
  LoopDesignProposalSet,
  LoopOpportunity
} from "../core";
import type { DiscoveryDesignStore } from "./discovery-design-store";
import type { HermesDesignStore } from "./hermes-design-store";
import type { LoopOpportunityStore } from "./loop-opportunity-store";
import { reviewHermesGraphChangeSet } from "./graph-change-review";

describe("accountable Hermes graph review", () => {
  it("binds approval to the complete design run and exact validated proposal IDs", async () => {
    const records = fixtures();
    const saved: GraphChangeSet[] = [];
    const approve = vi.fn(async () => ({
      receipt: { id: "approval_1" },
      changeSet: { ...records.changeSet, status: "approved" }
    })) as unknown as NonNullable<Parameters<typeof reviewHermesGraphChangeSet>[1]>["approve"];

    const result = await reviewHermesGraphChangeSet({
      projectRoot: "/tmp/loopgraph-review",
      changeSetId: records.changeSet.id,
      decision: "approved",
      actorId: "operator_1",
      actorRole: "operator",
      policyVersion: "loopgraph-ui/graph-review/v1",
      reason: "The exact design and evidence are ready for accountable application.",
      now: new Date("2026-08-16T12:00:00.000Z")
    }, {
      opportunityStore: opportunityStore(records, saved),
      hermesDesignStore: hermesStore(records.task),
      designStore: discoveryStore(records.designRun, records.proposalSet),
      approve
    });

    expect(saved).toEqual([expect.objectContaining({
      id: records.changeSet.id,
      designRunId: records.designRun.id
    })]);
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      expectedChangeSetHash: expect.any(String),
      expectedDesignRunId: records.designRun.id,
      approvedChangeIds: ["change_improve"],
      evidenceRefs: [
        `design-run:${records.designRun.id}`,
        `design-output:${records.designRun.outputHash}`,
        "loop-design-proposal:proposal_improve"
      ]
    }), expect.any(Object));
    expect(result).toMatchObject({
      designRunId: records.designRun.id,
      proposalIds: ["proposal_improve"]
    });
  });

  it("fails closed before approval when Hermes still needs evidence", async () => {
    const records = fixtures();
    const approve = vi.fn();
    await expect(reviewHermesGraphChangeSet({
      changeSetId: records.changeSet.id,
      decision: "approved",
      actorId: "operator_1",
      actorRole: "operator",
      policyVersion: "loopgraph-ui/graph-review/v1",
      reason: "Approve too early"
    }, {
      opportunityStore: opportunityStore(records, []),
      hermesDesignStore: hermesStore({ ...records.task, status: "needs_input" }),
      designStore: discoveryStore(records.designRun, records.proposalSet),
      approve: approve as never
    })).rejects.toThrow("Hermes design is not ready for approval: needs_input");
    expect(approve).not.toHaveBeenCalled();
  });

  it("rejects a cross-company lifecycle correlation", async () => {
    const records = fixtures();
    await expect(reviewHermesGraphChangeSet({
      changeSetId: records.changeSet.id,
      decision: "rejected",
      actorId: "operator_1",
      actorRole: "operator",
      policyVersion: "loopgraph-ui/graph-review/v1",
      reason: "Reject mismatched scope"
    }, {
      opportunityStore: opportunityStore({
        ...records,
        opportunity: { ...records.opportunity, companyId: "company_other" }
      }, []),
      hermesDesignStore: hermesStore(records.task),
      designStore: discoveryStore(records.designRun, records.proposalSet)
    })).rejects.toThrow("does not belong to its claimed opportunity scope");
  });
});

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
    status: "proposed",
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
    approvalReceiptIds: [],
    createdAt: "2026-08-16T10:00:00.000Z",
    updatedAt: "2026-08-16T10:00:00.000Z"
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
    designRunIds: ["design_run_improve"]
  } as HermesDesignTask;
  const designRun = {
    id: "design_run_improve",
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
  return { changeSet, opportunity, task, designRun, proposalSet };
}

function opportunityStore(
  records: { changeSet: GraphChangeSet; opportunity: LoopOpportunity },
  saved: GraphChangeSet[]
): LoopOpportunityStore {
  return {
    persistence: "file",
    getGraphChangeSet: async (id) => id === records.changeSet.id ? records.changeSet : undefined,
    getOpportunity: async (id) => id === records.opportunity.id ? records.opportunity : undefined,
    saveGraphChangeSet: async (changeSet) => { saved.push(changeSet); },
    saveOpportunity: async () => undefined,
    listGraphChangeSets: async () => [],
    listOpportunities: async () => []
  };
}

function hermesStore(task: HermesDesignTask): HermesDesignStore {
  return {
    persistence: "file",
    getTask: async (id: string) => id === task.id ? task : undefined
  } as unknown as HermesDesignStore;
}

function discoveryStore(
  designRun: DesignRun,
  proposalSet: LoopDesignProposalSet
): DiscoveryDesignStore {
  return {
    persistence: "file",
    getDesignRun: async (id: string) => id === designRun.id ? designRun : undefined,
    getProposalSet: async (id: string) => id === designRun.id ? proposalSet : undefined
  } as unknown as DiscoveryDesignStore;
}
