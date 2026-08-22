import {
  APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
  appOperationActionEventSchema,
  canonicalAppDigest,
  type AppOperationActionEvent
} from "loopgraph/core";
import type {
  AppInstallationStore,
  AppOperationActionStore
} from "loopgraph/runtime";

export type ConnectorActionApproval = {
  approvalId: string;
  actionId: string;
  fingerprint: string;
  expiresAt: string;
};

/**
 * Approves a provider action through its App-owned identity.
 *
 * The browser supplies only the App installation/action IDs and review
 * reason. Provider, connection, operation, Broker action, and fingerprint are
 * all recovered from trusted immutable state and rechecked against the
 * currently installed artifact before an approval receipt is created.
 */
export async function approveAppOperationAction(input: {
  workspaceId: string;
  installationId: string;
  actionId: string;
  reason: string;
  actorSubject: string;
  actionStore: AppOperationActionStore;
  installationStore: AppInstallationStore;
  approveConnectorAction: (input: {
    installationId: string;
    actionId: string;
    fingerprint: string;
    reason: string;
  }) => Promise<ConnectorActionApproval>;
  now?: Date;
}): Promise<{ approval: ConnectorActionApproval; event: AppOperationActionEvent }> {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1_000) throw new Error("App action approval reason must contain 3 to 1000 characters");
  if (!input.actorSubject.trim() || input.actorSubject.length > 512) throw new Error("App action approval requires an accountable actor");

  const action = await input.actionStore.get(input.workspaceId, input.actionId);
  if (!action || action.installationId !== input.installationId) {
    throw new Error("Prepared App action is unavailable for this installation");
  }
  if (!action.approvalRequired) throw new Error("Prepared App action does not require human approval");
  if (Date.parse(action.expiresAt) <= now.getTime()) throw new Error("Prepared App action has expired");
  const lifecycleEvents = await input.actionStore.listEvents({
    workspaceId: input.workspaceId,
    actionId: action.id,
    limit: 100
  });
  const priorApproval = lifecycleEvents.find((event) =>
    event.eventType === "approval_granted" &&
    event.approval &&
    Date.parse(event.approval.expiresAt) > now.getTime() &&
    !lifecycleEvents.some((candidate) => candidate.eventType === "commit_failed" && candidate.occurredAt >= event.occurredAt)
  );
  if (priorApproval) throw new Error("Prepared App action already has an approval receipt");

  const registry = await input.installationStore.read();
  if (registry.workspaceId !== input.workspaceId) throw new Error("App installation registry belongs to another workspace");
  const installation = registry.installations.find((candidate) => candidate.id === input.installationId);
  if (!installation || installation.appId !== action.appId) throw new Error("Prepared App action does not belong to the current installation");
  if (installation.artifactDigest !== action.artifactDigest) throw new Error("Prepared App action belongs to a stale App artifact");
  if (!["execute_with_approval", "live"].includes(installation.state) || !["execute_with_approval", "live"].includes(installation.mode)) {
    throw new Error("Installed App is not in an approval-gated execution mode");
  }
  if (!installation.ownedAssets.some((asset) => asset.kind === "loop_spec" && asset.assetId === action.loopId && asset.ownerInstallationIds.includes(installation.id))) {
    throw new Error("Prepared App action loop is no longer owned by this installation");
  }
  const binding = installation.operationBindings[action.capability];
  if (!binding || binding.executor !== "connector_broker" ||
    binding.providerId !== action.providerBinding.providerId ||
    binding.connectionId !== action.providerBinding.connectionId ||
    binding.brokerCapability !== action.providerBinding.brokerCapability ||
    binding.operation !== action.providerBinding.operation) {
    throw new Error("Prepared App action no longer matches the installed capability binding");
  }

  const approval = await input.approveConnectorAction({
    installationId: action.providerBinding.connectionId,
    actionId: action.brokerPreparedActionId,
    fingerprint: action.brokerPreparedActionFingerprint,
    reason
  });
  if (approval.actionId !== action.brokerPreparedActionId ||
    approval.fingerprint !== action.brokerPreparedActionFingerprint ||
    Date.parse(approval.expiresAt) > Date.parse(action.expiresAt)) {
    throw new Error("Connector approval receipt does not match the immutable App action");
  }
  const eventBase = {
    schemaVersion: APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
    id: `appactevt_${canonicalAppDigest({ actionId: action.id, approvalId: approval.approvalId }).slice("sha256:".length, "sha256:".length + 48)}`,
    workspaceId: input.workspaceId,
    installationId: action.installationId,
    actionId: action.id,
    actionRecordDigest: action.recordDigest,
    eventType: "approval_granted" as const,
    actor: { type: "user" as const, subject: input.actorSubject },
    approval: {
      connectorApprovalReceiptId: approval.approvalId,
      reasonDigest: canonicalAppDigest(reason),
      expiresAt: approval.expiresAt
    },
    occurredAt: now.toISOString()
  };
  const event = appOperationActionEventSchema.parse({
    ...eventBase,
    eventDigest: canonicalAppDigest({ ...eventBase, eventDigest: undefined })
  });
  await input.actionStore.recordEvent(event);
  return { approval, event };
}
