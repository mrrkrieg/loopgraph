import { describe, expect, it, vi } from "vitest";
import {
  APP_OPERATION_ACTION_SCHEMA_VERSION,
  canonicalAppDigest,
  type AppOperationAction,
  type AppOperationActionEvent
} from "loopgraph/core";
import type { AppOperationActionStore } from "loopgraph/runtime";
import { revokeAppOperationAction } from "./app-operation-action-revocation";

describe("App operation action revocation", () => {
  it("derives the Connector Broker identity and records only a reason digest", async () => {
    const action = preparedAction();
    const recorded: AppOperationActionEvent[] = [];
    const revokeConnectorAction = vi.fn(async () => ({
      actionId: action.brokerPreparedActionId,
      fingerprint: action.brokerPreparedActionFingerprint,
      status: "revoked" as const
    }));
    const result = await revokeAppOperationAction({
      workspaceId: action.workspaceId,
      installationId: action.installationId,
      actionId: action.id,
      reason: "The account owner withdrew authorization.",
      actorSubject: "reviewer-1",
      actionStore: actionStore(action, recorded),
      revokeConnectorAction,
      now: new Date("2026-08-21T12:02:00.000Z")
    });

    expect(revokeConnectorAction).toHaveBeenCalledWith({
      installationId: "hubspot-production",
      actionId: "broker-action-12345678",
      fingerprint: "f".repeat(64),
      reason: "The account owner withdrew authorization."
    });
    expect(result.event).toMatchObject({
      eventType: "revoked",
      actor: { type: "user", subject: "reviewer-1" },
      revocation: { reasonDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }
    });
    expect(JSON.stringify(result.event)).not.toContain("withdrew authorization");
    expect(recorded).toEqual([result.event]);
  });

  it("is idempotent after revocation and refuses committed or in-flight actions", async () => {
    const action = preparedAction();
    const existing = lifecycleEvent(action, "revoked");
    const revokeConnectorAction = vi.fn();
    const repeated = await revokeAppOperationAction({
      workspaceId: action.workspaceId,
      installationId: action.installationId,
      actionId: action.id,
      reason: "Still revoked.",
      actorSubject: "reviewer-1",
      actionStore: actionStore(action, [], [existing]),
      revokeConnectorAction,
      now: new Date("2026-08-21T12:02:00.000Z")
    });
    expect(repeated.event).toEqual(existing);
    expect(revokeConnectorAction).not.toHaveBeenCalled();

    await expect(revokeAppOperationAction({
      workspaceId: action.workspaceId,
      installationId: action.installationId,
      actionId: action.id,
      reason: "Too late to revoke.",
      actorSubject: "reviewer-1",
      actionStore: actionStore(action, [], [lifecycleEvent(action, "commit_succeeded")]),
      revokeConnectorAction,
      now: new Date("2026-08-21T12:02:00.000Z")
    })).rejects.toThrow(/cannot be revoked/i);

    await expect(revokeAppOperationAction({
      workspaceId: action.workspaceId,
      installationId: action.installationId,
      actionId: action.id,
      reason: "Wait for reconciliation.",
      actorSubject: "reviewer-1",
      actionStore: actionStore(action, [], [lifecycleEvent(action, "commit_requested")]),
      revokeConnectorAction,
      now: new Date("2026-08-21T12:02:00.000Z")
    })).rejects.toThrow(/in progress/i);
  });
});

function actionStore(action: AppOperationAction, recorded: AppOperationActionEvent[], events: AppOperationActionEvent[] = []): AppOperationActionStore {
  return {
    persistence: "file",
    recordPrepared: vi.fn(),
    get: vi.fn(async (workspaceId, actionId) => workspaceId === action.workspaceId && actionId === action.id ? action : undefined),
    list: vi.fn(async () => [action]),
    recordEvent: vi.fn(async (event) => { recorded.push(event); return event; }),
    listEvents: vi.fn(async () => events)
  };
}

function lifecycleEvent(action: AppOperationAction, eventType: "revoked" | "commit_requested" | "commit_succeeded"): AppOperationActionEvent {
  const base = {
    schemaVersion: "loopgraph-app-operation-action-event/v1alpha1" as const,
    id: `appactevt_${eventType.replaceAll("_", "-")}`,
    workspaceId: action.workspaceId,
    installationId: action.installationId,
    actionId: action.id,
    actionRecordDigest: action.recordDigest,
    eventType,
    actor: { type: eventType === "revoked" ? "user" as const : "workload" as const, subject: eventType === "revoked" ? "reviewer-1" : action.agentInstanceId },
    ...(eventType === "revoked" ? { revocation: { reasonDigest: canonicalAppDigest("revoked") } } : {
      commit: {
        requestId: "request-commit-12345678",
        idempotencyKey: "idempotency-commit-12345678",
        ...(eventType === "commit_succeeded" ? { connectorReceiptId: "receipt-commit-12345678" } : {}),
        outcome: eventType === "commit_requested" ? "requested" as const : "succeeded" as const
      }
    }),
    occurredAt: "2026-08-21T12:01:00.000Z"
  };
  return {
    ...base,
    eventDigest: canonicalAppDigest({ ...base, eventDigest: undefined })
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
