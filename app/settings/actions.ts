"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/db/supabase";

export async function saveOrganizationAction(formData: FormData) {
  const name = String(formData.get("organization_name") ?? "").trim();
  const supabase = createSupabaseAdminClient();

  if (supabase && name) {
    await supabase.from("organizations").insert({ name });
  }

  revalidatePath("/settings");
}

export async function saveProfileAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "member");
  const supabase = createSupabaseAdminClient();

  if (supabase && email) {
    await supabase.from("profiles").insert({
      id: crypto.randomUUID(),
      email,
      full_name: fullName,
      role
    });
  }

  revalidatePath("/settings");
}
