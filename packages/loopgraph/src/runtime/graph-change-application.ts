import path from "node:path";
import {
  contentHash,
  type GraphChangeApprovalReceipt
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
import { resolveCompletedHermesGraphDesign } from "./graph-change-review";
import { graphChangeSetHash } from "./semantic-graph-state";
import {
  applyGraphChangeSet,
  type SemanticGraphRuntimeOptions
} from "./semantic-graph-transactions";
import {
  FileSemanticGraphStore,
  type SemanticGraphStore
} from "./semantic-graph-store";
import { getLoopgraphRoot } from "./storage-resolver";

export type ApplyApprovedHermesGraphChangeInput = {
  projectRoot?: string;
  changeSetId: string;
  initiatedBy: string;
  now?: Date;
};

export type ApplyApprovedHermesGraphChangeOptions = SemanticGraphRuntimeOptions & {
  opportunityStore?: LoopOpportunityStore;
  designStore?: DiscoveryDesignStore;
  hermesDesignStore?: HermesDesignStore;
  store?: SemanticGraphStore;
  apply?: typeof applyGraphChangeSet;
};

/**
 * Applies the exact Hermes design that an accountable approval receipt bound.
 * The caller supplies only the change-set identity; receipt, design run, and
 * proposal identities are selected and verified from tenant-scoped storage.
 */
export async function applyApprovedHermesGraphChangeSet(
  input: ApplyApprovedHermesGraphChangeInput,
  options: ApplyApprovedHermesGraphChangeOptions = {}
) {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const store = options.store ?? new FileSemanticGraphStore(loopgraphRoot);
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
  if (changeSet.changes.length !== 1) {
    throw new Error(
      "Governed UI application requires one semantic operation per graph change set"
    );
  }
  if (changeSet.status !== "approved" && changeSet.status !== "applied") {
    throw new Error(
      `Graph change set ${changeSet.id} cannot be applied from status=${changeSet.status}`
    );
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

  const design = await resolveCompletedHermesGraphDesign({
    changeSet,
    opportunity,
    hermesDesignStore,
    designStore
  });
  if (changeSet.designRunId !== design.designRunId) {
    throw new Error("Approved graph change is not bound to the completed Hermes design run");
  }
  const evidenceRefs = [
    `design-run:${design.designRunId}`,
    `design-output:${design.outputHash}`,
    ...design.proposalIds.map((proposalId) =>
      `loop-design-proposal:${proposalId}`
    )
  ];
  const approval = await selectContentBoundApproval({
    changeSet,
    evidenceRefs,
    store
  });
  const apply = options.apply ?? applyGraphChangeSet;
  return apply({
    projectRoot,
    changeSetId: changeSet.id,
    approvalReceiptId: approval.id,
    expectedApprovalEvidenceRefs: evidenceRefs,
    designRunId: design.designRunId,
    acceptedProposalIds: design.proposalIds,
    initiatedBy: input.initiatedBy,
    now: input.now
  }, {
    store,
    opportunityStore,
    designStore,
    hermesDesignStore,
    loopSpecStore: options.loopSpecStore
  });
}

async function selectContentBoundApproval(input: {
  changeSet: NonNullable<Awaited<ReturnType<LoopOpportunityStore["getGraphChangeSet"]>>>;
  evidenceRefs: string[];
  store: SemanticGraphStore;
}): Promise<GraphChangeApprovalReceipt> {
  const receipts = (await Promise.all(
    input.changeSet.approvalReceiptIds.map((id) => input.store.getApproval(id))
  )).filter((receipt): receipt is GraphChangeApprovalReceipt => Boolean(receipt));
  const expectedChangeIds = input.changeSet.changes.map((change) => change.id).sort();
  const expectedEvidence = [...new Set(input.evidenceRefs)].sort();
  const matching = receipts.filter((receipt) => {
    const approvedChangeIds = [...new Set(receipt.approvedChangeIds)].sort();
    const evidenceRefs = [...new Set(receipt.evidenceRefs)].sort();
    return receipt.subjectType === "graph_change" &&
      receipt.decision === "approved" &&
      receipt.changeSetId === input.changeSet.id &&
      receipt.changeSetHash === graphChangeSetHash(input.changeSet) &&
      receipt.baseGraphHash === input.changeSet.baseGraphHash &&
      approvedChangeIds.length === expectedChangeIds.length &&
      contentHash(approvedChangeIds) === contentHash(expectedChangeIds) &&
      evidenceRefs.length === expectedEvidence.length &&
      contentHash(evidenceRefs) === contentHash(expectedEvidence);
  }).sort((left, right) => right.decidedAt.localeCompare(left.decidedAt));
  if (!matching[0]) {
    throw new Error(
      "No accountable approval receipt matches the exact Hermes design and graph change"
    );
  }
  return matching[0];
}
