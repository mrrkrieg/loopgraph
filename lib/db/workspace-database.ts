import "server-only";

import type { HostedPermission } from "@/lib/auth/hosted-access";
import { requireHostedPermission } from "@/lib/auth/hosted-access";
import { isHostedAuthRequired } from "@/lib/auth/hosted-config";
import { createSupabaseAdminClient } from "./supabase-admin";
import { createSupabaseServerClient } from "./supabase-server";

export type WorkspaceDatabase = {
  client: NonNullable<ReturnType<typeof createSupabaseAdminClient>> | null;
  organizationId?: string;
  userId?: string;
  email?: string;
  role?: string;
  hosted: boolean;
};

export async function getWorkspaceDatabase(
  permission: HostedPermission
): Promise<WorkspaceDatabase> {
  if (isHostedAuthRequired()) {
    const identity = await requireHostedPermission(permission);
    const client = await createSupabaseServerClient();
    if (!identity?.membership || !client) {
      return { client: null, hosted: true };
    }
    return {
      client,
      organizationId: identity.membership.organizationId,
      userId: identity.userId,
      email: identity.email,
      role: identity.membership.role,
      hosted: true
    };
  }

  return {
    client: createSupabaseAdminClient(),
    hosted: false
  };
}
