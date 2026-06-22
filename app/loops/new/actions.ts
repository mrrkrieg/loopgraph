"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/db/supabase";

export async function createLoopAction(formData: FormData) {
  const department = String(formData.get("department") ?? "marketing");
  const templateId = String(formData.get("template_id") ?? "marketing-campaign_learning");
  const name = String(formData.get("loop_name") ?? "Campaign Learning Loop");
  const goal = String(formData.get("goal") ?? "").trim();
  const supabase = createSupabaseAdminClient();

  if (supabase) {
    const { data: organization } = await supabase
      .from("organizations")
      .insert({ name: "Demo organization" })
      .select("id")
      .single();

    await supabase.from("loops").insert({
      organization_id: organization?.id,
      name,
      department,
      loop_type: templateId.split("-").slice(1).join("-") || "campaign_learning",
      status: "questions_in_progress",
      autonomy_level: "draft_for_review",
      goal,
      target_metric: "Cost per qualified customer",
      business_outcome:
        "More qualified activated or paying customers from channels that can scale without degrading cohort quality.",
      cadence: "Weekly"
    });
  }

  redirect("/loops/loop_demo_marketing_campaign/questions");
}
