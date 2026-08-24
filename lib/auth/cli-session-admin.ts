import "server-only";

import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import type { WorkspaceDatabase } from "@/lib/db/workspace-database";

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 10_000;

export type CliSessionAdminStatus = "active" | "refresh_required" | "expired" | "revoked";

export type CliSessionAdminView = {
  id: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  capabilities: string[];
  status: CliSessionAdminStatus;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  refreshReuseDetectedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CliSessionAdminPage = {
  sessions: CliSessionAdminView[];
  offset: number;
  limit: number;
  total: number;
  nextOffset?: number;
};

export async function listCliAccessSessions(
  database: WorkspaceDatabase,
  options: { offset?: number; limit?: number; now?: Date } = {}
): Promise<CliSessionAdminPage> {
  const offset = boundedInteger(options.offset, 0, MAX_OFFSET, 0);
  const limit = boundedInteger(options.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  if (!database.organizationId) return { sessions: [], offset, limit, total: 0 };
  const projectKey = hostedProjectKey();
  const client = cliSessionControlPlaneClient();
  const fields = [
    "id",
    "user_id",
    "capabilities",
    "access_expires_at",
    "refresh_expires_at",
    "last_used_at",
    "revoked_at",
    "refresh_reuse_detected_at",
    "created_at",
    "updated_at"
  ].join(",");
  const { data, error, count } = await client
    .from("cli_access_sessions")
    .select(fields, { count: "exact" })
    .eq("organization_id", database.organizationId)
    .eq("project_key", projectKey)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const userIds = [...new Set(rows.map((row) => stringValue(row.user_id)).filter(Boolean))];
  const profiles = new Map<string, { email?: string; name?: string }>();
  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await client
      .from("profiles")
      .select("id,email,full_name")
      .eq("organization_id", database.organizationId)
      .in("id", userIds);
    if (profileError) throw profileError;
    for (const profile of profileRows ?? []) {
      profiles.set(String(profile.id), {
        email: optionalString(profile.email),
        name: optionalString(profile.full_name)
      });
    }
  }

  const now = options.now ?? new Date();
  const sessions = rows.map((row) => mapCliSession(row, profiles, now));
  const total = typeof count === "number" && count >= 0 ? count : offset + sessions.length;
  const nextOffset = offset + sessions.length < total ? offset + sessions.length : undefined;
  return { sessions, offset, limit, total, ...(nextOffset === undefined ? {} : { nextOffset }) };
}

export async function revokeCliAccessSessions(input: {
  database: WorkspaceDatabase;
  scope: "session" | "user" | "organization";
  reason: string;
  sessionId?: string;
  targetUserId?: string;
}) {
  if (!input.database.organizationId || !input.database.userId) {
    throw new Error("Hosted CLI session administration is unavailable");
  }
  const projectKey = hostedProjectKey();
  const { data, error } = await cliSessionControlPlaneClient().rpc(
    "admin_revoke_cli_access_sessions",
    {
      p_organization_id: input.database.organizationId,
      p_project_key: projectKey,
      p_actor_user_id: input.database.userId,
      p_scope: input.scope,
      p_reason: input.reason,
      p_session_id: input.sessionId ?? null,
      p_target_user_id: input.targetUserId ?? null,
      p_now: new Date().toISOString()
    }
  );
  if (error) throw error;
  const row = firstRow(data);
  const revokedCount = Number(row.revoked_count);
  const correlationId = optionalString(row.correlation_id);
  if (!Number.isInteger(revokedCount) || revokedCount < 0 || !correlationId) {
    throw new Error("CLI session revocation returned an invalid receipt");
  }
  return { revokedCount, correlationId };
}

function mapCliSession(
  row: Record<string, unknown>,
  profiles: Map<string, { email?: string; name?: string }>,
  now: Date
): CliSessionAdminView {
  const id = requiredString(row.id, "CLI session ID");
  const userId = requiredString(row.user_id, "CLI session user");
  const accessExpiresAt = requiredDateString(row.access_expires_at, "CLI access expiry");
  const refreshExpiresAt = requiredDateString(row.refresh_expires_at, "CLI refresh expiry");
  const revokedAt = optionalDateString(row.revoked_at);
  const refreshReuseDetectedAt = optionalDateString(row.refresh_reuse_detected_at);
  const profile = profiles.get(userId);
  return {
    id,
    userId,
    ...(profile?.email ? { userEmail: profile.email } : {}),
    ...(profile?.name ? { userName: profile.name } : {}),
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((value): value is string => typeof value === "string")
      : [],
    status: sessionStatus({ accessExpiresAt, refreshExpiresAt, revokedAt, now }),
    accessExpiresAt,
    refreshExpiresAt,
    ...(optionalDateString(row.last_used_at) ? { lastUsedAt: optionalDateString(row.last_used_at) } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    ...(refreshReuseDetectedAt ? { refreshReuseDetectedAt } : {}),
    createdAt: requiredDateString(row.created_at, "CLI session creation time"),
    updatedAt: requiredDateString(row.updated_at, "CLI session update time")
  };
}

export function sessionStatus(input: {
  accessExpiresAt: string;
  refreshExpiresAt: string;
  revokedAt?: string;
  now: Date;
}): CliSessionAdminStatus {
  if (input.revokedAt) return "revoked";
  if (Date.parse(input.refreshExpiresAt) <= input.now.getTime()) return "expired";
  if (Date.parse(input.accessExpiresAt) <= input.now.getTime()) return "refresh_required";
  return "active";
}

function hostedProjectKey() {
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!PROJECT_KEY_PATTERN.test(projectKey)) throw new Error("Hosted project key is invalid");
  return projectKey;
}

function cliSessionControlPlaneClient() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("CLI session control-plane storage is unavailable");
  return client;
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function firstRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  const text = stringValue(value).trim();
  return text || undefined;
}

function requiredString(value: unknown, label: string) {
  const text = optionalString(value);
  if (!text) throw new Error(`${label} is invalid`);
  return text;
}

function optionalDateString(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function requiredDateString(value: unknown, label: string) {
  const date = optionalDateString(value);
  if (!date) throw new Error(`${label} is invalid`);
  return date;
}
