"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function saveAnswersAndGenerateSpecAction(formData: FormData) {
  const loopId = String(formData.get("loop_id") ?? "loop_demo_marketing_campaign");

  revalidatePath(`/loops/${loopId}/questions`);
  redirect(`/loops/${loopId}/spec`);
}
