import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/202607300012_hermes_enterprise_operations.sql";

describe("Hermes enterprise operations migration", () => {
  it("keeps agent and execution state tenant scoped, server only, bounded, and idempotent", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.hermes_agent_instances");
    expect(sql).toContain("create table if not exists public.hermes_execution_events");
    expect(sql).toContain("unique (organization_id, project_key, idempotency_key)");
    expect(sql).toContain("unique (organization_id, project_key, run_id, event_sequence)");
    expect(sql).toContain("pg_column_size(payload) <= 1048576");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.hermes_execution_events from public, anon, authenticated, service_role");
    expect(sql).toContain("security definer\nset search_path = ''");
    expect(sql).toContain("grant execute on function public.append_hermes_execution_event");
    expect(sql).toContain("'dispatched'");
  });
});
