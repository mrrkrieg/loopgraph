import "server-only";

import { isHostedAuthRequired, isPublicHostedPreviewEnvironment } from "@/lib/auth/hosted-config";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { resolveHostedRuntimeProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import { getHostedAppEvidenceHealth } from "./app-evidence-health";
import { emitOperationalLog } from "./operational-log";

export type OperationalMetrics = {
  machineRequests5m: number;
  machineRateLimited5m: number;
  machineDenied5m: number;
  auditEventsTotal: number;
  auditHeadSequence: number;
  cliSessionsTotal: number;
  cliSessionsActive: number;
  cliSessionsRefreshRequired: number;
  cliSessionsExpired: number;
  cliSessionsRevoked: number;
  cliRefreshReuseDetectedTotal: number;
  cliRefreshReuseDetected24h: number;
  cliRefreshReuseUnrevoked: number;
  cliDeviceAuthorizationsPending: number;
  cliDeviceAuthorizationOldestPendingSeconds: number;
  routeJobsQueued: number;
  routeJobsRunning: number;
  routeJobsWaitingReview: number;
  routeJobsDeadLetter: number;
  routeJobsDue: number;
  routeJobExpiredLeases: number;
  routeJobOldestDueSeconds: number;
  hermesDispatchQueued: number;
  hermesDispatchRunning: number;
  hermesDispatchDeadLetter: number;
  hermesDispatchDue: number;
  hermesDispatchExpiredLeases: number;
  hermesDispatchOldestDueSeconds: number;
  hermesCallbacksQueued: number;
  hermesCallbacksRunning: number;
  hermesCallbacksDeadLetter: number;
  hermesCallbacksDue: number;
  hermesCallbackExpiredLeases: number;
  hermesCallbackOldestDueSeconds: number;
  discoverySessionsTotal: number;
  discoverySessionsActive: number;
  discoveryEvidenceGapSetsTotal: number;
  loopDesignArtifactsTotal: number;
  discoveryOldestActiveSeconds: number;
  activeLoopSpecs: number;
  immutableLoopSpecVersions: number;
  loopSpecCommits: number;
  loopSpecWorkspaceRevision: number;
  opportunitiesTotal: number;
  opportunitiesQualified: number;
  graphChangesProposed: number;
  controllerRunsTotal: number;
  controllerRunsFailed: number;
  controllerTriggersPending: number;
  controllerTriggersProcessing: number;
  controllerTriggersFailed: number;
  controllerTriggerExpiredLeases: number;
  controllerOldestPendingSeconds: number;
  controllerActiveLeases: number;
  graphSnapshotsTotal: number;
  graphApprovalsTotal: number;
  graphTransactionsTotal: number;
  graphTransactionsFailed: number;
  graphPromotionsTotal: number;
  graphRehearsalsTotal: number;
  graphCommitsTotal: number;
  latestGraphSequence: number;
  appInstallationsTotal: number;
  appEvidenceHealth: number;
  appEvidenceInstallationsTotal: number;
  appEvidenceInvalid: number;
  appEvidenceExpired: number;
  appEvidenceRenewSoon: number;
  appEvidenceIncomplete: number;
  appEvidenceCurrent: number;
  appEvidenceNotApplicable: number;
  appEvidenceItemsReturned: number;
  appEvidencePlanTruncated: number;
  appLifecycleRecoveryPending: number;
  appLifecycleRecoveryPrepared: number;
  appLifecycleRecoveryRequiresReconciliation: number;
  appLifecycleRecoveryStale: number;
  appLifecycleRecoveryWorkspacesAffected: number;
  appLifecycleRecoveryOldestAgeSeconds: number;
  appLifecycleRecoveryStaleAfterSeconds: number;
  appActionCommitsRequestedTotal: number;
  appActionCommitsSucceededTotal: number;
  appActionCommitsFailedTotal: number;
  appActionReconciliationPending: number;
  appActionReconciliationStale: number;
  appActionReconciliationWorkspacesAffected: number;
  appActionReconciliationOldestAgeSeconds: number;
  appActionReconciliationStaleAfterSeconds: number;
  lastMachineRequestAt?: string;
};

export type OperationalReadiness = {
  ready: boolean;
  degraded: boolean;
  mode: "local" | "preview" | "hosted";
  checkedAt: string;
  checks: {
    configuration: boolean;
    database: boolean | null;
    audit: boolean | null;
    cliSessionSecurity: boolean | null;
    runtimeNamespace: boolean | null;
    appEvidenceFreshness: boolean | null;
    appLifecycleRecovery: boolean | null;
    appActionReconciliation: boolean | null;
  };
  metrics: OperationalMetrics;
};

export type SecurityAuditEvent = {
  sequence_number: number;
  id: string;
  organization_id: string;
  project_key: string;
  occurred_at: string;
  event_type: string;
  outcome: string;
  actor_type: string;
  actor_id: string;
  capability: string | null;
  request_id: string | null;
  correlation_id: string;
  source: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  previous_hash: string;
  event_hash: string;
};

export type AuditIntegrity = {
  valid: boolean;
  eventsChecked: number;
  firstBadSequence?: number;
  headHash: string;
};

export type AuditExportCheckpoint = AuditIntegrity & {
  headSequence: number;
  currentHeadSequence: number;
};

const EMPTY_METRICS: OperationalMetrics = {
  machineRequests5m: 0,
  machineRateLimited5m: 0,
  machineDenied5m: 0,
  auditEventsTotal: 0,
  auditHeadSequence: 0,
  cliSessionsTotal: 0,
  cliSessionsActive: 0,
  cliSessionsRefreshRequired: 0,
  cliSessionsExpired: 0,
  cliSessionsRevoked: 0,
  cliRefreshReuseDetectedTotal: 0,
  cliRefreshReuseDetected24h: 0,
  cliRefreshReuseUnrevoked: 0,
  cliDeviceAuthorizationsPending: 0,
  cliDeviceAuthorizationOldestPendingSeconds: 0,
  routeJobsQueued: 0,
  routeJobsRunning: 0,
  routeJobsWaitingReview: 0,
  routeJobsDeadLetter: 0,
  routeJobsDue: 0,
  routeJobExpiredLeases: 0,
  routeJobOldestDueSeconds: 0,
  hermesDispatchQueued: 0,
  hermesDispatchRunning: 0,
  hermesDispatchDeadLetter: 0,
  hermesDispatchDue: 0,
  hermesDispatchExpiredLeases: 0,
  hermesDispatchOldestDueSeconds: 0,
  hermesCallbacksQueued: 0,
  hermesCallbacksRunning: 0,
  hermesCallbacksDeadLetter: 0,
  hermesCallbacksDue: 0,
  hermesCallbackExpiredLeases: 0,
  hermesCallbackOldestDueSeconds: 0,
  discoverySessionsTotal: 0,
  discoverySessionsActive: 0,
  discoveryEvidenceGapSetsTotal: 0,
  loopDesignArtifactsTotal: 0,
  discoveryOldestActiveSeconds: 0,
  activeLoopSpecs: 0,
  immutableLoopSpecVersions: 0,
  loopSpecCommits: 0,
  loopSpecWorkspaceRevision: 0,
  opportunitiesTotal: 0,
  opportunitiesQualified: 0,
  graphChangesProposed: 0,
  controllerRunsTotal: 0,
  controllerRunsFailed: 0,
  controllerTriggersPending: 0,
  controllerTriggersProcessing: 0,
  controllerTriggersFailed: 0,
  controllerTriggerExpiredLeases: 0,
  controllerOldestPendingSeconds: 0,
  controllerActiveLeases: 0,
  graphSnapshotsTotal: 0,
  graphApprovalsTotal: 0,
  graphTransactionsTotal: 0,
  graphTransactionsFailed: 0,
  graphPromotionsTotal: 0,
  graphRehearsalsTotal: 0,
  graphCommitsTotal: 0,
  latestGraphSequence: 0,
  appInstallationsTotal: 0,
  appEvidenceHealth: 1,
  appEvidenceInstallationsTotal: 0,
  appEvidenceInvalid: 0,
  appEvidenceExpired: 0,
  appEvidenceRenewSoon: 0,
  appEvidenceIncomplete: 0,
  appEvidenceCurrent: 0,
  appEvidenceNotApplicable: 0,
  appEvidenceItemsReturned: 0,
  appEvidencePlanTruncated: 0,
  appLifecycleRecoveryPending: 0,
  appLifecycleRecoveryPrepared: 0,
  appLifecycleRecoveryRequiresReconciliation: 0,
  appLifecycleRecoveryStale: 0,
  appLifecycleRecoveryWorkspacesAffected: 0,
  appLifecycleRecoveryOldestAgeSeconds: 0,
  appLifecycleRecoveryStaleAfterSeconds: 0,
  appActionCommitsRequestedTotal: 0,
  appActionCommitsSucceededTotal: 0,
  appActionCommitsFailedTotal: 0,
  appActionReconciliationPending: 0,
  appActionReconciliationStale: 0,
  appActionReconciliationWorkspacesAffected: 0,
  appActionReconciliationOldestAgeSeconds: 0,
  appActionReconciliationStaleAfterSeconds: 0
};

export async function getOperationalReadiness(): Promise<OperationalReadiness> {
  const checkedAt = new Date().toISOString();
  if (!isHostedAuthRequired()) {
    return {
      ready: true,
      degraded: false,
      mode: isPublicHostedPreviewEnvironment() ? "preview" : "local",
      checkedAt,
      checks: {
        configuration: true,
        database: null,
        audit: null,
        cliSessionSecurity: null,
        runtimeNamespace: null,
        appEvidenceFreshness: null,
        appLifecycleRecovery: null,
        appActionReconciliation: null
      },
      metrics: EMPTY_METRICS
    };
  }

  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const lifecycleStaleAfterSeconds = parseLifecycleStaleAfterSeconds(
    process.env.LOOPGRAPH_APP_LIFECYCLE_RECOVERY_STALE_SECONDS
  );
  const actionStaleAfterSeconds = parseActionStaleAfterSeconds(
    process.env.LOOPGRAPH_APP_ACTION_RECONCILIATION_STALE_SECONDS
  );
  let runtimeNamespace = false;
  let runtimeProjectRoot: string | undefined;
  try {
    runtimeProjectRoot = resolveHostedRuntimeProjectRoot(process.env);
    runtimeNamespace = true;
  } catch {
    runtimeNamespace = false;
  }
  const configuration = Boolean(
    organizationId && runtimeNamespace && lifecycleStaleAfterSeconds !== undefined &&
    actionStaleAfterSeconds !== undefined
  );
  const supabase = createSupabaseAdminClient();
  if (
    !configuration ||
    !organizationId ||
    !supabase ||
    lifecycleStaleAfterSeconds === undefined ||
    actionStaleAfterSeconds === undefined
  ) {
    emitOperationalLog({
      level: "error",
      event: "operational.readiness.failed",
      outcome: "error",
      organizationId,
      projectKey,
      reason: !configuration ? "invalid_hosted_configuration" : "service_database_unavailable"
    });
    return {
      ready: false,
      degraded: false,
      mode: "hosted",
      checkedAt,
      checks: {
        configuration,
        database: Boolean(supabase),
        audit: false,
        cliSessionSecurity: false,
        runtimeNamespace,
        appEvidenceFreshness: false,
        appLifecycleRecovery: false,
        appActionReconciliation: false
      },
      metrics: EMPTY_METRICS
    };
  }

  const [
    operational,
    cliSessionSecurity,
    callbacks,
    discoveryDesign,
    loopSpecRegistry,
    opportunityController,
    semanticGraph,
    appEvidenceHealth,
    appLifecycleRecovery,
    appActionReconciliation
  ] =
    await Promise.all([
      supabase.rpc("get_loopgraph_operational_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey
      }),
      supabase.rpc("get_cli_session_security_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey,
        p_now: checkedAt
      }),
      supabase.rpc("get_hermes_callback_queue_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey
      }),
      supabase.rpc("get_discovery_design_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey
      }),
      supabase.rpc("get_loop_spec_registry_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey
      }),
      supabase.rpc("get_opportunity_controller_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey
      }),
      supabase.rpc("get_semantic_graph_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey
      }),
      getHostedAppEvidenceHealth({ projectRoot: runtimeProjectRoot, now: new Date(checkedAt) })
        .then((data) => ({ data, error: null }))
        .catch((error: unknown) => ({ data: null, error })),
      supabase.rpc("get_app_lifecycle_recovery_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey,
        p_stale_after_seconds: lifecycleStaleAfterSeconds
      }),
      supabase.rpc("get_loopgraph_app_action_reconciliation_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey,
        p_stale_after_seconds: actionStaleAfterSeconds
      })
    ]);
  if (
    operational.error ||
    cliSessionSecurity.error ||
    callbacks.error ||
    discoveryDesign.error ||
    loopSpecRegistry.error ||
    opportunityController.error ||
    semanticGraph.error ||
    appEvidenceHealth.error ||
    appLifecycleRecovery.error ||
    appActionReconciliation.error ||
    !isRecord(operational.data) ||
    !isRecord(cliSessionSecurity.data) ||
    !isRecord(callbacks.data) ||
    !isRecord(discoveryDesign.data) ||
    !isRecord(loopSpecRegistry.data) ||
    !isRecord(opportunityController.data) ||
    !isRecord(semanticGraph.data) ||
    !appEvidenceHealth.data ||
    !isRecord(appLifecycleRecovery.data) ||
    !isRecord(appActionReconciliation.data) ||
    operational.data.database_ready !== true
  ) {
    emitOperationalLog({
      level: "error",
      event: "operational.readiness.failed",
      outcome: "error",
      organizationId,
      projectKey,
      reason: "operational_snapshot_unavailable"
    });
    return {
      ready: false,
      degraded: false,
      mode: "hosted",
      checkedAt,
      checks: {
        configuration: true,
        database: false,
        audit: false,
        cliSessionSecurity: false,
        runtimeNamespace: true,
        appEvidenceFreshness: false,
        appLifecycleRecovery: false,
        appActionReconciliation: false
      },
      metrics: EMPTY_METRICS
    };
  }

  const metrics = {
    ...parseMetrics({
      ...operational.data,
      ...cliSessionSecurity.data,
      ...callbacks.data,
      ...discoveryDesign.data,
      ...loopSpecRegistry.data,
      ...opportunityController.data,
      ...semanticGraph.data,
      ...appLifecycleRecovery.data,
      ...appActionReconciliation.data
    }),
    appEvidenceHealth: appEvidenceHealth.data.health === "healthy" ? 1 : 0,
    appEvidenceInstallationsTotal: appEvidenceHealth.data.totalInstallations,
    appEvidenceInvalid: appEvidenceHealth.data.counts.invalid,
    appEvidenceExpired: appEvidenceHealth.data.counts.expired,
    appEvidenceRenewSoon: appEvidenceHealth.data.counts.renewSoon,
    appEvidenceIncomplete: appEvidenceHealth.data.counts.incomplete,
    appEvidenceCurrent: appEvidenceHealth.data.counts.current,
    appEvidenceNotApplicable: appEvidenceHealth.data.counts.notApplicable,
    appEvidenceItemsReturned: appEvidenceHealth.data.itemsReturned,
    appEvidencePlanTruncated: appEvidenceHealth.data.truncated ? 1 : 0
  };
  const appEvidenceFreshnessHealthy = appEvidenceHealth.data.health === "healthy";
  const lifecycleRecoveryHealthy =
    metrics.appLifecycleRecoveryRequiresReconciliation === 0 &&
    metrics.appLifecycleRecoveryStale === 0;
  const actionReconciliationHealthy = metrics.appActionReconciliationStale === 0;
  const cliSessionIntegrityHealthy = metrics.cliRefreshReuseUnrevoked === 0;
  const cliSessionSecurityHealthy =
    metrics.cliRefreshReuseDetected24h === 0 && cliSessionIntegrityHealthy;

  return {
    ready: cliSessionIntegrityHealthy,
    degraded: !appEvidenceFreshnessHealthy || !lifecycleRecoveryHealthy ||
      !actionReconciliationHealthy || !cliSessionSecurityHealthy,
    mode: "hosted",
    checkedAt,
    checks: {
      configuration: true,
      database: true,
      audit: true,
      cliSessionSecurity: cliSessionSecurityHealthy,
      runtimeNamespace: true,
      appEvidenceFreshness: appEvidenceFreshnessHealthy,
      appLifecycleRecovery: lifecycleRecoveryHealthy,
      appActionReconciliation: actionReconciliationHealthy
    },
    metrics
  };
}

export async function exportSecurityAuditEvents(input: {
  organizationId: string;
  afterSequence: number;
  throughSequence?: number;
  limit: number;
}): Promise<SecurityAuditEvent[]> {
  const supabase = requiredAdminClient();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const bounded = input.throughSequence !== undefined;
  const { data, error } = await supabase.rpc(
    bounded ? "export_security_audit_events_bounded" : "export_security_audit_events",
    {
      p_organization_id: input.organizationId,
      p_project_key: projectKey,
      p_after_sequence: Math.max(0, Math.floor(input.afterSequence)),
      ...(bounded
        ? { p_through_sequence: Math.max(0, Math.floor(input.throughSequence!)) }
        : {}),
      p_limit: Math.min(500, Math.max(1, Math.floor(input.limit)))
    }
  );
  if (error) {
    emitOperationalLog({
      level: "error",
      event: "audit.export.failed",
      outcome: "error",
      organizationId: input.organizationId,
      projectKey,
      reason: "audit_export_rpc_failed"
    });
    throw new Error("Security audit export is unavailable.");
  }
  return Array.isArray(data) ? data as SecurityAuditEvent[] : [];
}

export async function getVerifiedSecurityAuditCheckpoint(input: {
  organizationId: string;
  throughSequence?: number;
}): Promise<AuditExportCheckpoint> {
  const supabase = requiredAdminClient();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await supabase.rpc("get_verified_security_audit_checkpoint", {
    p_organization_id: input.organizationId,
    p_project_key: projectKey,
    p_through_sequence: input.throughSequence ?? null
  });
  if (error) {
    emitOperationalLog({
      level: "error",
      event: "audit.checkpoint.failed",
      outcome: "error",
      organizationId: input.organizationId,
      projectKey,
      reason: "audit_checkpoint_rpc_failed"
    });
    throw new Error("Security audit checkpoint is unavailable.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row) || typeof row.valid !== "boolean") {
    throw new Error("Audit checkpoint returned an invalid result.");
  }
  const headHash = typeof row.head_hash === "string" ? row.head_hash : "";
  if (!/^[a-f0-9]{64}$/.test(headHash)) {
    throw new Error("Audit checkpoint returned an invalid head hash.");
  }
  return {
    valid: row.valid,
    eventsChecked: strictAuditInteger(row.events_checked, "events_checked"),
    headSequence: strictAuditInteger(row.head_sequence, "head_sequence"),
    currentHeadSequence: strictAuditInteger(
      row.current_head_sequence,
      "current_head_sequence"
    ),
    headHash
  };
}

function strictAuditInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Audit checkpoint returned an invalid ${field}.`);
  }
  return parsed;
}

export async function verifySecurityAuditChain(
  organizationId: string
): Promise<AuditIntegrity> {
  const supabase = requiredAdminClient();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await supabase.rpc("verify_security_audit_chain", {
    p_organization_id: organizationId,
    p_project_key: projectKey
  });
  if (error) {
    emitOperationalLog({
      level: "error",
      event: "audit.verification.failed",
      outcome: "error",
      organizationId,
      projectKey,
      reason: "audit_verification_rpc_failed"
    });
    throw new Error("Security audit verification is unavailable.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row) || typeof row.valid !== "boolean") {
    throw new Error("Audit verification returned an invalid result.");
  }
  return {
    valid: row.valid,
    eventsChecked: nonnegative(row.events_checked),
    ...(row.first_bad_sequence === null || row.first_bad_sequence === undefined
      ? {}
      : { firstBadSequence: nonnegative(row.first_bad_sequence) }),
    headHash: typeof row.head_hash === "string" ? row.head_hash : ""
  };
}

export function formatPrometheusMetrics(readiness: OperationalReadiness): string {
  const metrics = readiness.metrics;
  return [
    "# HELP loopgraph_ready Whether the deployment passed its readiness checks.",
    "# TYPE loopgraph_ready gauge",
    `loopgraph_ready ${readiness.ready ? 1 : 0}`,
    "# HELP loopgraph_operational_degraded Whether recoverable tenant work requires operator attention without making the service unavailable.",
    "# TYPE loopgraph_operational_degraded gauge",
    `loopgraph_operational_degraded ${readiness.degraded ? 1 : 0}`,
    "# HELP loopgraph_machine_requests_5m Durable machine request receipts in five minutes.",
    "# TYPE loopgraph_machine_requests_5m gauge",
    `loopgraph_machine_requests_5m ${metrics.machineRequests5m}`,
    "# HELP loopgraph_machine_rate_limited_5m Rate-limited machine requests in five minutes.",
    "# TYPE loopgraph_machine_rate_limited_5m gauge",
    `loopgraph_machine_rate_limited_5m ${metrics.machineRateLimited5m}`,
    "# HELP loopgraph_machine_denied_5m Denied machine requests in five minutes.",
    "# TYPE loopgraph_machine_denied_5m gauge",
    `loopgraph_machine_denied_5m ${metrics.machineDenied5m}`,
    "# HELP loopgraph_security_audit_events_total Security audit events for this deployment.",
    "# TYPE loopgraph_security_audit_events_total gauge",
    `loopgraph_security_audit_events_total ${metrics.auditEventsTotal}`,
    "# HELP loopgraph_security_audit_head_sequence Current audit-chain sequence.",
    "# TYPE loopgraph_security_audit_head_sequence gauge",
    `loopgraph_security_audit_head_sequence ${metrics.auditHeadSequence}`,
    "# HELP loopgraph_cli_sessions_total Human CLI sessions in the tenant project.",
    "# TYPE loopgraph_cli_sessions_total gauge",
    `loopgraph_cli_sessions_total ${metrics.cliSessionsTotal}`,
    "# HELP loopgraph_cli_sessions_active Human CLI sessions with current access and refresh authority.",
    "# TYPE loopgraph_cli_sessions_active gauge",
    `loopgraph_cli_sessions_active ${metrics.cliSessionsActive}`,
    "# HELP loopgraph_cli_sessions_refresh_required Human CLI sessions whose access token expired while refresh authority remains.",
    "# TYPE loopgraph_cli_sessions_refresh_required gauge",
    `loopgraph_cli_sessions_refresh_required ${metrics.cliSessionsRefreshRequired}`,
    "# HELP loopgraph_cli_sessions_expired Human CLI sessions whose refresh authority expired without explicit revocation.",
    "# TYPE loopgraph_cli_sessions_expired gauge",
    `loopgraph_cli_sessions_expired ${metrics.cliSessionsExpired}`,
    "# HELP loopgraph_cli_sessions_revoked Human CLI sessions explicitly revoked or revoked by policy.",
    "# TYPE loopgraph_cli_sessions_revoked gauge",
    `loopgraph_cli_sessions_revoked ${metrics.cliSessionsRevoked}`,
    "# HELP loopgraph_cli_refresh_reuse_detected_total CLI session families with detected prior-generation refresh replay.",
    "# TYPE loopgraph_cli_refresh_reuse_detected_total gauge",
    `loopgraph_cli_refresh_reuse_detected_total ${metrics.cliRefreshReuseDetectedTotal}`,
    "# HELP loopgraph_cli_refresh_reuse_detected_24h CLI session families with refresh replay detected in the last 24 hours.",
    "# TYPE loopgraph_cli_refresh_reuse_detected_24h gauge",
    `loopgraph_cli_refresh_reuse_detected_24h ${metrics.cliRefreshReuseDetected24h}`,
    "# HELP loopgraph_cli_refresh_reuse_unrevoked CLI session families where replay was detected without family revocation.",
    "# TYPE loopgraph_cli_refresh_reuse_unrevoked gauge",
    `loopgraph_cli_refresh_reuse_unrevoked ${metrics.cliRefreshReuseUnrevoked}`,
    "# HELP loopgraph_cli_device_authorizations_pending Unexpired pending CLI device authorizations.",
    "# TYPE loopgraph_cli_device_authorizations_pending gauge",
    `loopgraph_cli_device_authorizations_pending ${metrics.cliDeviceAuthorizationsPending}`,
    "# HELP loopgraph_cli_device_authorization_oldest_pending_seconds Age of the oldest unexpired pending CLI device authorization.",
    "# TYPE loopgraph_cli_device_authorization_oldest_pending_seconds gauge",
    `loopgraph_cli_device_authorization_oldest_pending_seconds ${metrics.cliDeviceAuthorizationOldestPendingSeconds}`,
    "# HELP loopgraph_route_jobs_queued Route jobs queued or waiting for retry.",
    "# TYPE loopgraph_route_jobs_queued gauge",
    `loopgraph_route_jobs_queued ${metrics.routeJobsQueued}`,
    "# HELP loopgraph_route_jobs_running Route jobs with claimed or running state.",
    "# TYPE loopgraph_route_jobs_running gauge",
    `loopgraph_route_jobs_running ${metrics.routeJobsRunning}`,
    "# HELP loopgraph_route_jobs_waiting_review Route jobs waiting for human review.",
    "# TYPE loopgraph_route_jobs_waiting_review gauge",
    `loopgraph_route_jobs_waiting_review ${metrics.routeJobsWaitingReview}`,
    "# HELP loopgraph_route_jobs_dead_letter Exhausted route jobs requiring intervention.",
    "# TYPE loopgraph_route_jobs_dead_letter gauge",
    `loopgraph_route_jobs_dead_letter ${metrics.routeJobsDeadLetter}`,
    "# HELP loopgraph_route_jobs_due Claimable route jobs due now.",
    "# TYPE loopgraph_route_jobs_due gauge",
    `loopgraph_route_jobs_due ${metrics.routeJobsDue}`,
    "# HELP loopgraph_route_job_expired_leases Route jobs with expired worker leases.",
    "# TYPE loopgraph_route_job_expired_leases gauge",
    `loopgraph_route_job_expired_leases ${metrics.routeJobExpiredLeases}`,
    "# HELP loopgraph_route_job_oldest_due_seconds Age of the oldest claimable route job.",
    "# TYPE loopgraph_route_job_oldest_due_seconds gauge",
    `loopgraph_route_job_oldest_due_seconds ${metrics.routeJobOldestDueSeconds}`,
    "# HELP loopgraph_hermes_dispatch_queued Hermes design deliveries queued or waiting for retry.",
    "# TYPE loopgraph_hermes_dispatch_queued gauge",
    `loopgraph_hermes_dispatch_queued ${metrics.hermesDispatchQueued}`,
    "# HELP loopgraph_hermes_dispatch_running Hermes design deliveries with an active worker lease.",
    "# TYPE loopgraph_hermes_dispatch_running gauge",
    `loopgraph_hermes_dispatch_running ${metrics.hermesDispatchRunning}`,
    "# HELP loopgraph_hermes_dispatch_dead_letter Exhausted Hermes design deliveries requiring intervention.",
    "# TYPE loopgraph_hermes_dispatch_dead_letter gauge",
    `loopgraph_hermes_dispatch_dead_letter ${metrics.hermesDispatchDeadLetter}`,
    "# HELP loopgraph_hermes_dispatch_due Claimable Hermes design deliveries due now.",
    "# TYPE loopgraph_hermes_dispatch_due gauge",
    `loopgraph_hermes_dispatch_due ${metrics.hermesDispatchDue}`,
    "# HELP loopgraph_hermes_dispatch_expired_leases Hermes design deliveries with expired worker leases.",
    "# TYPE loopgraph_hermes_dispatch_expired_leases gauge",
    `loopgraph_hermes_dispatch_expired_leases ${metrics.hermesDispatchExpiredLeases}`,
    "# HELP loopgraph_hermes_dispatch_oldest_due_seconds Age of the oldest claimable Hermes design delivery.",
    "# TYPE loopgraph_hermes_dispatch_oldest_due_seconds gauge",
    `loopgraph_hermes_dispatch_oldest_due_seconds ${metrics.hermesDispatchOldestDueSeconds}`,
    "# HELP loopgraph_hermes_callbacks_queued Hermes callbacks queued or waiting for retry.",
    "# TYPE loopgraph_hermes_callbacks_queued gauge",
    `loopgraph_hermes_callbacks_queued ${metrics.hermesCallbacksQueued}`,
    "# HELP loopgraph_hermes_callbacks_running Hermes callbacks with an active worker lease.",
    "# TYPE loopgraph_hermes_callbacks_running gauge",
    `loopgraph_hermes_callbacks_running ${metrics.hermesCallbacksRunning}`,
    "# HELP loopgraph_hermes_callbacks_dead_letter Exhausted Hermes callbacks requiring intervention.",
    "# TYPE loopgraph_hermes_callbacks_dead_letter gauge",
    `loopgraph_hermes_callbacks_dead_letter ${metrics.hermesCallbacksDeadLetter}`,
    "# HELP loopgraph_hermes_callbacks_due Claimable Hermes callbacks due now.",
    "# TYPE loopgraph_hermes_callbacks_due gauge",
    `loopgraph_hermes_callbacks_due ${metrics.hermesCallbacksDue}`,
    "# HELP loopgraph_hermes_callback_expired_leases Hermes callbacks with expired worker leases.",
    "# TYPE loopgraph_hermes_callback_expired_leases gauge",
    `loopgraph_hermes_callback_expired_leases ${metrics.hermesCallbackExpiredLeases}`,
    "# HELP loopgraph_hermes_callback_oldest_due_seconds Age of the oldest claimable Hermes callback.",
    "# TYPE loopgraph_hermes_callback_oldest_due_seconds gauge",
    `loopgraph_hermes_callback_oldest_due_seconds ${metrics.hermesCallbackOldestDueSeconds}`,
    "# HELP loopgraph_discovery_sessions_total Durable discovery sessions in this tenant project.",
    "# TYPE loopgraph_discovery_sessions_total gauge",
    `loopgraph_discovery_sessions_total ${metrics.discoverySessionsTotal}`,
    "# HELP loopgraph_discovery_sessions_active Discovery sessions not yet completed.",
    "# TYPE loopgraph_discovery_sessions_active gauge",
    `loopgraph_discovery_sessions_active ${metrics.discoverySessionsActive}`,
    "# HELP loopgraph_discovery_evidence_gap_sets_total Durable evidence-gap sets.",
    "# TYPE loopgraph_discovery_evidence_gap_sets_total gauge",
    `loopgraph_discovery_evidence_gap_sets_total ${metrics.discoveryEvidenceGapSetsTotal}`,
    "# HELP loopgraph_loop_design_artifacts_total Immutable Hermes design artifacts.",
    "# TYPE loopgraph_loop_design_artifacts_total gauge",
    `loopgraph_loop_design_artifacts_total ${metrics.loopDesignArtifactsTotal}`,
    "# HELP loopgraph_discovery_oldest_active_seconds Age of the oldest active discovery session.",
    "# TYPE loopgraph_discovery_oldest_active_seconds gauge",
    `loopgraph_discovery_oldest_active_seconds ${metrics.discoveryOldestActiveSeconds}`,
    "# HELP loopgraph_active_loop_specs Active LoopSpecs in the tenant project registry.",
    "# TYPE loopgraph_active_loop_specs gauge",
    `loopgraph_active_loop_specs ${metrics.activeLoopSpecs}`,
    "# HELP loopgraph_immutable_loop_spec_versions Immutable LoopSpec versions retained for rollback and audit.",
    "# TYPE loopgraph_immutable_loop_spec_versions gauge",
    `loopgraph_immutable_loop_spec_versions ${metrics.immutableLoopSpecVersions}`,
    "# HELP loopgraph_loop_spec_commits Atomic LoopSpec registry commits.",
    "# TYPE loopgraph_loop_spec_commits gauge",
    `loopgraph_loop_spec_commits ${metrics.loopSpecCommits}`,
    "# HELP loopgraph_loop_spec_workspace_revision Current active LoopSpec workspace revision.",
    "# TYPE loopgraph_loop_spec_workspace_revision gauge",
    `loopgraph_loop_spec_workspace_revision ${metrics.loopSpecWorkspaceRevision}`,
    "# HELP loopgraph_opportunities_total Durable loop opportunities.",
    "# TYPE loopgraph_opportunities_total gauge",
    `loopgraph_opportunities_total ${metrics.opportunitiesTotal}`,
    "# HELP loopgraph_opportunities_qualified Opportunities currently qualified for design or review.",
    "# TYPE loopgraph_opportunities_qualified gauge",
    `loopgraph_opportunities_qualified ${metrics.opportunitiesQualified}`,
    "# HELP loopgraph_graph_changes_proposed Proposed graph changes awaiting a governed decision.",
    "# TYPE loopgraph_graph_changes_proposed gauge",
    `loopgraph_graph_changes_proposed ${metrics.graphChangesProposed}`,
    "# HELP loopgraph_controller_runs_total Durable controller runs.",
    "# TYPE loopgraph_controller_runs_total gauge",
    `loopgraph_controller_runs_total ${metrics.controllerRunsTotal}`,
    "# HELP loopgraph_controller_runs_failed Failed controller runs.",
    "# TYPE loopgraph_controller_runs_failed gauge",
    `loopgraph_controller_runs_failed ${metrics.controllerRunsFailed}`,
    "# HELP loopgraph_controller_triggers_pending Controller triggers waiting for a worker.",
    "# TYPE loopgraph_controller_triggers_pending gauge",
    `loopgraph_controller_triggers_pending ${metrics.controllerTriggersPending}`,
    "# HELP loopgraph_controller_triggers_processing Controller triggers currently leased by workers.",
    "# TYPE loopgraph_controller_triggers_processing gauge",
    `loopgraph_controller_triggers_processing ${metrics.controllerTriggersProcessing}`,
    "# HELP loopgraph_controller_triggers_failed Controller triggers waiting for retry or operator action.",
    "# TYPE loopgraph_controller_triggers_failed gauge",
    `loopgraph_controller_triggers_failed ${metrics.controllerTriggersFailed}`,
    "# HELP loopgraph_controller_trigger_expired_leases Controller triggers with expired worker leases.",
    "# TYPE loopgraph_controller_trigger_expired_leases gauge",
    `loopgraph_controller_trigger_expired_leases ${metrics.controllerTriggerExpiredLeases}`,
    "# HELP loopgraph_controller_oldest_pending_seconds Age of the oldest pending controller trigger.",
    "# TYPE loopgraph_controller_oldest_pending_seconds gauge",
    `loopgraph_controller_oldest_pending_seconds ${metrics.controllerOldestPendingSeconds}`,
    "# HELP loopgraph_controller_active_leases Active controller and maintenance leases.",
    "# TYPE loopgraph_controller_active_leases gauge",
    `loopgraph_controller_active_leases ${metrics.controllerActiveLeases}`,
    "# HELP loopgraph_graph_snapshots_total Durable semantic graph snapshots.",
    "# TYPE loopgraph_graph_snapshots_total gauge",
    `loopgraph_graph_snapshots_total ${metrics.graphSnapshotsTotal}`,
    "# HELP loopgraph_graph_approvals_total Content-bound graph approval receipts.",
    "# TYPE loopgraph_graph_approvals_total gauge",
    `loopgraph_graph_approvals_total ${metrics.graphApprovalsTotal}`,
    "# HELP loopgraph_graph_transactions_total Durable semantic graph transactions.",
    "# TYPE loopgraph_graph_transactions_total gauge",
    `loopgraph_graph_transactions_total ${metrics.graphTransactionsTotal}`,
    "# HELP loopgraph_graph_transactions_failed Failed semantic graph transactions.",
    "# TYPE loopgraph_graph_transactions_failed gauge",
    `loopgraph_graph_transactions_failed ${metrics.graphTransactionsFailed}`,
    "# HELP loopgraph_graph_promotions_total Governed loop promotions.",
    "# TYPE loopgraph_graph_promotions_total gauge",
    `loopgraph_graph_promotions_total ${metrics.graphPromotionsTotal}`,
    "# HELP loopgraph_graph_rehearsals_total Durable promotion rehearsals.",
    "# TYPE loopgraph_graph_rehearsals_total gauge",
    `loopgraph_graph_rehearsals_total ${metrics.graphRehearsalsTotal}`,
    "# HELP loopgraph_graph_commits_total Atomic semantic graph commits.",
    "# TYPE loopgraph_graph_commits_total gauge",
    `loopgraph_graph_commits_total ${metrics.graphCommitsTotal}`,
    "# HELP loopgraph_latest_graph_sequence Latest semantic graph snapshot sequence.",
    "# TYPE loopgraph_latest_graph_sequence gauge",
    `loopgraph_latest_graph_sequence ${metrics.latestGraphSequence}`,
    "# HELP loopgraph_app_installations_total Installed Apps in this tenant project.",
    "# TYPE loopgraph_app_installations_total gauge",
    `loopgraph_app_installations_total ${metrics.appInstallationsTotal}`,
    "# HELP loopgraph_app_evidence_health Whether every installed App has non-invalid, non-expired evidence outside its renewal window.",
    "# TYPE loopgraph_app_evidence_health gauge",
    `loopgraph_app_evidence_health ${metrics.appEvidenceHealth}`,
    "# HELP loopgraph_app_evidence_installations_total Installed Apps evaluated by the evidence-renewal contract.",
    "# TYPE loopgraph_app_evidence_installations_total gauge",
    `loopgraph_app_evidence_installations_total ${metrics.appEvidenceInstallationsTotal}`,
    "# HELP loopgraph_app_evidence_invalid Installed Apps with invalid operating evidence.",
    "# TYPE loopgraph_app_evidence_invalid gauge",
    `loopgraph_app_evidence_invalid ${metrics.appEvidenceInvalid}`,
    "# HELP loopgraph_app_evidence_expired Installed Apps whose operating evidence has expired.",
    "# TYPE loopgraph_app_evidence_expired gauge",
    `loopgraph_app_evidence_expired ${metrics.appEvidenceExpired}`,
    "# HELP loopgraph_app_evidence_renew_soon Installed Apps whose operating evidence is inside the renewal window.",
    "# TYPE loopgraph_app_evidence_renew_soon gauge",
    `loopgraph_app_evidence_renew_soon ${metrics.appEvidenceRenewSoon}`,
    "# HELP loopgraph_app_evidence_incomplete Installed Apps that still need operating evidence for higher maturity.",
    "# TYPE loopgraph_app_evidence_incomplete gauge",
    `loopgraph_app_evidence_incomplete ${metrics.appEvidenceIncomplete}`,
    "# HELP loopgraph_app_evidence_current Installed Apps with current operating evidence.",
    "# TYPE loopgraph_app_evidence_current gauge",
    `loopgraph_app_evidence_current ${metrics.appEvidenceCurrent}`,
    "# HELP loopgraph_app_evidence_not_applicable Installed Apps whose current maturity does not yet require operating evidence.",
    "# TYPE loopgraph_app_evidence_not_applicable gauge",
    `loopgraph_app_evidence_not_applicable ${metrics.appEvidenceNotApplicable}`,
    "# HELP loopgraph_app_evidence_items_returned Bounded renewal-plan items returned to the health projection.",
    "# TYPE loopgraph_app_evidence_items_returned gauge",
    `loopgraph_app_evidence_items_returned ${metrics.appEvidenceItemsReturned}`,
    "# HELP loopgraph_app_evidence_plan_truncated Whether the bounded renewal-plan item list was truncated.",
    "# TYPE loopgraph_app_evidence_plan_truncated gauge",
    `loopgraph_app_evidence_plan_truncated ${metrics.appEvidencePlanTruncated}`,
    "# HELP loopgraph_app_lifecycle_recovery_pending Prepared or interrupted App lifecycle operations requiring an exact retry.",
    "# TYPE loopgraph_app_lifecycle_recovery_pending gauge",
    `loopgraph_app_lifecycle_recovery_pending ${metrics.appLifecycleRecoveryPending}`,
    "# HELP loopgraph_app_lifecycle_recovery_prepared App lifecycle operations prepared but not yet completed.",
    "# TYPE loopgraph_app_lifecycle_recovery_prepared gauge",
    `loopgraph_app_lifecycle_recovery_prepared ${metrics.appLifecycleRecoveryPrepared}`,
    "# HELP loopgraph_app_lifecycle_recovery_requires_reconciliation Interrupted App lifecycle operations requiring reconciliation.",
    "# TYPE loopgraph_app_lifecycle_recovery_requires_reconciliation gauge",
    `loopgraph_app_lifecycle_recovery_requires_reconciliation ${metrics.appLifecycleRecoveryRequiresReconciliation}`,
    "# HELP loopgraph_app_lifecycle_recovery_stale App lifecycle operations older than the configured recovery threshold.",
    "# TYPE loopgraph_app_lifecycle_recovery_stale gauge",
    `loopgraph_app_lifecycle_recovery_stale ${metrics.appLifecycleRecoveryStale}`,
    "# HELP loopgraph_app_lifecycle_recovery_workspaces_affected Workspaces with unfinished App lifecycle operations.",
    "# TYPE loopgraph_app_lifecycle_recovery_workspaces_affected gauge",
    `loopgraph_app_lifecycle_recovery_workspaces_affected ${metrics.appLifecycleRecoveryWorkspacesAffected}`,
    "# HELP loopgraph_app_lifecycle_recovery_oldest_age_seconds Age of the oldest unfinished App lifecycle operation.",
    "# TYPE loopgraph_app_lifecycle_recovery_oldest_age_seconds gauge",
    `loopgraph_app_lifecycle_recovery_oldest_age_seconds ${metrics.appLifecycleRecoveryOldestAgeSeconds}`,
    "# HELP loopgraph_app_lifecycle_recovery_stale_after_seconds Configured age at which unfinished App lifecycle work is stale.",
    "# TYPE loopgraph_app_lifecycle_recovery_stale_after_seconds gauge",
    `loopgraph_app_lifecycle_recovery_stale_after_seconds ${metrics.appLifecycleRecoveryStaleAfterSeconds}`,
    "# HELP loopgraph_app_action_commits_requested_total App provider commits requested in the tenant project.",
    "# TYPE loopgraph_app_action_commits_requested_total gauge",
    `loopgraph_app_action_commits_requested_total ${metrics.appActionCommitsRequestedTotal}`,
    "# HELP loopgraph_app_action_commits_succeeded_total App provider commits with a durable successful terminal receipt.",
    "# TYPE loopgraph_app_action_commits_succeeded_total gauge",
    `loopgraph_app_action_commits_succeeded_total ${metrics.appActionCommitsSucceededTotal}`,
    "# HELP loopgraph_app_action_commits_failed_total App provider commits with a durable failed terminal receipt.",
    "# TYPE loopgraph_app_action_commits_failed_total gauge",
    `loopgraph_app_action_commits_failed_total ${metrics.appActionCommitsFailedTotal}`,
    "# HELP loopgraph_app_action_reconciliation_pending Commit requests without a matching terminal receipt.",
    "# TYPE loopgraph_app_action_reconciliation_pending gauge",
    `loopgraph_app_action_reconciliation_pending ${metrics.appActionReconciliationPending}`,
    "# HELP loopgraph_app_action_reconciliation_stale Nonterminal commit requests older than the configured recovery threshold.",
    "# TYPE loopgraph_app_action_reconciliation_stale gauge",
    `loopgraph_app_action_reconciliation_stale ${metrics.appActionReconciliationStale}`,
    "# HELP loopgraph_app_action_reconciliation_workspaces_affected Workspaces with a nonterminal App commit request.",
    "# TYPE loopgraph_app_action_reconciliation_workspaces_affected gauge",
    `loopgraph_app_action_reconciliation_workspaces_affected ${metrics.appActionReconciliationWorkspacesAffected}`,
    "# HELP loopgraph_app_action_reconciliation_oldest_age_seconds Age of the oldest nonterminal App commit request.",
    "# TYPE loopgraph_app_action_reconciliation_oldest_age_seconds gauge",
    `loopgraph_app_action_reconciliation_oldest_age_seconds ${metrics.appActionReconciliationOldestAgeSeconds}`,
    "# HELP loopgraph_app_action_reconciliation_stale_after_seconds Configured age at which a nonterminal App commit request is stale.",
    "# TYPE loopgraph_app_action_reconciliation_stale_after_seconds gauge",
    `loopgraph_app_action_reconciliation_stale_after_seconds ${metrics.appActionReconciliationStaleAfterSeconds}`,
    ""
  ].join("\n");
}

function requiredAdminClient() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase service authorization is not configured.");
  }
  return supabase;
}

function parseMetrics(data: Record<string, unknown>): OperationalMetrics {
  return {
    machineRequests5m: nonnegative(data.machine_requests_5m),
    machineRateLimited5m: nonnegative(data.machine_rate_limited_5m),
    machineDenied5m: nonnegative(data.machine_denied_5m),
    auditEventsTotal: nonnegative(data.audit_events_total),
    auditHeadSequence: nonnegative(data.audit_head_sequence),
    cliSessionsTotal: nonnegative(data.cli_sessions_total),
    cliSessionsActive: nonnegative(data.cli_sessions_active),
    cliSessionsRefreshRequired: nonnegative(data.cli_sessions_refresh_required),
    cliSessionsExpired: nonnegative(data.cli_sessions_expired),
    cliSessionsRevoked: nonnegative(data.cli_sessions_revoked),
    cliRefreshReuseDetectedTotal: nonnegative(data.cli_refresh_reuse_detected_total),
    cliRefreshReuseDetected24h: nonnegative(data.cli_refresh_reuse_detected_24h),
    cliRefreshReuseUnrevoked: nonnegative(data.cli_refresh_reuse_unrevoked),
    cliDeviceAuthorizationsPending: nonnegative(data.cli_device_authorizations_pending),
    cliDeviceAuthorizationOldestPendingSeconds: nonnegative(
      data.cli_device_authorizations_oldest_pending_seconds
    ),
    routeJobsQueued: nonnegative(data.route_jobs_queued),
    routeJobsRunning: nonnegative(data.route_jobs_running),
    routeJobsWaitingReview: nonnegative(data.route_jobs_waiting_review),
    routeJobsDeadLetter: nonnegative(data.route_jobs_dead_letter),
    routeJobsDue: nonnegative(data.route_jobs_due),
    routeJobExpiredLeases: nonnegative(data.route_job_expired_leases),
    routeJobOldestDueSeconds: nonnegative(data.route_job_oldest_due_seconds),
    hermesDispatchQueued: nonnegative(data.hermes_dispatch_queued),
    hermesDispatchRunning: nonnegative(data.hermes_dispatch_running),
    hermesDispatchDeadLetter: nonnegative(data.hermes_dispatch_dead_letter),
    hermesDispatchDue: nonnegative(data.hermes_dispatch_due),
    hermesDispatchExpiredLeases: nonnegative(data.hermes_dispatch_expired_leases),
    hermesDispatchOldestDueSeconds: nonnegative(
      data.hermes_dispatch_oldest_due_seconds
    ),
    hermesCallbacksQueued: nonnegative(data.hermes_callbacks_queued),
    hermesCallbacksRunning: nonnegative(data.hermes_callbacks_running),
    hermesCallbacksDeadLetter: nonnegative(data.hermes_callbacks_dead_letter),
    hermesCallbacksDue: nonnegative(data.hermes_callbacks_due),
    hermesCallbackExpiredLeases: nonnegative(
      data.hermes_callback_expired_leases
    ),
    hermesCallbackOldestDueSeconds: nonnegative(
      data.hermes_callback_oldest_due_seconds
    ),
    discoverySessionsTotal: nonnegative(data.session_count),
    discoverySessionsActive: nonnegative(data.active_session_count),
    discoveryEvidenceGapSetsTotal: nonnegative(
      data.evidence_gap_set_count
    ),
    loopDesignArtifactsTotal: nonnegative(data.design_artifact_count),
    discoveryOldestActiveSeconds: nonnegative(
      data.oldest_active_session_seconds
    ),
    activeLoopSpecs: nonnegative(data.active_loop_spec_count),
    immutableLoopSpecVersions: nonnegative(
      data.immutable_loop_spec_version_count
    ),
    loopSpecCommits: nonnegative(data.loop_spec_commit_count),
    loopSpecWorkspaceRevision: nonnegative(data.workspace_revision),
    opportunitiesTotal: nonnegative(data.opportunities_total),
    opportunitiesQualified: nonnegative(data.opportunities_qualified),
    graphChangesProposed: nonnegative(data.graph_changes_proposed),
    controllerRunsTotal: nonnegative(data.controller_runs_total),
    controllerRunsFailed: nonnegative(data.controller_runs_failed),
    controllerTriggersPending: nonnegative(data.controller_triggers_pending),
    controllerTriggersProcessing: nonnegative(
      data.controller_triggers_processing
    ),
    controllerTriggersFailed: nonnegative(data.controller_triggers_failed),
    controllerTriggerExpiredLeases: nonnegative(
      data.controller_trigger_expired_leases
    ),
    controllerOldestPendingSeconds: nonnegative(
      data.controller_oldest_pending_seconds
    ),
    controllerActiveLeases: nonnegative(data.controller_active_leases),
    graphSnapshotsTotal: nonnegative(data.graph_snapshots_total),
    graphApprovalsTotal: nonnegative(data.graph_approvals_total),
    graphTransactionsTotal: nonnegative(data.graph_transactions_total),
    graphTransactionsFailed: nonnegative(data.graph_transactions_failed),
    graphPromotionsTotal: nonnegative(data.graph_promotions_total),
    graphRehearsalsTotal: nonnegative(data.graph_rehearsals_total),
    graphCommitsTotal: nonnegative(data.graph_commits_total),
    latestGraphSequence: nonnegative(data.latest_graph_sequence),
    appInstallationsTotal: nonnegative(data.app_installations_total),
    appEvidenceHealth: 1,
    appEvidenceInstallationsTotal: 0,
    appEvidenceInvalid: 0,
    appEvidenceExpired: 0,
    appEvidenceRenewSoon: 0,
    appEvidenceIncomplete: 0,
    appEvidenceCurrent: 0,
    appEvidenceNotApplicable: 0,
    appEvidenceItemsReturned: 0,
    appEvidencePlanTruncated: 0,
    appLifecycleRecoveryPending: nonnegative(data.app_lifecycle_recovery_pending),
    appLifecycleRecoveryPrepared: nonnegative(data.app_lifecycle_recovery_prepared),
    appLifecycleRecoveryRequiresReconciliation: nonnegative(
      data.app_lifecycle_recovery_requires_reconciliation
    ),
    appLifecycleRecoveryStale: nonnegative(data.app_lifecycle_recovery_stale),
    appLifecycleRecoveryWorkspacesAffected: nonnegative(
      data.app_lifecycle_recovery_workspaces_affected
    ),
    appLifecycleRecoveryOldestAgeSeconds: nonnegative(
      data.app_lifecycle_recovery_oldest_age_seconds
    ),
    appLifecycleRecoveryStaleAfterSeconds: nonnegative(
      data.app_lifecycle_recovery_stale_after_seconds
    ),
    appActionCommitsRequestedTotal: nonnegative(
      data.app_action_commits_requested_total
    ),
    appActionCommitsSucceededTotal: nonnegative(
      data.app_action_commits_succeeded_total
    ),
    appActionCommitsFailedTotal: nonnegative(
      data.app_action_commits_failed_total
    ),
    appActionReconciliationPending: nonnegative(
      data.app_action_reconciliation_pending
    ),
    appActionReconciliationStale: nonnegative(
      data.app_action_reconciliation_stale
    ),
    appActionReconciliationWorkspacesAffected: nonnegative(
      data.app_action_reconciliation_workspaces_affected
    ),
    appActionReconciliationOldestAgeSeconds: nonnegative(
      data.app_action_reconciliation_oldest_age_seconds
    ),
    appActionReconciliationStaleAfterSeconds: nonnegative(
      data.app_action_reconciliation_stale_after_seconds
    ),
    ...(typeof data.last_machine_request_at === "string"
      ? { lastMachineRequestAt: data.last_machine_request_at }
      : {})
  };
}

function parseLifecycleStaleAfterSeconds(value: string | undefined): number | undefined {
  return parseStaleAfterSeconds(value, 900);
}

function parseActionStaleAfterSeconds(value: string | undefined): number | undefined {
  return parseStaleAfterSeconds(value, 300);
}

function parseStaleAfterSeconds(value: string | undefined, fallback: number): number | undefined {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[0-9]+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 60 && parsed <= 86_400
    ? parsed
    : undefined;
}

function nonnegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
