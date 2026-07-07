import {
  HumanInputRequirementSchema,
  type HumanInputRequirement
} from "../loopgraph-core/access-requirements";
import type { LoopRecommendation } from "../loopgraph-core/loop-recommendation";

export function generateHumanRequirements(recommendation: LoopRecommendation): HumanInputRequirement[] {
  const requirements: HumanInputRequirement[] = [
    HumanInputRequirementSchema.parse({
      id: `${recommendation.id}:human:owner`,
      companyId: recommendation.companyId,
      departmentId: recommendation.departmentId,
      loopRecommendationId: recommendation.id,
      ownerRole: "Department owner",
      requirementType: "loop_owner",
      prompt: `Who owns ${recommendation.name}?`,
      reason: "Every loop needs a named accountable human before activation.",
      blocking: true,
      status: "open"
    })
  ];

  for (const [index, review] of recommendation.humanReviewDraft.entries()) {
    requirements.push(HumanInputRequirementSchema.parse({
      id: `${recommendation.id}:human:review:${index + 1}`,
      companyId: recommendation.companyId,
      departmentId: recommendation.departmentId,
      loopRecommendationId: recommendation.id,
      ownerRole: review.reviewerRole,
      requirementType: review.condition.toLowerCase().includes("customer")
        ? "customer_facing_review"
        : "approval",
      prompt: review.condition,
      reason: review.reason,
      blocking: true,
      status: "open"
    }));
  }

  if (recommendation.estimatedValue.netSavedMinutesPerWeek === undefined) {
    requirements.push(HumanInputRequirementSchema.parse({
      id: `${recommendation.id}:human:review-budget`,
      companyId: recommendation.companyId,
      departmentId: recommendation.departmentId,
      loopRecommendationId: recommendation.id,
      ownerRole: "Management",
      requirementType: "review_budget",
      prompt: "How much weekly review and botsitting time should be budgeted?",
      reason: "Gross AI savings are not value until review, rework, escalation, governance, and botsitting are subtracted.",
      blocking: false,
      status: "open"
    }));
  }

  return requirements;
}

export function generateHumanRequirementPlan(recommendations: LoopRecommendation[]) {
  return recommendations.flatMap((recommendation) => generateHumanRequirements(recommendation));
}

