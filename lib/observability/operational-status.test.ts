import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const resolveHostedRuntimeProjectRoot = vi.hoisted(() => vi.fn(() => "/runtime/org/main"));

vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ rpc })
}));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({
  resolveHostedRuntimeProjectRoot
}));

import {
  exportSecurityAuditEvents,
  formatPrometheusMetrics,
  getOperationalReadiness,
  verifySecurityAuditChain
} from "./operational-status";

describe("operational status", () => {
  beforeEach(() => {
    rpc.mockReset();
    resolveHostedRuntimeProjectRoot.mockClear();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports local mode without claiming hosted persistence", async () => {
    const readiness = await getOperationalReadiness();
    expect(readiness).toMatchObject({
      ready: true,
      mode: "local",
      checks: {
        configuration: true,
        database: null,
        audit: null,
        runtimeNamespace: null
      }
    });
  });

  it("loads a tenant-bound hosted snapshot and formats scrape metrics", async () => {
    hostedEnvironment();
    rpc.mockImplementation(async (name: string) => name ===
      "get_hermes_callback_queue_snapshot"
      ? {
          data: {
            hermes_callbacks_queued: 6,
            hermes_callbacks_running: 2,
            hermes_callbacks_dead_letter: 1,
            hermes_callbacks_due: 3,
            hermes_callback_expired_leases: 1,
            hermes_callback_oldest_due_seconds: 33
          },
          error: null
        }
      : {
          data: {
            database_ready: true,
            machine_requests_5m: 8,
            machine_rate_limited_5m: 2,
            machine_denied_5m: 3,
            audit_events_total: 90,
            audit_head_sequence: 105,
            route_jobs_queued: 7,
            route_jobs_running: 2,
            route_jobs_waiting_review: 1,
            route_jobs_dead_letter: 4,
            route_jobs_due: 3,
            route_job_expired_leases: 1,
            route_job_oldest_due_seconds: 75,
            hermes_dispatch_queued: 5,
            hermes_dispatch_running: 2,
            hermes_dispatch_dead_letter: 1,
            hermes_dispatch_due: 4,
            hermes_dispatch_expired_leases: 1,
            hermes_dispatch_oldest_due_seconds: 45
          },
          error: null
        });

    const readiness = await getOperationalReadiness();

    expect(readiness).toMatchObject({
      ready: true,
      mode: "hosted",
      checks: {
        configuration: true,
        database: true,
        audit: true,
        runtimeNamespace: true
      },
      metrics: {
        machineRequests5m: 8,
        machineRateLimited5m: 2,
        machineDenied5m: 3,
        auditEventsTotal: 90,
        auditHeadSequence: 105,
        routeJobsQueued: 7,
        routeJobsRunning: 2,
        routeJobsWaitingReview: 1,
        routeJobsDeadLetter: 4,
        routeJobsDue: 3,
        routeJobExpiredLeases: 1,
        routeJobOldestDueSeconds: 75,
        hermesDispatchQueued: 5,
        hermesDispatchRunning: 2,
        hermesDispatchDeadLetter: 1,
        hermesDispatchDue: 4,
        hermesDispatchExpiredLeases: 1,
        hermesDispatchOldestDueSeconds: 45,
        hermesCallbacksQueued: 6,
        hermesCallbacksRunning: 2,
        hermesCallbacksDeadLetter: 1,
        hermesCallbacksDue: 3,
        hermesCallbackExpiredLeases: 1,
        hermesCallbackOldestDueSeconds: 33
      }
    });
    expect(formatPrometheusMetrics(readiness)).toContain("loopgraph_ready 1");
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_machine_rate_limited_5m 2"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_route_jobs_dead_letter 4"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_hermes_dispatch_due 4"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_hermes_callbacks_due 3"
    );
  });

  it("exports bounded audit pages and verifies their hash chain", async () => {
    hostedEnvironment();
    rpc
      .mockResolvedValueOnce({
        data: [{ sequence_number: 12, event_type: "machine.request.authorized" }],
        error: null
      })
      .mockResolvedValueOnce({
        data: [{
          valid: true,
          events_checked: 12,
          first_bad_sequence: null,
          head_hash: "a".repeat(64)
        }],
        error: null
      });

    const events = await exportSecurityAuditEvents({
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      afterSequence: -9,
      limit: 900
    });
    const integrity = await verifySecurityAuditChain(
      "123e4567-e89b-12d3-a456-426614174000"
    );

    expect(events).toHaveLength(1);
    expect(rpc).toHaveBeenNthCalledWith(1, "export_security_audit_events", {
      p_organization_id: "123e4567-e89b-12d3-a456-426614174000",
      p_project_key: "main",
      p_after_sequence: 0,
      p_limit: 500
    });
    expect(integrity).toEqual({
      valid: true,
      eventsChecked: 12,
      headHash: "a".repeat(64)
    });
  });
});

function hostedEnvironment() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
  vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
  vi.stubEnv(
    "LOOPGRAPH_HOSTED_ORGANIZATION_ID",
    "123e4567-e89b-12d3-a456-426614174000"
  );
  vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
}
