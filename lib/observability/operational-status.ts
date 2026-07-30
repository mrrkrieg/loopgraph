import "server-only";

import { isHostedAuthRequired, isPublicHostedPreviewEnvironment } from "@/lib/auth/hosted-config";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { resolveHostedRuntimeProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import { emitOperationalLog } from "./operational-log";

export type OperationalMetrics = {
  machineRequests5m: number;
  machineRateLimited5m: number;
  machineDenied5m: number;
  auditEventsTotal: number;
  auditHeadSequence: number;
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
  lastMachineRequestAt?: string;
};

export type OperationalReadiness = {
  ready: boolean;
  mode: "local" | "preview" | "hosted";
  checkedAt: string;
  checks: {
    configuration: boolean;
    database: boolean | null;
    audit: boolean | null;
    runtimeNamespace: boolean | null;
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

const EMPTY_METRICS: OperationalMetrics = {
  machineRequests5m: 0,
  machineRateLimited5m: 0,
  machineDenied5m: 0,
  auditEventsTotal: 0,
  auditHeadSequence: 0,
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
  controllerActiveLeases: 0
};

export async function getOperationalReadiness(): Promise<OperationalReadiness> {
  const checkedAt = new Date().toISOString();
  if (!isHostedAuthRequired()) {
    return {
      ready: true,
      mode: isPublicHostedPreviewEnvironment() ? "preview" : "local",
      checkedAt,
      checks: {
        configuration: true,
        database: null,
        audit: null,
        runtimeNamespace: null
      },
      metrics: EMPTY_METRICS
    };
  }

  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  let runtimeNamespace = false;
  try {
    resolveHostedRuntimeProjectRoot(process.env);
    runtimeNamespace = true;
  } catch {
    runtimeNamespace = false;
  }
  const configuration = Boolean(organizationId && runtimeNamespace);
  const supabase = createSupabaseAdminClient();
  if (!configuration || !organizationId || !supabase) {
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
      mode: "hosted",
      checkedAt,
      checks: {
        configuration,
        database: Boolean(supabase),
        audit: false,
        runtimeNamespace
      },
      metrics: EMPTY_METRICS
    };
  }

  const [
    operational,
    callbacks,
    discoveryDesign,
    loopSpecRegistry,
    opportunityController
  ] =
    await Promise.all([
      supabase.rpc("get_loopgraph_operational_snapshot", {
        p_organization_id: organizationId,
        p_project_key: projectKey
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
      })
    ]);
  if (
    operational.error ||
    callbacks.error ||
    discoveryDesign.error ||
    loopSpecRegistry.error ||
    opportunityController.error ||
    !isRecord(operational.data) ||
    !isRecord(callbacks.data) ||
    !isRecord(discoveryDesign.data) ||
    !isRecord(loopSpecRegistry.data) ||
    !isRecord(opportunityController.data) ||
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
      mode: "hosted",
      checkedAt,
      checks: {
        configuration: true,
        database: false,
        audit: false,
        runtimeNamespace: true
      },
      metrics: EMPTY_METRICS
    };
  }

  return {
    ready: true,
    mode: "hosted",
    checkedAt,
    checks: {
      configuration: true,
      database: true,
      audit: true,
      runtimeNamespace: true
    },
    metrics: parseMetrics({
      ...operational.data,
      ...callbacks.data,
      ...discoveryDesign.data,
      ...loopSpecRegistry.data,
      ...opportunityController.data
    })
  };
}

export async function exportSecurityAuditEvents(input: {
  organizationId: string;
  afterSequence: number;
  limit: number;
}): Promise<SecurityAuditEvent[]> {
  const supabase = requiredAdminClient();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await supabase.rpc("export_security_audit_events", {
    p_organization_id: input.organizationId,
    p_project_key: projectKey,
    p_after_sequence: Math.max(0, Math.floor(input.afterSequence)),
    p_limit: Math.min(500, Math.max(1, Math.floor(input.limit)))
  });
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
    ...(typeof data.last_machine_request_at === "string"
      ? { lastMachineRequestAt: data.last_machine_request_at }
      : {})
  };
}

function nonnegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
