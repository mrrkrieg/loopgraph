import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300002_machine_request_guards.sql"
);

describe("machine request guard migration", () => {
  it("persists tenant-scoped replay receipts and atomic rate windows", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.machine_request_receipts");
    expect(sql).toContain("create table if not exists public.machine_rate_limit_windows");
    expect(sql).toContain("unique (organization_id, project_key, credential_id, request_id)");
    expect(sql).toContain("on conflict (organization_id, project_key, credential_id, request_id) do nothing");
    expect(sql).toContain("request_count < p_rate_limit");
    expect(sql).toContain("'replayed_request'");
    expect(sql).toContain("'rate_limited'");
  });

  it("keeps the guard service-only with RLS enabled", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("alter table public.machine_request_receipts enable row level security");
    expect(sql).toContain("revoke all on public.machine_request_receipts from public, anon, authenticated");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("to service_role");
  });
});
