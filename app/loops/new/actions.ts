"use server";

import { redirect } from "next/navigation";
import { getTemplateById } from "@/lib/loop-engineering-builder/templates";
import { createLoop } from "@/lib/loop-engineering-builder/workspace";

export async function createLoopAction(formData: FormData) {
  const organizationName = String(formData.get("organization_name") ?? "Loopgraph workspace");
  const templateId = String(formData.get("template_id") ?? "marketing-campaign_learning");
  const department = getTemplateById(templateId)?.department ?? "marketing";
  const name = String(formData.get("loop_name") ?? "Campaign Learning Loop");
  const goal = String(formData.get("goal") ?? "").trim();
  const loopId = await createLoop({ organizationName, department, templateId, name, goal });

  redirect(`/loops/${loopId}/questions`);
}
