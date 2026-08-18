import { createPublicKey, verify } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  auditDrainReceiptV3Schema,
  canonicalJson,
  readBoundedIntegrityFile,
  retentionAcknowledgementSigningPayload,
  sha256Digest
} from "./audit-retention-protocol";
import { RECOVERY_TABLES } from "./recovery-contract";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const projectKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const originSchema = z.string().url();

const stagingReceiptSchema = z.object({
  schemaVersion: z.literal("staging-validation/v3"),
  targetOrigin: originSchema,
  organizationId: z.string().uuid(),
  projectKey: projectKeySchema,
  checkedAt: z.string().datetime({ offset: true }),
  auditCheckpoint: z.object({
    headSequence: safeInteger,
    headHash: hashSchema
  }).strict(),
  results: z.array(z.object({
    name: z.enum(["readiness", "operational_metrics", "audit_integrity"]),
    status: z.number().int().min(200).max(299),
    ok: z.literal(true),
    detail: z.string().min(1).max(1024)
  }).strict()).length(3)
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
  schemaVersion: z.literal("loopgraph-production-promotion-evidence/v1"),
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
    auditRetentionTrust: z.object({
      keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/),
      publicKeyDigest: digestSchema
    }).strict()
  }).strict(),
  evidence: z.object({
    staging: evidenceDescriptorSchema,
    marketplace: evidenceDescriptorSchema,
    recovery: evidenceDescriptorSchema,
    auditRetention: evidenceDescriptorSchema
  }).strict(),
  evidenceSetDigest: digestSchema
}).strict();

export type ProductionEvidenceManifest = z.infer<typeof productionEvidenceManifestSchema>;

export type ProductionEvidenceReceipts = {
  staging: unknown;
  marketplace: unknown;
  recovery: unknown;
  auditRetention: unknown;
};

export type ProductionEvidenceConfig = {
  repository: string;
  commitSha: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  deploymentOrigin: string;
  organizationId: string;
  projectKey: string;
  databaseIdentityDigest: string;
  marketplaceApp: { id: string; version: string; artifactDigest: string };
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
  const marketplace = marketplaceReceiptSchema.parse(receipts.marketplace);
  const recovery = recoveryReceiptSchema.parse(receipts.recovery);
  const auditRetention = auditDrainReceiptV3Schema.parse(receipts.auditRetention);
  validateConfig(config);
  const auditRetentionPublicKey = createPublicKey(config.auditRetentionPublicKeyPem);
  if (auditRetentionPublicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Audit retention trust anchor must be an Ed25519 public key");
  }

  for (const [label, timestamp] of [
    ["staging validation", staging.checkedAt],
    ["marketplace validation", marketplace.checkedAt],
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
  if (
    staging.organizationId !== config.organizationId ||
    marketplace.organizationId !== config.organizationId ||
    auditRetention.organizationId !== config.organizationId ||
    staging.projectKey !== config.projectKey ||
    marketplace.projectKey !== config.projectKey ||
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
    ["readiness", "operational_metrics", "audit_integrity"],
    "Staging validation"
  );
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
    auditRetentionTrust: {
      keyId: config.auditRetentionKeyId,
      publicKeyDigest: sha256Digest(auditRetentionPublicKey.export({ type: "spki", format: "der" }))
    }
  };
  const evidence = {
    staging: descriptor(staging, staging.checkedAt, {
      auditHeadSequence: staging.auditCheckpoint.headSequence,
      auditHeadHash: staging.auditCheckpoint.headHash,
      checks: staging.results.length
    }),
    marketplace: descriptor(marketplace, marketplace.checkedAt, {
      checks: marketplace.checks.length,
      auditedRequestId: marketplace.auditEvidence.requestId,
      auditThroughSequence: marketplace.auditEvidence.throughSequence,
      auditHeadHash: marketplace.auditEvidence.headHash,
      artifactDigest: marketplace.app.artifactDigest
    }),
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
    schemaVersion: "loopgraph-production-promotion-evidence/v1",
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
    marketplace: marketplaceReceiptSchema.parse(input.receipts.marketplace),
    recovery: recoveryReceiptSchema.parse(input.receipts.recovery),
    auditRetention: auditDrainReceiptV3Schema.parse(input.receipts.auditRetention)
  };
  for (const [label, timestamp] of [
    ["staging validation", receiptsAtPromotion.staging.checkedAt],
    ["marketplace validation", receiptsAtPromotion.marketplace.checkedAt],
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
    marketplace: await readJsonReceipt("LOOPGRAPH_MARKETPLACE_RECEIPT_FILE"),
    recovery: await readJsonReceipt("LOOPGRAPH_RECOVERY_RECEIPT_FILE"),
    auditRetention: await readJsonReceipt("LOOPGRAPH_AUDIT_RECEIPT_FILE")
  };
  const common = {
    repository: required("GITHUB_REPOSITORY"),
    commitSha: required("GITHUB_SHA"),
    workflowRunId: required("GITHUB_RUN_ID"),
    workflowRunAttempt: positiveInteger("GITHUB_RUN_ATTEMPT"),
    deploymentOrigin: required("LOOPGRAPH_RELEASE_DEPLOYMENT_URL"),
    organizationId: required("LOOPGRAPH_RELEASE_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_RELEASE_PROJECT_KEY"),
    databaseIdentityDigest: required("LOOPGRAPH_RELEASE_DATABASE_IDENTITY_DIGEST"),
    marketplaceApp: {
      id: required("LOOPGRAPH_RELEASE_MARKETPLACE_APP_ID"),
      version: required("LOOPGRAPH_RELEASE_MARKETPLACE_APP_VERSION"),
      artifactDigest: required("LOOPGRAPH_RELEASE_MARKETPLACE_ARTIFACT_DIGEST")
    },
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
