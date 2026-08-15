import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608010001_enterprise_connector_broker.sql"
);
const providerExpansionMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608100001_expand_connector_broker_providers.sql"
);
const engineeringProviderExpansionMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608100002_expand_engineering_connector_providers.sql"
);
const warehouseProviderExpansionMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260813133306_expand_warehouse_connector_providers.sql"
);
const providerDetectorMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260813200615_provider_detector_scheduler.sql"
);
const providerDetectorOperationsMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260815222254_provider_detector_operations.sql"
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

  it("keeps expanded providers behind an explicit reviewed database allowlist", async () => {
    const sql = await readFile(providerExpansionMigrationPath, "utf8");
    expect(sql).toContain("drop constraint if exists connector_installations_provider_check");
    for (const providerId of ["gmail", "google_calendar", "outlook", "teams", "posthog", "amplitude"]) {
      expect(sql).toContain(`'${providerId}'`);
    }
    expect(sql).toContain("adding a provider requires schema, onboarding, capability, operation, normalization, fixture, and migration coverage");
  });

  it("adds Engineering providers only through the reviewed database allowlist", async () => {
    const sql = await readFile(engineeringProviderExpansionMigrationPath, "utf8");
    expect(sql).toContain("drop constraint if exists connector_installations_provider_check");
    for (const providerId of ["linear", "jira", "gitlab"]) expect(sql).toContain(`'${providerId}'`);
    expect(sql).toContain("webhook-security");
  });

  it("adds warehouse providers only through the reviewed database allowlist", async () => {
    const sql = await readFile(warehouseProviderExpansionMigrationPath, "utf8");
    expect(sql).toContain("drop constraint if exists connector_installations_provider_check");
    for (const providerId of ["bigquery", "snowflake"]) expect(sql).toContain(`'${providerId}'`);
    expect(sql).toContain("bounded operation");
  });

  it("leases warehouse detector windows durably without exposing rows or credentials", async () => {
    const sql = await readFile(providerDetectorMigrationPath, "utf8");
    expect(sql).toContain("public.provider_detector_schedules");
    expect(sql).toContain("public.provider_detector_runs");
    expect(sql).toContain("for update of schedule skip locked");
    expect(sql).toContain("lease_token_hash = encode(extensions.digest");
    expect(sql).toContain("current_run_id = p_run_id");
    expect(sql).toContain("checkpoint_at = pending_window_end");
    expect(sql).toContain("status = 'paused', run_state = 'dead_letter'");
    expect(sql).toContain("revoke all on table public.provider_detector_schedules from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/\b(access_token|refresh_token|client_secret|raw_payload|provider_rows)\s+(?:text|jsonb)/i);
  });

  it("exposes only a bounded detector operations view and audits fenced controls", async () => {
    const sql = await readFile(providerDetectorOperationsMigrationPath, "utf8");
    expect(sql).toContain("public.list_provider_detector_operations");
    expect(sql).toContain("public.control_provider_detector_schedule");
    expect(sql).toContain("limit 5");
    expect(sql).toContain("for update");
    expect(sql).toContain("blocked_by_kill_switch");
    expect(sql).toContain("append_connector_security_audit_event");
    expect(sql).toContain("then 'accepted' else 'denied'");
    expect(sql).toContain("reasonHash");
    expect(sql).toContain("pending_window_start is null");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/jsonb_build_object\([\s\S]*?(?:event_ids|result_hash|broker_receipt_id)/i);
    expect(sql).not.toMatch(/\b(access_token|refresh_token|client_secret|provider_rows)\b/i);
  });
});
