import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300006_hermes_design_dispatch_queue.sql"
);

describe("Hermes design dispatch queue migration", () => {
  it("persists tenant-scoped jobs with task and idempotency boundaries", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create table if not exists public.hermes_design_dispatch_jobs"
    );
    expect(sql).toContain(
      "foreign key (organization_id, project_key, task_id)"
    );
    expect(sql).toContain("hermes_design_dispatch_jobs_idempotency_idx");
    expect(sql).toContain("pg_column_size(payload) <= 1048576");
  });

  it("commits tasks with jobs and claims work using leases and row locks", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.create_hermes_design_task_with_dispatch"
    );
    expect(sql).toContain(
      "create or replace function public.claim_hermes_design_dispatch_jobs"
    );
    expect(sql).toContain(
      "create or replace function public.compare_and_swap_hermes_design_task_with_dispatch"
    );
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain(
      "create or replace function public.compare_and_swap_hermes_design_dispatch_job"
    );
    expect(sql).toContain("current_job.lease_token is distinct from p_expected_lease_token");
    expect(sql).toContain("'lease_lost'::text");
    expect(sql).toContain("'hermes_dispatch_dead_letter'");
  });

  it("denies browser access and limits service mutation to bounded functions", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "alter table public.hermes_design_dispatch_jobs enable row level security"
    );
    expect(sql).toContain(
      "revoke all on public.hermes_design_dispatch_jobs"
    );
    expect(sql).toContain(
      "grant select on public.hermes_design_dispatch_jobs to service_role"
    );
    expect(sql).toContain(
      "grant execute on function public.claim_hermes_design_dispatch_jobs"
    );
  });
});
