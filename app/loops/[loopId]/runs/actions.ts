"use server";

import { revalidatePath } from "next/cache";
import { startLoopRun } from "@/lib/loop-engineering-builder/workspace";

export async function startLoopRunAction(formData: FormData) {
  const loopId = String(formData.get("loop_id") ?? "");
  if (!loopId) {
    return;
  }

  await startLoopRun(loopId);
  revalidatePath(`/loops/${loopId}/runs`);
  revalidatePath(`/loops/${loopId}/reviews`);
  revalidatePath("/topology");
}
