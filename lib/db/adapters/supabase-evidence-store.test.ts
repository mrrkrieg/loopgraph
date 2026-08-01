import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { measurementJobSchema } from "loopgraph/core";
import { SupabaseEvidenceStore } from "./supabase-evidence-store";

const scope = { organizationId: "123e4567-e89b-12d3-a456-426614174000", projectKey: "main" };

describe("Supabase evidence store", () => {
  it("rejects unsafe tenant scopes", () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseEvidenceStore(client, { organizationId: "../other", projectKey: "main" })).toThrow("organization ID");
    expect(() => new SupabaseEvidenceStore(client, { organizationId: scope.organizationId, projectKey: "../../escape" })).toThrow("project key");
  });

  it("claims and finalizes measurement jobs through fenced database RPCs", async () => {
    const pending = job("pending");
    const claimed = measurementJobSchema.parse({
      ...pending,
      status: "claimed",
      attemptCount: 1,
      lease: { claimedBy: "collector", tokenHash: "0123456789abcdef", claimedAt: "2026-07-31T00:00:00.000Z", expiresAt: "2026-07-31T00:05:00.000Z" }
    });
    const failed = measurementJobSchema.parse({
      ...claimed,
      status: "failed",
      lease: undefined,
      error: { code: "provider_timeout", message: "Synthetic timeout", retryable: true, failedAt: "2026-07-31T00:01:00.000Z" },
      updatedAt: "2026-07-31T00:01:00.000Z"
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_loopgraph_measurement_jobs") return { data: [{ payload: claimed, lease_token: "raw-lease" }], error: null };
      if (name === "finalize_loopgraph_measurement_job") return { data: failed, error: null };
      return { data: pending, error: null };
    });
    const store = new SupabaseEvidenceStore({ rpc, from: vi.fn() } as unknown as SupabaseClient, scope);
    await expect(store.claimDueJobs({ claimedBy: "collector", limit: 10, leaseSeconds: 300, now: new Date("2026-07-31T00:00:00.000Z") })).resolves.toEqual([{ job: claimed, leaseToken: "raw-lease" }]);
    await expect(store.saveClaimedMeasurementJob(failed, "0123456789abcdef")).resolves.toEqual(failed);
    expect(rpc).toHaveBeenCalledWith("finalize_loopgraph_measurement_job", expect.objectContaining({ p_expected_lease_hash: "0123456789abcdef", p_record_id: failed.id }));
  });
});

function job(status: "pending") {
  return measurementJobSchema.parse({
    id: "measurement_job_1",
    idempotencyKey: "measurement_1",
    projectRootId: "project_1",
    bindingId: "binding_1",
    bindingHash: "aaaaaaaaaaaaaaaa",
    metricDefinitionId: "metric_1",
    metricKey: "activation_rate",
    loopId: "product_activation",
    connectorInstanceId: "analytics_main",
    capabilityKey: "analytics.read",
    query: { resource: "events", fieldPath: "activation_rate", timestampField: "occurred_at", aggregation: "average" },
    unit: "percent",
    window: { start: "2026-07-30T23:00:00.000Z", end: "2026-07-31T00:00:00.000Z" },
    dueAt: "2026-07-31T00:00:00.000Z",
    status,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z"
  });
}
