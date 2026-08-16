import type {
  GraphEditorTransaction,
  HermesDesignTaskStatus,
  LoopOpportunity
} from "../core";
import type { HermesDesignStore } from "./hermes-design-store";
import type { LoopOpportunityStore } from "./loop-opportunity-store";

export type GraphEditorProposalLifecycleReference = {
  opportunityId: string;
  graphChangeSetId?: string;
  designTaskId?: string;
  discoverySessionId?: string;
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
  const [opportunities, designTasks] = await Promise.all([
    input.opportunityStore.listOpportunities(),
    input.designStore.listTasks()
  ]);
  const opportunitiesByTransaction = indexGraphEditorOpportunities(opportunities);
  const tasksById = new Map(designTasks.map((task) => [task.id, task]));
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
        return {
          opportunityId: opportunity.id,
          graphChangeSetId: opportunity.graphChangeSetId,
          designTaskId: opportunity.designTaskId,
          discoverySessionId: task?.sessionId ?? opportunity.discoverySessionId,
          nextAction: nextActionForTask(task?.status, opportunity)
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
