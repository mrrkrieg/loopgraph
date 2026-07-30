"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applyReviewDecision,
  mapUiDecisionToReviewStatus,
  ReviewServiceError
} from "@/lib/loopgraph-runtime/review-service";
import {
  getActiveLoopgraphProjectRoot,
  getStorageAdapter
} from "@/lib/loopgraph-runtime/storage-resolver";
import type { ReviewRole } from "@/lib/loopgraph-core/constants";

export async function submitHumanReviewAction(formData: FormData) {
  const loopId = String(formData.get("loop_id") ?? "");
  const runId = String(formData.get("run_id") ?? "");
  const decision = String(formData.get("decision") ?? "approved");
  const reviewerNotes = String(formData.get("reviewer_notes") ?? "");
  const teacherFeedback = String(formData.get("teacher_feedback") ?? "");
  const reviewerId = String(formData.get("reviewer_id") ?? "").trim();
  const role = String(formData.get("reviewer_role") ?? "approver") as ReviewRole;
  const approvedFingerprints = formData
    .getAll("approved_fingerprints")
    .map((value) => String(value))
    .filter(Boolean);

  if (!runId) {
    redirect(loopId ? `/loops/${loopId}/reviews?error=Missing+run+id` : "/loops");
  }
  if (!reviewerId) {
    redirect(`/loops/${loopId}/reviews?runId=${runId}&error=Reviewer+identity+is+required`);
  }

  try {
    const storage = getStorageAdapter();
    const trace = await storage.getRun(runId);
    if (trace && decision === "approved") {
      const allowedRoles = ["approver", "reviewer", "owner", "teacher", "executor", "accountability_holder"];
      if (!allowedRoles.includes(role)) {
        throw new ReviewServiceError(`Role ${role} is not allowed to approve`);
      }
    }
    await applyReviewDecision(storage, {
      runId,
      status: mapUiDecisionToReviewStatus(decision),
      approvedFingerprints: decision === "approved" ? approvedFingerprints : [],
      reviewerId,
      role,
      comment: reviewerNotes,
      teacherFeedback,
      reviewMinutes: Number(formData.get("review_minutes") ?? 0),
      reworkMinutes: Number(formData.get("rework_minutes") ?? 0),
      botsittingMinutes: Number(formData.get("botsitting_minutes") ?? 0),
      escalationMinutes: Number(formData.get("escalation_minutes") ?? 0),
      governanceMinutes: Number(formData.get("governance_minutes") ?? 0)
    }, {
      projectRoot: getActiveLoopgraphProjectRoot()
    });
  } catch (error) {
    const message = encodeURIComponent(error instanceof ReviewServiceError ? error.message : "Review failed");
    redirect(`/loops/${loopId}/reviews?runId=${runId}&error=${message}`);
  }

  revalidatePath(`/loops/${loopId}/runs`);
  revalidatePath(`/loops/${loopId}/runs/${runId}`);
  revalidatePath(`/loops/${loopId}/reviews`);
  revalidatePath(`/loops/${loopId}/improvements`);
  revalidatePath("/management");

  const statusParam = decision === "approved" ? "&success=approved" : "";
  redirect(`/loops/${loopId}/reviews?runId=${runId}${statusParam}`);
}
