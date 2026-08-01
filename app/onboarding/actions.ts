"use server";

import { redirect } from "next/navigation";
import { getHostedIdentity } from "@/lib/auth/hosted-access";
import {
  HOSTED_ORGANIZATION_COOKIE,
  getHostedOrganizationId
} from "@/lib/auth/hosted-config";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { cookies } from "next/headers";

export async function createOrganizationAction(formData: FormData) {
  const name = String(formData.get("organization_name") ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("Organization name must be between 2 and 120 characters.");
  }
  const identity = await getHostedIdentity();
  if (!identity) throw new Error("Hosted authentication is not enabled.");
  if (identity.membership) redirect("/");
  if (getHostedOrganizationId()) {
    throw new Error(
      "This deployment is already bound to an organization. Ask an owner to invite your account."
    );
  }

  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Server provisioning is not configured.");
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .insert({ name })
    .select("id")
    .single();
  if (organizationError) throw organizationError;

  const { error: membershipError } = await admin.from("organization_memberships").insert({
    organization_id: organization.id,
    user_id: identity.userId,
    role: "owner",
    status: "active"
  });
  if (membershipError) {
    await admin.from("organizations").delete().eq("id", organization.id);
    throw membershipError;
  }
  const { error: profileError } = await admin.from("profiles").upsert({
    id: identity.userId,
    organization_id: organization.id,
    email: identity.email ?? "",
    role: "owner"
  });
  if (profileError) {
    await admin.from("organizations").delete().eq("id", organization.id);
    throw profileError;
  }

  (await cookies()).set(HOSTED_ORGANIZATION_COOKIE, organization.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  redirect("/");
}
