"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

export async function saveOrganizationAction(formData: FormData) {
  const name = String(formData.get("organization_name") ?? "").trim();
  if (name.length > 120) throw new Error("Organization name must be 120 characters or fewer.");
  const { client: supabase, organizationId } = await getWorkspaceDatabase("organization.manage");

  if (supabase && name) {
    let targetId = organizationId;
    if (!targetId) {
      const { data } = await supabase
        .from("organizations")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      targetId = data?.id;
    }
    if (targetId) {
      const { error } = await supabase.from("organizations").update({ name }).eq("id", targetId);
      if (error) throw error;
    }
  }

  revalidatePath("/settings");
}

export async function saveProfileAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (fullName.length > 120) throw new Error("Full name must be 120 characters or fewer.");
  const database = await getWorkspaceDatabase("workspace.read");
  const supabase = database.client;

  if (supabase && database.hosted && database.userId && database.organizationId) {
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", database.userId)
      .eq("organization_id", database.organizationId);
    if (error) throw error;
  } else if (supabase && email) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (profile?.id) {
      const { error } = await supabase
        .from("profiles")
        .update({ email, full_name: fullName })
        .eq("id", profile.id);
      if (error) throw error;
    }
  }

  revalidatePath("/settings");
}
