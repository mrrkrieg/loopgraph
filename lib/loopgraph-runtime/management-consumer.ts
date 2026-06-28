import type { EscalationCase } from "../loopgraph-core/escalation";

export type ManagementPlan = {
  resourceDecision: Record<string, unknown>;
  crossFunctionalDependencies: string[];
  leadershipDecisionRequired: boolean;
  monitoringPlan: {
    nextReviewAt: string;
    successCriteria: string[];
  };
};

export function consumeEscalationCase(caseItem: EscalationCase): ManagementPlan {
  return {
    resourceDecision: {
      engineeringPriority: caseItem.severity,
      customerSuccessCoverage: caseItem.severity === "P0" || caseItem.severity === "P1" ? "executive_sponsor_required" : "standard",
      salesInvolvement: caseItem.category === "revenue_risk" || caseItem.category === "customer_risk"
    },
    crossFunctionalDependencies: caseItem.responsePlan.internalActions.map((action) => `${action.label} (${action.toolKey})`),
    leadershipDecisionRequired: caseItem.severity === "P0",
    monitoringPlan: {
      nextReviewAt: caseItem.routing.nextUpdateDueAt ?? caseItem.routing.escalationDeadline,
      successCriteria: caseItem.responsePlan.successCriteria
    }
  };
}
