#!/usr/bin/env tsx
/**
 * Idempotent Design Studio seed for Supabase.
 * Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.
 *
 * Usage: npm run seed:design-studio
 */
import "./load-env";
import { createSupabaseAdminClient } from "../lib/db/supabase-admin";

async function main() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    console.error("Supabase admin client unavailable. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("id")
    .eq("name", "Acme Loops")
    .maybeSingle();

  const organizationId =
    existingOrg?.id ??
    (
      await supabase
        .from("organizations")
        .insert({ name: "Acme Loops" })
        .select("id")
        .single()
    ).data?.id;

  if (!organizationId) {
    throw new Error("Failed to create organization");
  }

  const { data: existingLoop } = await supabase
    .from("loops")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", "Campaign Learning Loop")
    .maybeSingle();

  if (!existingLoop) {
    const { data: templateRow } = await supabase
      .from("loop_templates")
      .select("id")
      .eq("department", "marketing")
      .eq("loop_type", "campaign_learning")
      .maybeSingle();

    await supabase.from("loops").insert({
      organization_id: organizationId,
      template_id: templateRow?.id ?? null,
      name: "Campaign Learning Loop",
      department: "marketing",
      loop_type: "campaign_learning",
      status: "active",
      autonomy_level: "draft_for_review",
      goal: "Acquire qualified customers at a sustainable CAC.",
      target_metric: "Cost per qualified customer",
      business_outcome: "More qualified activated customers from scalable channels.",
      cadence: "Weekly"
    });
  }

  console.log(`Design Studio seed complete for organization ${organizationId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
