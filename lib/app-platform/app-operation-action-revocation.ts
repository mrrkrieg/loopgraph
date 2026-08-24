import {
  APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
  appOperationActionEventSchema,
  canonicalAppDigest,
  type AppOperationActionEvent
} from "loopgraph/core";
import type { AppOperationActionStore } from "loopgraph/runtime";

export type ConnectorActionRevocation = {
  actionId: string;
  fingerprint: string;
  status: "revoked";
};

/**
 * Revokes one exact App-owned provider action without disconnecting the
 * provider. The browser never supplies provider, connection, operation,
 * Broker action, or fingerprint identity; those values are re-derived from
 * the immutable action ownership record.
 */
export async function revokeAppOperationAction(input: {
  workspaceId: string;
  installationId: string;
  actionId: string;
  reason: string;
  actorSubject: string;
  actionStore: AppOperationActionStore;
  revokeConnectorAction: (input: {
    installationId: string;
    actionId: string;
    fingerprint: string;
    reason: string;
  }) => Promise<ConnectorActionRevocation>;
  now?: Date;
}): Promise<{ revocation: ConnectorActionRevocation; event: AppOperationActionEvent }> {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1_000) throw new Error("App action revocation reason must contain 3 to 1000 characters");
  if (!input.actorSubject.trim() || input.actorSubject.length > 512) throw new Error("App action revocation requires an accountable actor");

  const action = await input.actionStore.get(input.workspaceId, input.actionId);
  if (!action || action.installationId !== input.installationId) {
    throw new Error("Prepared App action is unavailable for this installation");
  }
  const lifecycleEvents = await input.actionStore.listEvents({
    workspaceId: input.workspaceId,
    actionId: action.id,
    limit: 100
  });
  const existing = lifecycleEvents.find((event) => event.eventType === "revoked");
  if (existing) {
    return {
      revocation: {
        actionId: action.brokerPreparedActionId,
        fingerprint: action.brokerPreparedActionFingerprint,
        status: "revoked"
      },
      event: existing
    };
  }
  if (lifecycleEvents.some((event) => event.eventType === "commit_succeeded")) {
    throw new Error("Committed App actions cannot be revoked");
  }
  const incompleteCommit = lifecycleEvents.find((event) =>
    event.eventType === "commit_requested" && event.commit &&
    !lifecycleEvents.some((candidate) =>
      ["commit_succeeded", "commit_failed"].includes(candidate.eventType) &&
      candidate.commit?.requestId === event.commit?.requestId
    )
  );
  if (incompleteCommit) throw new Error("App action commit is in progress and must be reconciled before revocation");

  const revocation = await input.revokeConnectorAction({
    installationId: action.providerBinding.connectionId,
    actionId: action.brokerPreparedActionId,
    fingerprint: action.brokerPreparedActionFingerprint,
    reason
  });
  if (revocation.actionId !== action.brokerPreparedActionId ||
    revocation.fingerprint !== action.brokerPreparedActionFingerprint ||
    revocation.status !== "revoked") {
    throw new Error("Connector revocation receipt does not match the immutable App action");
  }

  const reasonDigest = canonicalAppDigest(reason);
  const eventBase = {
    schemaVersion: APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
    id: `appactevt_${canonicalAppDigest({ actionId: action.id, eventType: "revoked" }).slice("sha256:".length, "sha256:".length + 48)}`,
    workspaceId: input.workspaceId,
    installationId: action.installationId,
    actionId: action.id,
    actionRecordDigest: action.recordDigest,
    eventType: "revoked" as const,
    actor: { type: "user" as const, subject: input.actorSubject },
    revocation: { reasonDigest },
    occurredAt: now.toISOString()
  };
  const event = appOperationActionEventSchema.parse({
    ...eventBase,
    eventDigest: canonicalAppDigest({ ...eventBase, eventDigest: undefined })
  });
  await input.actionStore.recordEvent(event);
  return { revocation, event };
}
