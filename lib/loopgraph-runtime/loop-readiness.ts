import type { LoopRecommendation } from "loopgraph/core";
import type { LoopReadiness, ReadinessLevel } from "loopgraph/core";

const levelScore: Record<ReadinessLevel, number> = {
  L0: 20,
  L1: 42,
  L2: 64,
  L3: 82,
  L4: 94
};

export function calculateLoopReadiness(recommendation: LoopRecommendation): LoopReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const hasGoal = recommendation.goal.trim().length > 0;
  const hasOwner = recommendation.humanRequirements.some((item) => item.requirementType === "loop_owner");
  const hasMetric = recommendation.metricDrafts.length > 0;
  const hasUndefinedPrimaryMetric = recommendation.undefinedMetrics.some((item) =>
    item.metricKey === recommendation.metricDrafts[0]?.key && item.status === "open"
  );
  const hasVerifier = recommendation.verifierDraft.length > 0;
  const hasApproval = recommendation.humanReviewDraft.length > 0 ||
    recommendation.humanRequirements.some((item) => item.requirementType === "approval");
  const hasAccessPolicy = recommendation.accessRequirements.length > 0;
  const hasBlockingAccess = recommendation.accessRequirements.some((item) =>
    item.blockingLevel === "blocking" && !["connected", "manual_fallback", "waived"].includes(item.status)
  );
  const hasEscalation = recommendation.humanReviewDraft.length > 0;
  const hasLowRiskWrite = recommendation.allowedActions.some((action) =>
    action.riskLevel === "low" && !action.requiresApproval
  );
  const hasRiskyCustomerWrite = recommendation.allowedActions.some((action) =>
    ["high", "critical"].includes(action.riskLevel) && !action.requiresApproval
  );

  if (!hasGoal) blockers.push("Missing business goal");
  if (!hasOwner) blockers.push("Missing loop owner");
  if (!hasMetric) blockers.push("Missing success metric");
  if (hasUndefinedPrimaryMetric) blockers.push("Primary metric is undefined");
  if (!hasAccessPolicy) blockers.push("Missing explicit access policy");
  if (hasBlockingAccess) blockers.push("Blocking access is not connected or waived");
  if (!hasVerifier) blockers.push("Missing verifier");
  if (hasRiskyCustomerWrite) blockers.push("High-risk external write requires approval");

  if (!hasApproval) warnings.push("Human approval is not configured");
  if (!hasEscalation) warnings.push("Human escalation rule is missing");
  if (recommendation.undefinedMetrics.length > 0) warnings.push("Some metrics still need measurement work");

  let level: ReadinessLevel = "L0";
  if (hasGoal && hasAccessPolicy) level = "L1";
  if (level !== "L0" && hasVerifier && hasApproval) level = "L2";
  if (level === "L2" && hasMetric && !hasUndefinedPrimaryMetric && hasLowRiskWrite && !hasBlockingAccess) level = "L3";
  if (level === "L3" && recommendation.readiness.level === "L4" && recommendation.undefinedMetrics.length === 0) level = "L4";

  if (!hasVerifier || !hasMetric) level = maxLevel(level, "L1");
  if (!hasApproval || !hasEscalation || hasRiskyCustomerWrite) level = maxLevel(level, "L2");

  const penalty = blockers.length * 8 + warnings.length * 3;
  return {
    level,
    score: Math.max(0, Math.min(100, levelScore[level] - penalty)),
    blockers,
    warnings
  };
}

function maxLevel(current: ReadinessLevel, max: ReadinessLevel): ReadinessLevel {
  const order: ReadinessLevel[] = ["L0", "L1", "L2", "L3", "L4"];
  return order[Math.min(order.indexOf(current), order.indexOf(max))];
}

