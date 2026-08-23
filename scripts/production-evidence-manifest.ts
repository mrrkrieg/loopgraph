import { createPublicKey, verify } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { canonicalAppDigest } from "loopgraph/core";
import {
  auditDrainReceiptV3Schema,
  canonicalJson,
  readBoundedIntegrityFile,
  retentionAcknowledgementSigningPayload,
  sha256Digest
} from "./audit-retention-protocol";
import { RECOVERY_TABLES } from "./recovery-contract";
import { verifyAppActionExactlyOnceProof } from "./prove-app-action-exactly-once";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const projectKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const originSchema = z.string().url();

const stagingReceiptSchema = z.object({
  schemaVersion: z.literal("staging-validation/v5"),
  targetOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  auditCheckpoint: z.object({
    headSequence: safeInteger,
    headHash: hashSchema
  }).strict(),
  results: z.array(z.object({
    name: z.enum([
      "readiness",
      "operational_metrics",
      "app_action_reconciliation_health",
      "audit_integrity",
      "unauthenticated_user_denial",
      "cross_tenant_user_denial",
      "suspended_user_denial",
      "user_api_quota_saturation"
    ]),
    status: z.number().int().min(100).max(599),
    ok: z.literal(true),
    detail: z.string().min(1).max(1024)
  }).strict()).length(8),
  quotaEvidence: z.object({
    bucket: z.literal("admin"),
    limit: z.number().int().min(1).max(10),
    allowedRequests: z.number().int().min(1).max(10),
    deniedStatus: z.literal(429),
    retryAfterSeconds: z.number().int().min(1).max(30)
  }).strict(),
  appActionReconciliationEvidence: z.object({
    requestedTotal: safeInteger,
    succeededTotal: safeInteger,
    failedTotal: safeInteger,
    pending: z.literal(0),
    stale: z.literal(0),
    oldestAgeSeconds: z.literal(0),
    staleAfterSeconds: z.number().int().min(60).max(86_400)
  }).strict()
}).strict();

const marketplaceReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-marketplace-staging-validation/v2"),
  targetOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  app: z.object({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    artifactDigest: digestSchema
  }).strict(),
  auditEvidence: z.object({
    afterSequence: safeInteger,
    throughSequence: safeInteger,
    headHash: hashSchema,
    requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
  }).strict(),
  checks: z.array(z.object({
    name: z.string().min(1).max(128),
    ok: z.literal(true),
    status: z.number().int().min(100).max(599).optional(),
    detail: z.string().min(1).max(2048)
  }).strict()).length(7)
}).strict();

const appSnapshotReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-app-snapshot-staging-validation/v1"),
  targetOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  snapshotIdentityDigest: digestSchema,
  artifactDigest: digestSchema,
  filesDigest: digestSchema,
  checks: z.array(z.object({
    name: z.enum([
      "private_bounded_bucket",
      "authenticated_download_denial",
      "authenticated_insert_denial",
      "authenticated_update_denial",
      "authenticated_delete_denial",
      "immutable_first_writer",
      "cross_replica_exact_recovery",
      "cleanup_verified"
    ]),
    ok: z.literal(true),
    detail: z.string().min(1).max(2048)
  }).strict()).length(8)
}).strict();

const appSnapshotRecoveryReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-app-snapshot-restore-rehearsal/v1"),
  sourceOrigin: originSchema,
  restoreOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  archiveSizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
  snapshotIdentityDigest: digestSchema,
  artifactDigest: digestSchema,
  filesDigest: digestSchema,
  checks: z.array(z.object({
    name: z.enum([
      "separate_private_bounded_buckets",
      "source_archive_exported",
      "target_first_writer_restore",
      "isolated_target_exact_load",
      "source_preserved_after_target_cleanup",
      "cleanup_verified"
    ]),
    ok: z.literal(true),
    detail: z.string().min(1).max(2048)
  }).strict()).length(6)
}).strict();

const appSnapshotReconciliationReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-app-snapshot-reconciliation/v2"),
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  scopeDigest: digestSchema,
  inventoryPasses: z.number().int().min(2).max(4),
  inventoryGeneration: safeInteger,
  inventoryGenerationDigest: digestSchema,
  registriesScanned: safeInteger,
  detachedInstallations: safeInteger,
  verifiedSnapshots: safeInteger,
  missingSnapshots: z.literal(0),
  corruptSnapshots: z.literal(0),
  untrackedSnapshots: z.literal(0),
  unavailableSnapshots: z.literal(0),
  storageObjects: safeInteger,
  referencedStorageObjects: safeInteger,
  unreferencedSnapshots: safeInteger,
  malformedStorageObjects: z.literal(0),
  unreferencedInventoryDigest: digestSchema,
  healthy: z.literal(true),
  checks: z.array(z.object({
    name: z.enum([
      "tenant_registry_scan",
      "pinned_scope_identity",
      "non_empty_inventory_policy",
      "durable_descriptor_authority",
      "exact_archive_verification",
      "stable_cross_store_inventory",
      "exact_storage_inventory",
      "pinned_unreferenced_retention",
      "aggregate_only_receipt"
    ]),
    ok: z.literal(true)
  }).strict()).length(9)
}).strict().superRefine((receipt, context) => {
  if (receipt.verifiedSnapshots !== receipt.detachedInstallations) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verifiedSnapshots"],
      message: "Every detached App snapshot must verify before promotion"
    });
  }
  if (receipt.referencedStorageObjects + receipt.unreferencedSnapshots !== receipt.storageObjects) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["storageObjects"],
      message: "Referenced and retained App snapshots must cover the exact Storage inventory"
    });
  }
  if (receipt.referencedStorageObjects > receipt.verifiedSnapshots) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["referencedStorageObjects"],
      message: "Referenced Storage objects cannot exceed verified detached App snapshots"
    });
  }
  if (
    receipt.inventoryGenerationDigest !== canonicalAppDigest({
      scopeDigest: receipt.scopeDigest,
      generation: receipt.inventoryGeneration
    })
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inventoryGenerationDigest"],
      message: "App snapshot inventory generation digest must bind the exact scoped generation"
    });
  }
});

const recoveryReceiptSchema = z.object({
  schemaVersion: z.literal("backup-restore-rehearsal/v2"),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  dumpDurationMs: safeInteger,
  restoreDurationMs: safeInteger,
  dumpSizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  publicTableCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  postgresMajor: z.number().int().min(12).max(99),
  sourceHost: z.string().min(1).max(253),
  targetHost: z.string().min(1).max(253),
  sourceIdentityDigest: digestSchema,
  targetIdentityDigest: digestSchema,
  criticalTables: z.array(z.object({
    table: z.enum(RECOVERY_TABLES),
    rowCount: safeInteger,
    sha256: hashSchema,
    matched: z.literal(true)
  }).strict()).length(RECOVERY_TABLES.length),
  auditIntegrity: z.object({
    valid: z.literal(true),
    eventsChecked: safeInteger,
    scopesChecked: safeInteger
  }).strict(),
  evidenceRecordCounts: z.record(z.string(), safeInteger),
  externalArtifactBytes: z.object({
    verified: z.literal(false),
    requiredNextGate: z.literal("validate:marketplace-staging"),
    reason: z.string().min(1).max(1024)
  }).strict()
}).strict();

const evidenceDescriptorSchema = z.object({
  digest: digestSchema,
  completedAt: z.string().datetime({ offset: true }),
  summary: z.record(z.string(), z.union([z.string(), safeInteger, z.boolean()]))
}).strict();

export const productionEvidenceManifestSchema = z.object({
  schemaVersion: z.literal("loopgraph-production-promotion-evidence/v6"),
  release: z.object({
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    workflowRunId: z.string().regex(/^\d{1,32}$/),
    workflowRunAttempt: z.number().int().positive().max(10_000),
    deploymentOrigin: originSchema,
    generatedAt: z.string().datetime({ offset: true })
  }).strict(),
  scope: z.object({
    organizationId: z.string().uuid(),
    projectKey: projectKeySchema,
    databaseIdentityDigest: digestSchema,
    marketplaceApp: z.object({
      id: z.string().min(1).max(256),
      version: z.string().min(1).max(128),
      artifactDigest: digestSchema
    }).strict(),
    appSnapshotRetention: z.object({
      unreferencedInventoryDigest: digestSchema
    }).strict(),
    auditRetentionTrust: z.object({
      keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/),
      publicKeyDigest: digestSchema
    }).strict()
  }).strict(),
  evidence: z.object({
    staging: evidenceDescriptorSchema,
    appActionExactlyOnce: evidenceDescriptorSchema,
    marketplace: evidenceDescriptorSchema,
    appSnapshots: evidenceDescriptorSchema,
    appSnapshotRecovery: evidenceDescriptorSchema,
    appSnapshotReconciliation: evidenceDescriptorSchema,
    recovery: evidenceDescriptorSchema,
    auditRetention: evidenceDescriptorSchema
  }).strict(),
  evidenceSetDigest: digestSchema
}).strict();

export type ProductionEvidenceManifest = z.infer<typeof productionEvidenceManifestSchema>;

export type ProductionEvidenceReceipts = {
  staging: unknown;
  appActionExactlyOnce: unknown;
  marketplace: unknown;
  appSnapshots: unknown;
  appSnapshotRecovery: unknown;
  appSnapshotReconciliation: unknown;
  recovery: unknown;
  auditRetention: unknown;
};

export type ProductionEvidenceConfig = {
  repository: string;
  commitSha: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  deploymentOrigin: string;
  storageOrigin: string;
  snapshotRestoreOrigin: string;
  organizationId: string;
  projectKey: string;
  databaseIdentityDigest: string;
  marketplaceApp: { id: string; version: string; artifactDigest: string };
  expectedAppSnapshotUnreferencedInventoryDigest: string;
  auditRetentionKeyId: string;
  auditRetentionPublicKeyPem: string;
  generatedAt: Date;
  maximumEvidenceAgeMinutes: number;
};

export function buildProductionEvidenceManifest(
  receipts: ProductionEvidenceReceipts,
  config: ProductionEvidenceConfig
) {
  const deploymentOrigin = trustedOrigin(config.deploymentOrigin, "Release deployment origin");
  const staging = stagingReceiptSchema.parse(receipts.staging);
  const appActionExactlyOnce = verifyAppActionExactlyOnceProof(receipts.appActionExactlyOnce);
  const marketplace = marketplaceReceiptSchema.parse(receipts.marketplace);
  const appSnapshots = appSnapshotReceiptSchema.parse(receipts.appSnapshots);
  const appSnapshotRecovery = appSnapshotRecoveryReceiptSchema.parse(receipts.appSnapshotRecovery);
  const appSnapshotReconciliation = appSnapshotReconciliationReceiptSchema.parse(
    receipts.appSnapshotReconciliation
  );
  const recovery = recoveryReceiptSchema.parse(receipts.recovery);
  const auditRetention = auditDrainReceiptV3Schema.parse(receipts.auditRetention);
  validateConfig(config);
  const auditRetentionPublicKey = createPublicKey(config.auditRetentionPublicKeyPem);
  if (auditRetentionPublicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Audit retention trust anchor must be an Ed25519 public key");
  }

  for (const [label, timestamp] of [
    ["staging validation", staging.checkedAt],
    ["App action exactly-once proof", appActionExactlyOnce.checkedAt],
    ["marketplace validation", marketplace.checkedAt],
    ["App snapshot validation", appSnapshots.checkedAt],
    ["App snapshot recovery rehearsal", appSnapshotRecovery.completedAt],
    ["App snapshot reconciliation", appSnapshotReconciliation.checkedAt],
    ["recovery rehearsal", recovery.completedAt],
    ["audit retention", auditRetention.completedAt]
  ] as const) {
    requireFreshEvidence(label, timestamp, config.generatedAt, config.maximumEvidenceAgeMinutes);
  }

  if (
    staging.targetOrigin !== deploymentOrigin ||
    marketplace.targetOrigin !== deploymentOrigin ||
    auditRetention.sourceOrigin !== deploymentOrigin
  ) {
    throw new Error("Release receipts do not belong to the exact promoted deployment origin");
  }
  if (appSnapshots.targetOrigin !== trustedOrigin(config.storageOrigin, "Release Storage origin")) {
    throw new Error("App snapshot evidence does not belong to the exact protected Storage origin");
  }
  if (
    appSnapshotRecovery.sourceOrigin !== appSnapshots.targetOrigin ||
    appSnapshotRecovery.restoreOrigin !== trustedOrigin(
      config.snapshotRestoreOrigin,
      "Release snapshot restore origin"
    ) ||
    appSnapshotRecovery.sourceOrigin === appSnapshotRecovery.restoreOrigin
  ) {
    throw new Error("App snapshot recovery evidence does not bind the protected source to the isolated restore origin");
  }
  if (
    appSnapshotRecovery.artifactDigest !== appSnapshots.artifactDigest ||
    appSnapshotRecovery.filesDigest !== appSnapshots.filesDigest
  ) {
    throw new Error("App snapshot recovery evidence did not restore the exact validated App payload");
  }
  if (Date.parse(appSnapshotRecovery.completedAt) < Date.parse(appSnapshotRecovery.startedAt)) {
    throw new Error("App snapshot recovery evidence completed before it started");
  }
  if (
    appSnapshotReconciliation.scopeDigest !== canonicalAppDigest({
      origin: appSnapshots.targetOrigin,
      organizationId: config.organizationId,
      projectKey: config.projectKey
    })
  ) {
    throw new Error("App snapshot reconciliation evidence does not match the protected Storage and tenant scope");
  }
  if (
    appSnapshotReconciliation.unreferencedInventoryDigest !==
    config.expectedAppSnapshotUnreferencedInventoryDigest
  ) {
    throw new Error("App snapshot reconciliation evidence does not match the protected retention inventory");
  }
  if (appActionExactlyOnce.sourceCommitSha !== config.commitSha) {
    throw new Error("App action exactly-once proof does not belong to the promoted source commit");
  }
  if (
    staging.organizationId !== config.organizationId ||
    marketplace.organizationId !== config.organizationId ||
    appSnapshots.organizationId !== config.organizationId ||
    appSnapshotRecovery.organizationId !== config.organizationId ||
    auditRetention.organizationId !== config.organizationId ||
    staging.projectKey !== config.projectKey ||
    marketplace.projectKey !== config.projectKey ||
    appSnapshots.projectKey !== config.projectKey ||
    appSnapshotRecovery.projectKey !== config.projectKey ||
    auditRetention.projectKey !== config.projectKey
  ) {
    throw new Error("Release receipts do not belong to the exact tenant and project scope");
  }
  if (
    marketplace.app.id !== config.marketplaceApp.id ||
    marketplace.app.version !== config.marketplaceApp.version ||
    marketplace.app.artifactDigest !== config.marketplaceApp.artifactDigest
  ) {
    throw new Error("Marketplace evidence does not match the selected release artifact");
  }
  if (recovery.sourceIdentityDigest !== config.databaseIdentityDigest) {
    throw new Error("Recovery evidence does not match the protected production database identity");
  }
  if (recovery.sourceIdentityDigest === recovery.targetIdentityDigest) {
    throw new Error("Recovery source and disposable target identities must remain different");
  }

  requireExactNames(
    staging.results.map((result) => result.name),
    [
      "readiness",
      "operational_metrics",
      "app_action_reconciliation_health",
      "audit_integrity",
      "unauthenticated_user_denial",
      "cross_tenant_user_denial",
      "suspended_user_denial",
      "user_api_quota_saturation"
    ],
    "Staging validation"
  );
  requireExactStatuses(staging.results, {
    readiness: 200,
    operational_metrics: 200,
    app_action_reconciliation_health: 200,
    audit_integrity: 200,
    unauthenticated_user_denial: 401,
    cross_tenant_user_denial: 403,
    suspended_user_denial: 403,
    user_api_quota_saturation: 429
  });
  if (staging.quotaEvidence.allowedRequests !== staging.quotaEvidence.limit) {
    throw new Error("Staging quota evidence did not consume one exact configured window");
  }
  requireExactNames(
    marketplace.checks.map((check) => check.name),
    [
      "unauthenticated_denial",
      "tenant_catalog_visibility",
      "artifact_signature_and_cache",
      "cross_tenant_denial",
      "durable_revocation",
      "replay_denial",
      "independent_audit_evidence"
    ],
    "Marketplace validation"
  );
  requireExactNames(
    appSnapshots.checks.map((check) => check.name),
    [
      "private_bounded_bucket",
      "authenticated_download_denial",
      "authenticated_insert_denial",
      "authenticated_update_denial",
      "authenticated_delete_denial",
      "immutable_first_writer",
      "cross_replica_exact_recovery",
      "cleanup_verified"
    ],
    "App snapshot validation"
  );
  requireExactNames(
    appSnapshotRecovery.checks.map((check) => check.name),
    [
      "separate_private_bounded_buckets",
      "source_archive_exported",
      "target_first_writer_restore",
      "isolated_target_exact_load",
      "source_preserved_after_target_cleanup",
      "cleanup_verified"
    ],
    "App snapshot recovery rehearsal"
  );
  requireExactNames(
    appSnapshotReconciliation.checks.map((check) => check.name),
    [
      "tenant_registry_scan",
      "pinned_scope_identity",
      "non_empty_inventory_policy",
      "durable_descriptor_authority",
      "exact_archive_verification",
      "stable_cross_store_inventory",
      "exact_storage_inventory",
      "pinned_unreferenced_retention",
      "aggregate_only_receipt"
    ],
    "App snapshot reconciliation"
  );
  requireExactNames(
    recovery.criticalTables.map((table) => table.table),
    [...RECOVERY_TABLES],
    "Recovery fingerprint"
  );
  requireExactNames(
    auditRetention.verifiedReleaseCheckpoints.map((checkpoint) => checkpoint.name),
    ["staging", "marketplace"],
    "Audit retention checkpoint proof"
  );
  const retainedStaging = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "staging"
  );
  const retainedMarketplace = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "marketplace"
  );
  if (
    retainedStaging?.sequence !== staging.auditCheckpoint.headSequence ||
    retainedStaging?.hash !== staging.auditCheckpoint.headHash ||
    retainedMarketplace?.sequence !== marketplace.auditEvidence.throughSequence ||
    retainedMarketplace?.hash !== marketplace.auditEvidence.headHash ||
    auditRetention.verifiedReleaseCheckpoints.some((checkpoint) =>
      checkpoint.sequence < auditRetention.fromSequence ||
      checkpoint.sequence > auditRetention.throughSequence
    )
  ) {
    throw new Error("Independent audit retention does not prove the exact release checkpoints");
  }
  const acknowledgement = auditRetention.lastDestinationAcknowledgement;
  if (
    !acknowledgement ||
    !auditRetention.lastDestinationReceiptDigest ||
    auditRetention.lastDestinationReceiptDigest !== sha256Digest(canonicalJson(acknowledgement)) ||
    acknowledgement.statement.organizationId !== config.organizationId ||
    acknowledgement.statement.projectKey !== config.projectKey ||
    acknowledgement.statement.lastSequence !== auditRetention.throughSequence ||
    acknowledgement.statement.lastEventHash !== auditRetention.headHash
  ) {
    throw new Error("Audit retention receipt is not bound to its signed external acknowledgement");
  }
  if (acknowledgement.signature.keyId !== config.auditRetentionKeyId) {
    throw new Error("Audit retention acknowledgement used an unexpected protected signing key");
  }
  const acknowledgementSignature = Buffer.from(acknowledgement.signature.value, "base64url");
  if (
    acknowledgementSignature.length !== 64 ||
    !verify(
      null,
      Buffer.from(retentionAcknowledgementSigningPayload(acknowledgement)),
      auditRetentionPublicKey,
      acknowledgementSignature
    )
  ) {
    throw new Error("Audit retention acknowledgement signature is invalid for the protected trust anchor");
  }

  const release = {
    repository: config.repository,
    commitSha: config.commitSha,
    workflowRunId: config.workflowRunId,
    workflowRunAttempt: config.workflowRunAttempt,
    deploymentOrigin,
    generatedAt: config.generatedAt.toISOString()
  };
  const scope = {
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    databaseIdentityDigest: config.databaseIdentityDigest,
    marketplaceApp: config.marketplaceApp,
    appSnapshotRetention: {
      unreferencedInventoryDigest: config.expectedAppSnapshotUnreferencedInventoryDigest
    },
    auditRetentionTrust: {
      keyId: config.auditRetentionKeyId,
      publicKeyDigest: sha256Digest(auditRetentionPublicKey.export({ type: "spki", format: "der" }))
    }
  };
  const evidence = {
    staging: descriptor(staging, staging.checkedAt, {
      auditHeadSequence: staging.auditCheckpoint.headSequence,
      auditHeadHash: staging.auditCheckpoint.headHash,
      checks: staging.results.length,
      quotaBucket: staging.quotaEvidence.bucket,
      quotaLimit: staging.quotaEvidence.limit,
      actionCommitRequests: staging.appActionReconciliationEvidence.requestedTotal,
      actionCommitSucceeded: staging.appActionReconciliationEvidence.succeededTotal,
      actionCommitFailed: staging.appActionReconciliationEvidence.failedTotal,
      actionReconciliationPending: staging.appActionReconciliationEvidence.pending,
      actionReconciliationStale: staging.appActionReconciliationEvidence.stale,
      actionReconciliationStaleAfterSeconds:
        staging.appActionReconciliationEvidence.staleAfterSeconds
    }),
    appActionExactlyOnce: descriptor(appActionExactlyOnce, appActionExactlyOnce.checkedAt, {
      sourceCommitSha: appActionExactlyOnce.sourceCommitSha,
      scenario: appActionExactlyOnce.scenario,
      providerInvocationCount: appActionExactlyOnce.proof.providerInvocationCount,
      reconciliationCalls: appActionExactlyOnce.proof.reconciliationCalls,
      replayCommitCalls: appActionExactlyOnce.proof.replayCommitCalls,
      appTerminalEventsBeforeReconciliation:
        appActionExactlyOnce.proof.appTerminalEventsBeforeReconciliation,
      appTerminalEventsAfterReconciliation:
        appActionExactlyOnce.proof.appTerminalEventsAfterReconciliation,
      originalBrokerReceiptDigest: appActionExactlyOnce.proof.originalBrokerReceiptDigest,
      proofDigest: appActionExactlyOnce.proofDigest
    }),
    marketplace: descriptor(marketplace, marketplace.checkedAt, {
      checks: marketplace.checks.length,
      auditedRequestId: marketplace.auditEvidence.requestId,
      auditThroughSequence: marketplace.auditEvidence.throughSequence,
      auditHeadHash: marketplace.auditEvidence.headHash,
      artifactDigest: marketplace.app.artifactDigest
    }),
    appSnapshots: descriptor(appSnapshots, appSnapshots.checkedAt, {
      storageOrigin: appSnapshots.targetOrigin,
      checks: appSnapshots.checks.length,
      snapshotIdentityDigest: appSnapshots.snapshotIdentityDigest,
      artifactDigest: appSnapshots.artifactDigest,
      filesDigest: appSnapshots.filesDigest
    }),
    appSnapshotRecovery: descriptor(appSnapshotRecovery, appSnapshotRecovery.completedAt, {
      sourceOrigin: appSnapshotRecovery.sourceOrigin,
      restoreOrigin: appSnapshotRecovery.restoreOrigin,
      checks: appSnapshotRecovery.checks.length,
      archiveSizeBytes: appSnapshotRecovery.archiveSizeBytes,
      snapshotIdentityDigest: appSnapshotRecovery.snapshotIdentityDigest,
      artifactDigest: appSnapshotRecovery.artifactDigest,
      filesDigest: appSnapshotRecovery.filesDigest
    }),
    appSnapshotReconciliation: descriptor(
      appSnapshotReconciliation,
      appSnapshotReconciliation.checkedAt,
      {
        scopeDigest: appSnapshotReconciliation.scopeDigest,
        checks: appSnapshotReconciliation.checks.length,
        inventoryPasses: appSnapshotReconciliation.inventoryPasses,
        inventoryGeneration: appSnapshotReconciliation.inventoryGeneration,
        inventoryGenerationDigest: appSnapshotReconciliation.inventoryGenerationDigest,
        registriesScanned: appSnapshotReconciliation.registriesScanned,
        detachedInstallations: appSnapshotReconciliation.detachedInstallations,
        verifiedSnapshots: appSnapshotReconciliation.verifiedSnapshots,
        missingSnapshots: appSnapshotReconciliation.missingSnapshots,
        corruptSnapshots: appSnapshotReconciliation.corruptSnapshots,
        untrackedSnapshots: appSnapshotReconciliation.untrackedSnapshots,
        unavailableSnapshots: appSnapshotReconciliation.unavailableSnapshots,
        storageObjects: appSnapshotReconciliation.storageObjects,
        referencedStorageObjects: appSnapshotReconciliation.referencedStorageObjects,
        unreferencedSnapshots: appSnapshotReconciliation.unreferencedSnapshots,
        malformedStorageObjects: appSnapshotReconciliation.malformedStorageObjects,
        unreferencedInventoryDigest: appSnapshotReconciliation.unreferencedInventoryDigest,
        healthy: appSnapshotReconciliation.healthy
      }
    ),
    recovery: descriptor(recovery, recovery.completedAt, {
      sourceIdentityDigest: recovery.sourceIdentityDigest,
      criticalTables: recovery.criticalTables.length,
      auditEventsChecked: recovery.auditIntegrity.eventsChecked,
      restoredAuditScopes: recovery.auditIntegrity.scopesChecked,
      fingerprintSetDigest: sha256Digest(canonicalJson(recovery.criticalTables))
    }),
    auditRetention: descriptor(auditRetention, auditRetention.completedAt, {
      destinationOrigin: auditRetention.destinationOrigin,
      throughSequence: auditRetention.throughSequence,
      headHash: auditRetention.headHash,
      destinationReceiptDigest: auditRetention.lastDestinationReceiptDigest,
      verifiedCheckpointSetDigest: sha256Digest(canonicalJson(
        auditRetention.verifiedReleaseCheckpoints
      )),
      immutableUntil: acknowledgement.statement.immutableUntil,
      acknowledgementKeyId: acknowledgement.signature.keyId
    })
  };
  return productionEvidenceManifestSchema.parse({
    schemaVersion: "loopgraph-production-promotion-evidence/v6",
    release,
    scope,
    evidence,
    evidenceSetDigest: sha256Digest(canonicalJson({ release, scope, evidence }))
  });
}

export function verifyProductionEvidenceManifest(input: {
  manifest: unknown;
  receipts: ProductionEvidenceReceipts;
  config: Omit<ProductionEvidenceConfig, "generatedAt">;
  now: Date;
  expectedEvidenceSetDigest?: string;
}) {
  const manifest = productionEvidenceManifestSchema.parse(input.manifest);
  requireFreshEvidence(
    "production evidence manifest",
    manifest.release.generatedAt,
    input.now,
    input.config.maximumEvidenceAgeMinutes
  );
  const receiptsAtPromotion = {
    staging: stagingReceiptSchema.parse(input.receipts.staging),
    appActionExactlyOnce: verifyAppActionExactlyOnceProof(input.receipts.appActionExactlyOnce),
    marketplace: marketplaceReceiptSchema.parse(input.receipts.marketplace),
    appSnapshots: appSnapshotReceiptSchema.parse(input.receipts.appSnapshots),
    appSnapshotRecovery: appSnapshotRecoveryReceiptSchema.parse(input.receipts.appSnapshotRecovery),
    appSnapshotReconciliation: appSnapshotReconciliationReceiptSchema.parse(
      input.receipts.appSnapshotReconciliation
    ),
    recovery: recoveryReceiptSchema.parse(input.receipts.recovery),
    auditRetention: auditDrainReceiptV3Schema.parse(input.receipts.auditRetention)
  };
  for (const [label, timestamp] of [
    ["staging validation", receiptsAtPromotion.staging.checkedAt],
    ["App action exactly-once proof", receiptsAtPromotion.appActionExactlyOnce.checkedAt],
    ["marketplace validation", receiptsAtPromotion.marketplace.checkedAt],
    ["App snapshot validation", receiptsAtPromotion.appSnapshots.checkedAt],
    ["App snapshot recovery rehearsal", receiptsAtPromotion.appSnapshotRecovery.completedAt],
    ["App snapshot reconciliation", receiptsAtPromotion.appSnapshotReconciliation.checkedAt],
    ["recovery rehearsal", receiptsAtPromotion.recovery.completedAt],
    ["audit retention", receiptsAtPromotion.auditRetention.completedAt]
  ] as const) {
    requireFreshEvidence(label, timestamp, input.now, input.config.maximumEvidenceAgeMinutes);
  }
  const rebuilt = buildProductionEvidenceManifest(input.receipts, {
    ...input.config,
    generatedAt: new Date(manifest.release.generatedAt)
  });
  if (canonicalJson(rebuilt) !== canonicalJson(manifest)) {
    throw new Error("Production evidence manifest does not match the supplied receipts and release context");
  }
  if (
    input.expectedEvidenceSetDigest &&
    input.expectedEvidenceSetDigest !== manifest.evidenceSetDigest
  ) {
    throw new Error("Production evidence manifest digest does not match the upstream evidence job");
  }
  return manifest;
}

function descriptor(value: unknown, completedAt: string, summary: Record<string, string | number | boolean>) {
  return evidenceDescriptorSchema.parse({
    digest: sha256Digest(canonicalJson(value)),
    completedAt,
    summary
  });
}

function trustedOrigin(value: string, label: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/"
  ) throw new Error(`${label} must be an HTTPS origin without path, credentials, query, or fragment`);
  return url.origin;
}

function validateConfig(config: ProductionEvidenceConfig) {
  productionEvidenceManifestSchema.shape.release.omit({ generatedAt: true }).parse({
    repository: config.repository,
    commitSha: config.commitSha,
    workflowRunId: config.workflowRunId,
    workflowRunAttempt: config.workflowRunAttempt,
    deploymentOrigin: trustedOrigin(config.deploymentOrigin, "Release deployment origin")
  });
  productionEvidenceManifestSchema.shape.scope.parse({
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    databaseIdentityDigest: config.databaseIdentityDigest,
    marketplaceApp: config.marketplaceApp,
    appSnapshotRetention: {
      unreferencedInventoryDigest: config.expectedAppSnapshotUnreferencedInventoryDigest
    },
    auditRetentionTrust: {
      keyId: config.auditRetentionKeyId,
      publicKeyDigest: publicKeyDigest(config.auditRetentionPublicKeyPem)
    }
  });
  if (!Number.isInteger(config.maximumEvidenceAgeMinutes) ||
      config.maximumEvidenceAgeMinutes < 5 || config.maximumEvidenceAgeMinutes > 1_440) {
    throw new Error("Maximum evidence age must be an integer from 5 to 1440 minutes");
  }
}

function requireFreshEvidence(label: string, value: string, now: Date, maximumAgeMinutes: number) {
  const timestamp = Date.parse(value);
  const age = now.getTime() - timestamp;
  if (!Number.isFinite(timestamp) || age < -5 * 60_000 || age > maximumAgeMinutes * 60_000) {
    throw new Error(`${label} is outside the allowed release evidence window`);
  }
}

function requireExactNames(actual: string[], expected: string[], label: string) {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    expected.some((name) => !actual.includes(name))
  ) throw new Error(`${label} omitted or duplicated a required control`);
}

function requireExactStatuses(
  results: Array<{ name: string; status: number }>,
  expected: Record<string, number>
) {
  if (results.some((result) => expected[result.name] !== result.status)) {
    throw new Error("Staging validation returned an unexpected control status");
  }
}

async function readJsonReceipt(name: string) {
  const file = required(name);
  try {
    return JSON.parse(await readBoundedIntegrityFile(file, name, 16 * 1024 * 1024)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${name} did not contain one JSON receipt`);
    throw error;
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production promotion evidence`);
  return value;
}

function positiveInteger(name: string, fallback?: number) {
  const raw = process.env[name]?.trim();
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function main() {
  const receipts = {
    staging: await readJsonReceipt("LOOPGRAPH_STAGING_RECEIPT_FILE"),
    appActionExactlyOnce: await readJsonReceipt("LOOPGRAPH_APP_ACTION_EXACTLY_ONCE_RECEIPT_FILE"),
    marketplace: await readJsonReceipt("LOOPGRAPH_MARKETPLACE_RECEIPT_FILE"),
    appSnapshots: await readJsonReceipt("LOOPGRAPH_APP_SNAPSHOT_STAGING_RECEIPT_FILE"),
    appSnapshotRecovery: await readJsonReceipt("LOOPGRAPH_APP_SNAPSHOT_RECOVERY_RECEIPT_FILE"),
    appSnapshotReconciliation: await readJsonReceipt("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_RECEIPT_FILE"),
    recovery: await readJsonReceipt("LOOPGRAPH_RECOVERY_RECEIPT_FILE"),
    auditRetention: await readJsonReceipt("LOOPGRAPH_AUDIT_RECEIPT_FILE")
  };
  const common = {
    repository: required("GITHUB_REPOSITORY"),
    commitSha: required("GITHUB_SHA"),
    workflowRunId: required("GITHUB_RUN_ID"),
    workflowRunAttempt: positiveInteger("GITHUB_RUN_ATTEMPT"),
    deploymentOrigin: required("LOOPGRAPH_RELEASE_DEPLOYMENT_URL"),
    storageOrigin: required("LOOPGRAPH_RELEASE_STORAGE_URL"),
    snapshotRestoreOrigin: required("LOOPGRAPH_RELEASE_SNAPSHOT_RESTORE_URL"),
    organizationId: required("LOOPGRAPH_RELEASE_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_RELEASE_PROJECT_KEY"),
    databaseIdentityDigest: required("LOOPGRAPH_RELEASE_DATABASE_IDENTITY_DIGEST"),
    marketplaceApp: {
      id: required("LOOPGRAPH_RELEASE_MARKETPLACE_APP_ID"),
      version: required("LOOPGRAPH_RELEASE_MARKETPLACE_APP_VERSION"),
      artifactDigest: required("LOOPGRAPH_RELEASE_MARKETPLACE_ARTIFACT_DIGEST")
    },
    expectedAppSnapshotUnreferencedInventoryDigest: required(
      "LOOPGRAPH_RELEASE_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST"
    ),
    auditRetentionKeyId: required("LOOPGRAPH_RELEASE_AUDIT_RETENTION_KEY_ID"),
    auditRetentionPublicKeyPem: required("LOOPGRAPH_RELEASE_AUDIT_RETENTION_PUBLIC_KEY_PEM"),
    maximumEvidenceAgeMinutes: positiveInteger("LOOPGRAPH_RELEASE_EVIDENCE_MAX_AGE_MINUTES", 360)
  };
  if (process.argv.includes("--verify")) {
    const manifest = await readJsonReceipt("LOOPGRAPH_PRODUCTION_EVIDENCE_MANIFEST_FILE");
    const verified = verifyProductionEvidenceManifest({
      manifest,
      receipts,
      config: common,
      now: new Date(),
      expectedEvidenceSetDigest: process.env.LOOPGRAPH_EXPECTED_EVIDENCE_DIGEST?.trim()
    });
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "loopgraph-production-promotion-verification/v1",
      evidenceSetDigest: verified.evidenceSetDigest,
      verifiedAt: new Date().toISOString()
    }, null, 2)}\n`);
    return;
  }
  const manifest = buildProductionEvidenceManifest(receipts, {
    ...common,
    generatedAt: new Date()
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

function publicKeyDigest(pem: string) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Audit retention trust anchor must be an Ed25519 public key");
  }
  return sha256Digest(key.export({ type: "spki", format: "der" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
