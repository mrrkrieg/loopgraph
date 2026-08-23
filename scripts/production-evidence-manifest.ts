import { createPublicKey, verify } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { canonicalAppDigest } from "loopgraph/core";
import {
  auditDrainReceiptV7Schema,
  canonicalJson,
  readBoundedIntegrityFile,
  retentionAcknowledgementSigningPayload,
  sha256Digest
} from "./audit-retention-protocol";
import { RECOVERY_TABLES } from "./recovery-contract";
import { verifyAppActionExactlyOnceProof } from "./prove-app-action-exactly-once";
import { HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS } from "./hosted-app-snapshot-inventory-fence";

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

const cliSessionCheckNames = [
  "device_issuance_saturation",
  "polling_slow_down",
  "primary_refresh_rotation",
  "cross_replica_refresh_rotation",
  "stale_request_metadata_denial",
  "suspended_membership_denial",
  "revoked_session_denial",
  "request_rate_saturation",
  "refresh_replay_family_revocation",
  "independent_audit_evidence"
] as const;

const cliSessionReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-cli-session-staging-validation/v1"),
  primaryOrigin: originSchema,
  replicaOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  controls: z.object({
    deviceFingerprintLimit: z.literal(5),
    requestRateLimit: z.number().int().min(2).max(20),
    crossReplica: z.literal(true),
    disposableSessionRevoked: z.literal(true)
  }).strict(),
  auditEvidence: z.object({
    afterSequence: safeInteger,
    throughSequence: safeInteger,
    headHash: hashSchema,
    requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
  }).strict(),
  checks: z.array(z.object({
    name: z.enum(cliSessionCheckNames),
    ok: z.literal(true),
    status: z.number().int().min(100).max(599),
    detail: z.string().min(1).max(2048)
  }).strict()).length(cliSessionCheckNames.length)
}).strict().superRefine((receipt, context) => {
  if (receipt.auditEvidence.afterSequence > receipt.auditEvidence.throughSequence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["auditEvidence"],
      message: "CLI session audit checkpoint precedes its starting sequence"
    });
  }
});

const cliAdminCheckNames = [
  "aal1_step_up_denial",
  "aal2_exact_session_revocation",
  "post_revocation_inventory",
  "revoked_cli_access_denial",
  "independent_audit_evidence"
] as const;

const cliAdminReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-cli-admin-staging-validation/v1"),
  targetOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  controls: z.object({
    aal1Denied: z.literal(true),
    aal2Required: z.literal(true),
    exactSessionScope: z.literal(true),
    atomicAuditReceipt: z.literal(true),
    disposableSessionRevoked: z.literal(true)
  }).strict(),
  revocation: z.object({
    revokedCount: z.literal(1),
    correlationId: z.string().regex(
      /^cli_session_revoke_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  }).strict(),
  auditEvidence: z.object({
    afterSequence: safeInteger,
    throughSequence: safeInteger,
    headHash: hashSchema,
    correlationId: z.string().min(1).max(128)
  }).strict(),
  checks: z.array(z.object({
    name: z.enum(cliAdminCheckNames),
    ok: z.literal(true),
    status: z.number().int().min(100).max(599),
    detail: z.string().min(1).max(2048)
  }).strict()).length(cliAdminCheckNames.length)
}).strict().superRefine((receipt, context) => {
  if (
    receipt.auditEvidence.afterSequence > receipt.auditEvidence.throughSequence ||
    receipt.auditEvidence.correlationId !== receipt.revocation.correlationId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["auditEvidence"],
      message: "CLI administrator audit evidence must bind the exact revocation receipt"
    });
  }
});

const marketplaceReleaseRevocationCheckNames = [
  "verified_release_cached",
  "aal1_step_up_denial",
  "denied_request_preserves_release",
  "aal2_exact_release_revocation",
  "workload_revocation_and_cache_eviction",
  "independent_audit_evidence"
] as const;

const marketplaceReleaseRevocationReceiptSchema = z.object({
  schemaVersion: z.literal(
    "hosted-marketplace-release-revocation-staging-validation/v1"
  ),
  targetOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  release: z.object({
    appId: z.string().min(3).max(160),
    version: z.string().min(1).max(100),
    artifactDigest: digestSchema
  }).strict(),
  revocation: z.object({
    changed: z.literal(true),
    correlationId: z.string().regex(
      /^marketplace_release_status_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  }).strict(),
  auditEvidence: z.object({
    afterSequence: safeInteger,
    throughSequence: safeInteger,
    headHash: hashSchema,
    correlationId: z.string().min(1).max(128)
  }).strict(),
  checks: z.array(z.object({
    name: z.enum(marketplaceReleaseRevocationCheckNames),
    ok: z.literal(true),
    status: z.number().int().min(100).max(599),
    detail: z.string().min(1).max(2048)
  }).strict()).length(marketplaceReleaseRevocationCheckNames.length)
}).strict().superRefine((receipt, context) => {
  if (
    receipt.auditEvidence.afterSequence > receipt.auditEvidence.throughSequence ||
    receipt.auditEvidence.correlationId !== receipt.revocation.correlationId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["auditEvidence"],
      message: "Marketplace release revocation evidence must bind the exact audit receipt"
    });
  }
});

const appEvidenceCountSchema = z.object({
  invalid: safeInteger,
  expired: safeInteger,
  renewSoon: safeInteger,
  incomplete: safeInteger,
  current: safeInteger,
  notApplicable: safeInteger
}).strict();

const appEvidenceCheckNames = [
  "unauthenticated_denial",
  "cross_tenant_denial",
  "authorized_health_projection",
  "replay_denial",
  "aggregate_only_contract",
  "metrics_projection_parity",
  "classification_fixture_rehearsal",
  "independent_audit_evidence"
] as const;

const appEvidenceClassificationExpectations = [
  { status: "invalid", health: "blocked" },
  { status: "expired", health: "degraded" },
  { status: "renew_soon", health: "degraded" },
  { status: "incomplete", health: "healthy" },
  { status: "current", health: "healthy" },
  { status: "not_applicable", health: "healthy" }
] as const;

const appEvidenceHealthReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-app-evidence-health-staging-validation/v3"),
  targetOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  auditEvidence: z.object({
    afterSequence: safeInteger,
    throughSequence: safeInteger,
    headHash: hashSchema,
    requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
  }).strict(),
  classificationEvidence: z.object({
    cases: z.array(z.object({
      status: z.enum([
        "invalid",
        "expired",
        "renew_soon",
        "incomplete",
        "current",
        "not_applicable"
      ]),
      expectedHealth: z.enum(["healthy", "degraded", "blocked"]),
      observedHealth: z.enum(["healthy", "degraded", "blocked"]),
      ok: z.literal(true)
    }).strict()).length(appEvidenceClassificationExpectations.length)
  }).strict(),
  projection: z.object({
    generatedAt: z.string().datetime({ offset: true }),
    health: z.enum(["healthy", "degraded", "blocked"]),
    totalInstallations: safeInteger,
    totalMatched: safeInteger,
    itemsReturned: safeInteger,
    truncated: z.boolean(),
    counts: appEvidenceCountSchema
  }).strict(),
  metrics: z.object({
    health: z.union([z.literal(0), z.literal(1)]),
    totalInstallations: safeInteger,
    itemsReturned: safeInteger,
    truncated: z.union([z.literal(0), z.literal(1)]),
    counts: appEvidenceCountSchema
  }).strict(),
  checks: z.array(z.object({
    name: z.enum(appEvidenceCheckNames),
    ok: z.literal(true),
    status: z.number().int().min(100).max(599).optional(),
    detail: z.string().min(1).max(2048)
  }).strict()).length(appEvidenceCheckNames.length)
}).strict().superRefine((receipt, context) => {
  if (receipt.auditEvidence.afterSequence > receipt.auditEvidence.throughSequence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["auditEvidence"],
      message: "App evidence audit checkpoint precedes its starting sequence"
    });
  }
  for (const [index, expected] of appEvidenceClassificationExpectations.entries()) {
    const observed = receipt.classificationEvidence.cases[index];
    if (
      observed?.status !== expected.status ||
      observed.expectedHealth !== expected.health ||
      observed.observedHealth !== expected.health
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["classificationEvidence", "cases", index],
        message: "App evidence classification fixture set is incomplete or drifted"
      });
    }
  }
  const counts = receipt.projection.counts;
  const countTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const expectedHealth = counts.invalid > 0
    ? "blocked"
    : counts.expired > 0 || counts.renewSoon > 0
      ? "degraded"
      : "healthy";
  if (!Number.isSafeInteger(countTotal) || countTotal !== receipt.projection.totalInstallations) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["projection", "counts"],
      message: "App evidence counts must cover the installed fleet exactly once"
    });
  }
  if (
    receipt.projection.totalMatched > receipt.projection.totalInstallations ||
    receipt.projection.itemsReturned > receipt.projection.totalMatched ||
    receipt.projection.truncated !==
      (receipt.projection.itemsReturned < receipt.projection.totalMatched)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["projection"],
      message: "App evidence fleet totals or truncation are inconsistent"
    });
  }
  if (receipt.projection.health !== expectedHealth) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["projection", "health"],
      message: "App evidence health does not match its counts"
    });
  }
  if (
    receipt.metrics.health !== (receipt.projection.health === "healthy" ? 1 : 0) ||
    receipt.metrics.totalInstallations !== receipt.projection.totalInstallations ||
    receipt.metrics.itemsReturned !== receipt.projection.itemsReturned ||
    receipt.metrics.truncated !== (receipt.projection.truncated ? 1 : 0) ||
    Object.keys(counts).some((name) =>
      receipt.metrics.counts[name as keyof typeof counts] !==
      counts[name as keyof typeof counts])
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["metrics"],
      message: "App evidence metrics must match the schedule projection"
    });
  }
  if (
    Math.abs(Date.parse(receipt.checkedAt) - Date.parse(receipt.projection.generatedAt)) >
    5 * 60_000
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["projection", "generatedAt"],
      message: "App evidence projection must be fresh at receipt creation"
    });
  }
});

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

const appSnapshotFenceProbeCheckNames = [
  "registry_insert_advanced",
  "registry_update_advanced",
  "registry_delete_advanced",
  "storage_upload_advanced",
  "storage_replace_advanced",
  "storage_delete_advanced",
  "probe_authority_clean",
  "probe_generation_clean"
] as const;

const appSnapshotFenceProbeReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-app-snapshot-fence-probe/v1"),
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  scopeDigest: digestSchema,
  healthy: z.literal(true),
  checks: z.array(z.object({
    name: z.enum(appSnapshotFenceProbeCheckNames),
    ok: z.literal(true)
  }).strict()).length(appSnapshotFenceProbeCheckNames.length)
}).strict();

const learningEntityProbeCheckNames = [
  "distributed_measurement_claim",
  "stale_lease_rejected",
  "cross_replica_job_finalization",
  "metric_sample_immutable",
  "observed_outcome_immutable",
  "value_ledger_immutable",
  "cross_replica_entity_visibility",
  "provider_alias_single_owner",
  "probe_scope_clean"
] as const;

const learningEntityProbeReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-learning-entity-staging-validation/v1"),
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  scopeDigest: digestSchema,
  healthy: z.literal(true),
  checks: z.array(z.object({
    name: z.enum(learningEntityProbeCheckNames),
    ok: z.literal(true)
  }).strict()).length(learningEntityProbeCheckNames.length)
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
  schemaVersion: z.literal("hosted-app-snapshot-reconciliation/v3"),
  checkedAt: z.string().datetime({ offset: true }),
  durationMs: safeInteger,
  scopeDigest: digestSchema,
  inventoryFenceDigest: digestSchema,
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
      "live_mutation_fence",
      "non_empty_inventory_policy",
      "durable_descriptor_authority",
      "exact_archive_verification",
      "stable_cross_store_inventory",
      "exact_storage_inventory",
      "pinned_unreferenced_retention",
      "aggregate_only_receipt"
    ]),
    ok: z.literal(true)
  }).strict()).length(10)
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
    receipt.inventoryFenceDigest !== canonicalAppDigest({
      scopeDigest: receipt.scopeDigest,
      status: HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS
    })
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inventoryFenceDigest"],
      message: "App snapshot inventory fence digest must bind the exact live attestation"
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
  schemaVersion: z.literal("loopgraph-production-promotion-evidence/v15"),
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
    appSnapshotFenceProbe: z.object({
      scopeDigest: digestSchema
    }).strict(),
    learningEntityProbe: z.object({
      scopeDigest: digestSchema
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
    cliSessions: evidenceDescriptorSchema,
    cliAdmin: evidenceDescriptorSchema,
    marketplaceReleaseRevocation: evidenceDescriptorSchema,
    appEvidenceHealth: evidenceDescriptorSchema,
    appSnapshotFenceProbe: evidenceDescriptorSchema,
    learningEntities: evidenceDescriptorSchema,
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
  cliSessions: unknown;
  cliAdmin: unknown;
  marketplaceReleaseRevocation: unknown;
  appEvidenceHealth: unknown;
  appSnapshotFenceProbe: unknown;
  learningEntities: unknown;
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
  expectedMarketplaceReleaseRevocationArtifactDigest: string;
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
  const cliSessions = cliSessionReceiptSchema.parse(receipts.cliSessions);
  const cliAdmin = cliAdminReceiptSchema.parse(receipts.cliAdmin);
  const marketplaceReleaseRevocation = marketplaceReleaseRevocationReceiptSchema.parse(
    receipts.marketplaceReleaseRevocation
  );
  const appEvidenceHealth = appEvidenceHealthReceiptSchema.parse(receipts.appEvidenceHealth);
  const appSnapshotFenceProbe = appSnapshotFenceProbeReceiptSchema.parse(
    receipts.appSnapshotFenceProbe
  );
  const learningEntities = learningEntityProbeReceiptSchema.parse(receipts.learningEntities);
  const appSnapshots = appSnapshotReceiptSchema.parse(receipts.appSnapshots);
  const appSnapshotRecovery = appSnapshotRecoveryReceiptSchema.parse(receipts.appSnapshotRecovery);
  const appSnapshotReconciliation = appSnapshotReconciliationReceiptSchema.parse(
    receipts.appSnapshotReconciliation
  );
  const recovery = recoveryReceiptSchema.parse(receipts.recovery);
  const auditRetention = auditDrainReceiptV7Schema.parse(receipts.auditRetention);
  validateConfig(config);
  const auditRetentionPublicKey = createPublicKey(config.auditRetentionPublicKeyPem);
  if (auditRetentionPublicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Audit retention trust anchor must be an Ed25519 public key");
  }

  for (const [label, timestamp] of [
    ["staging validation", staging.checkedAt],
    ["App action exactly-once proof", appActionExactlyOnce.checkedAt],
    ["marketplace validation", marketplace.checkedAt],
    ["CLI session validation", cliSessions.checkedAt],
    ["CLI administrator MFA validation", cliAdmin.checkedAt],
    ["marketplace release revocation validation", marketplaceReleaseRevocation.checkedAt],
    ["App evidence health validation", appEvidenceHealth.checkedAt],
    ["App snapshot mutation fence probe", appSnapshotFenceProbe.checkedAt],
    ["hosted learning and entity validation", learningEntities.checkedAt],
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
    trustedOrigin(cliSessions.primaryOrigin, "CLI session primary origin") !== deploymentOrigin ||
    trustedOrigin(cliAdmin.targetOrigin, "CLI administrator origin") !== deploymentOrigin ||
    trustedOrigin(
      marketplaceReleaseRevocation.targetOrigin,
      "Marketplace release revocation origin"
    ) !== deploymentOrigin ||
    appEvidenceHealth.targetOrigin !== deploymentOrigin ||
    auditRetention.sourceOrigin !== deploymentOrigin
  ) {
    throw new Error("Release receipts do not belong to the exact promoted deployment origin");
  }
  if (
    trustedOrigin(cliSessions.replicaOrigin, "CLI session replica origin") === deploymentOrigin
  ) {
    throw new Error("CLI session evidence must exercise a distinct replica origin");
  }
  if (appSnapshots.targetOrigin !== trustedOrigin(config.storageOrigin, "Release Storage origin")) {
    throw new Error("App snapshot evidence does not belong to the exact protected Storage origin");
  }
  const appSnapshotFenceProbeScopeDigest = canonicalAppDigest({
    origin: appSnapshots.targetOrigin,
    organizationId: config.organizationId.toLowerCase(),
    probeNamespace: "fence_probe"
  });
  if (appSnapshotFenceProbe.scopeDigest !== appSnapshotFenceProbeScopeDigest) {
    throw new Error("App snapshot mutation fence probe does not match the protected Storage and tenant scope");
  }
  const learningEntityProbeScopeDigest = canonicalAppDigest({
    origin: appSnapshots.targetOrigin,
    organizationId: config.organizationId.toLowerCase(),
    probeNamespace: "learning_probe"
  });
  if (learningEntities.scopeDigest !== learningEntityProbeScopeDigest) {
    throw new Error("Hosted learning and entity evidence does not match the protected Storage and tenant scope");
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
    cliSessions.organizationId !== config.organizationId ||
    cliAdmin.organizationId !== config.organizationId ||
    marketplaceReleaseRevocation.organizationId !== config.organizationId ||
    appEvidenceHealth.organizationId !== config.organizationId ||
    appSnapshots.organizationId !== config.organizationId ||
    appSnapshotRecovery.organizationId !== config.organizationId ||
    auditRetention.organizationId !== config.organizationId ||
    staging.projectKey !== config.projectKey ||
    marketplace.projectKey !== config.projectKey ||
    cliSessions.projectKey !== config.projectKey ||
    cliAdmin.projectKey !== config.projectKey ||
    marketplaceReleaseRevocation.projectKey !== config.projectKey ||
    appEvidenceHealth.projectKey !== config.projectKey ||
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
  if (
    marketplaceReleaseRevocation.release.artifactDigest !==
    config.expectedMarketplaceReleaseRevocationArtifactDigest
  ) {
    throw new Error("Marketplace release revocation does not match the independently pinned disposable artifact");
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
    cliSessions.checks.map((check) => check.name),
    [...cliSessionCheckNames],
    "CLI session validation"
  );
  const cliSessionStatuses = new Map<string, number>(
    cliSessions.checks.map((check) => [check.name, check.status])
  );
  const expectedCliSessionStatuses = new Map<string, number>([
    ["device_issuance_saturation", 429],
    ["polling_slow_down", 429],
    ["primary_refresh_rotation", 200],
    ["cross_replica_refresh_rotation", 200],
    ["stale_request_metadata_denial", 400],
    ["suspended_membership_denial", 403],
    ["revoked_session_denial", 401],
    ["request_rate_saturation", 429],
    ["refresh_replay_family_revocation", 400],
    ["independent_audit_evidence", 200]
  ]);
  if ([...expectedCliSessionStatuses].some(
    ([name, status]) => cliSessionStatuses.get(name) !== status
  )) {
    throw new Error("CLI session validation returned an unexpected control status");
  }
  requireExactNames(
    cliAdmin.checks.map((check) => check.name),
    [...cliAdminCheckNames],
    "CLI administrator MFA validation"
  );
  const cliAdminStatuses = new Map<string, number>(
    cliAdmin.checks.map((check) => [check.name, check.status])
  );
  const expectedCliAdminStatuses = new Map<string, number>([
    ["aal1_step_up_denial", 403],
    ["aal2_exact_session_revocation", 200],
    ["post_revocation_inventory", 200],
    ["revoked_cli_access_denial", 401],
    ["independent_audit_evidence", 200]
  ]);
  if ([...expectedCliAdminStatuses].some(
    ([name, status]) => cliAdminStatuses.get(name) !== status
  )) {
    throw new Error("CLI administrator MFA validation returned an unexpected control status");
  }
  requireExactNames(
    marketplaceReleaseRevocation.checks.map((check) => check.name),
    [...marketplaceReleaseRevocationCheckNames],
    "Marketplace release revocation validation"
  );
  const marketplaceReleaseRevocationStatuses = new Map<string, number>(
    marketplaceReleaseRevocation.checks.map((check) => [check.name, check.status])
  );
  const expectedMarketplaceReleaseRevocationStatuses = new Map<string, number>([
    ["verified_release_cached", 200],
    ["aal1_step_up_denial", 403],
    ["denied_request_preserves_release", 200],
    ["aal2_exact_release_revocation", 200],
    ["workload_revocation_and_cache_eviction", 404],
    ["independent_audit_evidence", 200]
  ]);
  if ([...expectedMarketplaceReleaseRevocationStatuses].some(
    ([name, status]) => marketplaceReleaseRevocationStatuses.get(name) !== status
  )) {
    throw new Error("Marketplace release revocation validation returned an unexpected control status");
  }
  requireExactNames(
    appEvidenceHealth.checks.map((check) => check.name),
    [...appEvidenceCheckNames],
    "App evidence health validation"
  );
  const appEvidenceStatuses = new Map(
    appEvidenceHealth.checks.map((check) => [check.name, check.status])
  );
  if (
    appEvidenceStatuses.get("unauthenticated_denial") !== 401 ||
    appEvidenceStatuses.get("cross_tenant_denial") !== 403 ||
    appEvidenceStatuses.get("authorized_health_projection") !== 202 ||
    ![403, 409].includes(appEvidenceStatuses.get("replay_denial") ?? 0) ||
    appEvidenceStatuses.get("aggregate_only_contract") !== undefined ||
    appEvidenceStatuses.get("metrics_projection_parity") !== 200 ||
    appEvidenceStatuses.get("classification_fixture_rehearsal") !== undefined ||
    appEvidenceStatuses.get("independent_audit_evidence") !== 200
  ) {
    throw new Error("App evidence health validation returned an unexpected control status");
  }
  requireExactNames(
    appSnapshotFenceProbe.checks.map((check) => check.name),
    [...appSnapshotFenceProbeCheckNames],
    "App snapshot mutation fence probe"
  );
  requireExactNames(
    learningEntities.checks.map((check) => check.name),
    [...learningEntityProbeCheckNames],
    "Hosted learning and entity validation"
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
      "live_mutation_fence",
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
    [
      "staging",
      "marketplace",
      "app_evidence_health",
      "cli_sessions",
      "cli_admin",
      "marketplace_release_revocation"
    ],
    "Audit retention checkpoint proof"
  );
  const retainedStaging = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "staging"
  );
  const retainedMarketplace = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "marketplace"
  );
  const retainedAppEvidenceHealth = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "app_evidence_health"
  );
  const retainedCliSessions = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "cli_sessions"
  );
  const retainedCliAdmin = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "cli_admin"
  );
  const retainedMarketplaceReleaseRevocation = auditRetention.verifiedReleaseCheckpoints.find(
    (checkpoint) => checkpoint.name === "marketplace_release_revocation"
  );
  if (
    retainedStaging?.sequence !== staging.auditCheckpoint.headSequence ||
    retainedStaging?.hash !== staging.auditCheckpoint.headHash ||
    retainedMarketplace?.sequence !== marketplace.auditEvidence.throughSequence ||
    retainedMarketplace?.hash !== marketplace.auditEvidence.headHash ||
    retainedAppEvidenceHealth?.sequence !== appEvidenceHealth.auditEvidence.throughSequence ||
    retainedAppEvidenceHealth?.hash !== appEvidenceHealth.auditEvidence.headHash ||
    retainedCliSessions?.sequence !== cliSessions.auditEvidence.throughSequence ||
    retainedCliSessions?.hash !== cliSessions.auditEvidence.headHash ||
    retainedCliAdmin?.sequence !== cliAdmin.auditEvidence.throughSequence ||
    retainedCliAdmin?.hash !== cliAdmin.auditEvidence.headHash ||
    retainedMarketplaceReleaseRevocation?.sequence !==
      marketplaceReleaseRevocation.auditEvidence.throughSequence ||
    retainedMarketplaceReleaseRevocation?.hash !==
      marketplaceReleaseRevocation.auditEvidence.headHash ||
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
    appSnapshotFenceProbe: {
      scopeDigest: appSnapshotFenceProbeScopeDigest
    },
    learningEntityProbe: {
      scopeDigest: learningEntityProbeScopeDigest
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
    cliSessions: descriptor(cliSessions, cliSessions.checkedAt, {
      primaryOrigin: cliSessions.primaryOrigin,
      replicaOrigin: cliSessions.replicaOrigin,
      checks: cliSessions.checks.length,
      requestRateLimit: cliSessions.controls.requestRateLimit,
      deviceFingerprintLimit: cliSessions.controls.deviceFingerprintLimit,
      auditedRequestId: cliSessions.auditEvidence.requestId,
      auditThroughSequence: cliSessions.auditEvidence.throughSequence,
      auditHeadHash: cliSessions.auditEvidence.headHash,
      disposableSessionRevoked: cliSessions.controls.disposableSessionRevoked
    }),
    cliAdmin: descriptor(cliAdmin, cliAdmin.checkedAt, {
      checks: cliAdmin.checks.length,
      revokedCount: cliAdmin.revocation.revokedCount,
      auditCorrelationId: cliAdmin.auditEvidence.correlationId,
      auditThroughSequence: cliAdmin.auditEvidence.throughSequence,
      auditHeadHash: cliAdmin.auditEvidence.headHash,
      aal1Denied: cliAdmin.controls.aal1Denied,
      aal2Required: cliAdmin.controls.aal2Required,
      exactSessionScope: cliAdmin.controls.exactSessionScope,
      atomicAuditReceipt: cliAdmin.controls.atomicAuditReceipt,
      disposableSessionRevoked: cliAdmin.controls.disposableSessionRevoked
    }),
    marketplaceReleaseRevocation: descriptor(
      marketplaceReleaseRevocation,
      marketplaceReleaseRevocation.checkedAt,
      {
        appId: marketplaceReleaseRevocation.release.appId,
        version: marketplaceReleaseRevocation.release.version,
        artifactDigest: marketplaceReleaseRevocation.release.artifactDigest,
        checks: marketplaceReleaseRevocation.checks.length,
        changed: marketplaceReleaseRevocation.revocation.changed,
        auditCorrelationId: marketplaceReleaseRevocation.auditEvidence.correlationId,
        auditThroughSequence: marketplaceReleaseRevocation.auditEvidence.throughSequence,
        auditHeadHash: marketplaceReleaseRevocation.auditEvidence.headHash
      }
    ),
    appEvidenceHealth: descriptor(appEvidenceHealth, appEvidenceHealth.checkedAt, {
      checks: appEvidenceHealth.checks.length,
      auditedRequestId: appEvidenceHealth.auditEvidence.requestId,
      auditThroughSequence: appEvidenceHealth.auditEvidence.throughSequence,
      auditHeadHash: appEvidenceHealth.auditEvidence.headHash,
      classificationCases: appEvidenceHealth.classificationEvidence.cases.length,
      health: appEvidenceHealth.projection.health,
      totalInstallations: appEvidenceHealth.projection.totalInstallations,
      totalMatched: appEvidenceHealth.projection.totalMatched,
      itemsReturned: appEvidenceHealth.projection.itemsReturned,
      truncated: appEvidenceHealth.projection.truncated,
      invalid: appEvidenceHealth.projection.counts.invalid,
      expired: appEvidenceHealth.projection.counts.expired,
      renewSoon: appEvidenceHealth.projection.counts.renewSoon,
      incomplete: appEvidenceHealth.projection.counts.incomplete,
      current: appEvidenceHealth.projection.counts.current,
      notApplicable: appEvidenceHealth.projection.counts.notApplicable
    }),
    appSnapshotFenceProbe: descriptor(appSnapshotFenceProbe, appSnapshotFenceProbe.checkedAt, {
      scopeDigest: appSnapshotFenceProbe.scopeDigest,
      checks: appSnapshotFenceProbe.checks.length,
      healthy: appSnapshotFenceProbe.healthy
    }),
    learningEntities: descriptor(learningEntities, learningEntities.checkedAt, {
      scopeDigest: learningEntities.scopeDigest,
      checks: learningEntities.checks.length,
      healthy: learningEntities.healthy,
      durationMs: learningEntities.durationMs
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
        inventoryFenceDigest: appSnapshotReconciliation.inventoryFenceDigest,
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
    schemaVersion: "loopgraph-production-promotion-evidence/v15",
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
    cliSessions: cliSessionReceiptSchema.parse(input.receipts.cliSessions),
    cliAdmin: cliAdminReceiptSchema.parse(input.receipts.cliAdmin),
    marketplaceReleaseRevocation: marketplaceReleaseRevocationReceiptSchema.parse(
      input.receipts.marketplaceReleaseRevocation
    ),
    appEvidenceHealth: appEvidenceHealthReceiptSchema.parse(input.receipts.appEvidenceHealth),
    appSnapshotFenceProbe: appSnapshotFenceProbeReceiptSchema.parse(
      input.receipts.appSnapshotFenceProbe
    ),
    learningEntities: learningEntityProbeReceiptSchema.parse(input.receipts.learningEntities),
    appSnapshots: appSnapshotReceiptSchema.parse(input.receipts.appSnapshots),
    appSnapshotRecovery: appSnapshotRecoveryReceiptSchema.parse(input.receipts.appSnapshotRecovery),
    appSnapshotReconciliation: appSnapshotReconciliationReceiptSchema.parse(
      input.receipts.appSnapshotReconciliation
    ),
    recovery: recoveryReceiptSchema.parse(input.receipts.recovery),
    auditRetention: auditDrainReceiptV7Schema.parse(input.receipts.auditRetention)
  };
  for (const [label, timestamp] of [
    ["staging validation", receiptsAtPromotion.staging.checkedAt],
    ["App action exactly-once proof", receiptsAtPromotion.appActionExactlyOnce.checkedAt],
    ["marketplace validation", receiptsAtPromotion.marketplace.checkedAt],
    ["CLI session validation", receiptsAtPromotion.cliSessions.checkedAt],
    ["CLI administrator MFA validation", receiptsAtPromotion.cliAdmin.checkedAt],
    [
      "marketplace release revocation validation",
      receiptsAtPromotion.marketplaceReleaseRevocation.checkedAt
    ],
    ["App evidence health validation", receiptsAtPromotion.appEvidenceHealth.checkedAt],
    ["App snapshot mutation fence probe", receiptsAtPromotion.appSnapshotFenceProbe.checkedAt],
    ["hosted learning and entity validation", receiptsAtPromotion.learningEntities.checkedAt],
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
    appSnapshotFenceProbe: {
      scopeDigest: canonicalAppDigest({
        origin: trustedOrigin(config.storageOrigin, "Release Storage origin"),
        organizationId: config.organizationId.toLowerCase(),
        probeNamespace: "fence_probe"
      })
    },
    learningEntityProbe: {
      scopeDigest: canonicalAppDigest({
        origin: trustedOrigin(config.storageOrigin, "Release Storage origin"),
        organizationId: config.organizationId.toLowerCase(),
        probeNamespace: "learning_probe"
      })
    },
    auditRetentionTrust: {
      keyId: config.auditRetentionKeyId,
      publicKeyDigest: publicKeyDigest(config.auditRetentionPublicKeyPem)
    }
  });
  digestSchema.parse(config.expectedMarketplaceReleaseRevocationArtifactDigest);
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
    cliSessions: await readJsonReceipt("LOOPGRAPH_CLI_SESSION_RECEIPT_FILE"),
    cliAdmin: await readJsonReceipt("LOOPGRAPH_CLI_ADMIN_RECEIPT_FILE"),
    marketplaceReleaseRevocation: await readJsonReceipt(
      "LOOPGRAPH_MARKETPLACE_RELEASE_REVOCATION_RECEIPT_FILE"
    ),
    appEvidenceHealth: await readJsonReceipt("LOOPGRAPH_APP_EVIDENCE_HEALTH_RECEIPT_FILE"),
    appSnapshotFenceProbe: await readJsonReceipt(
      "LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_RECEIPT_FILE"
    ),
    learningEntities: await readJsonReceipt("LOOPGRAPH_LEARNING_ENTITY_RECEIPT_FILE"),
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
    expectedMarketplaceReleaseRevocationArtifactDigest: required(
      "LOOPGRAPH_RELEASE_EXPECTED_MARKETPLACE_RELEASE_REVOCATION_ARTIFACT_DIGEST"
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
