import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300004_distributed_routing_store.sql"
);

describe("distributed routing store migration", () => {
  it("persists complete tenant/project routing state and normalized jobs", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.routing_state_records");
    expect(sql).toContain("create table if not exists public.route_jobs");
    expect(sql).toContain("primary key (organization_id, project_key, record_type, record_id)");
    expect(sql).toContain("primary key (organization_id, project_key, job_id)");
    expect(sql).toContain("unique (organization_id, project_key, idempotency_key)");
    expect(sql).toContain("create unique index if not exists routing_state_primary_event_idx");
    expect(sql).toContain("create or replace function public.create_routing_event_receipt");
    expect(sql).toContain("pg_column_size(payload) <= 1048576");
  });

  it("claims work with row locks and protects stale workers with CAS and leases", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.claim_due_route_jobs");
    expect(sql).toContain("create or replace function public.claim_waiting_review_route_jobs");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("create or replace function public.compare_and_swap_route_job");
    expect(sql).toContain("current_job.revision <> p_expected_revision");
    expect(sql).toContain("current_job.lease_token is distinct from p_expected_lease_token");
    expect(sql).toContain("'lease_lost'::text");
    expect(sql).toContain("'revision_conflict'::text");
    expect(sql).toContain("'route_jobs_dead_letter'");
    expect(sql).toContain("'route_job_oldest_due_seconds'");
  });

  it("keeps routing persistence service-role-only", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("alter table public.routing_state_records enable row level security");
    expect(sql).toContain("alter table public.route_jobs enable row level security");
    expect(sql).toContain(
      "revoke all on public.routing_state_records from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "revoke all on public.route_jobs from public, anon, authenticated, service_role"
    );
    expect(sql).toContain("grant select on public.route_jobs to service_role");
    expect(sql).toContain("grant execute on function public.compare_and_swap_route_job");
  });
});
