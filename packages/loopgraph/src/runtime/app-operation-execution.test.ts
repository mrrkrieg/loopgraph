import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  CONNECTOR_AUDIT_RECEIPT_VERSION,
  CONNECTOR_PREPARED_ACTION_VERSION,
  APP_RUNTIME_OPERATION_RESPONSE_SCHEMA_VERSION,
  canonicalAppDigest,
  businessProblemSchema,
  eventReceiptSchema,
  hermesAgentInstanceSchema,
  hermesExecutionEventSchema,
  routeJobSchema,
  type AppOperationResolution,
  type ConnectorActionPrepareRequest,
  type ConnectorBrokerRequest
} from "../core";
import type { AppInstallationService } from "./app-installation-service";
import {
  AppOperationExecutionService,
  type AppOperationTransport
} from "./app-operation-execution";
import type { AppRuntimeOperationTransport } from "./app-runtime-operations";
import { FileHermesOperationsStore } from "./hermes-operations-store";
import { FileRoutingStore } from "./routing-store";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const LOOP_DIGEST = `sha256:${"a".repeat(64)}`;
const ARTIFACT_DIGEST = `sha256:${"b".repeat(64)}`;
const RESOLUTION_DIGEST = `sha256:${"c".repeat(64)}`;
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("App operation execution", () => {
  it("derives the exact provider call from the installed App and durable Hermes route", async () => {
    const fixture = await createFixture("invoke_read");

    const result = await fixture.service.invoke({
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-read-lead-1",
      input: { leadId: "lead-42" },
      now: NOW
    });

    expect(result).toMatchObject({
      disposition: "invoke_read",
      loopId: "sales-inbound-lead-intake",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales"
    });
    expect(result.executionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fixture.broker.execute).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "hubspot",
      installationId: "hubspot-production",
      capability: "provider.data.read",
      operation: "crm.contacts.read",
      tenant: { organizationId: ORGANIZATION_ID, projectKey: "workspace-sales" },
      actor: { type: "workload", subject: "hermes-agent:hermes-sales" },
      context: expect.objectContaining({
        companyObject: { type: "lead", id: "lead-42" },
        loopSpecHash: "a".repeat(64),
        routeJobId: "job-sales-read",
        activationMode: "execute"
      }),
      input: { leadId: "lead-42" }
    }));
    expect(fixture.broker.prepareAction).not.toHaveBeenCalled();
  });

  it("prepares a fingerprint-bound action instead of committing a provider write", async () => {
    const fixture = await createFixture("prepare_action", {
      logicalCapability: "crm.lead.write",
      brokerCapability: "provider.action.execute",
      operation: "crm.contacts.update"
    });

    const result = await fixture.service.invoke({
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.write",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-prepare-lead-1",
      input: { leadId: "lead-42", lifecycleStage: "qualified" },
      now: NOW
    });

    expect(result).toMatchObject({
      disposition: "prepare_action",
      brokerResponse: {
        status: "prepared",
        preparedAction: {
          operation: "crm.contacts.update",
          status: "prepared",
          approvalRequired: true
        }
      }
    });
    expect(fixture.broker.prepareAction).toHaveBeenCalledOnce();
    expect(fixture.broker.execute).not.toHaveBeenCalled();
  });

  it("executes an allowlisted Loopgraph runtime read through the same durable route authority", async () => {
    const fixture = await createFixture("invoke_loopgraph_runtime", {
      logicalCapability: "loopgraph.topology.read",
      runtimeOperation: "graph.read",
      omitTenant: true
    });

    const result = await fixture.service.invoke({
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "loopgraph.topology.read",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-read-topology-1",
      input: { limit: 10 },
      now: NOW
    });

    expect(result).toMatchObject({
      disposition: "invoke_loopgraph_runtime",
      runtimeResponse: {
        operation: "graph.read",
        status: "succeeded",
        result: { graphHash: "graph-hash" }
      }
    });
    expect(fixture.runtime.execute).toHaveBeenCalledWith(expect.objectContaining({
      operation: "graph.read",
      workspaceId: "workspace-sales",
      companyId: "company-acme",
      routeJobId: "job-sales-read",
      companyObject: { type: "lead", id: "lead-42" },
      input: { limit: 10 }
    }));
    expect(fixture.broker.execute).not.toHaveBeenCalled();
    expect(fixture.broker.prepareAction).not.toHaveBeenCalled();
  });

  it("fails closed before the broker for stale route versions and secret-shaped input", async () => {
    const stale = await createFixture("invoke_read", { routeLoopHash: "d".repeat(16) });
    await expect(stale.service.invoke({
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-stale-lead-1",
      input: { leadId: "lead-42" },
      now: NOW
    })).rejects.toThrow(/stale LoopSpec/);
    expect(stale.broker.execute).not.toHaveBeenCalled();

    const secret = await createFixture("invoke_read");
    await expect(secret.service.invoke({
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-secret-lead-1",
      input: { access_token: "must-not-cross-this-boundary" },
      now: NOW
    })).rejects.toThrow(/secret/i);
    expect(secret.appService.resolveOperation).not.toHaveBeenCalled();
    expect(secret.broker.execute).not.toHaveBeenCalled();
  });
});

async function createFixture(
  disposition: "invoke_read" | "prepare_action" | "invoke_loopgraph_runtime",
  options: {
    logicalCapability?: string;
    brokerCapability?: "provider.data.read" | "provider.action.execute";
    operation?: string;
    routeLoopHash?: string;
    runtimeOperation?: string;
    omitTenant?: boolean;
  } = {}
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-operation-"));
  temporaryDirectories.push(root);
  const routingStore = new FileRoutingStore(root);
  const operationsStore = new FileHermesOperationsStore(root);
  const logicalCapability = options.logicalCapability ?? "crm.lead.read";
  const brokerCapability = options.brokerCapability ?? "provider.data.read";
  const operation = options.operation ?? "crm.contacts.read";

  await operationsStore.saveAgentInstance(hermesAgentInstanceSchema.parse({
    id: "hermes-sales",
    workspaceId: "workspace-sales",
    organizationId: ORGANIZATION_ID,
    name: "Hermes Sales",
    environment: "production",
    status: "online",
    runtimeVersion: "2.4.0",
    capabilities: [logicalCapability],
    assignedLoopIds: ["sales-inbound-lead-intake"],
    defaultRouter: true,
    labels: {},
    lastHeartbeatAt: NOW.toISOString(),
    registeredAt: "2026-08-20T11:00:00.000Z",
    updatedAt: NOW.toISOString()
  }));
  await routingStore.saveEventReceipt(eventReceiptSchema.parse({
    id: "receipt-sales-read",
    eventId: "event-sales-read",
    event: {
      id: "event-sales-read",
      workspaceId: "workspace-sales",
      companyId: "company-acme",
      source: "hubspot",
      sourceRoute: "hermes.hubspot",
      sourceDeliveryId: "hubspot-lead-42",
      eventType: "lead.created",
      occurredAt: "2026-08-20T11:59:00.000Z",
      receivedAt: NOW.toISOString(),
      subject: { type: "lead", id: "lead-42" },
      correlationId: "correlation-sales-read",
      normalizedPayload: { leadId: "lead-42" },
      evidenceRefs: ["hubspot:lead-42"],
      trust: { signatureVerified: true, signer: "hubspot", untrustedFields: [] }
    },
    eventHash: "event-hash-sales-read",
    status: "received",
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString()
  }));
  await routingStore.saveBusinessProblem(businessProblemSchema.parse({
    id: "problem-sales-read",
    workspaceId: "workspace-sales",
    companyId: "company-acme",
    problemType: "sales.lead_intake",
    subject: { type: "lead", id: "lead-42" },
    summary: "A new lead requires governed qualification.",
    severity: "medium",
    status: "routed",
    correlationId: "correlation-sales-read",
    dedupeKey: "lead-42:intake",
    evidenceEventIds: ["event-sales-read"],
    primaryLoopId: "sales-inbound-lead-intake",
    supportingLoopIds: [],
    routeCommitIds: ["commit-sales-read"],
    outcomeRefs: [],
    openedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  }));
  await routingStore.saveRouteJob(routeJobSchema.parse({
    id: "job-sales-read",
    idempotencyKey: "job-sales-read-idempotency",
    eventId: "event-sales-read",
    problemId: "problem-sales-read",
    routeCommitId: "commit-sales-read",
    routeAttemptId: "attempt-sales-read",
    loopId: "sales-inbound-lead-intake",
    loopSpecHash: options.routeLoopHash ?? "a".repeat(16),
    runId: "run-sales-read",
    activationMode: "execute_with_approval",
    executionTarget: {
      runtime: "hermes",
      environment: "production",
      requiredCapabilities: [logicalCapability]
    },
    status: "dispatched",
    correlationId: "correlation-sales-read",
    attemptCount: 1,
    maxAttempts: 3,
    nextRunAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  }));
  await operationsStore.appendExecutionEvent(hermesExecutionEventSchema.parse({
    id: "assignment-sales-read",
    idempotencyKey: "assignment-sales-read-idempotency",
    workspaceId: "workspace-sales",
    organizationId: ORGANIZATION_ID,
    companyId: "company-acme",
    agentInstanceId: "hermes-sales",
    eventType: "assignment.received",
    routeJobId: "job-sales-read",
    routeCommitId: "commit-sales-read",
    routeAttemptId: "attempt-sales-read",
    eventId: "event-sales-read",
    problemId: "problem-sales-read",
    loopId: "sales-inbound-lead-intake",
    loopSpecHash: options.routeLoopHash ?? "a".repeat(16),
    runId: "run-sales-read",
    correlationId: "correlation-sales-read",
    sequence: 0,
    summary: "Hermes accepted the routed assignment.",
    occurredAt: NOW.toISOString(),
    recordedAt: NOW.toISOString()
  }));

  const resolution: AppOperationResolution = {
    schemaVersion: "loopgraph-app-operation-resolution/v1alpha1",
    workspaceId: "workspace-sales",
    installationId: "installed-sales-app",
    appId: "official.sales.lead-intake",
    artifactDigest: ARTIFACT_DIGEST,
    loopId: "sales-inbound-lead-intake",
    loopVersionHash: LOOP_DIGEST,
    capability: logicalCapability,
    state: "execute_with_approval",
    mode: "execute_with_approval",
    binding: disposition === "invoke_loopgraph_runtime" ? {
      providerId: "loopgraph",
      providerOperation: `loopgraph.${options.runtimeOperation ?? "graph.read"}`,
      operation: options.runtimeOperation ?? "graph.read",
      executor: "loopgraph_runtime",
      minimumScopes: []
    } : {
      providerId: "hubspot",
      providerOperation: operation,
      operation,
      executor: "connector_broker",
      connectionId: "hubspot-production",
      brokerCapability,
      minimumScopes: ["crm.objects.contacts.read"]
    },
    permission: {
      capability: logicalCapability,
      authority: disposition === "prepare_action" ? "execute" : "read",
      decision: disposition === "prepare_action" ? "approval_required" : "allow",
      reason: "Pinned App permission",
      changedFromInstalled: false
    },
    disposition,
    blockers: [],
    resolvedAt: NOW.toISOString(),
    expiresAt: "2026-08-20T12:02:00.000Z",
    resolutionDigest: RESOLUTION_DIGEST
  };
  const appService = {
    resolveOperation: vi.fn(async () => resolution)
  } as unknown as AppInstallationService;
  const broker: AppOperationTransport = {
    execute: vi.fn(async (request: ConnectorBrokerRequest) => ({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      status: "succeeded" as const,
      result: { leadId: "lead-42", lifecycleStage: "new" },
      receipt: auditReceipt(request)
    })),
    prepareAction: vi.fn(async (request: ConnectorActionPrepareRequest) => ({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      status: "prepared" as const,
      preparedAction: {
        schemaVersion: CONNECTOR_PREPARED_ACTION_VERSION,
        actionId: "action-sales-lead-update",
        tenant: request.tenant,
        providerId: request.providerId,
        installationId: request.installationId,
        capability: request.capability,
        operation: request.operation,
        context: request.context,
        canonicalInput: request.input,
        fingerprint: "f".repeat(64),
        preparedBy: request.actor.subject,
        preparedAt: request.issuedAt,
        expiresAt: request.expiresAt,
        status: "prepared" as const,
        approvalRequired: true,
        riskClass: "write" as const
      },
      receipt: auditReceipt(request)
    }))
  };
  const runtime: AppRuntimeOperationTransport = {
    execute: vi.fn(async (request) => {
      const base = {
        schemaVersion: APP_RUNTIME_OPERATION_RESPONSE_SCHEMA_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        status: "succeeded" as const,
        result: { graphHash: "graph-hash" },
        completedAt: request.now.toISOString()
      };
      return {
        ...base,
        resultDigest: canonicalAppDigest({ ...base, resultDigest: undefined })
      };
    })
  };
  return {
    appService,
    broker,
    runtime,
    service: new AppOperationExecutionService({
      appService,
      routingStore,
      operationsStore,
      broker,
      runtime,
      ...(options.omitTenant ? {} : {
        tenant: { organizationId: ORGANIZATION_ID, projectKey: "workspace-sales" }
      }),
      workspaceId: "workspace-sales",
      companyId: "company-acme",
      connections: [{
        schemaVersion: "connection-instance/v1alpha1",
        id: "hubspot-production",
        manifestId: "hubspot",
        source: "hermes_connector_broker",
        externalInstallationId: "hubspot-production",
        brokerCapabilities: [brokerCapability],
        accountLabel: "HubSpot production",
        capabilityKeys: [logicalCapability],
        grantedScopes: ["crm.objects.contacts.read"],
        status: "connected",
        environment: "live",
        brokerEnvironment: "production",
        readPolicy: "read_only",
        writePolicy: "approved_only",
        health: {
          status: "connected",
          checkedAt: NOW.toISOString(),
          checkedBy: "hermes_connector_broker",
          evidenceRefs: ["broker-installation:hubspot-production"]
        }
      }]
    })
  };
}

function auditReceipt(request: ConnectorBrokerRequest | ConnectorActionPrepareRequest) {
  if (!request.context) throw new Error("Test Broker request requires routed context");
  return {
    schemaVersion: CONNECTOR_AUDIT_RECEIPT_VERSION,
    receiptId: `receipt-${request.requestId}`,
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
    environment: request.context.environment,
    workspaceId: request.context.workspaceId,
    agentInstanceId: request.context.agentInstanceId,
    companyObjectType: request.context.companyObject.type,
    companyObjectId: request.context.companyObject.id,
    loopId: request.context.loopId,
    loopSpecHash: request.context.loopSpecHash,
    routeJobId: request.context.routeJobId,
    activationMode: request.context.activationMode,
    outcome: "accepted" as const,
    inputHash: "0".repeat(64),
    outputHash: "1".repeat(64),
    occurredAt: request.issuedAt,
    durationMs: 4
  };
}
