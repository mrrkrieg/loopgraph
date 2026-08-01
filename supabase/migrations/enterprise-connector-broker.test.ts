import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608010001_enterprise_connector_broker.sql"
);

describe("enterprise connector broker migration", () => {
  it("persists only non-secret control-plane, replay, receipt, and revocation state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "connector_installations",
      "credential_namespaces",
      "tenant_key_bindings",
      "provider_credential_versions",
      "credential_access_receipts",
      "connector_oauth_transactions",
      "connector_operation_receipts",
      "connector_idempotency_claims",
      "connector_prepared_actions",
      "connector_action_approvals",
      "workload_principals",
      "workload_capability_grants",
      "workload_identity_audit_events",
      "workload_identity_replay_claims",
      "connector_kill_switches",
      "provider_webhook_deliveries",
      "provider_webhook_inbox",
      "connector_revocation_jobs"
    ]) {
      expect(sql).toContain(`public.${table}`);
    }
    expect(sql).toContain("state_hash text not null");
    expect(sql).toContain("verifier_ref text");
    expect(sql).not.toMatch(/\b(access_token|refresh_token|client_secret|webhook_secret)\s+(?:text|jsonb)/i);
  });

  it("keeps connector control-plane tables service-only and receipts append-only", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("revoke all on public.%I from public, anon, authenticated");
    expect(sql).toContain("grant all on public.%I to service_role");
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)[^;]+to authenticated/i);
    expect(sql).toContain("connector operation receipts are append-only");
    expect(sql).toContain("before update or delete on public.connector_operation_receipts");
  });

  it("atomically consumes OAuth state, claims deliveries, and leases revocation jobs", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("and consumed_at is null");
    expect(sql).toContain("on conflict (organization_id, project_key, installation_id, provider_id, delivery_id)");
    expect(sql).toContain("delivery.status = 'failed' or delivery.leased_until < now()");
    expect(sql).toContain("delivery.body_hash = excluded.body_hash");
    expect(sql).toContain("claim_connector_idempotency");
    expect(sql).toContain("existing.request_hash <> p_request_hash");
    expect(sql).toContain("existing.status = 'completed' or existing.lease_until >= now()");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("order by job.emergency desc");
    expect(sql).toContain("claim_provider_webhook_inbox");
    expect(sql).toContain("consume_connector_action_approval");
    expect(sql).toContain("claim_connector_refresh_due");
    expect(sql).toContain("claim_connector_prepared_action");
    expect(sql).toContain("authorize_connector_workload");
    expect(sql).toContain("evaluate_connector_kill_switch");
    expect(sql).toContain("disable_connector_locally");
    expect(sql).toContain("locally_disable_connector");
    expect(sql).toContain("record_provider_credential_version");
    expect(sql).toContain("activate_provider_credential_version");
    expect(sql).toContain("refresh_lease_until");
    expect(sql).toContain("token_replayed");
    expect(sql).toContain("set status = 'revoked'");
  });
});
