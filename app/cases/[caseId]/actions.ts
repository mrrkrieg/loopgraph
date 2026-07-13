"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveCase } from "@/lib/loopgraph-runtime/case-service";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";

export async function resolveCaseAction(formData: FormData) {
  const caseId = String(formData.get("case_id") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();

  if (!caseId || !summary) {
    redirect(`/cases/${caseId}?error=Summary+required`);
  }

  const storage = getStorageAdapter();
  const caseItem = await storage.getEscalationCase(caseId);
  if (!caseItem) {
    redirect(`/cases/${caseId}?error=Case+not+found`);
  }

  await resolveCase(storage, caseId, {
    resolutionSummary: summary,
    resolvedAt: new Date().toISOString()
  });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/management");
  if (caseItem.sourceRunId) {
    revalidatePath(`/loops/${caseItem.sourceLoopId}/runs/${caseItem.sourceRunId}`);
    revalidatePath(`/loops/${caseItem.sourceLoopId}/runs`);
    revalidatePath(`/loops/${caseItem.sourceLoopId}/improvements`);
  }

  redirect(`/cases/${caseId}?resolved=1`);
}
