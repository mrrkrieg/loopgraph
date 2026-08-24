import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted learning/entity active probe migration", () => {
  it("requires a short-lived one-time authority before exact-scope cleanup", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823045212_hosted_learning_entity_probe.sql",
      "utf8"
    );
    expect(sql).toContain("create table if not exists public.loopgraph_learning_entity_probe_authorizations");
    expect(sql).toContain("^learning_probe_[a-f0-9]{24}$");
    expect(sql).toContain("check (token_hash ~ '^[a-f0-9]{64}$')");
    expect(sql).toContain("expires_at <= created_at + interval '30 minutes'");
    expect(sql).toContain(
      "alter table public.loopgraph_learning_entity_probe_authorizations enable row level security"
    );
    expect(sql).toContain(
      "revoke all on public.loopgraph_learning_entity_probe_authorizations\n" +
      "  from public, anon, authenticated, service_role"
    );
    expect(sql.match(/security definer\nset search_path = ''/g)).toHaveLength(3);
    expect(sql).toContain("create or replace function public.loopgraph_learning_entity_probe_authorize");
    expect(sql).toContain("Hosted learning/entity probe scope is not empty");
    expect(sql).toContain("pg_catalog.encode(extensions.digest(p_probe_token, 'sha256'), 'hex')");
    expect(sql).toContain("from public.loopgraph_learning_entity_probe_authorizations");
    expect(sql).toContain("v_authorization.expires_at <= pg_catalog.clock_timestamp()");
    expect(sql).toContain("Hosted learning/entity probe cleanup is not authorized");
    expect(sql).toContain("'authorizationConsumed', true");
    expect(sql).toContain("where organization_id = p_organization_id\n    and project_key = p_project_key");
    expect(sql).toContain("from public.canonical_company_entity_aliases");
    expect(sql).toContain(
      "create or replace function public.loopgraph_learning_entity_probe_sweep_expired"
    );
    expect(sql).toContain("expires_at <= pg_catalog.clock_timestamp()");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain(
      "revoke all on function public.loopgraph_learning_entity_probe_cleanup(uuid, text, text)"
    );
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain(
      "grant execute on function public.loopgraph_learning_entity_probe_cleanup(uuid, text, text)\n" +
      "  to service_role"
    );
    expect(sql).toContain(
      "grant execute on function public.loopgraph_learning_entity_probe_sweep_expired(uuid)\n" +
      "  to service_role"
    );
    expect(sql).not.toContain("loopgraph_learning_entity_probe_cleanup(uuid, text)\n");
    expect(sql).not.toMatch(/delete from public\.[a-z_]+\s*;/);
  });
});
