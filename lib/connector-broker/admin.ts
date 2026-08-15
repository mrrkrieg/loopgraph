import "server-only";

import { randomUUID } from "node:crypto";
import {
  brokerCapabilitySchema,
  connectorInstallationAdminSchema,
  connectorInstallationHasExpectedNamespace,
  connectorInstallationViewSchema,
  type ConnectorInstallationAdmin,
  type ConnectorInstallationView,
  type ProviderId
} from "loopgraph/core";
import { z } from "zod";
import {
  AmbientWorkloadTokenProvider,
  ConnectorBrokerClient
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import type { WorkspaceDatabase } from "@/lib/db/workspace-database";

export async function listConnectorInstallations(database: WorkspaceDatabase) {
  if (!database.organizationId) return [];
  const client = connectorControlPlaneClient();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await client
    .from("connector_installations")
    .select("*")
    .eq("organization_id", database.organizationId)
    .eq("project_key", projectKey)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapInstallation).map(toConnectorInstallationView);
}

export function getExternalConnectorBrokerClient() {
  const baseUrl = process.env.LOOPGRAPH_CONNECTOR_BROKER_URL?.trim();
  const audience = process.env.LOOPGRAPH_CONNECTOR_BROKER_AUDIENCE?.trim();
  if (!baseUrl || !audience) return undefined;
  return new ConnectorBrokerClient({
    baseUrl,
    audience,
    tokenProvider: new AmbientWorkloadTokenProvider()
  });
}

export async function persistConnectorInstallation(
  database: WorkspaceDatabase,
  installation: ConnectorInstallationAdmin
) {
  if (!database.organizationId) throw new Error("Hosted connector storage is unavailable");
  if (installation.tenant.organizationId !== database.organizationId) throw new Error("Connector tenant mismatch");
  if (!connectorInstallationHasExpectedNamespace(installation)) throw new Error("Connector credential namespace is invalid");
  const client = connectorControlPlaneClient();
  const { error } = await client.from("connector_installations").upsert({
    id: installation.id,
    organization_id: installation.tenant.organizationId,
    project_key: installation.tenant.projectKey,
    provider_id: installation.providerId,
    display_name: installation.displayName,
    environment: installation.environment,
    status: installation.status,
    credential_ref: installation.credentialRef,
    credential_namespace: installation.credentialNamespace,
    customer_managed_key_ref: installation.customerManagedKeyRef ?? null,
    webhook_secret_ref: installation.webhookSecretRef ?? null,
    webhook_secret_previous_ref: installation.webhookSecretPreviousRef ?? null,
    provider_subscription_id: installation.providerSubscriptionId ?? null,
    webhook_status: installation.webhookStatus,
    granted_scopes: installation.grantedScopes,
    allowed_capabilities: installation.allowedCapabilities,
    connected_by: installation.connectedBy ?? null,
    connected_at: installation.connectedAt ?? null,
    last_health_check_at: installation.lastHealthCheckAt ?? null,
    last_rotated_at: installation.lastRotatedAt ?? null,
    token_expires_at: installation.tokenExpiresAt ?? null,
    revoked_at: installation.revokedAt ?? null,
    created_at: installation.createdAt,
    updated_at: installation.updatedAt
  }, { onConflict: "organization_id,project_key,id" });
  if (error) throw error;
}

export function toConnectorInstallationView(
  installation: ConnectorInstallationAdmin
): ConnectorInstallationView {
  return connectorInstallationViewSchema.parse({
    ...installation,
    customerManagedKeyConfigured: Boolean(installation.customerManagedKeyRef)
  });
}

export async function queueConnectorRevocation(input: {
  database: WorkspaceDatabase;
  installationId: string;
  reason: string;
  emergency: boolean;
}) {
  const { database } = input;
  if (!database.organizationId || !database.userId) throw new Error("Hosted connector storage is unavailable");
  const client = connectorControlPlaneClient();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data: existing, error: readError } = await client
    .from("connector_installations")
    .select("*")
    .eq("organization_id", database.organizationId)
    .eq("project_key", projectKey)
    .eq("id", input.installationId)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) throw new Error("Connector installation was not found");
  const installation = mapInstallation(existing);
  const { data: job, error: jobError } = await client.rpc("locally_disable_connector", {
    p_organization_id: database.organizationId,
    p_project_key: projectKey,
    p_installation_id: input.installationId,
    p_requested_by: database.userId,
    p_reason: input.reason,
    p_emergency: input.emergency,
    p_now: new Date().toISOString()
  });
  if (jobError) throw jobError;
  await appendConnectorAdminAudit({
    organizationId: database.organizationId,
    projectKey,
    eventType: input.emergency ? "connector.emergency_disconnect_requested" : "connector.disconnect_requested",
    outcome: "accepted",
    actorId: database.userId,
    correlationId: `connector_revoke_${randomUUID()}`,
    resourceType: "connector_installation",
    resourceId: input.installationId,
    metadata: { providerId: installation.providerId, emergency: input.emergency, jobId: String(job) }
  });
  return { installation, jobId: String(job), projectKey };
}

export async function disableConnectorLocally(input: {
  database: WorkspaceDatabase;
  installationId: string;
  reason: string;
}) {
  if (!input.database.organizationId || !input.database.userId) throw new Error("Hosted connector storage is unavailable");
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await connectorControlPlaneClient().rpc("disable_connector_locally", {
    p_organization_id: input.database.organizationId,
    p_project_key: projectKey,
    p_installation_id: input.installationId,
    p_requested_by: input.database.userId,
    p_reason: input.reason,
    p_now: new Date().toISOString()
  });
  if (error) throw error;
  if (data !== true) throw new Error("Connector installation was not found");
  await appendConnectorAdminAudit({
    organizationId: input.database.organizationId,
    projectKey,
    eventType: "connector.locally_disabled",
    outcome: "accepted",
    actorId: input.database.userId,
    correlationId: `connector_disable_${randomUUID()}`,
    resourceType: "connector_installation",
    resourceId: input.installationId,
    metadata: { reasonRecorded: true }
  });
  return { status: "locally_disabled" as const, projectKey };
}

export async function completeConnectorRevocation(input: {
  database: WorkspaceDatabase;
  installationId: string;
  jobId: string;
  success: boolean;
  errorCode?: string;
}) {
  if (!input.database.organizationId) return;
  const client = connectorControlPlaneClient();
  const now = new Date().toISOString();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  await Promise.all([
    client.from("connector_revocation_jobs").update({
      status: input.success ? "completed" : "queued",
      completed_at: input.success ? now : null,
      last_error_code: input.errorCode ?? null,
      available_at: input.success ? now : new Date(Date.now() + 60_000).toISOString()
    }).eq("id", input.jobId).eq("organization_id", input.database.organizationId),
    input.success
      ? client.from("connector_installations").update({
          status: "revoked",
          revoked_at: now,
          allowed_capabilities: [],
          updated_at: now
        }).eq("organization_id", input.database.organizationId).eq("project_key", projectKey).eq("id", input.installationId)
      : Promise.resolve()
  ]);
}

export async function updateConnectorHealth(input: {
  database: WorkspaceDatabase;
  installationId: string;
  projectKey: string;
  status: "active" | "degraded";
  checkedAt: string;
}) {
  if (!input.database.organizationId) throw new Error("Hosted connector storage is unavailable");
  const { error } = await connectorControlPlaneClient().from("connector_installations").update({
    status: input.status,
    last_health_check_at: input.checkedAt,
    updated_at: input.checkedAt
  }).eq("organization_id", input.database.organizationId)
    .eq("project_key", input.projectKey)
    .eq("id", input.installationId);
  if (error) throw error;
}

export async function deleteConnectorInstallationMetadata(input: {
  database: WorkspaceDatabase;
  installationId: string;
  projectKey: string;
}) {
  if (!input.database.organizationId) throw new Error("Hosted connector storage is unavailable");
  const { data, error } = await connectorControlPlaneClient()
    .from("connector_installations")
    .delete()
    .eq("organization_id", input.database.organizationId)
    .eq("project_key", input.projectKey)
    .eq("id", input.installationId)
    .in("status", ["revoked", "disconnected", "failed"])
    .select("provider_id")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function appendConnectorAdminAudit(input: {
  organizationId: string;
  projectKey: string;
  eventType: string;
  outcome: "accepted" | "denied" | "error";
  actorId: string;
  correlationId: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, string | number | boolean>;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Connector audit storage is unavailable");
  const { error } = await admin.rpc("append_connector_security_audit_event", {
    p_organization_id: input.organizationId,
    p_project_key: input.projectKey,
    p_event_type: input.eventType,
    p_outcome: input.outcome,
    p_actor_type: "user",
    p_actor_id: input.actorId,
    p_correlation_id: input.correlationId,
    p_resource_type: input.resourceType,
    p_resource_id: input.resourceId,
    p_metadata: input.metadata ?? {}
  });
  if (error) throw error;
}

export async function approveConnectorPreparedAction(input: {
  database: WorkspaceDatabase;
  installationId: string;
  actionId: string;
  fingerprint: string;
  reason: string;
}) {
  if (!input.database.organizationId || !input.database.userId) {
    throw new Error("Hosted connector storage is unavailable");
  }
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const client = connectorControlPlaneClient();
  const { data: action, error: actionError } = await client.from("connector_prepared_actions")
    .select("action_id,fingerprint,installation_id,provider_id,capability,operation,status,expires_at,approval_required")
    .eq("organization_id", input.database.organizationId)
    .eq("project_key", projectKey)
    .eq("installation_id", input.installationId)
    .eq("action_id", input.actionId)
    .maybeSingle();
  if (actionError) throw actionError;
  if (!action || action.status !== "prepared" || action.fingerprint !== input.fingerprint) {
    throw new Error("Prepared action is unavailable or its fingerprint changed");
  }
  if (action.approval_required !== true) throw new Error("Prepared action does not require human approval");
  const expiresAt = new Date(Math.min(Date.parse(String(action.expires_at)), Date.now() + 5 * 60_000)).toISOString();
  if (Date.parse(expiresAt) <= Date.now()) throw new Error("Prepared action has expired");
  const approvalId = `connector_approval_${randomUUID()}`;
  const { error: approvalError } = await client.from("connector_action_approvals").insert({
    organization_id: input.database.organizationId,
    project_key: projectKey,
    approval_id: approvalId,
    action_id: input.actionId,
    fingerprint: input.fingerprint,
    approved_by: input.database.userId,
    expires_at: expiresAt,
    reason: input.reason,
    status: "approved"
  });
  if (approvalError) throw approvalError;
  await appendConnectorAdminAudit({
    organizationId: input.database.organizationId,
    projectKey,
    eventType: "connector.action.approved",
    outcome: "accepted",
    actorId: input.database.userId,
    correlationId: approvalId,
    resourceType: "connector_prepared_action",
    resourceId: input.actionId,
    metadata: {
      installationId: input.installationId,
      providerId: String(action.provider_id),
      capability: String(action.capability),
      operation: String(action.operation)
    }
  });
  return { approvalId, actionId: input.actionId, fingerprint: input.fingerprint, expiresAt };
}

export type WorkloadIdentityAdminView = {
  credentialId: string;
  issuer: string;
  subject: string;
  audience: string;
  environment: "development" | "staging" | "production";
  workloadType: string;
  status: "active" | "disabled" | "revoked" | "expired";
  expiresAt?: string;
  confirmationKeyBound: boolean;
  grants: Array<{
    id: string;
    capability: z.infer<typeof brokerCapabilitySchema>;
    connectionId?: string;
    environment: "development" | "staging" | "production";
    status: "active" | "disabled" | "revoked" | "expired";
    expiresAt?: string;
  }>;
};

export type ConnectorKillSwitchAdminView = {
  id: string;
  scopeType: "organization" | "environment" | "provider" | "connection" | "capability" | "loop" | "agent";
  scopeValue: string;
  environment?: "development" | "staging" | "production";
  status: "active" | "cleared" | "expired";
  reason: string;
  activatedBy: string;
  activatedAt: string;
  expiresAt?: string;
  clearedBy?: string;
  clearedAt?: string;
};

const providerDetectorTimestampSchema = z.string().datetime({ offset: true });

const providerDetectorRunAdminViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["forwarded", "no_change", "retry", "dead_letter"]),
  attemptCount: z.number().int().min(1).max(100),
  emittedEventCount: z.number().int().min(0).max(500),
  errorCode: z.string().min(1).max(160).optional(),
  windowStart: providerDetectorTimestampSchema,
  windowEnd: providerDetectorTimestampSchema,
  startedAt: providerDetectorTimestampSchema,
  completedAt: providerDetectorTimestampSchema
}).strict();

const providerDetectorScheduleAdminViewSchema = z.object({
  id: z.string().min(8).max(160),
  installationId: z.string().min(1).max(128),
  installationDisplayName: z.string().min(1).max(120),
  installationStatus: z.string().min(1).max(64),
  environment: z.enum(["development", "staging", "production"]),
  providerId: z.enum(["bigquery", "snowflake"]),
  detectorKey: z.string().min(3).max(64),
  operation: z.string().min(3).max(128),
  eventType: z.string().min(3).max(160),
  subjectType: z.string().min(1).max(96),
  cadenceMinutes: z.number().int().min(5).max(1440),
  windowMinutes: z.number().int().min(5).max(525_600),
  overlapMinutes: z.number().int().min(0).max(1440),
  status: z.enum(["active", "paused", "disabled"]),
  runState: z.enum(["idle", "leased", "retry", "dead_letter"]),
  checkpointAt: providerDetectorTimestampSchema.optional(),
  nextRunAt: providerDetectorTimestampSchema,
  availableAt: providerDetectorTimestampSchema,
  leaseUntil: providerDetectorTimestampSchema.optional(),
  attemptCount: z.number().int().min(0).max(100),
  lastErrorCode: z.string().min(1).max(160).optional(),
  lastStartedAt: providerDetectorTimestampSchema.optional(),
  lastCompletedAt: providerDetectorTimestampSchema.optional(),
  blockedByKillSwitch: z.boolean(),
  recentRuns: z.array(providerDetectorRunAdminViewSchema).max(5)
}).strict();

export type ProviderDetectorRunAdminView = z.infer<typeof providerDetectorRunAdminViewSchema>;
export type ProviderDetectorScheduleAdminView = z.infer<typeof providerDetectorScheduleAdminViewSchema>;
export type ProviderDetectorControlAction = "pause" | "resume" | "run_now" | "retry_now";

export class ProviderDetectorControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 404 | 409
  ) {
    super(message);
    this.name = "ProviderDetectorControlError";
  }
}

export async function listProviderDetectorOperations(
  database: WorkspaceDatabase
): Promise<ProviderDetectorScheduleAdminView[]> {
  if (!database.organizationId) return [];
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await connectorControlPlaneClient().rpc("list_provider_detector_operations", {
    p_organization_id: database.organizationId,
    p_project_key: projectKey,
    p_limit: 200
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => providerDetectorScheduleAdminViewSchema.parse({
    id: row.schedule_id,
    installationId: row.installation_id,
    installationDisplayName: row.installation_display_name,
    installationStatus: row.installation_status,
    environment: row.environment,
    providerId: row.provider_id,
    detectorKey: row.detector_key,
    operation: row.operation,
    eventType: row.event_type,
    subjectType: row.subject_type,
    cadenceMinutes: row.cadence_minutes,
    windowMinutes: row.window_minutes,
    overlapMinutes: row.overlap_minutes,
    status: row.schedule_status,
    runState: row.run_state,
    checkpointAt: row.checkpoint_at ?? undefined,
    nextRunAt: row.next_run_at,
    availableAt: row.available_at,
    leaseUntil: row.lease_until ?? undefined,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code ?? undefined,
    lastStartedAt: row.last_started_at ?? undefined,
    lastCompletedAt: row.last_completed_at ?? undefined,
    blockedByKillSwitch: row.blocked_by_kill_switch,
    recentRuns: row.recent_runs ?? []
  }));
}

export async function controlProviderDetectorSchedule(input: {
  database: WorkspaceDatabase;
  scheduleId: string;
  action: ProviderDetectorControlAction;
  reason: string;
}) {
  if (!input.database.organizationId || !input.database.userId) {
    throw new ProviderDetectorControlError("storage_unavailable", "Hosted detector operations are unavailable.", 409);
  }
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await connectorControlPlaneClient().rpc("control_provider_detector_schedule", {
    p_organization_id: input.database.organizationId,
    p_project_key: projectKey,
    p_schedule_id: input.scheduleId,
    p_action: input.action,
    p_actor_id: input.database.userId,
    p_reason: input.reason,
    p_now: new Date().toISOString()
  });
  if (error) throw error;
  const result = String(data ?? "missing");
  const failure = detectorControlFailure(result);
  if (failure) throw failure;
  const schedule = (await listProviderDetectorOperations(input.database)).find((item) => item.id === input.scheduleId);
  if (!schedule) throw new ProviderDetectorControlError("missing", "Detector schedule was not found.", 404);
  return { result, schedule };
}

function detectorControlFailure(result: string): ProviderDetectorControlError | undefined {
  const failures: Record<string, [string, string, 404 | 409]> = {
    missing: ["missing", "Detector schedule was not found.", 404],
    connector_inactive: ["connector_inactive", "Reconnect the provider and grant event emission before changing this detector.", 409],
    blocked_by_kill_switch: ["blocked_by_kill_switch", "An active connector kill switch blocks this detector.", 409],
    schedule_paused: ["schedule_paused", "Resume this detector before scheduling a run.", 409],
    already_running: ["already_running", "This detector already has a leased run.", 409],
    retry_pending: ["retry_pending", "This detector already has a retry pending.", 409],
    requires_retry: ["requires_retry", "Use Retry now to recover this dead-lettered detector.", 409],
    not_dead_lettered: ["not_dead_lettered", "Only a dead-lettered detector can be retried manually.", 409],
    retry_window_missing: ["retry_window_missing", "The failed detector window is unavailable and cannot be retried safely.", 409]
  };
  const entry = failures[result];
  return entry ? new ProviderDetectorControlError(...entry) : undefined;
}

export async function listWorkloadIdentities(database: WorkspaceDatabase): Promise<WorkloadIdentityAdminView[]> {
  if (!database.organizationId) return [];
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const client = connectorControlPlaneClient();
  const [{ data: principals, error: principalError }, { data: grants, error: grantError }] = await Promise.all([
    client.from("workload_principals").select("credential_id,issuer,subject,audience,environment,workload_type,status,expires_at,confirmation_key_thumbprint")
      .eq("organization_id", database.organizationId).eq("project_key", projectKey).order("created_at", { ascending: false }),
    client.from("workload_capability_grants").select("id,credential_id,capability,connection_id,environment,status,expires_at")
      .eq("organization_id", database.organizationId).eq("project_key", projectKey).order("created_at", { ascending: false })
  ]);
  if (principalError) throw principalError;
  if (grantError) throw grantError;
  return (principals ?? []).map((principal) => ({
    credentialId: String(principal.credential_id),
    issuer: String(principal.issuer),
    subject: String(principal.subject),
    audience: String(principal.audience),
    environment: principal.environment as WorkloadIdentityAdminView["environment"],
    workloadType: String(principal.workload_type),
    status: principal.status as WorkloadIdentityAdminView["status"],
    expiresAt: principal.expires_at ? String(principal.expires_at) : undefined,
    confirmationKeyBound: Boolean(principal.confirmation_key_thumbprint),
    grants: (grants ?? []).filter((grant) => grant.credential_id === principal.credential_id).map((grant) => ({
      id: String(grant.id),
      capability: brokerCapabilitySchema.parse(grant.capability),
      connectionId: grant.connection_id ? String(grant.connection_id) : undefined,
      environment: grant.environment as WorkloadIdentityAdminView["environment"],
      status: grant.status as WorkloadIdentityAdminView["status"],
      expiresAt: grant.expires_at ? String(grant.expires_at) : undefined
    }))
  }));
}

export async function upsertWorkloadIdentityGrant(input: {
  database: WorkspaceDatabase;
  credentialId: string;
  issuer: string;
  subject: string;
  audience: string;
  environment: "development" | "staging" | "production";
  workloadType: string;
  capability: z.infer<typeof brokerCapabilitySchema>;
  connectionId?: string;
  expiresAt?: string;
  confirmationKeyThumbprint?: string;
  reason: string;
}) {
  if (!input.database.organizationId || !input.database.userId) throw new Error("Hosted connector storage is unavailable");
  const organizationId = input.database.organizationId;
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const now = new Date().toISOString();
  const client = connectorControlPlaneClient();
  const { error: principalError } = await client.from("workload_principals").upsert({
    organization_id: organizationId,
    project_key: projectKey,
    credential_id: input.credentialId,
    issuer: input.issuer,
    subject: input.subject,
    audience: input.audience,
    environment: input.environment,
    workload_type: input.workloadType,
    status: "active",
    expires_at: input.expiresAt ?? null,
    confirmation_key_thumbprint: input.confirmationKeyThumbprint ?? null,
    updated_at: now
  }, { onConflict: "organization_id,project_key,credential_id" });
  if (principalError) throw principalError;
  const { error: grantError } = await client.from("workload_capability_grants").upsert({
    organization_id: organizationId,
    project_key: projectKey,
    credential_id: input.credentialId,
    capability: input.capability,
    connection_id: input.connectionId ?? null,
    environment: input.environment,
    status: "active",
    expires_at: input.expiresAt ?? null,
    granted_by: input.database.userId,
    reason: input.reason,
    updated_at: now
  }, { onConflict: "organization_id,project_key,credential_id,capability,connection_id,environment" });
  if (grantError) throw grantError;
  await appendConnectorAdminAudit({
    organizationId,
    projectKey,
    eventType: "workload_grant.changed",
    outcome: "accepted",
    actorId: input.database.userId,
    correlationId: `workload_grant_${randomUUID()}`,
    resourceType: "workload_principal",
    resourceId: input.credentialId,
    metadata: { capability: input.capability, environment: input.environment, connectionBound: Boolean(input.connectionId) }
  });
}

export async function revokeWorkloadIdentity(input: {
  database: WorkspaceDatabase;
  credentialId: string;
  reason: string;
}) {
  if (!input.database.organizationId || !input.database.userId) throw new Error("Hosted connector storage is unavailable");
  const organizationId = input.database.organizationId;
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const now = new Date().toISOString();
  const client = connectorControlPlaneClient();
  const [{ error: principalError }, { error: grantError }] = await Promise.all([
    client.from("workload_principals").update({ status: "revoked", updated_at: now })
      .eq("organization_id", organizationId).eq("project_key", projectKey).eq("credential_id", input.credentialId),
    client.from("workload_capability_grants").update({ status: "revoked", updated_at: now })
      .eq("organization_id", organizationId).eq("project_key", projectKey).eq("credential_id", input.credentialId)
  ]);
  if (principalError) throw principalError;
  if (grantError) throw grantError;
  await appendConnectorAdminAudit({
    organizationId,
    projectKey,
    eventType: "workload_grant.changed",
    outcome: "accepted",
    actorId: input.database.userId,
    correlationId: `workload_revoke_${randomUUID()}`,
    resourceType: "workload_principal",
    resourceId: input.credentialId,
    metadata: { status: "revoked", reasonRecorded: Boolean(input.reason) }
  });
}

export async function listConnectorKillSwitches(database: WorkspaceDatabase): Promise<ConnectorKillSwitchAdminView[]> {
  if (!database.organizationId) return [];
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const { data, error } = await connectorControlPlaneClient().from("connector_kill_switches")
    .select("id,scope_type,scope_value,environment,status,reason,activated_by,activated_at,expires_at,cleared_by,cleared_at")
    .eq("organization_id", database.organizationId).eq("project_key", projectKey)
    .order("activated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item) => ({
    id: String(item.id),
    scopeType: item.scope_type as ConnectorKillSwitchAdminView["scopeType"],
    scopeValue: String(item.scope_value),
    environment: item.environment ? item.environment as ConnectorKillSwitchAdminView["environment"] : undefined,
    status: item.status as ConnectorKillSwitchAdminView["status"],
    reason: String(item.reason),
    activatedBy: String(item.activated_by),
    activatedAt: String(item.activated_at),
    expiresAt: item.expires_at ? String(item.expires_at) : undefined,
    clearedBy: item.cleared_by ? String(item.cleared_by) : undefined,
    clearedAt: item.cleared_at ? String(item.cleared_at) : undefined
  }));
}

export async function setConnectorKillSwitch(input: {
  database: WorkspaceDatabase;
  scopeType: ConnectorKillSwitchAdminView["scopeType"];
  scopeValue: string;
  environment?: ConnectorKillSwitchAdminView["environment"];
  reason: string;
  expiresAt?: string;
}) {
  if (!input.database.organizationId || !input.database.userId) throw new Error("Hosted connector storage is unavailable");
  const organizationId = input.database.organizationId;
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const scopeValue = input.scopeType === "organization" ? organizationId : input.scopeValue;
  const client = connectorControlPlaneClient();
  if (input.scopeType === "connection") {
    const { count, error } = await client.from("connector_installations").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("project_key", projectKey).eq("id", scopeValue);
    if (error) throw error;
    if (count !== 1) throw new Error("Connector installation was not found");
  }
  const { data, error } = await client.from("connector_kill_switches").upsert({
    organization_id: organizationId,
    project_key: projectKey,
    scope_type: input.scopeType,
    scope_value: scopeValue,
    environment: input.environment ?? null,
    status: "active",
    reason: input.reason,
    activated_by: input.database.userId,
    activated_at: new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    cleared_by: null,
    cleared_at: null
  }, { onConflict: "organization_id,project_key,scope_type,scope_value,environment" }).select("id").single();
  if (error) throw error;
  await appendConnectorAdminAudit({
    organizationId,
    projectKey,
    eventType: "connector.kill_switch.activated",
    outcome: "accepted",
    actorId: input.database.userId,
    correlationId: `connector_kill_${randomUUID()}`,
    resourceType: "connector_kill_switch",
    resourceId: String(data.id),
    metadata: { scopeType: input.scopeType, scopeValue, environment: input.environment ?? "all" }
  });
  return String(data.id);
}

export async function clearConnectorKillSwitch(input: {
  database: WorkspaceDatabase;
  id: string;
  reason: string;
}) {
  if (!input.database.organizationId || !input.database.userId) throw new Error("Hosted connector storage is unavailable");
  const organizationId = input.database.organizationId;
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const now = new Date().toISOString();
  const { data, error } = await connectorControlPlaneClient().from("connector_kill_switches").update({
    status: "cleared",
    cleared_by: input.database.userId,
    cleared_at: now
  }).eq("organization_id", organizationId).eq("project_key", projectKey).eq("id", input.id).eq("status", "active")
    .select("id,scope_type,scope_value").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Active kill switch was not found");
  await appendConnectorAdminAudit({
    organizationId,
    projectKey,
    eventType: "connector.kill_switch.cleared",
    outcome: "accepted",
    actorId: input.database.userId,
    correlationId: `connector_kill_clear_${randomUUID()}`,
    resourceType: "connector_kill_switch",
    resourceId: input.id,
    metadata: { scopeType: String(data.scope_type), scopeValue: String(data.scope_value), reasonRecorded: Boolean(input.reason) }
  });
}

function mapInstallation(row: Record<string, unknown>): ConnectorInstallationAdmin {
  return connectorInstallationAdminSchema.parse({
    id: row.id,
    tenant: { organizationId: row.organization_id, projectKey: row.project_key },
    providerId: row.provider_id as ProviderId,
    displayName: row.display_name,
    environment: row.environment ?? "development",
    status: row.status,
    credentialRef: row.credential_ref,
    credentialNamespace: row.credential_namespace,
    grantedScopes: row.granted_scopes ?? [],
    allowedCapabilities: row.allowed_capabilities ?? [],
    customerManagedKeyRef: row.customer_managed_key_ref ?? undefined,
    webhookSecretRef: row.webhook_secret_ref ?? undefined,
    webhookSecretPreviousRef: row.webhook_secret_previous_ref ?? undefined,
    providerSubscriptionId: row.provider_subscription_id ?? undefined,
    webhookStatus: row.webhook_status ?? "not_configured",
    connectedBy: row.connected_by ?? undefined,
    connectedAt: row.connected_at ?? undefined,
    lastHealthCheckAt: row.last_health_check_at ?? undefined,
    lastRotatedAt: row.last_rotated_at ?? undefined,
    tokenExpiresAt: row.token_expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function connectorControlPlaneClient() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("Connector control-plane storage is unavailable");
  return client;
}
