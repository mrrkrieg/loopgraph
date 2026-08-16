import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260816110321_hosted_marketplace_registry.sql"
);

describe("hosted marketplace registry migration", () => {
  it("defines the normalized registry, release provenance, and private grants", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "marketplace_publishers",
      "marketplace_apps",
      "marketplace_app_versions",
      "marketplace_app_artifacts",
      "marketplace_app_dependencies",
      "marketplace_app_connector_requirements",
      "marketplace_app_presets",
      "marketplace_app_eval_results",
      "marketplace_release_signatures",
      "private_catalog_access"
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
    }
    expect(sql).toContain("artifact_object_key text not null");
    expect(sql).toContain("manifest_digest text not null");
    expect(sql).toContain("file_index_digest text not null");
    expect(sql).toContain("file_index_payload jsonb not null");
    expect(sql).toContain("verification_receipt_digest text");
    expect(sql).toContain("primary key (app_id, version)");
    expect(sql).toContain("app_id like publisher_id || '.%'");
  });

  it("uses RLS visibility for owner, public, and explicitly granted catalogs", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function private.can_read_marketplace_app");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("app.visibility in ('public', 'official')");
    expect(sql).toContain("from public.private_catalog_access catalog_access");
    expect(sql).toContain("membership.user_id = auth.uid()");
    expect(sql).toContain("alter table public.%I enable row level security");
    expect(sql).toContain("revoke all on public.%I from public, anon, authenticated, service_role");
    expect(sql).not.toContain("grant select on public.%I to authenticated");
    const versionGrant = sql.match(
      /grant select \([\s\S]*?\) on public\.marketplace_app_versions to authenticated;/
    )?.[0];
    expect(versionGrant).toBeDefined();
    expect(versionGrant).not.toContain("artifact_object_key");
    expect(versionGrant).not.toContain("manifest_payload");
    expect(versionGrant).not.toContain("verification_receipt_digest");
    expect(sql).not.toContain(
      "grant select on public.marketplace_release_signatures to authenticated"
    );
    expect(sql).not.toContain("grant insert on public.marketplace_app_versions to authenticated");
  });

  it("publishes immutable signed private versions into a tenant object namespace", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.publish_private_marketplace_app_version");
    expect(sql).toContain("array['admin', 'owner']");
    expect(sql).toContain("p_payload->>'schemaVersion' is distinct from 'hosted-marketplace-publication/v1alpha1'");
    expect(sql).toContain("p_artifact_object_key not like p_organization_id::text || '/marketplace/%'");
    expect(sql).toContain("p_payload->'version'->'source'->>'sourceType' is distinct from 'hosted'");
    expect(sql).toContain("p_payload->'artifact'->'provenance'->'signature'->>'publisherId' is distinct from v_publisher_id");
    expect(sql).toContain("v_publisher_id = 'loopgraph'");
    expect(sql).toContain("v_app_id like 'loopgraph.%'");
    expect(sql).toContain("p_payload->'publisher'->>'verified' is distinct from 'false'");
    expect(sql).toContain("p_payload->'version'->'permissions' is distinct from p_payload->'artifact'->'manifest'->'permissions'");
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("if not found or v_existing_owner is distinct from p_organization_id then");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("immutable hosted marketplace version conflict");
    expect(sql).toContain("'pending_verification'");
  });

  it("separates trusted digest attestation from publisher and lifecycle authority", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.attest_hosted_marketplace_release");
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain("marketplace verification digest mismatch");
    expect(sql).toContain("p_verified_manifest jsonb");
    expect(sql).toContain("p_verified_file_index jsonb");
    expect(sql).toContain("v_release.manifest_payload is distinct from p_verified_manifest");
    expect(sql).toContain("v_release.file_index_payload is distinct from p_verified_file_index");
    expect(sql).toContain("grant execute on function public.attest_hosted_marketplace_release");
    expect(sql).toContain("to service_role;");
    expect(sql).toContain("create or replace function public.set_private_marketplace_release_status");
    expect(sql).toContain("(v_release.release_status = 'deprecated' and p_release_status = 'revoked')");
    expect(sql).toContain("create or replace function public.grant_private_marketplace_app_access");
    expect(sql).toContain("create or replace function public.revoke_private_marketplace_app_access");
  });
});
