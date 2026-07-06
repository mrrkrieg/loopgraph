"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteLoop } from "@/lib/loop-engineering-builder/workspace";

export async function deleteLoopAction(formData: FormData) {
  const loopId = String(formData.get("loop_id") ?? "");

  if (!loopId) {
    return;
  }

  await deleteLoop(loopId);
  revalidatePath("/loops");
  revalidatePath("/topology");
  redirect("/loops");
}
