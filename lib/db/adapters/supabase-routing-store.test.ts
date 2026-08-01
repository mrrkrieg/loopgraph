import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  eventReceiptSchema,
  routeJobSchema,
  type EventReceipt,
  type RouteJob
} from "loopgraph/core";
import {
  SupabaseRoutingStore,
  isSupabaseRoutingStoreEnabled
} from "./supabase-routing-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

describe("Supabase routing store", () => {
  it("requires the service credential and an explicit tenant binding", () => {
    expect(isSupabaseRoutingStoreEnabled({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: ""
    } as NodeJS.ProcessEnv)).toBe(false);
    expect(isSupabaseRoutingStoreEnabled({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: scope.organizationId
    } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("rejects unsafe tenant and project scopes before issuing a query", () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseRoutingStore(client, {
      organizationId: "../another-tenant",
      projectKey: "main"
    })).toThrow("organization ID");
    expect(() => new SupabaseRoutingStore(client, {
      organizationId: scope.organizationId,
      projectKey: "../../escape"
    })).toThrow("project key");
  });

  it("uses the atomic claim RPC and validates every returned job", async () => {
    const job = routeJob();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ job, revision: 2 }],
      error: null
    });
    const store = new SupabaseRoutingStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    const claimed = await store.claimDueRouteJobsAtomically({
      claimedBy: "worker_a",
      now: new Date("2026-07-30T12:01:00.000Z"),
      leaseSeconds: 300,
      limit: 10
    });

    expect(claimed).toEqual([job]);
    expect(rpc).toHaveBeenCalledWith("claim_due_route_jobs", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_claimed_by: "worker_a",
      p_now: "2026-07-30T12:01:00.000Z",
      p_lease_seconds: 300,
      p_limit: 10
    });
  });

  it("uses a unique database receipt before Hermes reasons about an event", async () => {
    const receipt = eventReceipt();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ receipt, created: false }],
      error: null
    });
    const store = new SupabaseRoutingStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    const result = await store.createEventReceiptAtomically(receipt);

    expect(result).toEqual({ receipt, created: false });
    expect(rpc).toHaveBeenCalledWith("create_routing_event_receipt", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_record_id: receipt.id,
      p_event_id: receipt.eventId,
      p_payload: receipt
    });
  });

  it("retries a revision conflict and commits the caller's pure update", async () => {
    const initial = routeJob();
    const refreshed = { ...initial, updatedAt: "2026-07-30T12:00:01.000Z" };
    const query = routeJobQuery([
      { payload: initial, revision: 1 },
      { payload: refreshed, revision: 2 }
    ]);
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          updated: false,
          job: refreshed,
          revision: 2,
          conflict_reason: "revision_conflict"
        }],
        error: null
      })
      .mockImplementationOnce(async (_name, args: { p_job: RouteJob }) => ({
        data: [{
          updated: true,
          job: args.p_job,
          revision: 3,
          conflict_reason: null
        }],
        error: null
      }));
    const store = new SupabaseRoutingStore(
      { rpc, from: vi.fn(() => query) } as unknown as SupabaseClient,
      scope
    );

    const updated = await store.updateRouteJobAtomically({
      jobId: initial.id,
      update: (job) => routeJobSchema.parse({
        ...job,
        status: "running",
        updatedAt: "2026-07-30T12:02:00.000Z"
      })
    });

    expect(updated.status).toBe("running");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_revision: 1 });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_expected_revision: 2 });
  });
});

function routeJob(): RouteJob {
  return routeJobSchema.parse({
    schemaVersion: "route-job/v1alpha1",
    id: "job_1",
    idempotencyKey: "idempotency_1",
    eventId: "event_1",
    problemId: "problem_1",
    routeCommitId: "commit_1",
    routeAttemptId: "attempt_1",
    loopId: "product_feedback",
    loopSpecHash: "hash_1",
    runId: "run_1",
    activationMode: "shadow",
    status: "queued",
    correlationId: "correlation_1",
    attemptCount: 0,
    maxAttempts: 3,
    retryPolicy: {
      baseDelaySeconds: 30,
      maxDelaySeconds: 3600,
      backoffMultiplier: 2
    },
    nextRunAt: "2026-07-30T12:00:00.000Z",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z"
  });
}

function eventReceipt(): EventReceipt {
  return eventReceiptSchema.parse({
    id: "receipt_event_1",
    eventId: "event_1",
    event: {
      schemaVersion: "event-envelope/v1alpha1",
      id: "event_1",
      workspaceId: "workspace_1",
      companyId: "company_1",
      source: "product_events",
      sourceDeliveryId: "delivery_1",
      sourceRoute: "hermes.product_events",
      eventType: "feedback.received",
      occurredAt: "2026-07-30T12:00:00.000Z",
      receivedAt: "2026-07-30T12:00:01.000Z",
      subject: { type: "feedback", id: "feedback_1" },
      correlationId: "correlation_1",
      normalizedPayload: { rating: 2 },
      trust: {
        signatureVerified: true,
        signer: "product_events",
        untrustedFields: []
      }
    },
    eventHash: "event_hash_1",
    status: "received",
    firstSeenAt: "2026-07-30T12:00:01.000Z",
    lastSeenAt: "2026-07-30T12:00:01.000Z"
  });
}

function routeJobQuery(rows: Array<{ payload: RouteJob; revision: number }>) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: rows.shift() ?? null,
      error: null
    }))
  };
  return query;
}
