import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608150001_hosted_graph_authoring.sql"
);

describe("hosted graph authoring migration", () => {
  it("stores immutable tenant-scoped transactions and separate layout state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.graph_editor_transactions");
    expect(sql).toContain("create table if not exists public.graph_editor_layouts");
    expect(sql).toContain("primary key (organization_id, project_key, transaction_id)");
    expect(sql).toContain("contains_semantic_operations");
    expect(sql).toContain("positions = public.graph_editor_layouts.positions || excluded.positions");
  });

  it("requires authenticated membership and prevents direct writes", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("private.is_org_member");
    expect(sql).toContain("array['operator', 'admin', 'owner']");
    expect(sql).toContain("v_actor_id is distinct from auth.uid()");
    expect(sql).toContain("revoke all on public.graph_editor_transactions");
    expect(sql).not.toContain("grant insert on public.graph_editor_transactions to authenticated");
  });

  it("keeps semantic proposals out of the layout mutation path", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("p_payload->>'status' is distinct from 'proposal_pending'");
    expect(sql).toContain("p_payload->>'status' is distinct from 'layout_applied'");
    expect(sql).toContain("if not v_semantic then");
    expect(sql).toContain("jsonb_array_length(p_payload->'operations') not between 1 and 200");
  });

  it("rejects missing JSON fields instead of letting SQL NULL bypass validation", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("jsonb_typeof(p_payload) is distinct from 'object'");
    expect(sql).toContain(
      "p_payload->>'schemaVersion' is distinct from 'graph-editor-transaction/v1alpha1'"
    );
    expect(sql).toContain("p_payload->>'workspaceId' is distinct from p_project_key");
    expect(sql).toContain("p_payload->>'companyId' is distinct from p_organization_id::text");
    expect(sql).toContain("nullif(v_operation->>'kind', '') is null");
    expect(sql).toContain("nullif(v_operation->>'nodeType', '') is null");
    expect(sql).toContain("nullif(v_operation->>'departmentId', '') is null");
    expect(sql).toContain("nullif(v_operation->>'relation', '') is null");
    expect(sql).toContain("'propose_lifecycle'");
    expect(sql).toContain("v_operation->>'mode' not in ('improve', 'split', 'merge', 'retire')");
    expect(sql).toContain("jsonb_typeof(v_operation->'targetNodeIds') is distinct from 'array'");
    expect(sql).toContain("jsonb_array_length(v_operation->'targetNodeIds') not between 1 and 10");
    expect(sql).toContain("invalid graph editor lifecycle proposal");
    expect(sql).toContain("v_created_at is null");
  });
});
