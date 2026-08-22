import { contentDigest, type AppOperationActionReconciliationResult } from "../core";
import type { AppOperationActionStore } from "./app-operation-action-store";

export const APP_ACTION_RECONCILIATION_WORKER_SCHEMA_VERSION = "loopgraph-app-action-reconciliation-worker/v1alpha1" as const;

export type AppActionReconciliationWorkerItem = {
  actionId: string;
  installationId: string;
  originalRequestId: string;
  status: AppOperationActionReconciliationResult["status"] | "failed";
  reasonCode?: string;
};

export type AppActionReconciliationWorkerResult = {
  schemaVersion: typeof APP_ACTION_RECONCILIATION_WORKER_SCHEMA_VERSION;
  workspaceId: string;
  scanned: number;
  eligible: number;
  resolvedSucceeded: number;
  resolvedFailed: number;
  pending: number;
  unresolved: number;
  failed: number;
  items: AppActionReconciliationWorkerItem[];
  completedAt: string;
};

/**
 * Finds App actions with an old commit request and no terminal event, then asks
 * the caller to reconcile each one. This worker never receives provider input
 * and cannot invoke a provider operation; the supplied callback must enter the
 * same receipt-only App reconciliation boundary used by Hermes.
 */
export async function runAppActionReconciliationWorker(input: {
  actionStore: AppOperationActionStore;
  workspaceId: string;
  reconcile: (request: {
    installationId: string;
    actionId: string;
    routeJobId: string;
    agentInstanceId: string;
    callId: string;
  }) => Promise<AppOperationActionReconciliationResult>;
  now?: Date;
  limit?: number;
  minimumAgeMs?: number;
}): Promise<AppActionReconciliationWorkerResult> {
  const now = input.now ?? new Date();
  const limit = boundedInteger(input.limit, 25, 1, 100, "reconciliation worker limit");
  const minimumAgeMs = boundedInteger(input.minimumAgeMs, 60_000, 30_000, 24 * 60 * 60 * 1_000, "reconciliation minimum age");
  const requestedBefore = new Date(now.getTime() - minimumAgeMs).toISOString();
  if (input.actionStore.listReconciliationCandidates) {
    const directCandidates = await input.actionStore.listReconciliationCandidates({
      workspaceId: input.workspaceId,
      requestedBefore,
      limit
    });
    return reconcileCandidates({
      workspaceId: input.workspaceId,
      now,
      scanned: directCandidates.length,
      candidates: directCandidates.map(({ action, requestEvent }) => ({
        actionId: action.id,
        installationId: action.installationId,
        routeJobId: action.routeJobId,
        agentInstanceId: action.agentInstanceId,
        originalRequestId: requestEvent.commit.requestId
      })),
      reconcile: input.reconcile
    });
  }
  const requested = await input.actionStore.listEvents({
    workspaceId: input.workspaceId,
    eventType: "commit_requested",
    limit: 1_000
  });
  const cutoff = Date.parse(requestedBefore);
  const seen = new Set<string>();
  const candidates: Array<{
    actionId: string;
    installationId: string;
    routeJobId: string;
    agentInstanceId: string;
    originalRequestId: string;
  }> = [];

  for (const requestEvent of requested) {
    if (candidates.length >= limit || seen.has(requestEvent.actionId) || !requestEvent.commit) continue;
    seen.add(requestEvent.actionId);
    if (Date.parse(requestEvent.occurredAt) > cutoff) continue;
    const [action, events] = await Promise.all([
      input.actionStore.get(input.workspaceId, requestEvent.actionId),
      input.actionStore.listEvents({ workspaceId: input.workspaceId, actionId: requestEvent.actionId, limit: 100 })
    ]);
    if (!action || action.installationId !== requestEvent.installationId) continue;
    const terminal = events.some((event) =>
      ["commit_succeeded", "commit_failed"].includes(event.eventType) &&
      event.commit?.requestId === requestEvent.commit?.requestId
    );
    if (terminal || events.some((event) => event.eventType === "revoked")) continue;
    candidates.push({
      actionId: action.id,
      installationId: action.installationId,
      routeJobId: action.routeJobId,
      agentInstanceId: action.agentInstanceId,
      originalRequestId: requestEvent.commit.requestId
    });
  }

  return reconcileCandidates({
    workspaceId: input.workspaceId,
    now,
    scanned: requested.length,
    candidates,
    reconcile: input.reconcile
  });
}

async function reconcileCandidates(input: {
  workspaceId: string;
  now: Date;
  scanned: number;
  candidates: Array<{
    actionId: string;
    installationId: string;
    routeJobId: string;
    agentInstanceId: string;
    originalRequestId: string;
  }>;
  reconcile: (request: {
    installationId: string;
    actionId: string;
    routeJobId: string;
    agentInstanceId: string;
    callId: string;
  }) => Promise<AppOperationActionReconciliationResult>;
}): Promise<AppActionReconciliationWorkerResult> {
  const items: AppActionReconciliationWorkerItem[] = [];
  for (const candidate of input.candidates) {
    try {
      const result = await input.reconcile({
        installationId: candidate.installationId,
        actionId: candidate.actionId,
        routeJobId: candidate.routeJobId,
        agentInstanceId: candidate.agentInstanceId,
        callId: `scheduled-reconcile-${contentDigest({
          workspaceId: input.workspaceId,
          actionId: candidate.actionId,
          originalRequestId: candidate.originalRequestId
        }).slice(0, 48)}`
      });
      items.push({
        actionId: candidate.actionId,
        installationId: candidate.installationId,
        originalRequestId: candidate.originalRequestId,
        status: result.status,
        ...(result.brokerReconciliation.reasonCode ? { reasonCode: result.brokerReconciliation.reasonCode } : {})
      });
    } catch {
      items.push({
        actionId: candidate.actionId,
        installationId: candidate.installationId,
        originalRequestId: candidate.originalRequestId,
        status: "failed",
        reasonCode: "reconciliation_boundary_failed"
      });
    }
  }

  return {
    schemaVersion: APP_ACTION_RECONCILIATION_WORKER_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    scanned: input.scanned,
    eligible: input.candidates.length,
    resolvedSucceeded: count(items, "resolved_succeeded"),
    resolvedFailed: count(items, "resolved_failed"),
    pending: count(items, "pending"),
    unresolved: count(items, "unresolved"),
    failed: count(items, "failed"),
    items,
    completedAt: input.now.toISOString()
  };
}

function count(items: AppActionReconciliationWorkerItem[], status: AppActionReconciliationWorkerItem["status"]) {
  return items.filter((item) => item.status === status).length;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return candidate;
}
