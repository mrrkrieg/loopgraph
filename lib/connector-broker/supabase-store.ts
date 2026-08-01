import "server-only";

import type {
  ConnectorAuditReceipt,
  ConnectorBrokerResponse,
  ConnectorInstallationAdmin,
  ConnectorPreparedAction,
  ProviderId
} from "loopgraph/core";
import { connectorInstallationAdminSchema, connectorPreparedActionSchema } from "loopgraph/core";
import type {
  ConnectorAuditSink,
  ConnectorAccessPolicy,
  ConnectorApprovalVerifier,
  ConnectorIdempotencyStore,
  ConnectorInstallationStore,
  ConnectorPreparedActionStore,
  OAuthLifecycleAudit,
  OAuthLifecycleStore,
  OAuthTransaction,
  WebhookReplayStore
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export class SupabaseConnectorBrokerStore implements
  ConnectorInstallationStore,
  ConnectorIdempotencyStore,
  ConnectorAuditSink,
  ConnectorApprovalVerifier,
  ConnectorAccessPolicy,
  ConnectorPreparedActionStore,
  OAuthLifecycleStore,
  WebhookReplayStore {
  constructor(private readonly client: AdminClient) {}

  static fromEnvironment() {
    const client = createSupabaseAdminClient();
    if (!client) throw new Error("Supabase service storage is required by the connector broker");
    return new SupabaseConnectorBrokerStore(client);
  }

  async get(input: { organizationId: string; projectKey: string; installationId: string }) {
    return this.getInstallation(input);
  }

  async save(installation: ConnectorInstallationAdmin) {
    return this.saveInstallation(installation);
  }

  async getInstallation(input: { organizationId: string; projectKey: string; installationId: string }) {
    const { data, error } = await this.client.from("connector_installations")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("id", input.installationId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapInstallation(data) : undefined;
  }

  async findInstallationGlobal(input: { installationId: string; providerId?: ProviderId }) {
    let query = this.client.from("connector_installations").select("*").eq("id", input.installationId);
    if (input.providerId) query = query.eq("provider_id", input.providerId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data ? mapInstallation(data) : undefined;
  }

  async saveInstallation(installation: ConnectorInstallationAdmin) {
    const { error } = await this.client.from("connector_installations").upsert(installationRow(installation), {
      onConflict: "organization_id,project_key,id"
    });
    if (error) throw error;
  }

  async recordCredentialNamespace(installation: ConnectorInstallationAdmin) {
    const { error } = await this.client.from("credential_namespaces").upsert({
      organization_id: installation.tenant.organizationId,
      project_key: installation.tenant.projectKey,
      namespace: installation.credentialNamespace,
      provider_id: installation.providerId,
      installation_id: installation.id,
      environment: installation.environment,
      customer_managed_key_ref: installation.customerManagedKeyRef ?? null,
      status: "active",
      updated_at: installation.updatedAt
    }, { onConflict: "organization_id,project_key,installation_id" });
    if (error) throw error;
    if (installation.customerManagedKeyRef) {
      const { error: keyError } = await this.client.from("tenant_key_bindings").upsert({
        organization_id: installation.tenant.organizationId,
        project_key: installation.tenant.projectKey,
        environment: installation.environment,
        key_provider: installation.customerManagedKeyRef.slice(0, installation.customerManagedKeyRef.indexOf("://")),
        key_reference: installation.customerManagedKeyRef,
        provider_id: installation.providerId,
        status: "active",
        bound_by: installation.connectedBy ?? "system:connector-onboarding",
        verified_at: installation.lastHealthCheckAt ?? null
      }, { onConflict: "organization_id,project_key,environment,provider_id" });
      if (keyError) throw keyError;
    }
  }

  async recordCredentialVersion(input: {
    installation: ConnectorInstallationAdmin;
    lifecycleEvent: "connected" | "refreshed" | "rotated" | "recovered";
    actorId: string;
  }) {
    const { installation } = input;
    const { data, error } = await this.client.rpc("record_provider_credential_version", {
      p_organization_id: installation.tenant.organizationId,
      p_project_key: installation.tenant.projectKey,
      p_installation_id: installation.id,
      p_credential_ref: installation.credentialRef,
      p_lifecycle_event: input.lifecycleEvent,
      p_granted_scopes: installation.grantedScopes,
      p_token_expires_at: installation.tokenExpiresAt ?? null,
      p_created_by: input.actorId,
      p_now: installation.updatedAt
    });
    if (error) throw error;
    return Number(data);
  }

  async activateCredentialVersion(input: {
    installation: ConnectorInstallationAdmin;
    lifecycleEvent: "connected" | "refreshed" | "rotated" | "recovered";
    actorId: string;
  }) {
    const { installation } = input;
    const { data, error } = await this.client.rpc("activate_provider_credential_version", {
      p_organization_id: installation.tenant.organizationId,
      p_project_key: installation.tenant.projectKey,
      p_installation_id: installation.id,
      p_credential_ref: installation.credentialRef,
      p_lifecycle_event: input.lifecycleEvent,
      p_status: installation.status,
      p_granted_scopes: installation.grantedScopes,
      p_allowed_capabilities: installation.allowedCapabilities,
      p_connected_by: installation.connectedBy ?? null,
      p_connected_at: installation.connectedAt ?? null,
      p_last_rotated_at: installation.lastRotatedAt ?? null,
      p_token_expires_at: installation.tokenExpiresAt ?? null,
      p_created_by: input.actorId,
      p_now: installation.updatedAt
    });
    if (error) throw error;
    return Number(data);
  }

  async revokeCredentialVersions(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    revokedAt: string;
  }) {
    const { error } = await this.client.from("provider_credential_versions").update({
      status: "revoked",
      revoked_at: input.revokedAt
    }).eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("installation_id", input.installationId)
      .neq("status", "revoked");
    if (error) throw error;
  }

  async getResponse(input: { organizationId: string; projectKey: string; idempotencyKey: string }) {
    const { data, error } = await this.client.from("connector_operation_receipts")
      .select("response")
      .eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    return data?.response as ConnectorBrokerResponse | undefined;
  }

  async reserve(input: {
    organizationId: string;
    projectKey: string;
    idempotencyKey: string;
    requestHash: string;
    leaseUntil: string;
  }) {
    const { data, error } = await this.client.rpc("claim_connector_idempotency", {
      p_organization_id: input.organizationId,
      p_project_key: input.projectKey,
      p_idempotency_key: input.idempotencyKey,
      p_request_hash: input.requestHash,
      p_lease_until: input.leaseUntil
    });
    if (error) throw error;
    if (data !== "claimed" && data !== "busy" && data !== "conflict") {
      throw new Error("Connector idempotency guard returned an invalid decision");
    }
    return data;
  }

  async putResponse(input: {
    organizationId: string;
    projectKey: string;
    idempotencyKey: string;
    response: ConnectorBrokerResponse;
  }) {
    const receipt = input.response.receipt;
    const { error } = await this.client.from("connector_operation_receipts").upsert({
      organization_id: input.organizationId,
      project_key: input.projectKey,
      installation_id: receipt.installationId,
      provider_id: receipt.providerId,
      request_id: receipt.requestId,
      idempotency_key: input.idempotencyKey,
      correlation_id: receipt.correlationId,
      capability: receipt.capability,
      operation: receipt.operation,
      actor_subject: receipt.actorSubject,
      actor_type: receipt.actorType,
      context_hash: receipt.contextHash ?? null,
      environment: receipt.environment ?? null,
      workspace_id: receipt.workspaceId ?? null,
      agent_instance_id: receipt.agentInstanceId ?? null,
      company_object_type: receipt.companyObjectType ?? null,
      company_object_id: receipt.companyObjectId ?? null,
      loop_id: receipt.loopId ?? null,
      loop_spec_hash: receipt.loopSpecHash ?? null,
      route_job_id: receipt.routeJobId ?? null,
      activation_mode: receipt.activationMode ?? null,
      outcome: receipt.outcome,
      reason_code: receipt.reasonCode ?? null,
      input_hash: receipt.inputHash,
      output_hash: receipt.outputHash ?? null,
      response: input.response,
      occurred_at: receipt.occurredAt
    }, { onConflict: "organization_id,project_key,idempotency_key", ignoreDuplicates: true });
    if (error) throw error;
    const { error: completionError } = await this.client.from("connector_idempotency_claims").update({
      status: "completed",
      completed_at: receipt.occurredAt,
      updated_at: receipt.occurredAt
    }).eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("idempotency_key", input.idempotencyKey);
    if (completionError) throw completionError;
  }

  async append(receipt: ConnectorAuditReceipt) {
    const { error } = await this.client.from("credential_access_receipts").insert({
      organization_id: receipt.organizationId,
      project_key: receipt.projectKey,
      installation_id: receipt.installationId,
      actor_type: receipt.actorType,
      actor_id: receipt.actorSubject,
      capability: receipt.capability,
      operation: receipt.operation,
      environment: receipt.environment ?? null,
      company_object_type: receipt.companyObjectType ?? null,
      company_object_id: receipt.companyObjectId ?? null,
      loop_id: receipt.loopId ?? null,
      route_job_id: receipt.routeJobId ?? null,
      decision: receipt.outcome,
      reason_code: receipt.reasonCode ?? null,
      correlation_id: receipt.correlationId,
      occurred_at: receipt.occurredAt
    });
    if (error) throw error;
    await this.appendAudit({
      eventType: `connector.operation.${receipt.outcome}`,
      outcome: receipt.outcome,
      tenant: { organizationId: receipt.organizationId, projectKey: receipt.projectKey },
      installationId: receipt.installationId,
      providerId: receipt.providerId,
      actorId: receipt.actorSubject,
      correlationId: receipt.correlationId,
      reasonCode: receipt.reasonCode
    });
  }

  async savePrepared(action: ConnectorPreparedAction) {
    const { error } = await this.client.from("connector_prepared_actions").insert({
      organization_id: action.tenant.organizationId,
      project_key: action.tenant.projectKey,
      action_id: action.actionId,
      provider_id: action.providerId,
      installation_id: action.installationId,
      capability: action.capability,
      operation: action.operation,
      invocation_context: action.context,
      canonical_input: action.canonicalInput,
      fingerprint: action.fingerprint,
      prepared_by: action.preparedBy,
      prepared_at: action.preparedAt,
      expires_at: action.expiresAt,
      status: action.status,
      approval_required: action.approvalRequired,
      risk_class: action.riskClass
    });
    if (error) throw error;
  }

  async getPrepared(input: { organizationId: string; projectKey: string; actionId: string }) {
    const { data, error } = await this.client.from("connector_prepared_actions")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("action_id", input.actionId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPreparedAction(data) : undefined;
  }

  async claimCommit(input: { organizationId: string; projectKey: string; actionId: string; fingerprint: string; now: string }) {
    const { data, error } = await this.client.rpc("claim_connector_prepared_action", {
      p_organization_id: input.organizationId,
      p_project_key: input.projectKey,
      p_action_id: input.actionId,
      p_fingerprint: input.fingerprint,
      p_now: input.now
    });
    if (error) throw error;
    if (!["claimed", "busy", "completed", "expired", "mismatch", "missing"].includes(String(data))) {
      throw new Error("Prepared-action guard returned an invalid decision");
    }
    return data as "claimed" | "busy" | "completed" | "expired" | "mismatch" | "missing";
  }

  async finishCommit(input: {
    organizationId: string;
    projectKey: string;
    actionId: string;
    status: "prepared" | "committed" | "revoked";
    committedAt?: string;
  }) {
    const expectedStatus = input.status === "revoked" ? "prepared" : "committing";
    const { error } = await this.client.from("connector_prepared_actions").update({
      status: input.status,
      committed_at: input.committedAt ?? null
    }).eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("action_id", input.actionId)
      .eq("status", expectedStatus);
    if (error) throw error;
  }

  async verify(input: {
    organizationId: string;
    projectKey: string;
    preparedActionId: string;
    preparedActionFingerprint: string;
    approvalReceiptId: string;
  }) {
    const { data, error } = await this.client.rpc("consume_connector_action_approval", {
      p_organization_id: input.organizationId,
      p_project_key: input.projectKey,
      p_approval_id: input.approvalReceiptId,
      p_action_id: input.preparedActionId,
      p_fingerprint: input.preparedActionFingerprint,
      p_now: new Date().toISOString()
    });
    if (error) throw error;
    return data === true;
  }

  async evaluate(input: {
    organizationId: string;
    projectKey: string;
    environment: "development" | "staging" | "production";
    providerId: string;
    connectionId: string;
    capability: string;
    loopId?: string;
    agentId?: string;
  }) {
    const { data, error } = await this.client.rpc("evaluate_connector_kill_switch", {
      p_organization_id: input.organizationId,
      p_project_key: input.projectKey,
      p_environment: input.environment,
      p_provider_id: input.providerId,
      p_connection_id: input.connectionId,
      p_capability: input.capability,
      p_loop_id: input.loopId ?? "",
      p_agent_id: input.agentId ?? "",
      p_now: new Date().toISOString()
    });
    if (error) throw error;
    return data ? { allowed: false, reason: String(data) } : { allowed: true };
  }

  readonly appendOAuthAudit: OAuthLifecycleAudit = async (event) => this.appendAudit(event);

  async saveTransaction(transaction: OAuthTransaction) {
    const { error } = await this.client.from("connector_oauth_transactions").insert({
      id: transaction.id,
      organization_id: transaction.tenant.organizationId,
      project_key: transaction.tenant.projectKey,
      installation_id: transaction.installationId,
      provider_id: transaction.providerId,
      state_hash: transaction.stateHash,
      verifier_ref: transaction.verifierRef ?? null,
      requested_scopes: transaction.requestedScopes,
      expires_at: transaction.expiresAt,
      consumed_at: transaction.consumedAt ?? null,
      created_at: transaction.createdAt
    });
    if (error) throw error;
  }

  async findTransactionByStateHash(input: { organizationId: string; projectKey: string; stateHash: string }) {
    const { data, error } = await this.client.from("connector_oauth_transactions")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("state_hash", input.stateHash)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTransaction(data) : undefined;
  }

  async findTransactionByStateHashGlobal(stateHash: string) {
    const { data, error } = await this.client.from("connector_oauth_transactions")
      .select("*")
      .eq("state_hash", stateHash)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTransaction(data) : undefined;
  }

  async consumeTransaction(input: { organizationId: string; projectKey: string; transactionId: string; consumedAt: string }) {
    const { data, error } = await this.client.rpc("consume_connector_oauth_transaction", {
      p_organization_id: input.organizationId,
      p_project_key: input.projectKey,
      p_transaction_id: input.transactionId,
      p_consumed_at: input.consumedAt
    });
    if (error) throw error;
    return data === true;
  }

  async listRefreshDue(input: { before: string; limit: number }) {
    const { data, error } = await this.client.rpc("claim_connector_refresh_due", {
      p_before: input.before,
      p_limit: input.limit,
      p_now: new Date().toISOString()
    });
    if (error) throw error;
    return (data ?? []).map(mapInstallation);
  }

  async claim(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: ProviderId;
    deliveryId: string;
    bodyHash: string;
    expiresAt: string;
  }) {
    const { data, error } = await this.client.rpc("claim_provider_webhook_delivery", {
      p_organization_id: input.organizationId,
      p_project_key: input.projectKey,
      p_installation_id: input.installationId,
      p_provider_id: input.providerId,
      p_delivery_id: input.deliveryId,
      p_body_hash: input.bodyHash,
      p_expires_at: input.expiresAt
    });
    if (error) throw error;
    return data === true;
  }

  async markWebhookDelivery(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: ProviderId;
    deliveryId: string;
    status: "queued" | "forwarded" | "failed";
    errorCode?: string;
  }) {
    const now = new Date().toISOString();
    const { error } = await this.client.from("provider_webhook_deliveries").update({
      status: input.status,
      forwarded_at: input.status === "forwarded" ? now : null,
      leased_until: now,
      last_error_code: input.errorCode ?? null
    }).eq("organization_id", input.organizationId)
      .eq("project_key", input.projectKey)
      .eq("installation_id", input.installationId)
      .eq("provider_id", input.providerId)
      .eq("delivery_id", input.deliveryId)
      .eq("status", "claimed");
    if (error) throw error;
  }

  async enqueueVerifiedWebhook(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: ProviderId;
    deliveryId: string;
    rawBody: string;
    verificationReceipt: Record<string, unknown>;
  }) {
    const { error } = await this.client.from("provider_webhook_inbox").upsert({
      organization_id: input.organizationId,
      project_key: input.projectKey,
      installation_id: input.installationId,
      provider_id: input.providerId,
      delivery_id: input.deliveryId,
      raw_body_base64: Buffer.from(input.rawBody, "utf8").toString("base64"),
      verification_receipt: input.verificationReceipt,
      status: "queued",
      attempt_count: 0,
      available_at: new Date().toISOString(),
      leased_until: null,
      last_error_code: null,
      forwarded_at: null
    }, { onConflict: "organization_id,project_key,installation_id,provider_id,delivery_id" });
    if (error) throw error;
  }

  private async appendAudit(event: {
    eventType: string;
    outcome: "accepted" | "denied" | "error";
    tenant: { organizationId: string; projectKey: string };
    installationId: string;
    providerId: ProviderId;
    actorId: string;
    correlationId: string;
    reasonCode?: string;
  }) {
    const { error } = await this.client.rpc("append_connector_security_audit_event", {
      p_organization_id: event.tenant.organizationId,
      p_project_key: event.tenant.projectKey,
      p_event_type: event.eventType,
      p_outcome: event.outcome,
      p_actor_type: event.actorId.startsWith("system:") ? "system" : "machine",
      p_actor_id: event.actorId,
      p_correlation_id: event.correlationId,
      p_resource_type: "connector_installation",
      p_resource_id: event.installationId,
      p_metadata: { providerId: event.providerId, ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}) }
    });
    if (error) throw error;
  }
}

function installationRow(installation: ConnectorInstallationAdmin) {
  return {
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
  };
}

function mapInstallation(row: Record<string, unknown>) {
  return connectorInstallationAdminSchema.parse({
    id: row.id,
    tenant: { organizationId: row.organization_id, projectKey: row.project_key },
    providerId: row.provider_id,
    displayName: row.display_name,
    environment: row.environment ?? "development",
    status: row.status,
    credentialRef: row.credential_ref,
    credentialNamespace: row.credential_namespace,
    customerManagedKeyRef: row.customer_managed_key_ref ?? undefined,
    webhookSecretRef: row.webhook_secret_ref ?? undefined,
    webhookSecretPreviousRef: row.webhook_secret_previous_ref ?? undefined,
    providerSubscriptionId: row.provider_subscription_id ?? undefined,
    webhookStatus: row.webhook_status ?? "not_configured",
    grantedScopes: row.granted_scopes ?? [],
    allowedCapabilities: row.allowed_capabilities ?? [],
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

function mapTransaction(row: Record<string, unknown>): OAuthTransaction {
  return {
    id: String(row.id),
    installationId: String(row.installation_id),
    tenant: { organizationId: String(row.organization_id), projectKey: String(row.project_key) },
    providerId: row.provider_id as ProviderId,
    stateHash: String(row.state_hash),
    verifierRef: row.verifier_ref ? String(row.verifier_ref) : undefined,
    requestedScopes: Array.isArray(row.requested_scopes) ? row.requested_scopes.map(String) : [],
    expiresAt: String(row.expires_at),
    consumedAt: row.consumed_at ? String(row.consumed_at) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapPreparedAction(row: Record<string, unknown>) {
  return connectorPreparedActionSchema.parse({
    schemaVersion: "connector-prepared-action/v1",
    actionId: row.action_id,
    tenant: { organizationId: row.organization_id, projectKey: row.project_key },
    providerId: row.provider_id,
    installationId: row.installation_id,
    capability: row.capability,
    operation: row.operation,
    context: row.invocation_context,
    canonicalInput: row.canonical_input,
    fingerprint: row.fingerprint,
    preparedBy: row.prepared_by,
    preparedAt: row.prepared_at,
    expiresAt: row.expires_at,
    status: row.status,
    approvalRequired: row.approval_required,
    riskClass: row.risk_class
  });
}
