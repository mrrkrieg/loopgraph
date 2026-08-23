import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_FUNCTION_DIGESTS } from "../../scripts/hosted-app-snapshot-inventory-fence";

describe("hosted App snapshot inventory fence attestation migration", () => {
  it("attests the exact enabled triggers and service-only reader without exposing catalogs", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823003138_hosted_app_snapshot_inventory_fence_attestation.sql",
      "utf8"
    );

    expect(sql).toMatch(/create or replace function public\.loopgraph_app_snapshot_inventory_fence_status_get\(\)/i);
    expect(sql).toMatch(/language plpgsql[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
    expect(sql).toMatch(/namespace_row\.nspname = 'storage'[\s\S]*?relation_row\.relname = 'objects'/i);
    expect(sql).toMatch(/trigger_row\.tgname = 'loopgraph_app_snapshot_inventory_generation'/i);
    expect(sql).toMatch(/namespace_row\.nspname = 'public'[\s\S]*?relation_row\.relname = 'loopgraph_app_installation_registries'/i);
    expect(sql).toMatch(/trigger_row\.tgname = 'loopgraph_app_snapshot_inventory_registry_generation'/i);
    expect(sql).toMatch(/trigger_row\.tgenabled in \('O', 'A'\)/i);
    expect(sql.match(/trigger_row\.tgtype = 29/gi)).toHaveLength(2);
    expect(sql.match(/trigger_row\.tgqual is null/gi)).toHaveLength(2);
    expect(sql).toMatch(/not pg_catalog\.has_function_privilege\([\s\S]*?'anon'/i);
    expect(sql).toMatch(/not pg_catalog\.has_function_privilege\([\s\S]*?'authenticated'/i);
    expect(sql).toMatch(/pg_catalog\.has_function_privilege\([\s\S]*?'service_role'/i);
    expect(sql).toMatch(/mutationFunctionsTriggerOnly/i);
    expect(sql).toMatch(/mutationFunctionsHardened/i);
    expect(sql).toMatch(/functionDefinitionDigests/i);
    expect(sql).toMatch(/functionOwnersPinned/i);
    expect(sql).toMatch(/functionAclsPinned/i);
    expect(sql).toMatch(/extensions\.digest\([\s\S]*?function_row\.prosrc[\s\S]*?'sha256'/i);
    expect(sql).toMatch(/pg_catalog\.pg_get_userbyid\(function_row\.proowner\) = 'postgres'/i);
    expect(sql).toMatch(/pg_catalog\.aclexplode\([\s\S]*?privilege_row\.privilege_type = 'EXECUTE'/i);
    expect(sql).toMatch(/alter function public\.loopgraph_app_snapshot_inventory_fence_status_get\(\)[\s\S]*?owner to postgres/i);
    expect(sql).toMatch(/count\(function_oid\) = 4/i);
    expect(sql).toMatch(/function_row\.prosecdef[\s\S]*?coalesce\('search_path=""' = any\(function_row\.proconfig\), false\)/i);
    expect(sql).toMatch(/revoke all on function public\.loopgraph_app_snapshot_inventory_fence_status_get\(\)[\s\S]*?from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.loopgraph_app_snapshot_inventory_fence_status_get\(\)[\s\S]*?to service_role/i);
    expect(sql).not.toMatch(/return query|select \*/i);
  });

  it("pins the exact deployed function bodies independently in release code", async () => {
    const generationSql = await readFile(
      "supabase/migrations/20260823003137_hosted_app_snapshot_inventory_generation.sql",
      "utf8"
    );
    const attestationSql = await readFile(
      "supabase/migrations/20260823003138_hosted_app_snapshot_inventory_fence_attestation.sql",
      "utf8"
    );
    const definitions = {
      generationAdvance: functionBody(generationSql, "loopgraph_app_snapshot_inventory_generation_advance"),
      scopeBump: functionBody(generationSql, "loopgraph_app_snapshot_inventory_generation_bump_scope"),
      storageTrigger: functionBody(generationSql, "loopgraph_app_snapshot_inventory_generation_bump"),
      registryTrigger: functionBody(generationSql, "loopgraph_app_snapshot_inventory_generation_bump_registry"),
      generationReader: functionBody(generationSql, "loopgraph_app_snapshot_inventory_generation_get"),
      fenceAttestation: functionBody(attestationSql, "loopgraph_app_snapshot_inventory_fence_status_get")
    };

    expect(Object.fromEntries(Object.entries(definitions).map(([key, body]) => [
      key,
      `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`
    ]))).toEqual(HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_FUNCTION_DIGESTS);
  });
});

function functionBody(sql: string, name: string): string {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\s*\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    "i"
  ));
  if (!match?.[1]) throw new Error(`Function body not found for ${name}`);
  return match[1];
}
