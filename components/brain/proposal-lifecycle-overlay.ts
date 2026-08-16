import type { GraphEditorProposalLifecycleReference } from "loopgraph/runtime";
import type { BrainGraph } from "./graph-types";

export type PendingGraphChange = Pick<
  GraphEditorProposalLifecycleReference,
  | "opportunityId"
  | "kind"
  | "status"
  | "title"
  | "department"
  | "graphChangeSetId"
  | "graphChangeSetStatus"
  | "designTaskId"
  | "discoverySessionId"
  | "updatedAt"
  | "nextAction"
>;

const terminalOpportunityStatuses = new Set(["dismissed", "implemented"]);
const terminalChangeSetStatuses = new Set([
  "applied",
  "rejected",
  "superseded",
  "rolled_back"
]);

export function pendingGraphProposalLifecycles(
  lifecycles: GraphEditorProposalLifecycleReference[]
): GraphEditorProposalLifecycleReference[] {
  const byOpportunityId = new Map<string, GraphEditorProposalLifecycleReference>();
  for (const lifecycle of lifecycles) {
    if (terminalOpportunityStatuses.has(lifecycle.status)) continue;
    if (
      lifecycle.graphChangeSetStatus &&
      terminalChangeSetStatuses.has(lifecycle.graphChangeSetStatus)
    ) continue;
    const current = byOpportunityId.get(lifecycle.opportunityId);
    if (!current || current.updatedAt.localeCompare(lifecycle.updatedAt) < 0) {
      byOpportunityId.set(lifecycle.opportunityId, lifecycle);
    }
  }
  return [...byOpportunityId.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function applyProposalLifecycleOverlay(input: {
  graph: BrainGraph;
  lifecycles: GraphEditorProposalLifecycleReference[];
}): BrainGraph {
  const pending = pendingGraphProposalLifecycles(input.lifecycles);
  if (pending.length === 0) return input.graph;

  const pendingByLoopId = new Map<string, PendingGraphChange[]>();
  for (const lifecycle of pending) {
    const summary = pendingGraphChange(lifecycle);
    for (const loopId of new Set(lifecycle.targetLoopIds)) {
      pendingByLoopId.set(loopId, [
        ...(pendingByLoopId.get(loopId) ?? []),
        summary
      ]);
    }
  }

  return {
    ...input.graph,
    nodes: input.graph.nodes.map((node) => {
      const changes = node.loopId ? pendingByLoopId.get(node.loopId) : undefined;
      if (!changes || changes.length === 0) return node;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          pendingGraphChangeCount: changes.length,
          pendingGraphChanges: changes
        }
      };
    })
  };
}

function pendingGraphChange(
  lifecycle: GraphEditorProposalLifecycleReference
): PendingGraphChange {
  return {
    opportunityId: lifecycle.opportunityId,
    kind: lifecycle.kind,
    status: lifecycle.status,
    title: lifecycle.title,
    department: lifecycle.department,
    graphChangeSetId: lifecycle.graphChangeSetId,
    graphChangeSetStatus: lifecycle.graphChangeSetStatus,
    designTaskId: lifecycle.designTaskId,
    discoverySessionId: lifecycle.discoverySessionId,
    updatedAt: lifecycle.updatedAt,
    nextAction: lifecycle.nextAction
  };
}
