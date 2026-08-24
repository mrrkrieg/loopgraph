import { describe, expect, it, vi } from "vitest";
import type {
  AppOperationAction,
  AppOperationActionEvent,
  AppOperationActionReconciliationResult
} from "../core";
import type {
  AppOperationActionReconciliationCandidate,
  AppOperationActionStore
} from "./app-operation-action-store";
import { runAppActionReconciliationWorker } from "./app-action-reconciliation-worker";

const NOW = new Date("2026-08-21T12:10:00.000Z");

describe("App action reconciliation worker", () => {
  it("reconciles only old nonterminal commits with a stable secret-free identity", async () => {
    const requested = [
      commitEvent("action-old", "request-old-12345678", "2026-08-21T12:00:00.000Z"),
      commitEvent("action-fresh", "request-fresh-12345678", "2026-08-21T12:09:45.000Z"),
      commitEvent("action-terminal", "request-terminal-12345678", "2026-08-21T11:59:00.000Z"),
      commitEvent("action-revoked", "request-revoked-12345678", "2026-08-21T11:58:00.000Z")
    ];
    const actions = new Map(requested.map((event) => [event.actionId, action(event.actionId)]));
    const events = new Map<string, AppOperationActionEvent[]>([
      ["action-old", [requested[0]!]],
      ["action-fresh", [requested[1]!]],
      ["action-terminal", [requested[2]!, terminalEvent("action-terminal", "request-terminal-12345678")]],
      ["action-revoked", [requested[3]!, revokedEvent("action-revoked")]]
    ]);
    const store = actionStore(actions, requested, events);
    const reconcile = vi.fn(async () => ({
      status: "pending",
      brokerReconciliation: { reasonCode: "connector_commit_in_progress" }
    } as AppOperationActionReconciliationResult));

    const result = await runAppActionReconciliationWorker({
      actionStore: store,
      workspaceId: "main",
      now: NOW,
      minimumAgeMs: 60_000,
      reconcile
    });

    expect(result).toMatchObject({
      workspaceId: "main",
      scanned: 4,
      eligible: 1,
      pending: 1,
      resolvedSucceeded: 0,
      resolvedFailed: 0,
      unresolved: 0,
      failed: 0
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installed-action-old",
      actionId: "action-old",
      routeJobId: "route-action-old",
      agentInstanceId: "hermes-action-old",
      callId: expect.stringMatching(/^scheduled-reconcile-[a-f0-9]{48}$/)
    }));
    expect(result.items).toEqual([expect.objectContaining({
      actionId: "action-old",
      originalRequestId: "request-old-12345678",
      status: "pending",
      reasonCode: "connector_commit_in_progress"
    })]);
  });

  it("continues after a bounded reconciliation failure without returning raw errors", async () => {
    const requested = [commitEvent("action-error", "request-error-12345678", "2026-08-21T12:00:00.000Z")];
    const store = actionStore(
      new Map([["action-error", action("action-error")]]),
      requested,
      new Map([["action-error", requested]])
    );

    const result = await runAppActionReconciliationWorker({
      actionStore: store,
      workspaceId: "main",
      now: NOW,
      reconcile: async () => { throw new Error("provider token secret-value"); }
    });

    expect(result.failed).toBe(1);
    expect(result.items[0]).toMatchObject({ status: "failed", reasonCode: "reconciliation_boundary_failed" });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("uses the store's bounded candidate query when distributed persistence supports it", async () => {
    const selectedAction = action("action-distributed");
    const selectedEvent = commitEvent("action-distributed", "request-distributed-12345678", "2026-08-21T12:00:00.000Z");
    const store = actionStore(new Map(), [], new Map());
    store.listReconciliationCandidates = vi.fn(async () => [{
      action: selectedAction,
      requestEvent: selectedEvent as AppOperationActionReconciliationCandidate["requestEvent"]
    }]);
    const reconcile = vi.fn(async () => ({
      status: "unresolved",
      brokerReconciliation: { reasonCode: "connector_commit_receipt_unavailable" }
    } as AppOperationActionReconciliationResult));

    const result = await runAppActionReconciliationWorker({
      actionStore: store,
      workspaceId: "main",
      now: NOW,
      minimumAgeMs: 60_000,
      limit: 10,
      reconcile
    });

    expect(store.listReconciliationCandidates).toHaveBeenCalledWith({
      workspaceId: "main",
      requestedBefore: "2026-08-21T12:09:00.000Z",
      limit: 10
    });
    expect(store.listEvents).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, eligible: 1, unresolved: 1 });
  });
});

function action(id: string) {
  return {
    id,
    workspaceId: "main",
    installationId: `installed-${id}`,
    routeJobId: `route-${id}`,
    agentInstanceId: `hermes-${id}`
  } as AppOperationAction;
}

function commitEvent(actionId: string, requestId: string, occurredAt: string) {
  return {
    actionId,
    installationId: `installed-${actionId}`,
    eventType: "commit_requested",
    commit: { requestId, idempotencyKey: `idempotency-${requestId}`, outcome: "requested" },
    occurredAt
  } as AppOperationActionEvent;
}

function terminalEvent(actionId: string, requestId: string) {
  return {
    actionId,
    installationId: `installed-${actionId}`,
    eventType: "commit_succeeded",
    commit: { requestId, idempotencyKey: `idempotency-${requestId}`, outcome: "succeeded", connectorReceiptId: "receipt-12345678" },
    occurredAt: "2026-08-21T12:01:00.000Z"
  } as AppOperationActionEvent;
}

function revokedEvent(actionId: string) {
  return {
    actionId,
    installationId: `installed-${actionId}`,
    eventType: "revoked",
    occurredAt: "2026-08-21T12:01:00.000Z"
  } as AppOperationActionEvent;
}

function actionStore(
  actions: Map<string, AppOperationAction>,
  requested: AppOperationActionEvent[],
  events: Map<string, AppOperationActionEvent[]>
): AppOperationActionStore {
  return {
    persistence: "distributed",
    recordPrepared: vi.fn(),
    recordEvent: vi.fn(),
    get: vi.fn(async (_workspaceId, actionId) => actions.get(actionId)),
    list: vi.fn(async () => [...actions.values()]),
    listEvents: vi.fn(async (query) => query.eventType === "commit_requested"
      ? requested
      : events.get(query.actionId ?? "") ?? [])
  } as AppOperationActionStore;
}
