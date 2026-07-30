import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300009_versioned_loop_spec_registry.sql"
);

describe("versioned LoopSpec registry migration", () => {
  it("stores immutable versions separately from the active registry", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create table if not exists public.loop_spec_versions"
    );
    expect(sql).toContain(
      "create table if not exists public.loop_spec_registry"
    );
    expect(sql).toContain(
      "primary key (organization_id, project_key, loop_id, version_hash)"
    );
    expect(sql).toContain(
      "foreign key (organization_id, project_key, loop_id, active_version_hash)"
    );
    expect(sql).toContain("LoopSpec immutable version conflict");
  });

  it("commits active versions, workspace CAS, and discovery state atomically", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.commit_loop_spec_registry"
    );
    expect(sql).toContain("for update");
    expect(sql).toContain(
      "current_workspace.revision <> p_expected_workspace_revision"
    );
    expect(sql).toContain(
      "current_session.revision <> p_expected_discovery_revision"
    );
    expect(sql).toContain(
      "revision = p_expected_discovery_revision + 1"
    );
    expect(sql).toContain(
      "insert into public.loop_spec_commits"
    );
  });

  it("is tenant scoped, payload bounded, and unavailable to browsers", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "primary key (organization_id, project_key)"
    );
    expect(sql).toContain(
      "pg_column_size(p_artifacts) > 33554432"
    );
    expect(sql).toContain(
      "alter table public.loop_spec_registry enable row level security"
    );
    expect(sql).toContain(
      "revoke all on public.loop_spec_registry"
    );
    expect(sql).toContain(
      "from public, anon, authenticated, service_role"
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });

  it("exposes bounded registry health to the service role", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.get_loop_spec_registry_snapshot"
    );
    expect(sql).toContain("active_loop_spec_count bigint");
    expect(sql).toContain("immutable_loop_spec_version_count bigint");
    expect(sql).toContain("loop_spec_commit_count bigint");
    expect(sql).toContain(
      "grant execute on function public.get_loop_spec_registry_snapshot"
    );
  });
});
