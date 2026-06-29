import type { HiddenLaborMetrics } from "../loop-engineering-builder/types";
import type { LoopRunTrace } from "../loopgraph-core/trace";

export function hiddenLaborFromTraceReview(review: LoopRunTrace["humanReviews"][number]): Partial<HiddenLaborMetrics> {
  return {
    reviewMinutes: review.reviewMinutes ?? 0,
    reworkMinutes: review.reworkMinutes ?? 0,
    botsittingMinutes: review.botsittingMinutes ?? 0,
    escalationMinutes: review.escalationMinutes ?? 0,
    governanceMinutes: review.governanceMinutes ?? 0
  };
}

export function hiddenLaborFromTrace(trace: LoopRunTrace): Partial<HiddenLaborMetrics> | undefined {
  const approved = [...trace.humanReviews].reverse().find((review) => review.status === "approved");
  if (!approved) return undefined;
  return hiddenLaborFromTraceReview(approved);
}

export function mergeTraceLaborEntries(entries: Array<Partial<HiddenLaborMetrics>>): Partial<HiddenLaborMetrics> {
  return entries.reduce<Partial<HiddenLaborMetrics>>((total, entry) => {
    for (const key of [
      "reviewMinutes",
      "reworkMinutes",
      "botsittingMinutes",
      "escalationMinutes",
      "governanceMinutes"
    ] as const) {
      total[key] = (total[key] ?? 0) + (entry[key] ?? 0);
    }
    return total;
  }, {});
}
