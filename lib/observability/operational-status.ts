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
  routeJobOldestDueSeconds: 0
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

  const { data, error } = await supabase.rpc("get_loopgraph_operational_snapshot", {
    p_organization_id: organizationId,
    p_project_key: projectKey
  });
  if (error || !isRecord(data) || data.database_ready !== true) {
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
    metrics: parseMetrics(data)
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
