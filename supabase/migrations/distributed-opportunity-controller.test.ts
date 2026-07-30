import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300010_distributed_opportunity_controller.sql"
);

describe("distributed opportunity controller migration", () => {
  it("persists tenant-scoped opportunities, graph proposals, and controller state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.loop_opportunities");
    expect(sql).toContain("create table if not exists public.loop_graph_change_sets");
    expect(sql).toContain("create table if not exists public.loop_controller_runs");
    expect(sql).toContain("create table if not exists public.loop_controller_state");
    expect(sql).toContain("unique (organization_id, project_key, fingerprint, generation)");
    expect(sql).toContain("unique (organization_id, project_key, idempotency_key)");
  });

  it("claims triggers with row locks and protects settlement with lease identity", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.loop_controller_triggers");
    expect(sql).toContain("create table if not exists public.loop_controller_leases");
    expect(sql).toContain("create or replace function public.enqueue_loop_controller_trigger");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("create or replace function public.claim_loop_controller_triggers");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("and lease_id = p_expected_lease_id");
    expect(sql).toContain("create or replace function public.renew_loop_controller_lease");
  });

  it("bounds payloads and keeps direct browser writes unavailable", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("pg_column_size(payload) <= 4194304");
    expect(sql).toContain("alter table public.loop_controller_triggers enable row level security");
    expect(sql).toContain(
      "revoke all on public.loop_controller_triggers from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "grant execute on function public.claim_loop_controller_triggers"
    );
    expect(sql).toContain("set search_path = ''");
  });

  it("exposes queue, opportunity, and lease health to the service role", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.get_opportunity_controller_snapshot"
    );
    expect(sql).toContain("controller_trigger_expired_leases bigint");
    expect(sql).toContain("controller_oldest_pending_seconds bigint");
    expect(sql).toContain(
      "grant execute on function public.get_opportunity_controller_snapshot"
    );
  });
});
