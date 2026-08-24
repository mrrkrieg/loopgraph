import { describe, expect, it, vi } from "vitest";
import {
  APP_OPERATION_ACTION_SCHEMA_VERSION,
  canonicalAppDigest,
  type AppOperationAction
} from "loopgraph/core";
import type { AppInstallationStore, AppOperationActionStore } from "loopgraph/runtime";
import { approveAppOperationAction } from "./app-operation-action-approval";

describe("App operation action approval", () => {
  it("derives every Connector Broker identity from the immutable App action", async () => {
    const action = preparedAction();
    const recordedEvents: unknown[] = [];
    const approveConnectorAction = vi.fn(async () => ({
      approvalId: "connector-approval-12345678",
      actionId: action.brokerPreparedActionId,
      fingerprint: action.brokerPreparedActionFingerprint,
      expiresAt: "2026-08-21T12:05:00.000Z"
    }));
    const result = await approveAppOperationAction({
      workspaceId: "acme",
      installationId: action.installationId,
      actionId: action.id,
      reason: "Account owner reviewed the exact follow-up action.",
      actorSubject: "reviewer-1",
      actionStore: actionStore(action, recordedEvents),
      installationStore: installationStore(action),
      approveConnectorAction,
      now: new Date("2026-08-21T12:01:00.000Z")
    });

    expect(approveConnectorAction).toHaveBeenCalledWith({
      installationId: "hubspot-production",
      actionId: "broker-action-12345678",
      fingerprint: "f".repeat(64),
      reason: "Account owner reviewed the exact follow-up action."
    });
    expect(result.event).toMatchObject({
      eventType: "approval_granted",
      actionId: action.id,
      actionRecordDigest: action.recordDigest,
      actor: { type: "user", subject: "reviewer-1" },
      approval: { connectorApprovalReceiptId: "connector-approval-12345678" }
    });
    expect(recordedEvents).toEqual([result.event]);
    expect(JSON.stringify(result.event)).not.toContain("Account owner reviewed");
  });

  it("fails closed when the installed artifact or binding changed", async () => {
    const action = preparedAction();
    const approveConnectorAction = vi.fn();
    const staleStore = installationStore(action);
    const registry = await staleStore.read();
    registry.installations[0]!.artifactDigest = canonicalAppDigest("replacement");

    await expect(approveAppOperationAction({
      workspaceId: "acme",
      installationId: action.installationId,
      actionId: action.id,
      reason: "Reviewed and approved.",
      actorSubject: "reviewer-1",
      actionStore: actionStore(action, []),
      installationStore: staleStore,
      approveConnectorAction,
      now: new Date("2026-08-21T12:01:00.000Z")
    })).rejects.toThrow(/stale App artifact/i);
    expect(approveConnectorAction).not.toHaveBeenCalled();
  });

  it("rejects expired actions and active approval replays", async () => {
    const action = preparedAction();
    const store = actionStore(action, [], [{
      eventType: "approval_granted",
      approval: { expiresAt: "2026-08-21T12:04:00.000Z" }
    }]);
    await expect(approveAppOperationAction({
      workspaceId: "acme",
      installationId: action.installationId,
      actionId: action.id,
      reason: "Reviewed and approved.",
      actorSubject: "reviewer-1",
      actionStore: store,
      installationStore: installationStore(action),
      approveConnectorAction: vi.fn(),
      now: new Date("2026-08-21T12:02:00.000Z")
    })).rejects.toThrow(/already has an approval/i);
  });
});

function actionStore(action: AppOperationAction, recordedEvents: unknown[], events: unknown[] = []): AppOperationActionStore {
  return {
    persistence: "file",
    recordPrepared: vi.fn(),
    get: vi.fn(async (workspaceId, actionId) => workspaceId === action.workspaceId && actionId === action.id ? action : undefined),
    list: vi.fn(async () => [action]),
    recordEvent: vi.fn(async (event) => { recordedEvents.push(event); return event; }),
    listEvents: vi.fn(async () => events as never[])
  };
}

function installationStore(action: AppOperationAction): AppInstallationStore {
  const registry = {
    workspaceId: action.workspaceId,
    installations: [{
      id: action.installationId,
      appId: action.appId,
      artifactDigest: action.artifactDigest,
      state: "execute_with_approval",
      mode: "execute_with_approval",
      ownedAssets: [{ assetId: action.loopId, kind: "loop_spec", ownerInstallationIds: [action.installationId] }],
      operationBindings: {
        [action.capability]: {
          executor: "connector_broker",
          providerId: action.providerBinding.providerId,
          connectionId: action.providerBinding.connectionId,
          brokerCapability: action.providerBinding.brokerCapability,
          operation: action.providerBinding.operation
        }
      }
    }]
  };
  return {
    persistence: "file",
    read: vi.fn(async () => registry as never),
    readLockfile: vi.fn(),
    withExclusiveUpdate: vi.fn()
  };
}

function preparedAction(): AppOperationAction {
  const base = {
    schemaVersion: APP_OPERATION_ACTION_SCHEMA_VERSION,
    id: "appact_12345678",
    workspaceId: "acme",
    companyId: "acme-company",
    installationId: "installed-sales",
    appId: "loopgraph.sales.inbound-leads",
    artifactDigest: canonicalAppDigest("artifact"),
    loopId: "sales-inbound-lead-intake",
    loopVersionHash: canonicalAppDigest("loop"),
    capability: "crm.lead.write",
    routeJobId: "route-job-1",
    agentInstanceId: "hermes-sales",
    callId: "call-1",
    requestId: "request-12345678",
    idempotencyKey: "idempotency-12345678",
    resolutionDigest: canonicalAppDigest("resolution"),
    executionDigest: canonicalAppDigest("execution"),
    providerBinding: { providerId: "hubspot", connectionId: "hubspot-production", brokerCapability: "provider.action.execute" as const, operation: "crm.contacts.update" },
    companyObject: { type: "lead", identityDigest: canonicalAppDigest("lead-42") },
    environment: "production" as const,
    brokerPreparedActionId: "broker-action-12345678",
    brokerPreparedActionFingerprint: "f".repeat(64),
    brokerPrepareReceiptId: "broker-receipt-12345678",
    approvalRequired: true,
    riskClass: "write" as const,
    status: "prepared" as const,
    preparedAt: "2026-08-21T12:00:00.000Z",
    expiresAt: "2026-08-21T12:10:00.000Z",
    updatedAt: "2026-08-21T12:00:00.000Z"
  };
  return { ...base, recordDigest: canonicalAppDigest({ ...base, recordDigest: undefined }) };
}
