import type { LoopRunTrace } from "../loopgraph-core/trace";
import type { HumanReviewTrace } from "../loopgraph-core/review";
import { calculateNetSavings, scoreLoopHealth } from "../loopgraph-core/measurement";

export type ImprovementItemInput = {
  loopId: string;
  sourceRunId: string;
  title: string;
  description: string;
  failureMode: string;
  teacherFeedback?: string;
};

export function buildImprovementItemFromReview(trace: LoopRunTrace, review: HumanReviewTrace): ImprovementItemInput | null {
  if (!["rejected", "needs_changes", "request_evidence"].includes(review.status)) {
    return null;
  }

  return {
    loopId: trace.loopId,
    sourceRunId: trace.id,
    title: `Review ${review.status}: improve loop behavior`,
    description: review.comment ?? "Human review requested loop changes.",
    failureMode: review.status,
    teacherFeedback: review.teacherFeedback
  };
}

export function summarizeLoopHealth(trace: LoopRunTrace, review?: HumanReviewTrace) {
  const savings = calculateNetSavings({
    grossSavedMinutes: 180,
    reviewMinutes: review?.reviewMinutes,
    reworkMinutes: review?.reworkMinutes,
    botsittingMinutes: review?.botsittingMinutes,
    escalationMinutes: review?.escalationMinutes,
    governanceMinutes: review?.governanceMinutes
  });

  return {
    health: scoreLoopHealth(savings.netSavedMinutes),
    savings
  };
}
