import { afterEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ from, rpc })
}));

import {
  listCliAccessSessions,
  revokeCliAccessSessions,
  sessionStatus
} from "./cli-session-admin";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("CLI session administration", () => {
  it("lists safe tenant-scoped metadata without selecting token digests", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    const selected: string[] = [];
    from.mockImplementation((table: string) => table === "cli_access_sessions"
      ? sessionQuery(selected)
      : profileQuery());
    const page = await listCliAccessSessions(database(), {
      now: new Date("2026-08-17T12:00:00.000Z")
    });
    expect(page).toMatchObject({ total: 1, offset: 0, limit: 50 });
    expect(page.sessions[0]).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174010",
      userEmail: "owner@example.com",
      status: "revoked",
      capabilities: ["marketplace.consume"],
      refreshReuseDetectedAt: "2026-08-17T11:55:00.000Z"
    });
    expect(selected.join(",")).not.toMatch(/token|hash|secret/i);
  });

  it("delegates scoped revocation to the atomic audited database function", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    rpc.mockResolvedValue({
      data: [{ revoked_count: 2, correlation_id: "cli_session_revoke_receipt" }],
      error: null
    });
    await expect(revokeCliAccessSessions({
      database: database(),
      scope: "user",
      targetUserId: "123e4567-e89b-12d3-a456-426614174002",
      reason: "Employee device was replaced"
    })).resolves.toEqual({ revokedCount: 2, correlationId: "cli_session_revoke_receipt" });
    expect(rpc).toHaveBeenCalledWith("admin_revoke_cli_access_sessions", expect.objectContaining({
      p_organization_id: "123e4567-e89b-12d3-a456-426614174000",
      p_project_key: "main",
      p_actor_user_id: "123e4567-e89b-12d3-a456-426614174001",
      p_scope: "user",
      p_target_user_id: "123e4567-e89b-12d3-a456-426614174002",
      p_session_id: null
    }));
  });

  it("distinguishes access refresh from full session expiry", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    expect(sessionStatus({ accessExpiresAt: "2026-08-17T11:59:00.000Z", refreshExpiresAt: "2026-08-18T12:00:00.000Z", now }))
      .toBe("refresh_required");
    expect(sessionStatus({ accessExpiresAt: "2026-08-16T12:00:00.000Z", refreshExpiresAt: "2026-08-17T11:59:00.000Z", now }))
      .toBe("expired");
    expect(sessionStatus({ accessExpiresAt: "2026-08-18T12:00:00.000Z", refreshExpiresAt: "2026-08-19T12:00:00.000Z", revokedAt: "2026-08-17T10:00:00.000Z", now }))
      .toBe("revoked");
  });
});

function database() {
  return {
    client: null,
    organizationId: "123e4567-e89b-12d3-a456-426614174000",
    userId: "123e4567-e89b-12d3-a456-426614174001",
    hosted: true
  };
}

function sessionQuery(selected: string[]) {
  const query = {
    select: vi.fn((fields: string) => { selected.push(fields); return query; }),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async () => ({
      data: [{
        id: "123e4567-e89b-12d3-a456-426614174010",
        user_id: "123e4567-e89b-12d3-a456-426614174002",
        capabilities: ["marketplace.consume"],
        access_expires_at: "2026-08-17T12:15:00.000Z",
        refresh_expires_at: "2026-09-16T12:00:00.000Z",
        last_used_at: null,
        revoked_at: "2026-08-17T11:55:00.000Z",
        refresh_reuse_detected_at: "2026-08-17T11:55:00.000Z",
        created_at: "2026-08-17T11:50:00.000Z",
        updated_at: "2026-08-17T11:50:00.000Z"
      }],
      count: 1,
      error: null
    }))
  };
  return query;
}

function profileQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(async () => ({
      data: [{
        id: "123e4567-e89b-12d3-a456-426614174002",
        email: "owner@example.com",
        full_name: "Workspace Owner"
      }],
      error: null
    }))
  };
  return query;
}
