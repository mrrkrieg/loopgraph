import "server-only";

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  HOSTED_ORGANIZATION_COOKIE,
  isHostedAuthRequired
} from "./hosted-config";

export const hostedOrganizationRoles = ["viewer", "operator", "admin", "owner"] as const;
export type HostedOrganizationRole = (typeof hostedOrganizationRoles)[number];

export const hostedPermissions = [
  "workspace.read",
  "loops.write",
  "runs.write",
  "reviews.write",
  "organization.manage",
  "members.manage",
  "organization.delete"
] as const;
export type HostedPermission = (typeof hostedPermissions)[number];

const ROLE_PERMISSIONS: Record<HostedOrganizationRole, ReadonlySet<HostedPermission>> = {
  viewer: new Set(["workspace.read"]),
  operator: new Set(["workspace.read", "loops.write", "runs.write", "reviews.write"]),
  admin: new Set([
    "workspace.read",
    "loops.write",
    "runs.write",
    "reviews.write",
    "organization.manage",
    "members.manage"
  ]),
  owner: new Set(hostedPermissions)
};

export type HostedMembership = {
  organizationId: string;
  organizationName: string;
  role: HostedOrganizationRole;
};

export type HostedIdentity = {
  mode: "hosted";
  userId: string;
  email?: string;
  membership?: HostedMembership;
  memberships: HostedMembership[];
};

export class HostedAccessError extends Error {
  readonly status: 401 | 403;
  readonly code: "authentication_required" | "membership_required" | "permission_denied";

  constructor(
    code: HostedAccessError["code"],
    message: string,
    status: HostedAccessError["status"]
  ) {
    super(message);
    this.name = "HostedAccessError";
    this.code = code;
    this.status = status;
  }
}

export function roleHasPermission(
  role: HostedOrganizationRole,
  permission: HostedPermission
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export async function getHostedIdentity(): Promise<HostedIdentity | undefined> {
  if (!isHostedAuthRequired()) return undefined;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    throw new HostedAccessError(
      "authentication_required",
      "Hosted Supabase authentication is not configured.",
      401
    );
  }

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : undefined;
  if (error || !userId) {
    throw new HostedAccessError(
      "authentication_required",
      "Sign in to access this hosted Loopgraph workspace.",
      401
    );
  }

  const { data: membershipRows, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, organizations(id, name)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (membershipError) throw membershipError;

  const memberships = (membershipRows ?? []).flatMap((row) => {
    const role = parseRole(row.role);
    const organization = relationRecord(row.organizations);
    return role && organization
      ? [{
          organizationId: String(row.organization_id),
          organizationName: String(organization.name),
          role
        }]
      : [];
  });
  const selectedOrganizationId = (await cookies()).get(HOSTED_ORGANIZATION_COOKIE)?.value;
  const membership = memberships.find((item) => item.organizationId === selectedOrganizationId)
    ?? memberships[0];

  return {
    mode: "hosted",
    userId,
    email: typeof claims?.email === "string" ? claims.email : undefined,
    membership,
    memberships
  };
}

export async function requireHostedPermission(
  permission: HostedPermission
): Promise<HostedIdentity | undefined> {
  const identity = await getHostedIdentity();
  if (!identity) return undefined;
  if (!identity.membership) {
    throw new HostedAccessError(
      "membership_required",
      "Create or join an organization before accessing this workspace.",
      403
    );
  }
  if (!roleHasPermission(identity.membership.role, permission)) {
    throw new HostedAccessError(
      "permission_denied",
      `${identity.membership.role} cannot perform ${permission}.`,
      403
    );
  }
  return identity;
}

function parseRole(value: unknown): HostedOrganizationRole | undefined {
  return typeof value === "string" && hostedOrganizationRoles.includes(value as HostedOrganizationRole)
    ? value as HostedOrganizationRole
    : undefined;
}

function relationRecord(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? first as Record<string, unknown> : undefined;
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}
