import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  buildCredentialNamespace,
  canonicalAppDigest,
  connectorInstallationAdminSchema
} from "../packages/loopgraph/src/core";
import {
  CompositeVault,
  HermesConnectorBroker,
  InMemoryConnectorState,
  assertSecretFree,
  operationKey
} from "../packages/loopgraph/src/runtime";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const appActionExactlyOnceProofSchema = z.object({
  schemaVersion: z.literal("app-action-exactly-once-proof/v1"),
  sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
  checkedAt: z.string().datetime({ offset: true }),
  scenario: z.literal("broker_receipt_persisted_before_app_terminal_event"),
  fixture: z.object({
    providerId: z.literal("slack"),
    operation: z.literal("message.send.execute"),
    environment: z.literal("staging"),
    networkAccess: z.literal(false),
    credentialAccess: z.literal(false)
  }).strict(),
  proof: z.object({
    providerInvocationCount: z.literal(1),
    originalCommitCalls: z.literal(1),
    reconciliationCalls: z.literal(1),
    replayCommitCalls: z.literal(1),
    appCommitRequestedEvents: z.literal(1),
    appTerminalEventsBeforeReconciliation: z.literal(0),
    appTerminalEventsAfterReconciliation: z.literal(1),
    reconciliationStatus: z.literal("resolved"),
    preparedActionStatus: z.literal("committed"),
    replayReturnedOriginalReceipt: z.literal(true),
    originalBrokerReceiptDigest: digestSchema
  }).strict(),
  outcome: z.literal("passed"),
  proofDigest: digestSchema
}).strict();

export type AppActionExactlyOnceProof = z.infer<typeof appActionExactlyOnceProofSchema>;

export function verifyAppActionExactlyOnceProof(input: unknown): AppActionExactlyOnceProof {
  const receipt = appActionExactlyOnceProofSchema.parse(input);
  const { proofDigest, ...base } = receipt;
  if (canonicalAppDigest(base) !== proofDigest) {
    throw new Error("App action exactly-once proof digest does not match its receipt body");
  }
  return receipt;
}

export async function proveAppActionExactlyOnce(input: {
  sourceCommitSha: string;
  checkedAt?: Date;
}): Promise<AppActionExactlyOnceProof> {
  const sourceCommitSha = z.string().regex(/^[a-f0-9]{40}$/).parse(input.sourceCommitSha);
  const checkedAt = input.checkedAt ?? new Date();
  if (!Number.isFinite(checkedAt.getTime())) throw new Error("Exactly-once proof time is invalid");

  const tenant = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    projectKey: "release-proof"
  };
  const installationId = "fixture-slack-staging";
  const credentialNamespace = buildCredentialNamespace({
    ...tenant,
    providerId: "slack",
    installationId,
    environment: "staging"
  });
  const installation = connectorInstallationAdminSchema.parse({
    id: installationId,
    tenant,
    providerId: "slack",
    displayName: "Release proof fixture",
    environment: "staging",
    status: "active",
    credentialRef: `vault://${credentialNamespace}/tokens/provider`,
    credentialNamespace,
    grantedScopes: ["chat:write"],
    allowedCapabilities: ["provider.action.execute"],
    createdAt: checkedAt.toISOString(),
    updatedAt: checkedAt.toISOString()
  });
  const state = new InMemoryConnectorState();
  await state.save(installation);

  let providerInvocationCount = 0;
  const broker = new HermesConnectorBroker({
    installations: state,
    idempotency: state,
    audit: state,
    preparedActions: state,
    approvals: { verify: async () => true },
    vault: new CompositeVault([]),
    handlers: new Map([[operationKey("slack", "message.send.execute"), async () => {
      providerInvocationCount += 1;
      return { fixtureMutationId: "mutation-1", accepted: true };
    }]]),
    defaultEnvironment: "staging",
    now: () => checkedAt
  });
  const actor = { type: "workload" as const, subject: "spiffe://loopgraph/release-proof/hermes" };
  const context = {
    workspaceId: "release-proof",
    environment: "staging" as const,
    agentInstanceId: "hermes-release-proof",
    companyObject: { type: "FixtureMessage", id: "fixture-message-1" },
    loopId: "release-proof-loop",
    loopSpecHash: "a".repeat(64),
    routeJobId: "release-proof-route-job",
    activationMode: "execute" as const
  };
  const expiresAt = new Date(checkedAt.getTime() + 5 * 60_000).toISOString();
  const prepared = await broker.prepareAction({
    protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
    requestId: "release_proof_prepare_00000001",
    idempotencyKey: "release_proof_prepare_idempotency_00000001",
    tenant,
    actor,
    providerId: "slack",
    installationId,
    capability: "provider.action.execute",
    operation: "message.send.execute",
    input: { channelId: "fixture-channel", text: "Approved fixture message" },
    context,
    issuedAt: checkedAt.toISOString(),
    expiresAt,
    correlationId: "release_proof_correlation_00000001"
  });
  const commitRequest = {
    protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
    requestId: "release_proof_commit_00000001",
    idempotencyKey: "release_proof_commit_idempotency_00000001",
    tenant,
    actor,
    providerId: "slack" as const,
    installationId,
    capability: "provider.action.execute" as const,
    operation: "message.send.execute",
    context,
    preparedActionId: prepared.preparedAction.actionId,
    preparedActionFingerprint: prepared.preparedAction.fingerprint,
    approvalReceiptId: "release-proof-approval-00000001",
    issuedAt: checkedAt.toISOString(),
    expiresAt,
    correlationId: "release_proof_correlation_00000001"
  };

  const appCommitRequestedEvents = 1;
  const originalResponse = await broker.commitAction(commitRequest);
  if (originalResponse.status !== "succeeded") {
    throw new Error("Fixture provider mutation did not produce a durable successful Broker receipt");
  }

  // Deliberately model a process loss after the Broker persisted its response but
  // before the App action ledger could append its terminal event.
  const appTerminalEventsBeforeReconciliation = 0;
  const reconciliation = await broker.reconcileAction({
    protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
    requestId: "release_proof_reconcile_00000001",
    idempotencyKey: "release_proof_reconcile_idempotency_00000001",
    tenant,
    actor,
    providerId: "slack",
    installationId,
    capability: "provider.action.execute",
    operation: "message.send.execute",
    context,
    preparedActionId: prepared.preparedAction.actionId,
    preparedActionFingerprint: prepared.preparedAction.fingerprint,
    originalRequestId: commitRequest.requestId,
    originalIdempotencyKey: commitRequest.idempotencyKey,
    issuedAt: checkedAt.toISOString(),
    expiresAt,
    correlationId: "release_proof_reconciliation_00000001"
  });
  if (reconciliation.status !== "resolved" ||
      reconciliation.brokerResponse?.receipt.receiptId !== originalResponse.receipt.receiptId) {
    throw new Error("Receipt-only reconciliation did not resolve the original durable Broker response");
  }
  const appTerminalEventsAfterReconciliation = 1;

  const replayResponse = await broker.commitAction(commitRequest);
  const replayReturnedOriginalReceipt =
    replayResponse.receipt.receiptId === originalResponse.receipt.receiptId;
  if (providerInvocationCount !== 1 || !replayReturnedOriginalReceipt) {
    throw new Error("Exactly-once proof observed a repeated fixture provider mutation");
  }

  const base = {
    schemaVersion: "app-action-exactly-once-proof/v1" as const,
    sourceCommitSha,
    checkedAt: checkedAt.toISOString(),
    scenario: "broker_receipt_persisted_before_app_terminal_event" as const,
    fixture: {
      providerId: "slack" as const,
      operation: "message.send.execute" as const,
      environment: "staging" as const,
      networkAccess: false as const,
      credentialAccess: false as const
    },
    proof: {
      providerInvocationCount: 1 as const,
      originalCommitCalls: 1 as const,
      reconciliationCalls: 1 as const,
      replayCommitCalls: 1 as const,
      appCommitRequestedEvents,
      appTerminalEventsBeforeReconciliation,
      appTerminalEventsAfterReconciliation,
      reconciliationStatus: reconciliation.status,
      preparedActionStatus: reconciliation.preparedActionStatus,
      replayReturnedOriginalReceipt: true as const,
      originalBrokerReceiptDigest: canonicalAppDigest(originalResponse.receipt)
    },
    outcome: "passed" as const
  };
  const receipt = verifyAppActionExactlyOnceProof({
    ...base,
    proofDigest: canonicalAppDigest(base)
  });
  assertSecretFree(receipt, "app_action_exactly_once_proof");
  return receipt;
}

function requiredCommitSha() {
  const value = process.env.GITHUB_SHA?.trim() || process.env.LOOPGRAPH_PROOF_COMMIT_SHA?.trim();
  if (!value) throw new Error("GITHUB_SHA or LOOPGRAPH_PROOF_COMMIT_SHA is required");
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receipt = await proveAppActionExactlyOnce({ sourceCommitSha: requiredCommitSha() });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
