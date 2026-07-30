import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300005_distributed_hermes_design_store.sql"
);

describe("distributed Hermes design store migration", () => {
  it("persists tenant-scoped tasks and callback audit records", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.hermes_design_tasks");
    expect(sql).toContain("create table if not exists public.hermes_design_callbacks");
    expect(sql).toContain("primary key (organization_id, project_key, task_id)");
    expect(sql).toContain("hermes_design_tasks_active_idempotency_idx");
    expect(sql).toContain("where status not in ('failed', 'cancelled')");
    expect(sql).toContain("pg_column_size(payload) <= 1048576");
  });

  it("uses atomic creation, task CAS, and callback application", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.create_hermes_design_task");
    expect(sql).toContain(
      "create or replace function public.compare_and_swap_hermes_design_task"
    );
    expect(sql).toContain("create or replace function public.apply_hermes_design_callback");
    expect(sql).toContain("for update");
    expect(sql).toContain("current_task.revision <> p_expected_revision");
    expect(sql).toContain("'revision_conflict'::text");
    expect(sql).toContain("Hermes design task must record the callback identity");
  });

  it("denies browser access and limits service-role mutation to RPCs", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "alter table public.hermes_design_tasks enable row level security"
    );
    expect(sql).toContain(
      "revoke all on public.hermes_design_tasks from public, anon, authenticated, service_role"
    );
    expect(sql).toContain("grant select on public.hermes_design_tasks to service_role");
    expect(sql).toContain(
      "grant execute on function public.apply_hermes_design_callback"
    );
  });
});
