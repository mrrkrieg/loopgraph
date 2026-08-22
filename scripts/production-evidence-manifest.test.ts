import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  retentionAcknowledgementSigningPayload,
  sha256Digest,
  type RetentionAcknowledgement
} from "./audit-retention-protocol";
import { RECOVERY_TABLES } from "./recovery-contract";
import {
  buildProductionEvidenceManifest,
  verifyProductionEvidenceManifest,
  type ProductionEvidenceConfig,
  type ProductionEvidenceReceipts
} from "./production-evidence-manifest";

const organizationId = "123e4567-e89b-42d3-a456-426614174000";
const generatedAt = new Date("2026-08-17T02:00:00.000Z");
const deploymentOrigin = "https://staging.loopgraph.test";
const databaseIdentityDigest = `sha256:${"d".repeat(64)}`;
const auditRetentionKeyId = "retention_key_1";
const auditRetentionKeys = generateKeyPairSync("ed25519");
const auditRetentionPublicKeyPem = auditRetentionKeys.publicKey.export({
  type: "spki",
  format: "pem"
}).toString();
const marketplaceApp = {
  id: "loopgraph.sales.qualify-and-route-inbound-leads",
  version: "1.0.0",
  artifactDigest: `sha256:${"a".repeat(64)}`
};

const config: ProductionEvidenceConfig = {
  repository: "mrrkrieg/loopgraph",
  commitSha: "b".repeat(40),
  workflowRunId: "123456789",
  workflowRunAttempt: 1,
  deploymentOrigin,
  organizationId,
  projectKey: "main",
  databaseIdentityDigest,
  marketplaceApp,
  auditRetentionKeyId,
  auditRetentionPublicKeyPem,
  generatedAt,
  maximumEvidenceAgeMinutes: 360
};

describe("production promotion evidence manifest", () => {
  it("binds the exact release to staging, marketplace, recovery, and external audit evidence", () => {
    const receipts = releaseReceipts();
    const manifest = buildProductionEvidenceManifest(receipts, config);

    expect(manifest).toMatchObject({
      schemaVersion: "loopgraph-production-promotion-evidence/v1",
      release: {
        repository: config.repository,
        commitSha: config.commitSha,
        deploymentOrigin
      },
      scope: { organizationId, projectKey: "main", databaseIdentityDigest },
      evidence: {
        staging: {
          summary: {
            checks: 8,
            quotaBucket: "admin",
            quotaLimit: 3,
            actionCommitRequests: 12,
            actionCommitSucceeded: 10,
            actionCommitFailed: 2,
            actionReconciliationPending: 0,
            actionReconciliationStale: 0,
            actionReconciliationStaleAfterSeconds: 300
          }
        },
        marketplace: { summary: { checks: 7, artifactDigest: marketplaceApp.artifactDigest } },
        recovery: { summary: { criticalTables: RECOVERY_TABLES.length } },
        auditRetention: { summary: { throughSequence: 50 } }
      }
    });
    expect(manifest.evidenceSetDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(verifyProductionEvidenceManifest({
      manifest,
      receipts,
      config: withoutGeneratedAt(config),
      now: generatedAt,
      expectedEvidenceSetDigest: manifest.evidenceSetDigest
    })).toEqual(manifest);
  });

  it("rejects mixed deployment and tenant evidence", () => {
    const receipts = releaseReceipts();
    receipts.marketplace = {
      ...(receipts.marketplace as Record<string, unknown>),
      targetOrigin: "https://other.loopgraph.test"
    };
    expect(() => buildProductionEvidenceManifest(receipts, config))
      .toThrow(/exact promoted deployment origin/i);
  });

  it("rejects stale receipts and altered evidence after manifest creation", () => {
    const receipts = releaseReceipts();
    const manifest = buildProductionEvidenceManifest(receipts, config);
    expect(() => buildProductionEvidenceManifest(receipts, {
      ...config,
      generatedAt: new Date("2026-08-18T02:00:00.000Z")
    })).toThrow(/evidence window/i);

    const altered = releaseReceipts();
    altered.staging = {
      ...(altered.staging as Record<string, unknown>),
      auditCheckpoint: { headSequence: 41, headHash: "f".repeat(64) }
    };
    expect(() => verifyProductionEvidenceManifest({
      manifest,
      receipts: altered,
      config: withoutGeneratedAt(config),
      now: generatedAt
    })).toThrow(/exact release checkpoints/i);
  });

  it("rejects a substituted destination digest and an inexact retained checkpoint", () => {
    const substitutedDigest = releaseReceipts();
    substitutedDigest.auditRetention = {
      ...(substitutedDigest.auditRetention as Record<string, unknown>),
      lastDestinationReceiptDigest: `sha256:${"f".repeat(64)}`
    };
    expect(() => buildProductionEvidenceManifest(substitutedDigest, config))
      .toThrow(/signed external acknowledgement/i);

    const alteredCheckpoint = releaseReceipts();
    const receipt = alteredCheckpoint.auditRetention as Record<string, unknown>;
    alteredCheckpoint.auditRetention = {
      ...receipt,
      verifiedReleaseCheckpoints: [
        { name: "staging", sequence: 40, hash: "f".repeat(64) },
        { name: "marketplace", sequence: 42, hash: "6".repeat(64) }
      ]
    };
    expect(() => buildProductionEvidenceManifest(alteredCheckpoint, config))
      .toThrow(/exact release checkpoints/i);
  });

  it("rejects incomplete or inconsistent user-boundary quota evidence", () => {
    const inconsistent = releaseReceipts();
    inconsistent.staging = {
      ...(inconsistent.staging as Record<string, unknown>),
      quotaEvidence: {
        bucket: "admin",
        limit: 3,
        allowedRequests: 2,
        deniedStatus: 429,
        retryAfterSeconds: 1
      }
    };
    expect(() => buildProductionEvidenceManifest(inconsistent, config))
      .toThrow(/one exact configured window/i);

    const wrongStatus = releaseReceipts();
    const staging = wrongStatus.staging as { results: Array<Record<string, unknown>> };
    wrongStatus.staging = {
      ...staging,
      results: staging.results.map((result) =>
        result.name === "cross_tenant_user_denial" ? { ...result, status: 401 } : result)
    };
    expect(() => buildProductionEvidenceManifest(wrongStatus, config))
      .toThrow(/unexpected control status/i);
  });

  it("rejects staging evidence with a nonterminal App action commit", () => {
    const receipts = releaseReceipts();
    receipts.staging = {
      ...(receipts.staging as Record<string, unknown>),
      appActionReconciliationEvidence: {
        requestedTotal: 12,
        succeededTotal: 10,
        failedTotal: 1,
        pending: 1,
        stale: 1,
        oldestAgeSeconds: 600,
        staleAfterSeconds: 300
      }
    };
    expect(() => buildProductionEvidenceManifest(receipts, config)).toThrow();
  });

  it("requires every claimed checkpoint to be inside the signed retained range", () => {
    const aboveSignedHead = releaseReceipts();
    aboveSignedHead.marketplace = {
      ...(aboveSignedHead.marketplace as Record<string, unknown>),
      auditEvidence: {
        afterSequence: 35,
        throughSequence: 51,
        headHash: "7".repeat(64),
        requestId: "marketplace_gate_12345678"
      }
    };
    aboveSignedHead.auditRetention = {
      ...(aboveSignedHead.auditRetention as Record<string, unknown>),
      verifiedReleaseCheckpoints: [
        { name: "staging", sequence: 40, hash: "4".repeat(64) },
        { name: "marketplace", sequence: 51, hash: "7".repeat(64) }
      ]
    };
    expect(() => buildProductionEvidenceManifest(aboveSignedHead, config))
      .toThrow(/exact release checkpoints/i);

    const beforePredecessor = releaseReceipts();
    beforePredecessor.auditRetention = {
      ...(beforePredecessor.auditRetention as Record<string, unknown>),
      fromSequence: 41
    };
    expect(() => buildProductionEvidenceManifest(beforePredecessor, config))
      .toThrow(/exact release checkpoints/i);
  });

  it("checks every source receipt directly against promotion time", () => {
    const receipts = releaseReceipts();
    const delayedConfig = {
      ...config,
      generatedAt: new Date("2026-08-17T07:29:00.000Z")
    };
    const manifest = buildProductionEvidenceManifest(receipts, delayedConfig);
    expect(() => verifyProductionEvidenceManifest({
      manifest,
      receipts,
      config: withoutGeneratedAt(delayedConfig),
      now: new Date("2026-08-17T13:28:00.000Z")
    })).toThrow(/staging validation.*evidence window/i);
  });

  it("rejects a retention acknowledgement outside the protected trust anchor", () => {
    const unrelated = generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem"
    }).toString();
    expect(() => buildProductionEvidenceManifest(releaseReceipts(), {
      ...config,
      auditRetentionPublicKeyPem: unrelated
    })).toThrow(/signature is invalid for the protected trust anchor/i);
  });
});

function withoutGeneratedAt(value: ProductionEvidenceConfig) {
  return {
    repository: value.repository,
    commitSha: value.commitSha,
    workflowRunId: value.workflowRunId,
    workflowRunAttempt: value.workflowRunAttempt,
    deploymentOrigin: value.deploymentOrigin,
    organizationId: value.organizationId,
    projectKey: value.projectKey,
    databaseIdentityDigest: value.databaseIdentityDigest,
    marketplaceApp: value.marketplaceApp,
    auditRetentionKeyId: value.auditRetentionKeyId,
    auditRetentionPublicKeyPem: value.auditRetentionPublicKeyPem,
    maximumEvidenceAgeMinutes: value.maximumEvidenceAgeMinutes
  };
}

function releaseReceipts(): ProductionEvidenceReceipts {
  const checkedAt = "2026-08-17T01:30:00.000Z";
  const headHash = "5".repeat(64);
  const acknowledgement: RetentionAcknowledgement = {
    schemaVersion: "loopgraph-audit-retention-ack/v1",
    statement: {
      receiverId: "retention_receiver_1",
      receiptId: "retention_receipt_1",
      receiptSequence: 1,
      organizationId,
      projectKey: "main",
      batchId: "audit_batch_1",
      payloadDigest: `sha256:${"9".repeat(64)}`,
      previousReceiptDigest: null,
      firstSequence: 1,
      lastSequence: 50,
      eventCount: 50,
      lastEventHash: headHash,
      retainedAt: "2026-08-17T01:44:00.000Z",
      immutableUntil: "2033-08-17T01:44:00.000Z"
    },
    signature: {
      algorithm: "ed25519",
      keyId: auditRetentionKeyId,
      value: "A".repeat(86)
    }
  };
  acknowledgement.signature.value = sign(
    null,
    Buffer.from(retentionAcknowledgementSigningPayload(acknowledgement)),
    auditRetentionKeys.privateKey
  ).toString("base64url");
  return {
    staging: {
      schemaVersion: "staging-validation/v5",
      targetOrigin: deploymentOrigin,
      organizationId,
      projectKey: "main",
      checkedAt,
      auditCheckpoint: { headSequence: 40, headHash: "4".repeat(64) },
      results: [
        { name: "readiness", status: 200 },
        { name: "operational_metrics", status: 200 },
        { name: "app_action_reconciliation_health", status: 200 },
        { name: "audit_integrity", status: 200 },
        { name: "unauthenticated_user_denial", status: 401 },
        { name: "cross_tenant_user_denial", status: 403 },
        { name: "suspended_user_denial", status: 403 },
        { name: "user_api_quota_saturation", status: 429 }
      ].map(({ name, status }) => ({ name, status, ok: true, detail: `${name} passed` })),
      quotaEvidence: {
        bucket: "admin",
        limit: 3,
        allowedRequests: 3,
        deniedStatus: 429,
        retryAfterSeconds: 1
      },
      appActionReconciliationEvidence: {
        requestedTotal: 12,
        succeededTotal: 10,
        failedTotal: 2,
        pending: 0,
        stale: 0,
        oldestAgeSeconds: 0,
        staleAfterSeconds: 300
      }
    },
    marketplace: {
      schemaVersion: "hosted-marketplace-staging-validation/v2",
      targetOrigin: deploymentOrigin,
      organizationId,
      projectKey: "main",
      checkedAt,
      durationMs: 2_000,
      app: marketplaceApp,
      auditEvidence: {
        afterSequence: 35,
        throughSequence: 42,
        headHash: "6".repeat(64),
        requestId: "marketplace_gate_12345678"
      },
      checks: [
        "unauthenticated_denial",
        "tenant_catalog_visibility",
        "artifact_signature_and_cache",
        "cross_tenant_denial",
        "durable_revocation",
        "replay_denial",
        "independent_audit_evidence"
      ].map((name) => ({ name, status: 200, ok: true, detail: `${name} passed` }))
    },
    recovery: {
      schemaVersion: "backup-restore-rehearsal/v2",
      startedAt: "2026-08-17T01:00:00.000Z",
      completedAt: checkedAt,
      durationMs: 30_000,
      dumpDurationMs: 10_000,
      restoreDurationMs: 20_000,
      dumpSizeBytes: 2_048,
      publicTableCount: RECOVERY_TABLES.length,
      postgresMajor: 17,
      sourceHost: "db.production.test",
      targetHost: "db.rehearsal.test",
      sourceIdentityDigest: databaseIdentityDigest,
      targetIdentityDigest: `sha256:${"e".repeat(64)}`,
      criticalTables: RECOVERY_TABLES.map((table, index) => ({
        table,
        rowCount: index,
        sha256: index.toString(16).padStart(64, "0"),
        matched: true
      })),
      auditIntegrity: { valid: true, eventsChecked: 48, scopesChecked: 1 },
      evidenceRecordCounts: {
        metric_binding: 1,
        measurement_job: 1,
        reconciliation: 1,
        metric_sample: 1,
        observed_outcome: 1,
        value_ledger: 1
      },
      externalArtifactBytes: {
        verified: false,
        requiredNextGate: "validate:marketplace-staging",
        reason: "PostgreSQL recovery proves metadata while marketplace validation proves bytes."
      }
    },
    auditRetention: {
      schemaVersion: "audit-drain/v3",
      organizationId,
      projectKey: "main",
      sourceOrigin: deploymentOrigin,
      destinationOrigin: "https://retention.loopgraph.test",
      startedAt: "2026-08-17T01:40:00.000Z",
      completedAt: "2026-08-17T01:45:00.000Z",
      fromSequence: 0,
      throughSequence: 50,
      eventCount: 50,
      batchCount: 1,
      headHash,
      lastDestinationReceiptDigest: sha256Digest(canonicalJson(acknowledgement)),
      lastDestinationAcknowledgement: acknowledgement,
      verifiedReleaseCheckpoints: [
        { name: "staging", sequence: 40, hash: "4".repeat(64) },
        { name: "marketplace", sequence: 42, hash: "6".repeat(64) }
      ]
    }
  };
}
