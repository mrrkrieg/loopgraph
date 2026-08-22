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
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_hermes_callback_queue_snapshot") {
        return {
          data: {
            hermes_callbacks_queued: 6,
            hermes_callbacks_running: 2,
            hermes_callbacks_dead_letter: 1,
            hermes_callbacks_due: 3,
            hermes_callback_expired_leases: 1,
            hermes_callback_oldest_due_seconds: 33
          },
          error: null
        };
      }
      if (name === "get_discovery_design_snapshot") {
        return {
          data: {
            session_count: 12,
            active_session_count: 4,
            evidence_gap_set_count: 9,
            design_artifact_count: 18,
            oldest_active_session_seconds: 240
          },
          error: null
        };
      }
      if (name === "get_loop_spec_registry_snapshot") {
        return {
          data: {
            workspace_count: 1,
            active_loop_spec_count: 7,
            immutable_loop_spec_version_count: 11,
            loop_spec_commit_count: 8,
            workspace_revision: 8
          },
          error: null
        };
      }
      if (name === "get_opportunity_controller_snapshot") {
        return {
          data: {
            opportunities_total: 13,
            opportunities_qualified: 4,
            graph_changes_proposed: 3,
            controller_runs_total: 20,
            controller_runs_failed: 1,
            controller_triggers_pending: 2,
            controller_triggers_processing: 1,
            controller_triggers_failed: 1,
            controller_trigger_expired_leases: 1,
            controller_oldest_pending_seconds: 80,
            controller_active_leases: 1
          },
          error: null
        };
      }
      if (name === "get_semantic_graph_snapshot") {
        return {
          data: {
            graph_snapshots_total: 12,
            graph_approvals_total: 6,
            graph_transactions_total: 5,
            graph_transactions_failed: 1,
            graph_promotions_total: 2,
            graph_rehearsals_total: 3,
            graph_commits_total: 4,
            latest_graph_sequence: 11
          },
          error: null
        };
      }
      if (name === "get_app_lifecycle_recovery_snapshot") {
        return {
          data: {
            app_installations_total: 5,
            app_lifecycle_recovery_pending: 1,
            app_lifecycle_recovery_prepared: 1,
            app_lifecycle_recovery_requires_reconciliation: 0,
            app_lifecycle_recovery_stale: 0,
            app_lifecycle_recovery_workspaces_affected: 1,
            app_lifecycle_recovery_oldest_age_seconds: 30,
            app_lifecycle_recovery_stale_after_seconds: 900
          },
          error: null
        };
      }
      if (name === "get_loopgraph_app_action_reconciliation_snapshot") {
        return {
          data: {
            app_action_commits_requested_total: 40,
            app_action_commits_succeeded_total: 36,
            app_action_commits_failed_total: 3,
            app_action_reconciliation_pending: 1,
            app_action_reconciliation_stale: 0,
            app_action_reconciliation_workspaces_affected: 1,
            app_action_reconciliation_oldest_age_seconds: 45,
            app_action_reconciliation_stale_after_seconds: 300
          },
          error: null
        };
      }
      return {
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
        };
    });

    const readiness = await getOperationalReadiness();

    expect(readiness).toMatchObject({
      ready: true,
      degraded: false,
      mode: "hosted",
      checks: {
        configuration: true,
        database: true,
        audit: true,
        runtimeNamespace: true,
        appLifecycleRecovery: true,
        appActionReconciliation: true
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
        hermesCallbackOldestDueSeconds: 33,
        discoverySessionsTotal: 12,
        discoverySessionsActive: 4,
        discoveryEvidenceGapSetsTotal: 9,
        loopDesignArtifactsTotal: 18,
        discoveryOldestActiveSeconds: 240,
        activeLoopSpecs: 7,
        immutableLoopSpecVersions: 11,
        loopSpecCommits: 8,
        loopSpecWorkspaceRevision: 8,
        opportunitiesTotal: 13,
        opportunitiesQualified: 4,
        graphChangesProposed: 3,
        controllerRunsTotal: 20,
        controllerRunsFailed: 1,
        controllerTriggersPending: 2,
        controllerTriggersProcessing: 1,
        controllerTriggersFailed: 1,
        controllerTriggerExpiredLeases: 1,
        controllerOldestPendingSeconds: 80,
        controllerActiveLeases: 1,
        appInstallationsTotal: 5,
        appLifecycleRecoveryPending: 1,
        appLifecycleRecoveryPrepared: 1,
        appLifecycleRecoveryRequiresReconciliation: 0,
        appLifecycleRecoveryStale: 0,
        appLifecycleRecoveryWorkspacesAffected: 1,
        appLifecycleRecoveryOldestAgeSeconds: 30,
        appLifecycleRecoveryStaleAfterSeconds: 900,
        appActionCommitsRequestedTotal: 40,
        appActionCommitsSucceededTotal: 36,
        appActionCommitsFailedTotal: 3,
        appActionReconciliationPending: 1,
        appActionReconciliationStale: 0,
        appActionReconciliationWorkspacesAffected: 1,
        appActionReconciliationOldestAgeSeconds: 45,
        appActionReconciliationStaleAfterSeconds: 300
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
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_loop_design_artifacts_total 18"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_active_loop_specs 7"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_controller_triggers_pending 2"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_controller_active_leases 1"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_graph_commits_total 4"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_app_lifecycle_recovery_pending 1"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_app_lifecycle_recovery_stale 0"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_app_action_reconciliation_pending 1"
    );
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_app_action_reconciliation_stale 0"
    );
    expect(rpc).toHaveBeenCalledWith("get_app_lifecycle_recovery_snapshot", {
      p_organization_id: "123e4567-e89b-12d3-a456-426614174000",
      p_project_key: "main",
      p_stale_after_seconds: 900
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_loopgraph_app_action_reconciliation_snapshot",
      {
        p_organization_id: "123e4567-e89b-12d3-a456-426614174000",
        p_project_key: "main",
        p_stale_after_seconds: 300
      }
    );
  });

  it("reports stale or interrupted App lifecycle work as degraded without failing traffic readiness", async () => {
    hostedEnvironment();
    rpc.mockImplementation(async (name: string) => ({
      data: name === "get_loopgraph_operational_snapshot"
        ? { database_ready: true }
        : name === "get_app_lifecycle_recovery_snapshot"
          ? {
              app_lifecycle_recovery_pending: 2,
              app_lifecycle_recovery_prepared: 1,
              app_lifecycle_recovery_requires_reconciliation: 1,
              app_lifecycle_recovery_stale: 1,
              app_lifecycle_recovery_workspaces_affected: 1,
              app_lifecycle_recovery_oldest_age_seconds: 1_200,
              app_lifecycle_recovery_stale_after_seconds: 900
            }
          : {},
      error: null
    }));

    const readiness = await getOperationalReadiness();

    expect(readiness).toMatchObject({
      ready: true,
      degraded: true,
      checks: { appLifecycleRecovery: false },
      metrics: {
        appLifecycleRecoveryPending: 2,
        appLifecycleRecoveryRequiresReconciliation: 1,
        appLifecycleRecoveryStale: 1,
        appLifecycleRecoveryOldestAgeSeconds: 1_200
      }
    });
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_operational_degraded 1"
    );
  });

  it("fails hosted readiness when the lifecycle recovery threshold is invalid", async () => {
    hostedEnvironment();
    vi.stubEnv("LOOPGRAPH_APP_LIFECYCLE_RECOVERY_STALE_SECONDS", "not-a-number");

    const readiness = await getOperationalReadiness();

    expect(readiness).toMatchObject({
      ready: false,
      checks: { configuration: false, appLifecycleRecovery: false }
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports stale App action commit receipts as degraded without failing traffic readiness", async () => {
    hostedEnvironment();
    rpc.mockImplementation(async (name: string) => ({
      data: name === "get_loopgraph_operational_snapshot"
        ? { database_ready: true }
        : name === "get_loopgraph_app_action_reconciliation_snapshot"
          ? {
              app_action_reconciliation_pending: 2,
              app_action_reconciliation_stale: 1,
              app_action_reconciliation_workspaces_affected: 1,
              app_action_reconciliation_oldest_age_seconds: 480,
              app_action_reconciliation_stale_after_seconds: 300
            }
          : {},
      error: null
    }));

    const readiness = await getOperationalReadiness();

    expect(readiness).toMatchObject({
      ready: true,
      degraded: true,
      checks: { appActionReconciliation: false },
      metrics: {
        appActionReconciliationPending: 2,
        appActionReconciliationStale: 1,
        appActionReconciliationOldestAgeSeconds: 480
      }
    });
    expect(formatPrometheusMetrics(readiness)).toContain(
      "loopgraph_app_action_reconciliation_stale 1"
    );
  });

  it("fails hosted readiness when the App action reconciliation threshold is invalid", async () => {
    hostedEnvironment();
    vi.stubEnv("LOOPGRAPH_APP_ACTION_RECONCILIATION_STALE_SECONDS", "30");

    const readiness = await getOperationalReadiness();

    expect(readiness).toMatchObject({
      ready: false,
      checks: { configuration: false, appActionReconciliation: false }
    });
    expect(rpc).not.toHaveBeenCalled();
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
