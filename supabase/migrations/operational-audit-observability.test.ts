import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300003_operational_audit_observability.sql"
);

describe("operational audit and observability migration", () => {
  it("creates an immutable tenant/project audit chain", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.security_audit_events");
    expect(sql).toContain("before update or delete on public.security_audit_events");
    expect(sql).toContain("raise exception 'security_audit_events is append-only'");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("v_previous_hash || '|' || v_payload::text");
    expect(sql).toContain("verify_security_audit_chain");
  });

  it("keeps writes and exports behind service-role-only functions", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "revoke all on public.security_audit_events from public, anon, authenticated, service_role"
    );
    expect(sql).toContain("grant select on public.security_audit_events to service_role");
    expect(sql).toContain("create or replace function private.append_security_audit_event");
    expect(sql).toContain("create or replace function public.export_security_audit_events");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("to service_role");
  });

  it("records machine authorization decisions atomically with request guards", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.authorize_machine_request");
    expect(sql).toContain("'machine.request.authorized'");
    expect(sql).toContain("'machine.request.denied'");
    expect(sql).toContain("'replayed_request'");
    expect(sql).toContain("'rate_limited'");
    expect(sql).toContain("get_loopgraph_operational_snapshot");
  });
});
