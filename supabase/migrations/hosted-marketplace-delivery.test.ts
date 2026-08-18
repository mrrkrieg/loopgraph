import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260816225117_hosted_marketplace_delivery.sql"
);

describe("hosted marketplace delivery migration", () => {
  it("creates a private bounded artifact bucket without browser storage policies", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("'loopgraph-marketplace-artifacts'");
    expect(sql).toContain("public = false");
    expect(sql).toContain("104857600");
    expect(sql).toContain("array['application/json']::text[]");
    expect(sql).not.toContain("on storage.objects");
    expect(sql).not.toContain("to authenticated using");
  });

  it("keeps catalog search RLS-bound and returns no delivery secrets", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const searchFunction = sql.match(
      /create or replace function public\.search_visible_marketplace_apps[\s\S]*?grant execute on function public\.search_visible_marketplace_apps[\s\S]*?to authenticated;/
    )?.[0];
    expect(searchFunction).toBeDefined();
    expect(searchFunction).toContain("security invoker");
    expect(searchFunction).toContain("release_status in ('active', 'deprecated')");
    expect(searchFunction).not.toContain("artifact_object_key");
    expect(searchFunction).not.toContain("signature_value");
  });

  it("leases verification jobs with fencing and service-only authority", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.marketplace_verification_jobs");
    expect(sql).toContain("for update of j skip locked");
    expect(sql).toContain("lease_token = gen_random_uuid()");
    expect(sql).toContain("j.lease_expires_at < now()");
    expect(sql).toContain("v_job.lease_token is distinct from p_lease_token");
    expect(sql).toContain("v_job.lease_expires_at <= now()");
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain("revoke all on public.marketplace_verification_jobs from anon, authenticated");
    expect(sql).toContain("grant execute on function public.claim_hosted_marketplace_verification_jobs");
    expect(sql).toContain("to service_role;");
  });

  it("enqueues publication and permits bounded verifier rejection", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("after insert on public.marketplace_app_versions");
    expect(sql).toContain("private.enqueue_marketplace_verification_job()");
    expect(sql).toContain("create or replace function public.reject_hosted_marketplace_release");
    expect(sql).toContain("p_reason_code !~ '^[a-z][a-z0-9_]{2,79}$'");
    expect(sql).toContain("release_status = 'rejected'");
  });
});
