import type {
  DepartmentType,
  GraphChangeSet,
  GraphEditorTransaction,
  HermesDesignTaskStatus,
  LoopOpportunity,
  LoopOpportunityKind,
  LoopOpportunityStatus
} from "../core";
import type { HermesDesignStore } from "./hermes-design-store";
import type { LoopOpportunityStore } from "./loop-opportunity-store";

export type GraphEditorProposalLifecycleReference = {
  opportunityId: string;
  kind: LoopOpportunityKind;
  status: LoopOpportunityStatus;
  title: string;
  department: DepartmentType;
  targetLoopIds: string[];
  graphChangeSetId?: string;
  graphChangeSetStatus?: GraphChangeSet["status"];
  designTaskId?: string;
  discoverySessionId?: string;
  updatedAt: string;
  nextAction: "answer_questions" | "await_hermes" | "review_proposal";
};

export type GraphEditorTransactionReceipt = {
  transaction: GraphEditorTransaction;
  proposalLifecycle: GraphEditorProposalLifecycleReference[];
};

/**
 * Rebuilds the operator-facing lifecycle links from durable records so graph
 * proposal handoffs remain resumable after refresh and across replicas.
 */
export async function projectGraphEditorTransactionReceipts(input: {
  transactions: GraphEditorTransaction[];
  opportunityStore: LoopOpportunityStore;
  designStore: HermesDesignStore;
}): Promise<GraphEditorTransactionReceipt[]> {
  const [opportunities, designTasks, graphChangeSets] = await Promise.all([
    input.opportunityStore.listOpportunities(),
    input.designStore.listTasks(),
    input.opportunityStore.listGraphChangeSets()
  ]);
  const opportunitiesByTransaction = indexGraphEditorOpportunities(opportunities);
  const tasksById = new Map(designTasks.map((task) => [task.id, task]));
  const changeSetsById = new Map(graphChangeSets.map((changeSet) => [changeSet.id, changeSet]));
  return input.transactions.map((transaction) => ({
    transaction,
    proposalLifecycle: (opportunitiesByTransaction.get(transaction.id) ?? [])
      .filter((opportunity) =>
        opportunity.workspaceId === transaction.workspaceId &&
        opportunity.companyId === transaction.companyId
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((opportunity) => {
        const task = opportunity.designTaskId
          ? tasksById.get(opportunity.designTaskId)
          : undefined;
        const scopedTask = task &&
          task.companyId === transaction.companyId &&
          task.originOpportunityId === opportunity.id
          ? task
          : undefined;
        const candidateChangeSet = opportunity.graphChangeSetId
          ? changeSetsById.get(opportunity.graphChangeSetId)
          : undefined;
        const changeSet = candidateChangeSet &&
          candidateChangeSet.workspaceId === transaction.workspaceId &&
          candidateChangeSet.companyId === transaction.companyId &&
          candidateChangeSet.opportunityId === opportunity.id
          ? candidateChangeSet
          : undefined;
        return {
          opportunityId: opportunity.id,
          kind: opportunity.kind,
          status: opportunity.status,
          title: opportunity.title,
          department: opportunity.department,
          targetLoopIds: opportunity.targetLoopIds,
          graphChangeSetId: opportunity.graphChangeSetId,
          graphChangeSetStatus: changeSet?.status,
          designTaskId: opportunity.designTaskId,
          discoverySessionId: scopedTask?.sessionId ?? opportunity.discoverySessionId,
          updatedAt: opportunity.updatedAt,
          nextAction: nextActionForTask(scopedTask?.status, opportunity)
        } satisfies GraphEditorProposalLifecycleReference;
      })
  }));
}

export function graphEditorTransactionReceipt(
  transaction: GraphEditorTransaction
): GraphEditorTransactionReceipt {
  return { transaction, proposalLifecycle: [] };
}

function indexGraphEditorOpportunities(
  opportunities: LoopOpportunity[]
): Map<string, LoopOpportunity[]> {
  const index = new Map<string, LoopOpportunity[]>();
  for (const opportunity of opportunities) {
    const transactionIds = new Set(opportunity.signals.flatMap((signal) => {
      const match = /^graph-editor:([^:]+):/.exec(signal.sourceRef);
      return match?.[1] ? [match[1]] : [];
    }));
    for (const transactionId of transactionIds) {
      index.set(transactionId, [...(index.get(transactionId) ?? []), opportunity]);
    }
  }
  return index;
}

function nextActionForTask(
  status: HermesDesignTaskStatus | undefined,
  opportunity: LoopOpportunity
): GraphEditorProposalLifecycleReference["nextAction"] {
  if (status === "completed" || opportunity.status === "proposal_ready") {
    return "review_proposal";
  }
  if (status === "needs_input" || status === "needs_repair") {
    return "answer_questions";
  }
  return "await_hermes";
}
