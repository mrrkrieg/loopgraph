import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260823044639_cli_refresh_replay_detection.sql"),
  "utf8"
);

describe("CLI refresh-token replay detection migration", () => {
  it("retains only prior token digests in a private bounded-lifetime history", () => {
    expect(migration).toContain("create table if not exists public.cli_refresh_token_history");
    expect(migration).toContain("refresh_token_hash text primary key");
    expect(migration).toContain("expires_at timestamptz not null");
    expect(migration).toContain("on delete cascade");
    expect(migration).toContain("alter table public.cli_refresh_token_history enable row level security");
    expect(migration).toContain("revoke all on table public.cli_refresh_token_history");
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).not.toMatch(/\brefresh_token\s+text/i);
    expect(migration).not.toMatch(/\baccess_token\s+text/i);
  });

  it("atomically revokes the current family when an earlier generation is replayed", () => {
    expect(migration).toContain("where history.refresh_token_hash = p_refresh_token_hash");
    expect(migration).toContain("for update of session");
    expect(migration).toContain("revoked_at = coalesce(session.revoked_at, p_now)");
    expect(migration).toContain("refresh_reuse_detected_at = coalesce(session.refresh_reuse_detected_at, p_now)");
    expect(migration).toContain("'refresh_token_reused'::text");
    expect(migration).toContain("refresh_token_generation = session.refresh_token_generation + 1");
  });

  it("records one digest-free tenant audit event for the first replay detection", () => {
    expect(migration).toContain("if v_session.refresh_reuse_detected_at is null then");
    expect(migration).toContain("'cli.session.refresh_reuse_detected'");
    expect(migration).toContain("'session_revoked', true");
    expect(migration).toContain("'presented_generation', v_presented_generation");
    expect(migration).toContain("'current_generation', v_session.refresh_token_generation");
    const auditStart = migration.indexOf("perform private.append_security_audit_event");
    const auditEnd = migration.indexOf("return query select false, 'refresh_token_reused'", auditStart);
    const auditSection = migration.slice(auditStart, auditEnd);
    expect(auditSection).not.toContain("p_refresh_token_hash");
    expect(auditSection).not.toContain("p_new_refresh_token_hash");
    expect(auditSection).not.toContain("p_new_access_token_hash");
  });

  it("continues to bind refresh to active tenant membership and one exact current row", () => {
    expect(migration).toContain("from public.organization_memberships membership");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("where session.refresh_token_hash = p_refresh_token_hash");
    expect(migration).toContain("for update;");
  });
});
