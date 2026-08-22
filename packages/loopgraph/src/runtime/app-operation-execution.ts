import {
  APP_OPERATION_EXECUTION_SCHEMA_VERSION,
  APP_OPERATION_ACTION_SCHEMA_VERSION,
  APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
  APP_OPERATION_ACTION_COMMIT_SCHEMA_VERSION,
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  appOperationActionCommitResultSchema,
  appOperationActionEventSchema,
  appOperationExecutionResultSchema,
  canonicalAppDigest,
  connectorActionCommitRequestSchema,
  connectorActionPrepareRequestSchema,
  connectorBrokerRequestSchema,
  contentHash,
  type AppConnectorOperationBinding,
  type AppOperationAction,
  type AppOperationExecutionResult,
  type AppOperationActionCommitResult,
  type ConnectionInstance,
  type ConnectorActionCommitRequest,
  type ConnectorActionPrepareRequest,
  type ConnectorActionPrepareResponse,
  type ConnectorBrokerRequest,
  type ConnectorBrokerResponse,
  type ConnectorTenant
} from "../core";
import { AppInstallationService } from "./app-installation-service";
import type { AppOperationActionStore } from "./app-operation-action-store";
import type { HermesOperationsStore } from "./hermes-operations-store";
import { selectHermesAgentForExecution } from "./hermes-operations-store";
import type { RoutingStore } from "./routing-store";
import { assertSecretFree } from "./secret-redaction";
import type { AppRuntimeOperationTransport } from "./app-runtime-operations";

const MAX_OPERATION_INPUT_BYTES = 64 * 1024;
const ACTIVE_ROUTE_JOB_STATUSES = new Set(["claimed", "dispatched", "running"]);

export type AppOperationTransport = {
  execute(request: ConnectorBrokerRequest): Promise<ConnectorBrokerResponse>;
  prepareAction(request: ConnectorActionPrepareRequest): Promise<ConnectorActionPrepareResponse>;
  commitAction(request: ConnectorActionCommitRequest): Promise<ConnectorBrokerResponse>;
};

export type InvokeAppOperationInput = {
  installationId: string;
  loopId: string;
  capability: string;
  routeJobId: string;
  agentInstanceId: string;
  callId: string;
  input: Record<string, unknown>;
  now?: Date;
};

export type CommitAppOperationActionInput = {
  installationId: string;
  actionId: string;
  routeJobId: string;
  agentInstanceId: string;
  callId: string;
  now?: Date;
};

/**
 * Converts one logical App capability into a bounded Connector Broker call.
 *
 * Provider identity, operation, connection, tenant, agent context, company
 * object, environment, and activation mode are all derived from trusted
 * installation and runtime state. The caller controls only the logical
 * capability, durable route/call identity, and provider-operation input.
 */
export class AppOperationExecutionService {
  constructor(private readonly dependencies: {
    appService: AppInstallationService;
    actionStore: AppOperationActionStore;
    routingStore: RoutingStore;
    operationsStore: HermesOperationsStore;
    broker?: AppOperationTransport;
    runtime?: AppRuntimeOperationTransport;
    tenant?: ConnectorTenant;
    workspaceId: string;
    companyId: string;
    connections: readonly ConnectionInstance[];
  }) {}

  async invoke(input: InvokeAppOperationInput): Promise<AppOperationExecutionResult> {
    const now = input.now ?? new Date();
    assertBoundedOperationInput(input.input);
    const resolution = await this.dependencies.appService.resolveOperation({
      installationId: input.installationId,
      loopId: input.loopId,
      capability: input.capability,
      now
    });
    if (resolution.disposition === "blocked") {
      throw new Error(`App operation is blocked: ${resolution.blockers.join("; ")}`);
    }
    const binding = resolution.binding;
    if (!binding) {
      throw new Error("App operation does not resolve to an executable binding");
    }
    if (resolution.disposition === "invoke_loopgraph_runtime") {
      if (binding.executor !== "loopgraph_runtime" || binding.providerId !== "loopgraph" || binding.connectionId) {
        throw new Error("App operation does not resolve to a complete Loopgraph runtime binding");
      }
      if (!this.dependencies.runtime) {
        throw new Error("Governed Loopgraph runtime operation handlers are not registered");
      }
    } else if (binding.executor !== "connector_broker" || !binding.connectionId || !binding.brokerCapability) {
      throw new Error("App operation does not resolve to a complete Connector Broker binding");
    }

    const job = await this.dependencies.routingStore.getRouteJob(input.routeJobId);
    if (!job) throw new Error(`Route job not found: ${input.routeJobId}`);
    const agent = await selectHermesAgentForExecution({
      store: this.dependencies.operationsStore,
      workspaceId: this.dependencies.workspaceId,
      environment: job.executionTarget.environment,
      requiredCapabilities: [input.capability],
      loopId: input.loopId,
      preferredAgentInstanceId: input.agentInstanceId,
      now
    });
    if (!agent || agent.id !== input.agentInstanceId) {
      throw new Error(`Hermes agent ${input.agentInstanceId} is unavailable, stale, unassigned, or missing capability ${input.capability}`);
    }
    if (job.loopId !== input.loopId) throw new Error(`Route job ${job.id} belongs to loop ${job.loopId}`);
    if (job.executionTarget.runtime !== "hermes") {
      throw new Error(`Route job ${job.id} is not assigned to the Hermes runtime`);
    }
    if (job.executionTarget.preferredAgentInstanceId && job.executionTarget.preferredAgentInstanceId !== agent.id) {
      throw new Error(`Route job ${job.id} is assigned to another Hermes agent`);
    }
    if (!ACTIVE_ROUTE_JOB_STATUSES.has(job.status)) {
      throw new Error(`Route job ${job.id} is not active (${job.status})`);
    }
    if (!job.executionTarget.requiredCapabilities.includes(input.capability)) {
      throw new Error(`Route job ${job.id} does not require capability ${input.capability}`);
    }
    if (!["execute_with_approval", "autonomous_low_risk"].includes(job.activationMode)) {
      throw new Error(`Route job ${job.id} activation mode ${job.activationMode} cannot invoke App operations`);
    }
    const expectedShortHash = resolution.loopVersionHash.slice("sha256:".length, "sha256:".length + 16);
    if (job.loopSpecHash !== expectedShortHash) {
      throw new Error(`Route job ${job.id} is bound to a stale LoopSpec version`);
    }

    const [problem, receipt] = await Promise.all([
      this.dependencies.routingStore.getBusinessProblem(job.problemId),
      this.dependencies.routingStore.getEventReceipt(job.eventId)
    ]);
    if (!problem) throw new Error(`Business problem not found: ${job.problemId}`);
    if (!receipt) throw new Error(`Event receipt not found: ${job.eventId}`);
    if (problem.workspaceId !== this.dependencies.workspaceId || problem.companyId !== this.dependencies.companyId) {
      throw new Error(`Business problem ${problem.id} belongs to another workspace or company`);
    }
    if (receipt.event.workspaceId !== this.dependencies.workspaceId || receipt.event.companyId !== this.dependencies.companyId) {
      throw new Error(`Event ${receipt.eventId} belongs to another workspace or company`);
    }
    if (receipt.event.source === "loopgraph" || receipt.event.normalizedPayload.notificationOnly === true) {
      throw new Error("Loopgraph lifecycle notifications cannot invoke App operations");
    }
    if (problem.subject.type !== receipt.event.subject.type || problem.subject.id !== receipt.event.subject.id) {
      throw new Error(`Business problem ${problem.id} subject does not match event ${receipt.eventId}`);
    }
    if (agent.organizationId && this.dependencies.tenant && agent.organizationId !== this.dependencies.tenant.organizationId) {
      throw new Error(`Hermes agent ${agent.id} belongs to another organization`);
    }
    if (this.dependencies.tenant && this.dependencies.tenant.projectKey !== this.dependencies.workspaceId) {
      throw new Error("Connector tenant project does not match the App workspace");
    }
    await requireDurableHermesAssignment({
      store: this.dependencies.operationsStore,
      workspaceId: this.dependencies.workspaceId,
      companyId: this.dependencies.companyId,
      organizationId: this.dependencies.tenant?.organizationId,
      agentInstanceId: agent.id,
      job
    });

    const runtimeEnvironment = brokerEnvironmentForRoute(job.executionTarget.environment);
    const connection = binding.executor === "connector_broker"
      ? requireCurrentBrokerConnection({
          connections: this.dependencies.connections,
          binding,
          capability: input.capability
        })
      : undefined;
    if (connection && connection.brokerEnvironment !== runtimeEnvironment) {
      throw new Error(`Connection ${connection.id} environment does not match route job ${job.id}`);
    }

    const requestIdentity = contentHash({
      workspaceId: this.dependencies.workspaceId,
      installationId: input.installationId,
      loopId: input.loopId,
      routeJobId: job.id,
      agentInstanceId: agent.id,
      capability: input.capability,
      callId: input.callId,
      operationInput: input.input
    });
    const requestId = `appop_${requestIdentity}`;
    const idempotencyKey = `appop_call_${requestIdentity}`;
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 2 * 60_000).toISOString();
    const context = {
      workspaceId: this.dependencies.workspaceId,
      environment: runtimeEnvironment,
      agentInstanceId: agent.id,
      companyObject: {
        type: problem.subject.type,
        id: problem.subject.id
      },
      loopId: input.loopId,
      loopSpecHash: resolution.loopVersionHash.slice("sha256:".length),
      routeJobId: job.id,
      activationMode: "execute" as const
    };
    const brokerTenant = binding.executor === "connector_broker"
      ? requireConnectorTenant(this.dependencies.tenant)
      : undefined;
    const envelope = binding.executor === "connector_broker" ? {
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId,
      idempotencyKey,
      tenant: brokerTenant!,
      actor: {
        type: "workload" as const,
        subject: `hermes-agent:${agent.id}`
      },
      providerId: binding.providerId,
      installationId: binding.connectionId!,
      capability: binding.brokerCapability!,
      operation: binding.operation,
      context,
      issuedAt,
      expiresAt,
      correlationId: boundedCorrelationId(job.correlationId, requestIdentity)
    } : undefined;

    const runtimeResponse = resolution.disposition === "invoke_loopgraph_runtime"
      ? await this.dependencies.runtime!.execute({
          requestId,
          operation: binding.operation,
          input: input.input,
          workspaceId: this.dependencies.workspaceId,
          companyId: this.dependencies.companyId,
          installationId: resolution.installationId,
          appId: resolution.appId,
          artifactDigest: resolution.artifactDigest,
          loopId: resolution.loopId,
          loopVersionHash: resolution.loopVersionHash,
          capability: resolution.capability,
          routeJobId: job.id,
          agentInstanceId: agent.id,
          companyObject: context.companyObject,
          now
        })
      : undefined;
    if (runtimeResponse && (runtimeResponse.requestId !== requestId || runtimeResponse.operation !== binding.operation)) {
      throw new Error("Loopgraph runtime response does not match the routed App operation context");
    }
    const brokerResponse = envelope
      ? resolution.disposition === "invoke_read"
        ? await requireBroker(this.dependencies.broker).execute(connectorBrokerRequestSchema.parse({ ...envelope, input: input.input }))
        : await requireBroker(this.dependencies.broker).prepareAction(connectorActionPrepareRequestSchema.parse({ ...envelope, input: input.input }))
      : undefined;
    if (brokerResponse && envelope && resolution.disposition !== "invoke_loopgraph_runtime") {
      assertBrokerResponseMatchesRequest({
        response: brokerResponse,
        requestId,
        tenant: brokerTenant!,
        envelope,
        disposition: resolution.disposition
      });
    }
    const completedAt = (input.now ?? new Date()).toISOString();
    const base = {
      schemaVersion: APP_OPERATION_EXECUTION_SCHEMA_VERSION,
      workspaceId: this.dependencies.workspaceId,
      installationId: resolution.installationId,
      appId: resolution.appId,
      artifactDigest: resolution.artifactDigest,
      loopId: resolution.loopId,
      loopVersionHash: resolution.loopVersionHash,
      capability: resolution.capability,
      routeJobId: job.id,
      agentInstanceId: agent.id,
      callId: input.callId,
      disposition: resolution.disposition,
      resolutionDigest: resolution.resolutionDigest,
      requestId,
      idempotencyKey,
      ...(brokerResponse ? { brokerResponse } : {}),
      ...(runtimeResponse ? { runtimeResponse } : {}),
      completedAt
    };
    const execution = appOperationExecutionResultSchema.parse({
      ...base,
      executionDigest: canonicalAppDigest({ ...base, executionDigest: undefined })
    });
    if (execution.disposition === "prepare_action") {
      const prepared = execution.brokerResponse?.status === "prepared"
        ? execution.brokerResponse.preparedAction
        : undefined;
      const receipt = execution.brokerResponse?.receipt;
      if (!prepared || !receipt || !connection || !binding.brokerCapability) {
        throw new Error("Prepared App operation is missing its exact Broker ownership record");
      }
      const actionIdentity = contentHash({
        workspaceId: this.dependencies.workspaceId,
        installationId: resolution.installationId,
        brokerPreparedActionId: prepared.actionId,
        brokerPreparedActionFingerprint: prepared.fingerprint
      });
      const actionBase = {
        schemaVersion: APP_OPERATION_ACTION_SCHEMA_VERSION,
        id: `appact_${actionIdentity.slice(0, 48)}`,
        workspaceId: this.dependencies.workspaceId,
        companyId: this.dependencies.companyId,
        installationId: resolution.installationId,
        appId: resolution.appId,
        artifactDigest: resolution.artifactDigest,
        loopId: resolution.loopId,
        loopVersionHash: resolution.loopVersionHash,
        capability: resolution.capability,
        routeJobId: job.id,
        agentInstanceId: agent.id,
        callId: input.callId,
        requestId,
        idempotencyKey,
        resolutionDigest: resolution.resolutionDigest,
        executionDigest: execution.executionDigest,
        providerBinding: {
          providerId: binding.providerId,
          connectionId: connection.id,
          brokerCapability: prepared.capability,
          operation: prepared.operation
        },
        companyObject: {
          type: context.companyObject.type,
          identityDigest: canonicalAppDigest(context.companyObject)
        },
        environment: runtimeEnvironment,
        brokerPreparedActionId: prepared.actionId,
        brokerPreparedActionFingerprint: prepared.fingerprint,
        brokerPrepareReceiptId: receipt.receiptId,
        approvalRequired: prepared.approvalRequired,
        riskClass: prepared.riskClass,
        status: "prepared" as const,
        preparedAt: prepared.preparedAt,
        expiresAt: prepared.expiresAt,
        updatedAt: prepared.preparedAt
      };
      await this.dependencies.actionStore.recordPrepared({
        ...actionBase,
        recordDigest: canonicalAppDigest({ ...actionBase, recordDigest: undefined })
      });
    }
    return execution;
  }

  async commitAction(input: CommitAppOperationActionInput): Promise<AppOperationActionCommitResult> {
    const now = input.now ?? new Date();
    const action = await this.dependencies.actionStore.get(this.dependencies.workspaceId, input.actionId);
    if (!action || action.installationId !== input.installationId) {
      throw new Error("Prepared App action is unavailable for this installation");
    }
    if (action.routeJobId !== input.routeJobId || action.agentInstanceId !== input.agentInstanceId) {
      throw new Error("App action commit does not match the routed Hermes assignment");
    }
    if (Date.parse(action.expiresAt) <= now.getTime()) throw new Error("Prepared App action has expired");
    const priorEvents = await this.dependencies.actionStore.listEvents({
      workspaceId: this.dependencies.workspaceId,
      actionId: action.id,
      limit: 100
    });
    if (priorEvents.some((event) => event.eventType === "commit_succeeded")) {
      throw new Error("Prepared App action has already been committed");
    }
    if (priorEvents.some((event) => event.eventType === "revoked")) {
      throw new Error("Prepared App action has been revoked by an accountable operator");
    }
    const incompleteCommit = priorEvents.find((event) =>
      event.eventType === "commit_requested" && event.commit &&
      !priorEvents.some((candidate) =>
        ["commit_succeeded", "commit_failed"].includes(candidate.eventType) &&
        candidate.commit?.requestId === event.commit?.requestId
      )
    );
    if (incompleteCommit) throw new Error("Prepared App action commit is already in progress or requires reconciliation");
    const approval = priorEvents.find((event) =>
      event.eventType === "approval_granted" &&
      event.approval &&
      Date.parse(event.approval.expiresAt) > now.getTime() &&
      !priorEvents.some((candidate) => candidate.eventType === "commit_failed" && candidate.occurredAt >= event.occurredAt)
    )?.approval;
    if (action.approvalRequired && !approval) {
      throw new Error("Prepared App action requires an unexpired App-owned approval receipt");
    }

    const resolution = await this.dependencies.appService.resolveOperation({
      installationId: action.installationId,
      loopId: action.loopId,
      capability: action.capability,
      now
    });
    const binding = resolution.binding;
    if (resolution.disposition !== "prepare_action" || !binding || binding.executor !== "connector_broker" ||
      !binding.connectionId || !binding.brokerCapability) {
      throw new Error("App action no longer resolves to an approval-gated Connector Broker write");
    }
    if (resolution.appId !== action.appId || resolution.artifactDigest !== action.artifactDigest ||
      resolution.loopVersionHash !== action.loopVersionHash || resolution.resolutionDigest !== action.resolutionDigest ||
      binding.providerId !== action.providerBinding.providerId ||
      binding.connectionId !== action.providerBinding.connectionId ||
      binding.brokerCapability !== action.providerBinding.brokerCapability ||
      binding.operation !== action.providerBinding.operation) {
      throw new Error("App action no longer matches the pinned artifact, LoopSpec, or provider binding");
    }

    const job = await this.dependencies.routingStore.getRouteJob(action.routeJobId);
    if (!job || job.id !== input.routeJobId || job.loopId !== action.loopId ||
      job.executionTarget.runtime !== "hermes" || !ACTIVE_ROUTE_JOB_STATUSES.has(job.status) ||
      !job.executionTarget.requiredCapabilities.includes(action.capability) ||
      !["execute_with_approval", "autonomous_low_risk"].includes(job.activationMode)) {
      throw new Error("App action route job is unavailable or no longer executable");
    }
    const expectedShortHash = action.loopVersionHash.slice("sha256:".length, "sha256:".length + 16);
    if (job.loopSpecHash !== expectedShortHash) throw new Error("App action route job is bound to a stale LoopSpec version");
    const agent = await selectHermesAgentForExecution({
      store: this.dependencies.operationsStore,
      workspaceId: this.dependencies.workspaceId,
      environment: job.executionTarget.environment,
      requiredCapabilities: [action.capability],
      loopId: action.loopId,
      preferredAgentInstanceId: input.agentInstanceId,
      now
    });
    if (!agent || agent.id !== action.agentInstanceId ||
      (job.executionTarget.preferredAgentInstanceId && job.executionTarget.preferredAgentInstanceId !== agent.id)) {
      throw new Error("Assigned Hermes agent is unavailable, stale, or no longer eligible for this App action");
    }
    const [problem, receipt] = await Promise.all([
      this.dependencies.routingStore.getBusinessProblem(job.problemId),
      this.dependencies.routingStore.getEventReceipt(job.eventId)
    ]);
    if (!problem || !receipt ||
      problem.workspaceId !== this.dependencies.workspaceId || problem.companyId !== this.dependencies.companyId ||
      receipt.event.workspaceId !== this.dependencies.workspaceId || receipt.event.companyId !== this.dependencies.companyId ||
      problem.subject.type !== receipt.event.subject.type || problem.subject.id !== receipt.event.subject.id ||
      receipt.event.source === "loopgraph" || receipt.event.normalizedPayload.notificationOnly === true) {
      throw new Error("App action company problem or source event is unavailable or out of scope");
    }
    if (action.companyId !== this.dependencies.companyId || action.companyObject.type !== problem.subject.type ||
      action.companyObject.identityDigest !== canonicalAppDigest({ type: problem.subject.type, id: problem.subject.id })) {
      throw new Error("App action company object no longer matches the routed business problem");
    }
    if (agent.organizationId && this.dependencies.tenant && agent.organizationId !== this.dependencies.tenant.organizationId) {
      throw new Error("Assigned Hermes agent belongs to another organization");
    }
    if (this.dependencies.tenant && this.dependencies.tenant.projectKey !== this.dependencies.workspaceId) {
      throw new Error("Connector tenant project does not match the App workspace");
    }
    await requireDurableHermesAssignment({
      store: this.dependencies.operationsStore,
      workspaceId: this.dependencies.workspaceId,
      companyId: this.dependencies.companyId,
      organizationId: this.dependencies.tenant?.organizationId,
      agentInstanceId: agent.id,
      job
    });

    const connection = requireCurrentBrokerConnection({
      connections: this.dependencies.connections,
      binding,
      capability: action.capability
    });
    const environment = brokerEnvironmentForRoute(job.executionTarget.environment);
    if (connection.brokerEnvironment !== environment || environment !== action.environment) {
      throw new Error("App action connection environment no longer matches the routed job");
    }
    const tenant = requireConnectorTenant(this.dependencies.tenant);
    const requestIdentity = contentHash({
      workspaceId: this.dependencies.workspaceId,
      installationId: action.installationId,
      actionId: action.id,
      actionRecordDigest: action.recordDigest,
      routeJobId: job.id,
      agentInstanceId: agent.id,
      callId: input.callId
    });
    const requestId = `appcommit_${requestIdentity}`;
    const idempotencyKey = `appcommit_call_${requestIdentity}`;
    if (priorEvents.some((event) => event.eventType === "commit_failed" && event.commit?.requestId === requestId)) {
      throw new Error("This App action commit call already failed; obtain any required new approval and use a new call identity");
    }
    const issuedAt = now.toISOString();
    const context = {
      workspaceId: this.dependencies.workspaceId,
      environment,
      agentInstanceId: agent.id,
      companyObject: { type: problem.subject.type, id: problem.subject.id },
      loopId: action.loopId,
      loopSpecHash: action.loopVersionHash.slice("sha256:".length),
      routeJobId: job.id,
      activationMode: "execute" as const
    };
    const envelope = {
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId,
      idempotencyKey,
      tenant,
      actor: { type: "workload" as const, subject: `hermes-agent:${agent.id}` },
      providerId: action.providerBinding.providerId,
      installationId: action.providerBinding.connectionId,
      capability: action.providerBinding.brokerCapability,
      operation: action.providerBinding.operation,
      context,
      issuedAt,
      expiresAt: new Date(now.getTime() + 2 * 60_000).toISOString(),
      correlationId: boundedCorrelationId(job.correlationId, requestIdentity),
      preparedActionId: action.brokerPreparedActionId,
      preparedActionFingerprint: action.brokerPreparedActionFingerprint,
      ...(approval ? { approvalReceiptId: approval.connectorApprovalReceiptId } : {})
    };
    const commitRequest = connectorActionCommitRequestSchema.parse(envelope);
    await this.dependencies.actionStore.recordEvent(commitLifecycleEvent({
      action,
      eventType: "commit_requested",
      actorSubject: agent.id,
      requestId,
      idempotencyKey,
      occurredAt: issuedAt
    }));

    let brokerResponse: ConnectorBrokerResponse;
    try {
      brokerResponse = await requireBroker(this.dependencies.broker).commitAction(commitRequest);
      assertBrokerResponseMatchesRequest({
        response: brokerResponse,
        requestId,
        tenant,
        envelope,
        disposition: "commit_action"
      });
    } catch (error) {
      await this.dependencies.actionStore.recordEvent(commitLifecycleEvent({
        action,
        eventType: "commit_failed",
        actorSubject: agent.id,
        requestId,
        idempotencyKey,
        reasonCode: "broker_transport_error",
        occurredAt: (input.now ?? new Date()).toISOString()
      }));
      throw error;
    }
    const completedAt = (input.now ?? new Date()).toISOString();
    await this.dependencies.actionStore.recordEvent(commitLifecycleEvent({
      action,
      eventType: brokerResponse.status === "succeeded" ? "commit_succeeded" : "commit_failed",
      actorSubject: agent.id,
      requestId,
      idempotencyKey,
      connectorReceiptId: brokerResponse.receipt.receiptId,
      reasonCode: brokerResponse.status === "succeeded" ? undefined : brokerResponse.error?.code ?? "broker_commit_failed",
      occurredAt: completedAt
    }));
    const base = {
      schemaVersion: APP_OPERATION_ACTION_COMMIT_SCHEMA_VERSION,
      workspaceId: this.dependencies.workspaceId,
      installationId: action.installationId,
      actionId: action.id,
      loopId: action.loopId,
      routeJobId: job.id,
      agentInstanceId: agent.id,
      callId: input.callId,
      requestId,
      idempotencyKey,
      status: brokerResponse.status,
      brokerResponse,
      completedAt
    };
    return appOperationActionCommitResultSchema.parse({
      ...base,
      commitDigest: canonicalAppDigest({ ...base, commitDigest: undefined })
    });
  }

}

function commitLifecycleEvent(input: {
  action: AppOperationAction;
  eventType: "commit_requested" | "commit_succeeded" | "commit_failed";
  actorSubject: string;
  requestId: string;
  idempotencyKey: string;
  connectorReceiptId?: string;
  reasonCode?: string;
  occurredAt: string;
}) {
  const eventBase = {
    schemaVersion: APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
    id: `appactevt_${contentHash({ actionId: input.action.id, requestId: input.requestId, eventType: input.eventType }).slice(0, 48)}`,
    workspaceId: input.action.workspaceId,
    installationId: input.action.installationId,
    actionId: input.action.id,
    actionRecordDigest: input.action.recordDigest,
    eventType: input.eventType,
    actor: { type: "workload" as const, subject: input.actorSubject },
    commit: {
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      ...(input.connectorReceiptId ? { connectorReceiptId: input.connectorReceiptId } : {}),
      outcome: input.eventType === "commit_requested" ? "requested" as const
        : input.eventType === "commit_succeeded" ? "succeeded" as const : "failed" as const,
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {})
    },
    occurredAt: input.occurredAt
  };
  return appOperationActionEventSchema.parse({
    ...eventBase,
    eventDigest: canonicalAppDigest({ ...eventBase, eventDigest: undefined })
  });
}

async function requireDurableHermesAssignment(input: {
  store: HermesOperationsStore;
  workspaceId: string;
  companyId: string;
  organizationId?: string;
  agentInstanceId: string;
  job: NonNullable<Awaited<ReturnType<RoutingStore["getRouteJob"]>>>;
}) {
  const events = await input.store.listExecutionEvents({
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    companyId: input.companyId,
    agentInstanceId: input.agentInstanceId,
    routeJobId: input.job.id,
    eventType: "assignment.received",
    limit: 20
  });
  const assignment = events.find((event) =>
    event.routeCommitId === input.job.routeCommitId &&
    event.routeAttemptId === input.job.routeAttemptId &&
    event.eventId === input.job.eventId &&
    event.problemId === input.job.problemId &&
    event.loopId === input.job.loopId &&
    event.loopSpecHash === input.job.loopSpecHash &&
    event.runId === input.job.runId &&
    event.correlationId === input.job.correlationId
  );
  if (!assignment) {
    throw new Error(`Hermes agent ${input.agentInstanceId} has no durable matching assignment for route job ${input.job.id}`);
  }
}

function assertBrokerResponseMatchesRequest(input: {
  response: ConnectorBrokerResponse | ConnectorActionPrepareResponse;
  requestId: string;
  tenant: ConnectorTenant;
  envelope: {
    correlationId: string;
    providerId: string;
    installationId: string;
    capability: string;
    operation: string;
    actor: { type: "workload"; subject: string };
    context: {
      workspaceId: string;
      environment: "development" | "staging" | "production";
      agentInstanceId: string;
      companyObject: { type: string; id: string };
      loopId: string;
      loopSpecHash: string;
      routeJobId: string;
      activationMode: "execute";
    };
  };
  disposition: "invoke_read" | "prepare_action" | "commit_action";
}) {
  const { response, envelope } = input;
  const receipt = response.receipt;
  if (response.requestId !== input.requestId || receipt.requestId !== input.requestId) {
    throw new Error("Connector Broker response does not match the App operation request identity");
  }
  const exactReceiptMatches =
    receipt.correlationId === envelope.correlationId &&
    receipt.organizationId === input.tenant.organizationId &&
    receipt.projectKey === input.tenant.projectKey &&
    receipt.installationId === envelope.installationId &&
    receipt.providerId === envelope.providerId &&
    receipt.capability === envelope.capability &&
    receipt.operation === envelope.operation &&
    receipt.actorSubject === envelope.actor.subject &&
    receipt.actorType === envelope.actor.type &&
    receipt.environment === envelope.context.environment &&
    receipt.workspaceId === envelope.context.workspaceId &&
    receipt.agentInstanceId === envelope.context.agentInstanceId &&
    receipt.companyObjectType === envelope.context.companyObject.type &&
    receipt.companyObjectId === envelope.context.companyObject.id &&
    receipt.loopId === envelope.context.loopId &&
    receipt.loopSpecHash === envelope.context.loopSpecHash &&
    receipt.routeJobId === envelope.context.routeJobId &&
    receipt.activationMode === envelope.context.activationMode;
  if (!exactReceiptMatches) {
    throw new Error("Connector Broker receipt does not match the routed App operation context");
  }
  if (input.disposition === "prepare_action") {
    if (response.status !== "prepared" ||
        response.preparedAction.tenant.organizationId !== input.tenant.organizationId ||
        response.preparedAction.tenant.projectKey !== input.tenant.projectKey ||
        response.preparedAction.providerId !== envelope.providerId ||
        response.preparedAction.installationId !== envelope.installationId ||
        response.preparedAction.capability !== envelope.capability ||
        response.preparedAction.operation !== envelope.operation ||
        JSON.stringify(response.preparedAction.context) !== JSON.stringify(envelope.context)) {
      throw new Error("Prepared action does not match the routed App operation context");
    }
  }
}

function requireCurrentBrokerConnection(input: {
  connections: readonly ConnectionInstance[];
  binding: AppConnectorOperationBinding;
  capability: string;
}): ConnectionInstance & { brokerEnvironment: "development" | "staging" | "production" } {
  const connection = input.connections.find((candidate) => candidate.id === input.binding.connectionId);
  if (!connection) throw new Error(`Connector Broker connection is unavailable: ${input.binding.connectionId}`);
  if (connection.source !== "hermes_connector_broker" ||
      (connection.externalInstallationId ?? connection.id) !== input.binding.connectionId) {
    throw new Error(`Connection ${connection.id} is not a trusted Connector Broker projection`);
  }
  if (connection.manifestId !== input.binding.providerId) {
    throw new Error(`Connection ${connection.id} provider changed after App resolution`);
  }
  if (connection.status !== "connected" || connection.health?.status === "degraded" || connection.health?.status === "missing") {
    throw new Error(`Connection ${connection.id} is not healthy`);
  }
  if (!connection.brokerEnvironment) throw new Error(`Connection ${connection.id} has no exact broker environment`);
  if (!connection.capabilityKeys.includes(input.capability)) {
    throw new Error(`Connection ${connection.id} no longer grants logical capability ${input.capability}`);
  }
  if (!connection.brokerCapabilities.includes(input.binding.brokerCapability!)) {
    throw new Error(`Connection ${connection.id} no longer grants broker capability ${input.binding.brokerCapability}`);
  }
  const missingScopes = input.binding.minimumScopes.filter((scope) => !connection.grantedScopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Connection ${connection.id} is missing scopes required by the pinned operation`);
  }
  return connection as ConnectionInstance & { brokerEnvironment: "development" | "staging" | "production" };
}

function brokerEnvironmentForRoute(environment: "local" | "sandbox" | "staging" | "production") {
  if (environment === "production") return "production" as const;
  if (environment === "staging" || environment === "sandbox") return "staging" as const;
  return "development" as const;
}

function boundedCorrelationId(value: string, fallback: string) {
  if (value.length >= 8 && value.length <= 128) return value;
  return `appop_${fallback}`;
}

function assertBoundedOperationInput(input: Record<string, unknown>) {
  assertSecretFree(input, "app_operation.input");
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new Error("App operation input must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_OPERATION_INPUT_BYTES) {
    throw new Error(`App operation input exceeds ${MAX_OPERATION_INPUT_BYTES} bytes`);
  }
}

function requireBroker(broker: AppOperationTransport | undefined): AppOperationTransport {
  if (!broker) throw new Error("Connector Broker transport is not configured for this App operation");
  return broker;
}

function requireConnectorTenant(tenant: ConnectorTenant | undefined): ConnectorTenant {
  if (!tenant) throw new Error("Connector Broker App operations require a trusted tenant binding");
  return tenant;
}
