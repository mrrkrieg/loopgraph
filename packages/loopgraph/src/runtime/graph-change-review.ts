import path from "node:path";
import {
  contentHash,
  graphChangeSetSchema,
  type GraphChangeSet
} from "../core";
import {
  FileDiscoveryDesignStore,
  type DiscoveryDesignStore
} from "./discovery-design-store";
import {
  FileHermesDesignStore,
  type HermesDesignStore
} from "./hermes-design-store";
import {
  FileLoopOpportunityStore,
  type LoopOpportunityStore
} from "./loop-opportunity-store";
import {
  approveGraphChangeSet,
  type SemanticGraphRuntimeOptions
} from "./semantic-graph-transactions";
import { graphChangeSetHash } from "./semantic-graph-state";
import { getLoopgraphRoot } from "./storage-resolver";

export type ReviewHermesGraphChangeInput = {
  projectRoot?: string;
  changeSetId: string;
  decision: "approved" | "rejected";
  actorId: string;
  actorRole: string;
  reason: string;
  policyVersion: string;
  now?: Date;
};

export type ReviewHermesGraphChangeOptions = SemanticGraphRuntimeOptions & {
  opportunityStore?: LoopOpportunityStore;
  designStore?: DiscoveryDesignStore;
  hermesDesignStore?: HermesDesignStore;
  approve?: typeof approveGraphChangeSet;
};

/**
 * Records an accountable graph decision only after the persisted Hermes design
 * artifacts are complete and mutually consistent. Rejection remains available
 * before design completes so an owner can stop unwanted work immediately.
 */
export async function reviewHermesGraphChangeSet(
  input: ReviewHermesGraphChangeInput,
  options: ReviewHermesGraphChangeOptions = {}
) {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const opportunityStore = options.opportunityStore ??
    new FileLoopOpportunityStore(loopgraphRoot);
  const hermesDesignStore = options.hermesDesignStore ??
    new FileHermesDesignStore(loopgraphRoot);
  const designStore = options.designStore ??
    new FileDiscoveryDesignStore(loopgraphRoot);
  const changeSet = await opportunityStore.getGraphChangeSet(input.changeSetId);
  if (!changeSet) {
    throw new Error(`Graph change set not found: ${input.changeSetId}`);
  }
  const opportunity = await opportunityStore.getOpportunity(changeSet.opportunityId);
  if (!opportunity) {
    throw new Error(`Loop opportunity not found: ${changeSet.opportunityId}`);
  }
  if (
    opportunity.graphChangeSetId !== changeSet.id ||
    opportunity.workspaceId !== changeSet.workspaceId ||
    opportunity.companyId !== changeSet.companyId
  ) {
    throw new Error("Graph change set does not belong to its claimed opportunity scope");
  }

  let reviewableChangeSet = changeSet;
  let designRunId: string | undefined;
  let proposalIds: string[] = [];
  if (input.decision === "approved") {
    const readiness = await requireCompletedHermesDesign({
      changeSet,
      opportunity,
      hermesDesignStore,
      designStore
    });
    designRunId = readiness.designRunId;
    proposalIds = readiness.proposalIds;
    if (changeSet.designRunId !== designRunId) {
      reviewableChangeSet = graphChangeSetSchema.parse({
        ...changeSet,
        designRunId,
        updatedAt: (input.now ?? new Date()).toISOString()
      });
      await opportunityStore.saveGraphChangeSet(reviewableChangeSet);
    }
  }

  const approve = options.approve ?? approveGraphChangeSet;
  const result = await approve({
    projectRoot,
    changeSetId: reviewableChangeSet.id,
    expectedChangeSetHash: graphChangeSetHash(reviewableChangeSet),
    expectedDesignRunId: input.decision === "approved" ? designRunId : undefined,
    decision: input.decision,
    approvedChangeIds: input.decision === "approved"
      ? reviewableChangeSet.changes.map((change) => change.id)
      : [],
    actorId: input.actorId,
    actorRole: input.actorRole,
    policyVersion: input.policyVersion,
    reason: input.reason,
    evidenceRefs: input.decision === "approved" && designRunId
      ? [
          `design-run:${designRunId}`,
          ...proposalIds.map((proposalId) => `loop-design-proposal:${proposalId}`)
        ]
      : [],
    now: input.now
  }, {
    store: options.store,
    opportunityStore,
    designStore,
    hermesDesignStore,
    loopSpecStore: options.loopSpecStore
  });
  return {
    ...result,
    designRunId,
    proposalIds
  };
}

async function requireCompletedHermesDesign(input: {
  changeSet: GraphChangeSet;
  opportunity: NonNullable<Awaited<ReturnType<LoopOpportunityStore["getOpportunity"]>>>;
  hermesDesignStore: HermesDesignStore;
  designStore: DiscoveryDesignStore;
}) {
  const taskId = input.changeSet.designTaskId ?? input.opportunity.designTaskId;
  if (!taskId) {
    throw new Error("Hermes must create a design task before this graph change can be approved");
  }
  const task = await input.hermesDesignStore.getTask(taskId);
  if (!task || task.originOpportunityId !== input.opportunity.id) {
    throw new Error("Hermes design task does not match this loop opportunity");
  }
  if (
    task.companyId !== input.changeSet.companyId ||
    task.department !== input.changeSet.changes[0]?.department
  ) {
    throw new Error("Hermes design task does not match the graph change scope");
  }
  if (task.status !== "completed") {
    throw new Error(`Hermes design is not ready for approval: ${task.status}`);
  }
  const designRunId = task.designRunIds.at(-1) ?? input.changeSet.designRunId;
  if (!designRunId) {
    throw new Error("Completed Hermes design task has no immutable design run");
  }
  const [designRun, proposalSet] = await Promise.all([
    input.designStore.getDesignRun(designRunId),
    input.designStore.getProposalSet(designRunId)
  ]);
  if (!designRun || !proposalSet) {
    throw new Error("Hermes design artifacts are incomplete");
  }
  if (
    designRun.sessionId !== task.sessionId ||
    proposalSet.sessionId !== task.sessionId ||
    designRun.departmentType !== task.department ||
    proposalSet.departmentType !== task.department
  ) {
    throw new Error("Hermes design artifacts do not match the design task scope");
  }
  if (!proposalSet.validationSummary.valid || proposalSet.proposals.length === 0) {
    throw new Error("Hermes proposal set has not passed Loopgraph validation");
  }
  const proposalIds = proposalSet.proposals.map((proposal) => proposal.proposalId).sort();
  if (
    proposalIds.length !== designRun.finalProposalIds.length ||
    contentHash(proposalIds) !== contentHash([...designRun.finalProposalIds].sort())
  ) {
    throw new Error("Hermes design run and proposal set identities do not match");
  }
  return { designRunId, proposalIds };
}
