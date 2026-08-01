import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300007_hermes_design_callback_inbox.sql"
);

describe("Hermes design callback inbox migration", () => {
  it("binds every callback job to tenant, task, callback, and signed body", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create table if not exists public.hermes_design_callback_jobs"
    );
    expect(sql).toContain(
      "foreign key (organization_id, project_key, task_id)"
    );
    expect(sql).toContain("hermes_design_callback_jobs_callback_idx");
    expect(sql).toContain("request_hash ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain("pg_column_size(payload) <= 1048576");
  });

  it("authorizes and enqueues in one transaction with exact replay handling", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.authorize_and_enqueue_hermes_design_callback"
    );
    expect(sql).toContain("from public.authorize_machine_request(");
    expect(sql).toContain("from public.enqueue_hermes_design_callback_job(");
    expect(sql).toContain("An enqueue exception rolls back the request receipt");
    expect(sql).toContain("'duplicate'::text");
    expect(sql).toContain(
      "existing_job.request_hash = p_request_hash"
    );
  });

  it("claims with row locks and enforces revision and lease fencing", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.claim_hermes_design_callback_jobs"
    );
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain(
      "create or replace function public.compare_and_swap_hermes_design_callback_job"
    );
    expect(sql).toContain(
      "current_job.lease_token is distinct from p_expected_lease_token"
    );
    expect(sql).toContain("'lease_lost'::text");
  });

  it("denies browser mutation and exposes queue health only to service role", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "alter table public.hermes_design_callback_jobs enable row level security"
    );
    expect(sql).toContain(
      "revoke all on public.hermes_design_callback_jobs"
    );
    expect(sql).toContain(
      "grant select on public.hermes_design_callback_jobs to service_role"
    );
    expect(sql).toContain(
      "create or replace function public.get_hermes_callback_queue_snapshot"
    );
    expect(sql).toContain(
      "from public, anon, authenticated, service_role"
    );
  });
});
