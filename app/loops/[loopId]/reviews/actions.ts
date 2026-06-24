"use server";

import { revalidatePath } from "next/cache";
import { submitHumanReview } from "@/lib/loop-engineering-builder/workspace";
import type { HumanReview } from "@/lib/loop-engineering-builder/types";

export async function submitHumanReviewAction(formData: FormData) {
  const loopId = String(formData.get("loop_id") ?? "");
  const reviewId = String(formData.get("review_id") ?? "");
  const decision = String(formData.get("decision") ?? "approved") as HumanReview["status"];
  const reviewerNotes = String(formData.get("reviewer_notes") ?? "");

  if (!reviewId) {
    return;
  }

  await submitHumanReview({
    reviewId,
    decision,
    reviewerNotes,
    hiddenLabor: {
      reviewMinutes: Number(formData.get("review_minutes") ?? 0),
      reworkMinutes: Number(formData.get("rework_minutes") ?? 0),
      botsittingMinutes: Number(formData.get("botsitting_minutes") ?? 0),
      escalationMinutes: Number(formData.get("escalation_minutes") ?? 0),
      governanceMinutes: Number(formData.get("governance_minutes") ?? 0),
      relationshipRedeploymentMinutes: Number(formData.get("relationship_minutes") ?? 0)
    }
  });

  if (loopId) {
    revalidatePath(`/loops/${loopId}/reviews`);
    revalidatePath(`/loops/${loopId}/improvements`);
  }
  revalidatePath("/topology");
}
