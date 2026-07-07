import { MAX_ESCALATION_REENTRY_DEPTH, MAX_PARENT_CHILD_RUN_DEPTH } from "../core/constants";

export type OrchestrationContext = {
  parentRunId?: string;
  depth: number;
  escalationReentryCount: number;
};

export function assertOrchestrationLimits(context: OrchestrationContext) {
  if (context.depth > MAX_PARENT_CHILD_RUN_DEPTH) {
    throw new Error(`Maximum parent/child run depth exceeded (${MAX_PARENT_CHILD_RUN_DEPTH})`);
  }
  if (context.escalationReentryCount > MAX_ESCALATION_REENTRY_DEPTH) {
    throw new Error(`Maximum escalation re-entry depth exceeded (${MAX_ESCALATION_REENTRY_DEPTH})`);
  }
}

export const informationalEdgeTypes = new Set(["reports_to", "learns_from", "depends_on"]);
export const semanticEdgeTypes = new Set([
  "observes",
  "calls",
  "verifies_with",
  "requires_approval",
  "escalates_to",
  "writes_trace_to"
]);

export function isExecutableEdge(edgeType: string) {
  return semanticEdgeTypes.has(edgeType) && !informationalEdgeTypes.has(edgeType);
}

export function assertEdgeExecutable(edgeType: string) {
  if (informationalEdgeTypes.has(edgeType)) {
    throw new Error(`Informational edge ${edgeType} cannot auto-execute`);
  }
}
