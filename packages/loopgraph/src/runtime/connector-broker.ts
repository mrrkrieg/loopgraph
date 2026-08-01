import { createHash, randomUUID } from "node:crypto";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  CONNECTOR_PREPARED_ACTION_VERSION,
  connectorActionCommitRequestSchema,
  connectorActionPrepareRequestSchema,
  connectorActionPrepareResponseSchema,
  connectorInstallationHasExpectedNamespace,
  connectorBrokerRequestSchema,
  connectorBrokerResponseSchema,
  type ConnectorAuditReceipt,
  type ConnectorActionCommitRequest,
  type ConnectorActionPrepareRequest,
  type ConnectorActionPrepareResponse,
  type ConnectorBrokerRequest,
  type ConnectorBrokerResponse,
  type ConnectorInstallationAdmin,
  type ConnectorPreparedAction
} from "../core";
import { getProviderOperation, type ProviderOperationDescriptor } from "./connector-capabilities";
import { assertSecretFree, redactSensitiveString } from "./secret-redaction";
import type { CompositeVault, SecretLease } from "./vault-adapters";

export interface ConnectorInstallationStore {
  get(input: { organizationId: string; projectKey: string; installationId: string }): Promise<ConnectorInstallationAdmin | undefined>;
  save(installation: ConnectorInstallationAdmin): Promise<void>;
}

export interface ConnectorIdempotencyStore {
  getResponse(input: { organizationId: string; projectKey: string; idempotencyKey: string }): Promise<ConnectorBrokerResponse | undefined>;
  reserve(input: {
    organizationId: string;
    projectKey: string;
    idempotencyKey: string;
    requestHash: string;
    leaseUntil: string;
  }): Promise<"claimed" | "busy" | "conflict">;
  putResponse(input: { organizationId: string; projectKey: string; idempotencyKey: string; response: ConnectorBrokerResponse }): Promise<void>;
}

export interface ConnectorAuditSink {
  append(receipt: ConnectorAuditReceipt): Promise<void>;
}

export interface ConnectorApprovalVerifier {
  verify(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: string;
    capability: string;
    operation: string;
    approvalReceiptId: string;
    preparedActionId: string;
    preparedActionFingerprint: string;
    actorSubject: string;
  }): Promise<boolean>;
}

export interface ConnectorPreparedActionStore {
  savePrepared(action: ConnectorPreparedAction): Promise<void>;
  getPrepared(input: { organizationId: string; projectKey: string; actionId: string }): Promise<ConnectorPreparedAction | undefined>;
  claimCommit(input: {
    organizationId: string;
    projectKey: string;
    actionId: string;
    fingerprint: string;
    now: string;
  }): Promise<"claimed" | "busy" | "completed" | "expired" | "mismatch" | "missing">;
  finishCommit(input: {
    organizationId: string;
    projectKey: string;
    actionId: string;
    status: "prepared" | "committed" | "revoked";
    committedAt?: string;
  }): Promise<void>;
}

export interface ConnectorAccessPolicy {
  evaluate(input: {
    organizationId: string;
    projectKey: string;
    environment: "development" | "staging" | "production";
    providerId: string;
    connectionId: string;
    capability: string;
    loopId?: string;
    agentId?: string;
  }): Promise<{ allowed: boolean; reason?: string }>;
}

export type ConnectorOperationContext = {
  request: ConnectorBrokerRequest;
  installation: ConnectorInstallationAdmin;
  descriptor: ProviderOperationDescriptor;
  getCredential: () => Promise<SecretLease>;
};

export type ConnectorOperationHandler = (context: ConnectorOperationContext) => Promise<Record<string, unknown>>;

export class HermesConnectorBroker {
  constructor(private readonly dependencies: {
    installations: ConnectorInstallationStore;
    idempotency: ConnectorIdempotencyStore;
    audit: ConnectorAuditSink;
    approvals?: ConnectorApprovalVerifier;
    preparedActions?: ConnectorPreparedActionStore;
    accessPolicy?: ConnectorAccessPolicy;
    vault: CompositeVault;
    handlers: ReadonlyMap<string, ConnectorOperationHandler>;
    defaultEnvironment?: "development" | "staging" | "production";
    now?: () => Date;
  }) {}

  async execute(rawRequest: unknown): Promise<ConnectorBrokerResponse> {
    const started = this.now().getTime();
    let request: ConnectorBrokerRequest;
    try {
      request = connectorBrokerRequestSchema.parse(rawRequest);
    } catch {
      throw new ConnectorBrokerError("invalid_request", "Connector request does not match the broker protocol.", false);
    }
    const now = this.now().getTime();
    if (Date.parse(request.issuedAt) > now + 30_000 || Date.parse(request.expiresAt) < now) {
      return this.failure(request, started, "denied", "request_expired", "Connector request is expired or not active.");
    }
    const duplicate = await this.dependencies.idempotency.getResponse({ ...request.tenant, idempotencyKey: request.idempotencyKey });
    if (duplicate) {
      if (!responseMatchesRequest(duplicate, request)) {
        const response = this.failure(request, started, "denied", "idempotency_conflict", "Idempotency key was already used for a different connector request.");
        await this.dependencies.audit.append(response.receipt);
        return response;
      }
      return duplicate;
    }

    const installation = await this.dependencies.installations.get({
      ...request.tenant,
      installationId: request.installationId
    });
    if (!installation || installation.providerId !== request.providerId ||
      installation.tenant.organizationId !== request.tenant.organizationId ||
      installation.tenant.projectKey !== request.tenant.projectKey) {
      return this.persistFailure(request, started, "denied", "installation_not_found", "Connector installation is unavailable.");
    }
    if (!connectorInstallationHasExpectedNamespace(installation)) {
      return this.persistFailure(request, started, "denied", "credential_namespace_invalid", "Connector credential namespace is invalid.");
    }
    if (request.context && request.context.environment !== installation.environment) {
      return this.persistFailure(request, started, "denied", "environment_scope_mismatch", "Connector invocation environment does not match the connection.");
    }
    if (["disabling", "locally_disabled", "provider_revocation_pending", "subscriptions_removing", "revoked", "revoking", "deletion_pending", "deleted", "disconnected", "failed"].includes(installation.status)) {
      return this.persistFailure(request, started, "denied", "installation_inactive", "Connector installation is not active.");
    }
    if (!installation.allowedCapabilities.includes(request.capability)) {
      return this.persistFailure(request, started, "denied", "capability_not_granted", "Connector capability is not granted.");
    }
    const descriptor = getProviderOperation(request.providerId, request.operation);
    if (!descriptor || descriptor.capability !== request.capability) {
      return this.persistFailure(request, started, "denied", "operation_not_allowed", "Provider operation is not registered.");
    }
    const access = await this.evaluateAccess(request, installation);
    if (!access.allowed) {
      return this.persistFailure(request, started, "denied", "locally_disabled", `Connector access is disabled (${access.reason ?? "policy"}).`);
    }
    if (descriptor.minimumScopes.some((scope) => !installation.grantedScopes.includes(scope))) {
      return this.persistFailure(request, started, "denied", "scope_not_granted", "Provider scope is not granted.");
    }
    if (descriptor.capability === "provider.data.read" && !request.context) {
      return this.persistFailure(request, started, "denied", "invocation_context_required", "Provider reads require a complete LoopSpec and company-object context.");
    }
    if (descriptor.write) {
      return this.persistFailure(request, started, "denied", "prepare_commit_required", "Provider writes must use the fingerprint-bound prepare and commit protocol.");
    }
    if (containsNetworkEscapeHatch(request.input)) {
      return this.persistFailure(request, started, "denied", "arbitrary_http_blocked", "Connector inputs cannot supply URLs, hosts, methods, or headers.");
    }
    const handler = this.dependencies.handlers.get(operationKey(request.providerId, request.operation));
    if (!handler) {
      return this.persistFailure(request, started, "denied", "operation_unavailable", "Provider operation is not installed in this broker.");
    }

    const reservation = await this.dependencies.idempotency.reserve({
      ...request.tenant,
      idempotencyKey: request.idempotencyKey,
      requestHash: requestFingerprint(request),
      leaseUntil: new Date(this.now().getTime() + 5 * 60 * 1_000).toISOString()
    });
    if (reservation !== "claimed") {
      const response = this.failure(
        request,
        started,
        "denied",
        reservation === "conflict" ? "idempotency_conflict" : "request_in_progress",
        reservation === "conflict"
          ? "Idempotency key was already used for a different connector request."
          : "An identical connector request is already in progress.",
        reservation === "busy"
      );
      await this.dependencies.audit.append(response.receipt);
      return response;
    }

    try {
      const result = await handler({
        request,
        installation,
        descriptor,
        getCredential: () => this.dependencies.vault.resolve(installation.credentialRef, {
          ...request.tenant,
          expectedNamespace: installation.credentialNamespace,
          customerManagedKeyRef: installation.customerManagedKeyRef
        })
      });
      assertSecretFree(result, "connector_broker.response");
      const receipt = this.receipt(request, started, "accepted", undefined, result);
      const response = connectorBrokerResponseSchema.parse({
        protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        status: "succeeded",
        result,
        receipt
      });
      await Promise.all([
        this.dependencies.audit.append(receipt),
        this.dependencies.idempotency.putResponse({ ...request.tenant, idempotencyKey: request.idempotencyKey, response })
      ]);
      return response;
    } catch (error) {
      const known = error instanceof ConnectorBrokerError ? error : undefined;
      return this.persistFailure(
        request,
        started,
        known?.denied ? "denied" : "error",
        known?.code ?? "provider_operation_failed",
        known?.safeMessage ?? "Provider operation failed.",
        known?.retryable ?? true
      );
    }
  }

  async prepareAction(rawRequest: unknown): Promise<ConnectorActionPrepareResponse> {
    const started = this.now().getTime();
    let prepareRequest: ConnectorActionPrepareRequest;
    try {
      prepareRequest = connectorActionPrepareRequestSchema.parse(rawRequest);
    } catch {
      throw new ConnectorBrokerError("invalid_request", "Connector action prepare request does not match the broker protocol.", false, true);
    }
    this.assertFresh(prepareRequest.issuedAt, prepareRequest.expiresAt);
    if (!this.dependencies.preparedActions) {
      throw new ConnectorBrokerError("prepared_action_store_unavailable", "Durable prepared-action storage is required.", true, true);
    }
    assertSecretFree(prepareRequest.input, "connector_broker.prepare.input");
    if (containsNetworkEscapeHatch(prepareRequest.input)) {
      throw new ConnectorBrokerError("arbitrary_http_blocked", "Connector inputs cannot supply URLs, hosts, methods, or headers.", false, true);
    }
    const request = connectorBrokerRequestSchema.parse({ ...prepareRequest, input: prepareRequest.input });
    const { descriptor } = await this.resolveActionOperation(request);
    if (!descriptor.write) {
      throw new ConnectorBrokerError("read_operation_not_preparable", "Read operations execute directly and cannot be prepared.", false, true);
    }
    const preparedAt = this.now();
    const expiresAt = new Date(Math.min(
      Date.parse(prepareRequest.expiresAt),
      preparedAt.getTime() + 10 * 60 * 1_000
    )).toISOString();
    const actionId = `connector_action_${randomUUID()}`;
    const fingerprint = hash({
      schemaVersion: CONNECTOR_PREPARED_ACTION_VERSION,
      actionId,
      tenant: prepareRequest.tenant,
      providerId: prepareRequest.providerId,
      installationId: prepareRequest.installationId,
      capability: prepareRequest.capability,
      operation: prepareRequest.operation,
      context: prepareRequest.context,
      canonicalInput: prepareRequest.input,
      expiresAt
    });
    const preparedAction: ConnectorPreparedAction = {
      schemaVersion: CONNECTOR_PREPARED_ACTION_VERSION,
      actionId,
      tenant: prepareRequest.tenant,
      providerId: prepareRequest.providerId,
      installationId: prepareRequest.installationId,
      capability: prepareRequest.capability,
      operation: prepareRequest.operation,
      context: prepareRequest.context,
      canonicalInput: prepareRequest.input,
      fingerprint,
      preparedBy: prepareRequest.actor.subject,
      preparedAt: preparedAt.toISOString(),
      expiresAt,
      status: "prepared",
      approvalRequired: descriptor.approvalRequired,
      riskClass: descriptor.riskClass
    };
    await this.dependencies.preparedActions.savePrepared(preparedAction);
    const receipt = this.receipt(request, started, "accepted", undefined, {
      actionId,
      fingerprint,
      status: "prepared"
    });
    await this.dependencies.audit.append(receipt);
    return connectorActionPrepareResponseSchema.parse({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: prepareRequest.requestId,
      status: "prepared",
      preparedAction,
      receipt
    });
  }

  async commitAction(rawRequest: unknown): Promise<ConnectorBrokerResponse> {
    const started = this.now().getTime();
    let commitRequest: ConnectorActionCommitRequest;
    try {
      commitRequest = connectorActionCommitRequestSchema.parse(rawRequest);
    } catch {
      throw new ConnectorBrokerError("invalid_request", "Connector action commit request does not match the broker protocol.", false, true);
    }
    this.assertFresh(commitRequest.issuedAt, commitRequest.expiresAt);
    const store = this.dependencies.preparedActions;
    if (!store) throw new ConnectorBrokerError("prepared_action_store_unavailable", "Durable prepared-action storage is required.", true, true);
    const prepared = await store.getPrepared({
      ...commitRequest.tenant,
      actionId: commitRequest.preparedActionId
    });
    if (!prepared) throw new ConnectorBrokerError("prepared_action_not_found", "Prepared action was not found.", false, true);
    const identityMatches = prepared.fingerprint === commitRequest.preparedActionFingerprint &&
      prepared.providerId === commitRequest.providerId &&
      prepared.installationId === commitRequest.installationId &&
      prepared.capability === commitRequest.capability &&
      prepared.operation === commitRequest.operation &&
      hash(prepared.context) === hash(commitRequest.context);
    if (!identityMatches) throw new ConnectorBrokerError("prepared_action_mismatch", "Prepared action identity or fingerprint does not match.", false, true);
    if (Date.parse(prepared.expiresAt) < this.now().getTime()) {
      await store.finishCommit({ ...commitRequest.tenant, actionId: prepared.actionId, status: "revoked" });
      throw new ConnectorBrokerError("prepared_action_expired", "Prepared action has expired.", false, true);
    }
    const request = connectorBrokerRequestSchema.parse({
      ...commitRequest,
      input: prepared.canonicalInput
    });
    const { installation, descriptor, handler } = await this.resolveActionOperation(request);
    if (!descriptor.write) throw new ConnectorBrokerError("read_operation_not_committable", "Read operations cannot be committed.", false, true);
    if (prepared.approvalRequired) {
      if (!this.dependencies.approvals || !commitRequest.approvalReceiptId) {
        return this.persistFailure(request, started, "denied", "approval_required", "A fingerprint-bound approval verifier is required.");
      }
      const approved = await this.dependencies.approvals.verify({
        ...request.tenant,
        installationId: request.installationId,
        providerId: request.providerId,
        capability: request.capability,
        operation: request.operation,
        approvalReceiptId: commitRequest.approvalReceiptId,
        preparedActionId: prepared.actionId,
        preparedActionFingerprint: prepared.fingerprint,
        actorSubject: request.actor.subject
      });
      if (!approved) {
        return this.persistFailure(request, started, "denied", "approval_invalid", "Provider write approval is invalid, expired, or out of scope.");
      }
    }
    const duplicate = await this.dependencies.idempotency.getResponse({ ...request.tenant, idempotencyKey: request.idempotencyKey });
    if (duplicate) return responseMatchesRequest(duplicate, request)
      ? duplicate
      : this.persistFailure(request, started, "denied", "idempotency_conflict", "Idempotency key was already used for a different connector request.");
    const claim = await store.claimCommit({
      ...request.tenant,
      actionId: prepared.actionId,
      fingerprint: prepared.fingerprint,
      now: this.now().toISOString()
    });
    if (claim !== "claimed") {
      const code = claim === "completed" ? "prepared_action_already_committed"
        : claim === "expired" ? "prepared_action_expired"
          : claim === "mismatch" ? "prepared_action_mismatch"
            : claim === "missing" ? "prepared_action_not_found" : "prepared_action_in_progress";
      return this.persistFailure(request, started, "denied", code, "Prepared action cannot be committed in its current state.", claim === "busy");
    }
    const reservation = await this.dependencies.idempotency.reserve({
      ...request.tenant,
      idempotencyKey: request.idempotencyKey,
      requestHash: requestFingerprint(request),
      leaseUntil: new Date(this.now().getTime() + 5 * 60 * 1_000).toISOString()
    });
    if (reservation !== "claimed") {
      await store.finishCommit({ ...request.tenant, actionId: prepared.actionId, status: "prepared" });
      return this.persistFailure(
        request,
        started,
        "denied",
        reservation === "conflict" ? "idempotency_conflict" : "request_in_progress",
        "Connector commit could not obtain its idempotency lease.",
        reservation === "busy"
      );
    }
    try {
      const result = await handler({
        request,
        installation,
        descriptor,
        getCredential: () => this.dependencies.vault.resolve(installation.credentialRef, {
          ...request.tenant,
          expectedNamespace: installation.credentialNamespace,
          customerManagedKeyRef: installation.customerManagedKeyRef
        })
      });
      assertSecretFree(result, "connector_broker.commit.response");
      const receipt = this.receipt(request, started, "accepted", undefined, result);
      const response = connectorBrokerResponseSchema.parse({
        protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        status: "succeeded",
        result,
        receipt
      });
      await Promise.all([
        this.dependencies.audit.append(receipt),
        this.dependencies.idempotency.putResponse({ ...request.tenant, idempotencyKey: request.idempotencyKey, response }),
        store.finishCommit({ ...request.tenant, actionId: prepared.actionId, status: "committed", committedAt: this.now().toISOString() })
      ]);
      return response;
    } catch (error) {
      await store.finishCommit({ ...request.tenant, actionId: prepared.actionId, status: "prepared" });
      const known = error instanceof ConnectorBrokerError ? error : undefined;
      return this.persistFailure(
        request,
        started,
        known?.denied ? "denied" : "error",
        known?.code ?? "provider_operation_failed",
        known?.safeMessage ?? "Provider operation failed.",
        known?.retryable ?? true
      );
    }
  }

  private assertFresh(issuedAt: string, expiresAt: string) {
    const now = this.now().getTime();
    if (Date.parse(issuedAt) > now + 30_000 || Date.parse(expiresAt) < now) {
      throw new ConnectorBrokerError("request_expired", "Connector request is expired or not active.", false, true);
    }
  }

  private async resolveActionOperation(request: ConnectorBrokerRequest) {
    const installation = await this.dependencies.installations.get({ ...request.tenant, installationId: request.installationId });
    if (!installation || installation.providerId !== request.providerId ||
      installation.tenant.organizationId !== request.tenant.organizationId ||
      installation.tenant.projectKey !== request.tenant.projectKey) {
      throw new ConnectorBrokerError("installation_not_found", "Connector installation is unavailable.", false, true);
    }
    if (!connectorInstallationHasExpectedNamespace(installation)) {
      throw new ConnectorBrokerError("credential_namespace_invalid", "Connector credential namespace is invalid.", false, true);
    }
    if (request.context && request.context.environment !== installation.environment) {
      throw new ConnectorBrokerError("environment_scope_mismatch", "Connector invocation environment does not match the connection.", false, true);
    }
    if (installation.status !== "active") {
      throw new ConnectorBrokerError("installation_inactive", "Connector installation is not active.", false, true);
    }
    if (!installation.allowedCapabilities.includes(request.capability)) {
      throw new ConnectorBrokerError("capability_not_granted", "Connector capability is not granted.", false, true);
    }
    const descriptor = getProviderOperation(request.providerId, request.operation);
    if (!descriptor || descriptor.capability !== request.capability) {
      throw new ConnectorBrokerError("operation_not_allowed", "Provider operation is not registered.", false, true);
    }
    const access = await this.evaluateAccess(request, installation);
    if (!access.allowed) {
      throw new ConnectorBrokerError("locally_disabled", `Connector access is disabled (${access.reason ?? "policy"}).`, false, true);
    }
    if (descriptor.minimumScopes.some((scope) => !installation.grantedScopes.includes(scope))) {
      throw new ConnectorBrokerError("scope_not_granted", "Provider scope is not granted.", false, true);
    }
    if (!request.context) {
      throw new ConnectorBrokerError("invocation_context_required", "Provider actions require a complete LoopSpec and company-object context.", false, true);
    }
    if (descriptor.capability === "provider.action.execute" && request.context.activationMode !== "execute") {
      throw new ConnectorBrokerError("activation_mode_blocked", "External actions require execute activation mode.", false, true);
    }
    if (!descriptor.permittedObjectTypes.includes("CompanyObject") &&
      !descriptor.permittedObjectTypes.includes(request.context.companyObject.type)) {
      throw new ConnectorBrokerError("company_object_not_allowed", "The provider operation cannot act on this company object type.", false, true);
    }
    if (containsNetworkEscapeHatch(request.input)) {
      throw new ConnectorBrokerError("arbitrary_http_blocked", "Connector inputs cannot supply URLs, hosts, methods, or headers.", false, true);
    }
    const handler = this.dependencies.handlers.get(operationKey(request.providerId, request.operation));
    if (!handler) throw new ConnectorBrokerError("operation_unavailable", "Provider operation is not installed in this broker.", false, true);
    return { installation, descriptor, handler };
  }

  private async evaluateAccess(request: ConnectorBrokerRequest, installation?: ConnectorInstallationAdmin) {
    if (!this.dependencies.accessPolicy) return { allowed: true } as const;
    return this.dependencies.accessPolicy.evaluate({
      organizationId: request.tenant.organizationId,
      projectKey: request.tenant.projectKey,
      environment: request.context?.environment ?? installation?.environment ?? this.dependencies.defaultEnvironment ?? "development",
      providerId: request.providerId,
      connectionId: request.installationId,
      capability: request.capability,
      loopId: request.context?.loopId,
      agentId: request.context?.agentInstanceId
    });
  }

  private async persistFailure(
    request: ConnectorBrokerRequest,
    started: number,
    outcome: "denied" | "error",
    code: string,
    message: string,
    retryable = false
  ) {
    const response = this.failure(request, started, outcome, code, message, retryable);
    await Promise.all([
      this.dependencies.audit.append(response.receipt),
      this.dependencies.idempotency.putResponse({ ...request.tenant, idempotencyKey: request.idempotencyKey, response })
    ]);
    return response;
  }

  private failure(
    request: ConnectorBrokerRequest,
    started: number,
    outcome: "denied" | "error",
    code: string,
    message: string,
    retryable = false
  ) {
    return connectorBrokerResponseSchema.parse({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      status: outcome === "denied" ? "denied" : "failed",
      error: { code, message: redactSensitiveString(message), retryable },
      receipt: this.receipt(request, started, outcome, code)
    });
  }

  private receipt(
    request: ConnectorBrokerRequest,
    started: number,
    outcome: "accepted" | "denied" | "error",
    reasonCode?: string,
    result?: unknown
  ): ConnectorAuditReceipt {
    return {
      schemaVersion: "connector-audit-receipt/v1",
      receiptId: `connector_receipt_${randomUUID()}`,
      requestId: request.requestId,
      correlationId: request.correlationId,
      organizationId: request.tenant.organizationId,
      projectKey: request.tenant.projectKey,
      installationId: request.installationId,
      providerId: request.providerId,
      capability: request.capability,
      operation: request.operation,
      actorSubject: request.actor.subject,
      actorType: request.actor.type,
      ...(request.context ? {
        contextHash: hash(request.context),
        environment: request.context.environment,
        workspaceId: request.context.workspaceId,
        agentInstanceId: request.context.agentInstanceId,
        companyObjectType: request.context.companyObject.type,
        companyObjectId: request.context.companyObject.id,
        loopId: request.context.loopId,
        loopSpecHash: request.context.loopSpecHash,
        routeJobId: request.context.routeJobId,
        activationMode: request.context.activationMode
      } : {}),
      outcome,
      reasonCode,
      inputHash: hash(request.input),
      outputHash: result === undefined ? undefined : hash(result),
      occurredAt: this.now().toISOString(),
      durationMs: Math.max(0, this.now().getTime() - started)
    };
  }

  private now() {
    return this.dependencies.now?.() ?? new Date();
  }
}

export class ConnectorBrokerError extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string,
    readonly retryable: boolean,
    readonly denied = false
  ) {
    super(safeMessage);
    this.name = "ConnectorBrokerError";
  }
}

export function operationKey(providerId: string, operation: string) {
  return `${providerId}:${operation}`;
}

function containsNetworkEscapeHatch(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => containsNetworkEscapeHatch(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /^(?:base_?url|endpoint|headers?|host|hostname|http_?method|method|proxy|url)$/i.test(key) ||
    containsNetworkEscapeHatch(child, depth + 1)
  );
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestFingerprint(request: ConnectorBrokerRequest) {
  return hash({
    tenant: request.tenant,
    actor: request.actor,
    providerId: request.providerId,
    installationId: request.installationId,
    capability: request.capability,
    operation: request.operation,
    context: request.context,
    input: request.input
  });
}

function responseMatchesRequest(response: ConnectorBrokerResponse, request: ConnectorBrokerRequest) {
  const receipt = response.receipt;
  return receipt.organizationId === request.tenant.organizationId &&
    receipt.projectKey === request.tenant.projectKey &&
    receipt.installationId === request.installationId &&
    receipt.providerId === request.providerId &&
    receipt.capability === request.capability &&
    receipt.operation === request.operation &&
    receipt.actorType === request.actor.type &&
    receipt.actorSubject === request.actor.subject &&
    receipt.contextHash === (request.context ? hash(request.context) : undefined) &&
    receipt.inputHash === hash(request.input);
}

export class InMemoryConnectorState implements ConnectorInstallationStore, ConnectorIdempotencyStore, ConnectorAuditSink, ConnectorPreparedActionStore {
  readonly installations = new Map<string, ConnectorInstallationAdmin>();
  readonly responses = new Map<string, ConnectorBrokerResponse>();
  readonly reservations = new Map<string, { requestHash: string; leaseUntil: string }>();
  readonly receipts: ConnectorAuditReceipt[] = [];
  readonly preparedActions = new Map<string, ConnectorPreparedAction>();

  async get(input: { organizationId: string; projectKey: string; installationId: string }) {
    return this.installations.get(`${input.organizationId}:${input.projectKey}:${input.installationId}`);
  }

  async save(installation: ConnectorInstallationAdmin) {
    this.installations.set(`${installation.tenant.organizationId}:${installation.tenant.projectKey}:${installation.id}`, installation);
  }

  async getResponse(input: { organizationId: string; projectKey: string; idempotencyKey: string }) {
    return this.responses.get(`${input.organizationId}:${input.projectKey}:${input.idempotencyKey}`);
  }

  async reserve(input: { organizationId: string; projectKey: string; idempotencyKey: string; requestHash: string; leaseUntil: string }) {
    const key = `${input.organizationId}:${input.projectKey}:${input.idempotencyKey}`;
    const existing = this.reservations.get(key);
    if (existing && existing.requestHash !== input.requestHash) return "conflict" as const;
    if (existing) return "busy" as const;
    this.reservations.set(key, { requestHash: input.requestHash, leaseUntil: input.leaseUntil });
    return "claimed" as const;
  }

  async putResponse(input: { organizationId: string; projectKey: string; idempotencyKey: string; response: ConnectorBrokerResponse }) {
    this.responses.set(`${input.organizationId}:${input.projectKey}:${input.idempotencyKey}`, input.response);
  }

  async append(receipt: ConnectorAuditReceipt) {
    this.receipts.push(receipt);
  }

  async savePrepared(action: ConnectorPreparedAction) {
    this.preparedActions.set(`${action.tenant.organizationId}:${action.tenant.projectKey}:${action.actionId}`, action);
  }

  async getPrepared(input: { organizationId: string; projectKey: string; actionId: string }) {
    return this.preparedActions.get(`${input.organizationId}:${input.projectKey}:${input.actionId}`);
  }

  async claimCommit(input: { organizationId: string; projectKey: string; actionId: string; fingerprint: string; now: string }) {
    const key = `${input.organizationId}:${input.projectKey}:${input.actionId}`;
    const action = this.preparedActions.get(key);
    if (!action) return "missing" as const;
    if (action.fingerprint !== input.fingerprint) return "mismatch" as const;
    if (Date.parse(action.expiresAt) < Date.parse(input.now)) return "expired" as const;
    if (action.status === "committed") return "completed" as const;
    if (action.status === "committing") return "busy" as const;
    if (action.status !== "prepared") return "expired" as const;
    this.preparedActions.set(key, { ...action, status: "committing" });
    return "claimed" as const;
  }

  async finishCommit(input: { organizationId: string; projectKey: string; actionId: string; status: "prepared" | "committed" | "revoked" }) {
    const key = `${input.organizationId}:${input.projectKey}:${input.actionId}`;
    const action = this.preparedActions.get(key);
    if (action) this.preparedActions.set(key, { ...action, status: input.status });
  }
}
