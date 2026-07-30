import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300008_distributed_discovery_design_store.sql"
);

describe("distributed discovery design store migration", () => {
  it("stores tenant-scoped sessions, evidence gaps, and immutable design artifacts", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create table if not exists public.discovery_sessions"
    );
    expect(sql).toContain(
      "create table if not exists public.discovery_evidence_gap_sets"
    );
    expect(sql).toContain(
      "create table if not exists public.loop_design_artifacts"
    );
    expect(sql).toContain(
      "primary key (organization_id, project_key, session_id)"
    );
    expect(sql).toContain("loop_design_artifacts_idempotency_idx");
    expect(sql).toContain("pg_column_size(design_context) <= 4194304");
  });

  it("uses revision CAS and creates design artifacts with the session update in one transaction", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.compare_and_swap_discovery_session"
    );
    expect(sql).toContain("for update");
    expect(sql).toContain("current_session.revision <> p_expected_revision");
    expect(sql).toContain("'revision_conflict'::text");
    expect(sql).toContain(
      "create or replace function public.create_loop_design_artifact"
    );
    expect(sql).toContain("'{designRunIds}'");
    expect(sql).toContain("revision = current_session.revision + 1");
    expect(sql).toContain("stored.session_id = v_session_id");
    expect(sql).toContain(
      "p_design_context->>'companyId' <> current_session.company_id"
    );
  });

  it("prevents stale evidence derivations from replacing newer state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.put_discovery_evidence_gap_set"
    );
    expect(sql).toContain(
      "where public.discovery_evidence_gap_sets.revision <= excluded.revision"
    );
    expect(sql).toContain(
      "(p_gap_set->>'revision')::bigint > current_session.revision"
    );
  });

  it("denies browser access and grants only bounded service-role operations", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "alter table public.discovery_sessions enable row level security"
    );
    expect(sql).toContain(
      "alter table public.loop_design_artifacts enable row level security"
    );
    expect(sql).toContain(
      "from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "grant select on public.discovery_sessions to service_role"
    );
    expect(sql).toContain(
      "grant execute on function public.create_loop_design_artifact"
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });

  it("exposes tenant-scoped discovery and design queue health", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.get_discovery_design_snapshot"
    );
    expect(sql).toContain("evidence_gap_set_count bigint");
    expect(sql).toContain("design_artifact_count bigint");
    expect(sql).toContain("oldest_active_session_seconds bigint");
    expect(sql).toContain("sessions.status <> 'completed'");
    expect(sql).toContain(
      "grant execute on function public.get_discovery_design_snapshot"
    );
  });
});
