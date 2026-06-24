"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generateAndPersistLoopSpec, saveLoopAnswers } from "@/lib/loop-engineering-builder/workspace";

export async function saveAnswersAndGenerateSpecAction(formData: FormData) {
  const loopId = String(formData.get("loop_id") ?? "loop_demo_marketing_campaign");
  const answers = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([key]) => key !== "loop_id")
      .map(([key, value]) => [key, String(value)])
  );

  await saveLoopAnswers(loopId, answers);
  await generateAndPersistLoopSpec(loopId);
  revalidatePath(`/loops/${loopId}/questions`);
  revalidatePath(`/loops/${loopId}/spec`);
  revalidatePath(`/loops/${loopId}/implementation`);
  revalidatePath("/topology");
  redirect(`/loops/${loopId}/spec`);
}
