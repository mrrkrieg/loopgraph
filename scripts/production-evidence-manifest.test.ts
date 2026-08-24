import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS } from "./hosted-app-snapshot-inventory-fence";
import {
  canonicalJson,
  retentionAcknowledgementSigningPayload,
  sha256Digest,
  type RetentionAcknowledgement
} from "./audit-retention-protocol";
import { RECOVERY_TABLES } from "./recovery-contract";
import { canonicalAppDigest } from "../packages/loopgraph/src/core";
import {
  buildProductionEvidenceManifest,
  verifyProductionEvidenceManifest,
  type ProductionEvidenceConfig,
  type ProductionEvidenceReceipts
} from "./production-evidence-manifest";

const organizationId = "123e4567-e89b-42d3-a456-426614174000";
const generatedAt = new Date("2026-08-17T02:00:00.000Z");
const deploymentOrigin = "https://staging.loopgraph.test";
const storageOrigin = "https://snapshot-staging.supabase.co";
const snapshotRestoreOrigin = "https://snapshot-restore.supabase.co";
const databaseIdentityDigest = `sha256:${"d".repeat(64)}`;
const unreferencedInventoryDigest = canonicalAppDigest({ objectKeyDigests: [] });
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
const marketplaceReleaseRevocationApp = {
  appId: "staging.release.revocation.probe",
  version: "1.0.0",
  artifactDigest: `sha256:${"c".repeat(64)}`
};
const workloadIssuerRotation = {
  issuer: "https://identity.staging.test",
  jwksUri: "https://identity.staging.test/.well-known/jwks.json",
  rotationId: "staging-rotation-2026-08-23",
  previousKid: "issuer-key-a",
  nextKid: "issuer-key-b"
};
const workloadIssuerRotationScopeDigest = canonicalAppDigest(workloadIssuerRotation);

const config: ProductionEvidenceConfig = {
  repository: "mrrkrieg/loopgraph",
  commitSha: "b".repeat(40),
  workflowRunId: "123456789",
  workflowRunAttempt: 1,
  deploymentOrigin,
  storageOrigin,
  snapshotRestoreOrigin,
  organizationId,
  projectKey: "main",
  databaseIdentityDigest,
  marketplaceApp,
  expectedAppSnapshotUnreferencedInventoryDigest: unreferencedInventoryDigest,
  expectedMarketplaceReleaseRevocationArtifactDigest:
    marketplaceReleaseRevocationApp.artifactDigest,
  expectedWorkloadIssuerRotationScopeDigest: workloadIssuerRotationScopeDigest,
  auditRetentionKeyId,
  auditRetentionPublicKeyPem,
  generatedAt,
  maximumEvidenceAgeMinutes: 360
};

describe("production promotion evidence manifest", () => {
  it("binds the exact release to staging, marketplace, App snapshots, recovery, and external audit evidence", () => {
    const receipts = releaseReceipts();
    const manifest = buildProductionEvidenceManifest(receipts, config);

    expect(manifest).toMatchObject({
      schemaVersion: "loopgraph-production-promotion-evidence/v16",
      release: {
        repository: config.repository,
        commitSha: config.commitSha,
        deploymentOrigin
      },
      scope: {
        organizationId,
        projectKey: "main",
        databaseIdentityDigest,
        appSnapshotRetention: { unreferencedInventoryDigest },
        appSnapshotFenceProbe: {
          scopeDigest: canonicalAppDigest({
            origin: storageOrigin,
            organizationId,
            probeNamespace: "fence_probe"
          })
        },
        learningEntityProbe: {
          scopeDigest: canonicalAppDigest({
            origin: storageOrigin,
            organizationId,
            probeNamespace: "learning_probe"
          })
        }
      },
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
        appActionExactlyOnce: {
          summary: {
            sourceCommitSha: config.commitSha,
            scenario: "broker_receipt_persisted_before_app_terminal_event",
            providerInvocationCount: 1,
            reconciliationCalls: 1,
            replayCommitCalls: 1,
            appTerminalEventsBeforeReconciliation: 0,
            appTerminalEventsAfterReconciliation: 1,
            originalBrokerReceiptDigest: `sha256:${"8".repeat(64)}`,
            proofDigest: exactlyOnceReceipt("2026-08-17T01:30:00.000Z").proofDigest
          }
        },
        marketplace: { summary: { checks: 7, artifactDigest: marketplaceApp.artifactDigest } },
        cliSessions: {
          summary: {
            primaryOrigin: deploymentOrigin,
            replicaOrigin: "https://staging-replica.loopgraph.test",
            checks: 10,
            requestRateLimit: 10,
            deviceFingerprintLimit: 5,
            auditedRequestId: "cli_rate_12345678",
            auditThroughSequence: 45,
            auditHeadHash: "8".repeat(64),
            disposableSessionRevoked: true
          }
        },
        cliAdmin: {
          summary: {
            checks: 5,
            revokedCount: 1,
            auditCorrelationId:
              "cli_session_revoke_123e4567-e89b-42d3-a456-426614174099",
            auditThroughSequence: 46,
            auditHeadHash: "9".repeat(64),
            aal1Denied: true,
            aal2Required: true,
            exactSessionScope: true,
            atomicAuditReceipt: true,
            disposableSessionRevoked: true
          }
        },
        marketplaceReleaseRevocation: {
          summary: {
            appId: marketplaceReleaseRevocationApp.appId,
            version: marketplaceReleaseRevocationApp.version,
            artifactDigest: marketplaceReleaseRevocationApp.artifactDigest,
            checks: 6,
            changed: true,
            auditCorrelationId:
              "marketplace_release_status_123e4567-e89b-42d3-a456-426614174098",
            auditThroughSequence: 47,
            auditHeadHash: "a".repeat(64)
          }
        },
        workloadIssuerRotation: {
          summary: {
            primaryOrigin: deploymentOrigin,
            replicaOrigin: "https://staging-replica.loopgraph.test",
            scopeDigest: workloadIssuerRotationScopeDigest,
            checks: 8,
            overlapReceiptDigest: `sha256:${"6".repeat(64)}`,
            retirementReceiptDigest: `sha256:${"7".repeat(64)}`,
            auditRequestId: "issuer_final_primary_12345678",
            auditThroughSequence: 48,
            auditHeadHash: "b".repeat(64)
          }
        },
        appEvidenceHealth: {
          summary: {
            checks: 8,
            auditedRequestId: "app_evidence_health_12345678",
            auditThroughSequence: 44,
            auditHeadHash: "7".repeat(64),
            classificationCases: 6,
            health: "degraded",
            totalInstallations: 5,
            totalMatched: 2,
            itemsReturned: 2,
            truncated: false,
            invalid: 0,
            expired: 0,
            renewSoon: 1,
            incomplete: 1,
            current: 2,
            notApplicable: 1
          }
        },
        appSnapshotFenceProbe: {
          summary: {
            scopeDigest: canonicalAppDigest({
              origin: storageOrigin,
              organizationId,
              probeNamespace: "fence_probe"
            }),
            checks: 8,
            healthy: true
          }
        },
        learningEntities: {
          summary: {
            scopeDigest: canonicalAppDigest({
              origin: storageOrigin,
              organizationId,
              probeNamespace: "learning_probe"
            }),
            checks: 9,
            healthy: true,
            durationMs: 3_000
          }
        },
        appSnapshots: {
          summary: {
            storageOrigin,
            checks: 8,
            snapshotIdentityDigest: `sha256:${"1".repeat(64)}`,
            artifactDigest: `sha256:${"2".repeat(64)}`,
            filesDigest: `sha256:${"3".repeat(64)}`
          }
        },
        appSnapshotRecovery: {
          summary: {
            sourceOrigin: storageOrigin,
            restoreOrigin: snapshotRestoreOrigin,
            checks: 6,
            archiveSizeBytes: 4_096,
            snapshotIdentityDigest: `sha256:${"4".repeat(64)}`,
            artifactDigest: `sha256:${"2".repeat(64)}`,
            filesDigest: `sha256:${"3".repeat(64)}`
          }
        },
        appSnapshotReconciliation: {
          summary: {
            scopeDigest: canonicalAppDigest({
              origin: storageOrigin,
              organizationId,
              projectKey: "main"
            }),
            checks: 10,
            inventoryFenceDigest: canonicalAppDigest({
              scopeDigest: canonicalAppDigest({
                origin: storageOrigin,
                organizationId,
                projectKey: "main"
              }),
              status: HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS
            }),
            inventoryPasses: 2,
            inventoryGeneration: 3,
            inventoryGenerationDigest: canonicalAppDigest({
              scopeDigest: canonicalAppDigest({
                origin: storageOrigin,
                organizationId,
                projectKey: "main"
              }),
              generation: 3
            }),
            registriesScanned: 4,
            detachedInstallations: 3,
            verifiedSnapshots: 3,
            missingSnapshots: 0,
            corruptSnapshots: 0,
            untrackedSnapshots: 0,
            unavailableSnapshots: 0,
            storageObjects: 3,
            referencedStorageObjects: 3,
            unreferencedSnapshots: 0,
            malformedStorageObjects: 0,
            unreferencedInventoryDigest,
            healthy: true
          }
        },
        recovery: { summary: { criticalTables: RECOVERY_TABLES.length } },
        auditRetention: { summary: { throughSequence: 50 } }
      }
    });
    expect(Object.keys(manifest.evidence)).toHaveLength(15);
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

  it("requires CLI evidence from a distinct replica with the exact control contract", () => {
    const sameReplica = releaseReceipts();
    sameReplica.cliSessions = {
      ...(sameReplica.cliSessions as Record<string, unknown>),
      replicaOrigin: deploymentOrigin
    };
    expect(() => buildProductionEvidenceManifest(sameReplica, config))
      .toThrow(/distinct replica origin/i);

    const wrongStatus = releaseReceipts();
    const receipt = wrongStatus.cliSessions as { checks: Array<Record<string, unknown>> };
    wrongStatus.cliSessions = {
      ...receipt,
      checks: receipt.checks.map((check) =>
        check.name === "refresh_replay_family_revocation"
          ? { ...check, status: 200 }
          : check)
    };
    expect(() => buildProductionEvidenceManifest(wrongStatus, config))
      .toThrow(/unexpected control status/i);
  });

  it("requires exact MFA administrator revocation and audit correlation evidence", () => {
    const wrongStatus = releaseReceipts();
    const receipt = wrongStatus.cliAdmin as { checks: Array<Record<string, unknown>> };
    wrongStatus.cliAdmin = {
      ...receipt,
      checks: receipt.checks.map((check) =>
        check.name === "aal1_step_up_denial" ? { ...check, status: 200 } : check)
    };
    expect(() => buildProductionEvidenceManifest(wrongStatus, config))
      .toThrow(/unexpected control status/i);

    const wrongCorrelation = releaseReceipts();
    const correlated = wrongCorrelation.cliAdmin as Record<string, unknown>;
    wrongCorrelation.cliAdmin = {
      ...correlated,
      auditEvidence: {
        ...(correlated.auditEvidence as Record<string, unknown>),
        correlationId: "cli_session_revoke_123e4567-e89b-42d3-a456-426614174098"
      }
    };
    expect(() => buildProductionEvidenceManifest(wrongCorrelation, config)).toThrow();
  });

  it("requires the independently pinned marketplace release revocation proof", () => {
    const wrongStatus = releaseReceipts();
    const receipt = wrongStatus.marketplaceReleaseRevocation as {
      checks: Array<Record<string, unknown>>;
    };
    wrongStatus.marketplaceReleaseRevocation = {
      ...receipt,
      checks: receipt.checks.map((check) =>
        check.name === "workload_revocation_and_cache_eviction"
          ? { ...check, status: 200 }
          : check)
    };
    expect(() => buildProductionEvidenceManifest(wrongStatus, config))
      .toThrow(/unexpected control status/i);

    const substitutedArtifact = releaseReceipts();
    const substitutedReceipt = substitutedArtifact.marketplaceReleaseRevocation as
      Record<string, unknown>;
    substitutedArtifact.marketplaceReleaseRevocation = {
      ...substitutedReceipt,
      release: {
        ...(substitutedReceipt.release as Record<string, unknown>),
        artifactDigest: `sha256:${"f".repeat(64)}`
      }
    };
    expect(() => buildProductionEvidenceManifest(substitutedArtifact, config))
      .toThrow(/independently pinned disposable artifact/i);

    const unretainedAudit = releaseReceipts();
    const auditedReceipt = unretainedAudit.marketplaceReleaseRevocation as
      Record<string, unknown>;
    unretainedAudit.marketplaceReleaseRevocation = {
      ...auditedReceipt,
      auditEvidence: {
        ...(auditedReceipt.auditEvidence as Record<string, unknown>),
        throughSequence: 48
      }
    };
    expect(() => buildProductionEvidenceManifest(unretainedAudit, config))
      .toThrow(/exact release checkpoints/i);
  });

  it("requires the independently pinned workload issuer rotation proof", () => {
    const wrongStatus = releaseReceipts();
    const receipt = wrongStatus.workloadIssuerRotation as {
      checks: Array<Record<string, unknown>>;
    };
    wrongStatus.workloadIssuerRotation = {
      ...receipt,
      checks: receipt.checks.map((check) =>
        check.name === "previous_key_cross_replica_denial"
          ? { ...check, status: 200 }
          : check)
    };
    expect(() => buildProductionEvidenceManifest(wrongStatus, config))
      .toThrow(/unexpected control status/i);

    const substitutedScope = releaseReceipts();
    const substitutedReceipt = substitutedScope.workloadIssuerRotation as
      Record<string, unknown>;
    substitutedScope.workloadIssuerRotation = {
      ...substitutedReceipt,
      issuer: "https://other-identity.staging.test",
      jwksUri: "https://other-identity.staging.test/.well-known/jwks.json"
    };
    expect(() => buildProductionEvidenceManifest(substitutedScope, config))
      .toThrow(/independently pinned rotation scope/i);

    const unretainedAudit = releaseReceipts();
    const auditedReceipt = unretainedAudit.workloadIssuerRotation as
      Record<string, unknown>;
    unretainedAudit.workloadIssuerRotation = {
      ...auditedReceipt,
      auditEvidence: {
        ...(auditedReceipt.auditEvidence as Record<string, unknown>),
        throughSequence: 49
      }
    };
    expect(() => buildProductionEvidenceManifest(unretainedAudit, config))
      .toThrow(/exact release checkpoints/i);
  });

  it("rejects App evidence health from another deployment, tenant, or stale projection", () => {
    const wrongOrigin = releaseReceipts();
    wrongOrigin.appEvidenceHealth = {
      ...(wrongOrigin.appEvidenceHealth as Record<string, unknown>),
      targetOrigin: "https://other.loopgraph.test"
    };
    expect(() => buildProductionEvidenceManifest(wrongOrigin, config))
      .toThrow(/exact promoted deployment origin/i);

    const wrongTenant = releaseReceipts();
    wrongTenant.appEvidenceHealth = {
      ...(wrongTenant.appEvidenceHealth as Record<string, unknown>),
      organizationId: "00000000-0000-4000-8000-000000000001"
    };
    expect(() => buildProductionEvidenceManifest(wrongTenant, config))
      .toThrow(/exact tenant and project scope/i);

    const staleProjection = releaseReceipts();
    const receipt = staleProjection.appEvidenceHealth as Record<string, unknown>;
    staleProjection.appEvidenceHealth = {
      ...receipt,
      projection: {
        ...(receipt.projection as Record<string, unknown>),
        generatedAt: "2026-08-17T01:00:00.000Z"
      }
    };
    expect(() => buildProductionEvidenceManifest(staleProjection, config)).toThrow();

    const unretainedAudit = releaseReceipts();
    const auditedReceipt = unretainedAudit.appEvidenceHealth as Record<string, unknown>;
    unretainedAudit.appEvidenceHealth = {
      ...auditedReceipt,
      auditEvidence: {
        ...(auditedReceipt.auditEvidence as Record<string, unknown>),
        throughSequence: 45
      }
    };
    expect(() => buildProductionEvidenceManifest(unretainedAudit, config))
      .toThrow(/exact release checkpoints/i);
  });

  it("rejects App evidence metric drift or an inexact control set", () => {
    const drift = releaseReceipts();
    const receipt = drift.appEvidenceHealth as Record<string, unknown>;
    drift.appEvidenceHealth = {
      ...receipt,
      metrics: {
        ...(receipt.metrics as Record<string, unknown>),
        totalInstallations: 6
      }
    };
    expect(() => buildProductionEvidenceManifest(drift, config))
      .toThrow(/metrics must match/i);

    const duplicated = releaseReceipts();
    const duplicatedReceipt = duplicated.appEvidenceHealth as {
      checks: Array<Record<string, unknown>>;
    };
    duplicated.appEvidenceHealth = {
      ...duplicatedReceipt,
      checks: [duplicatedReceipt.checks[0], ...duplicatedReceipt.checks.slice(0, -1)]
    };
    expect(() => buildProductionEvidenceManifest(duplicated, config))
      .toThrow(/omitted or duplicated/i);

    const wrongStatus = releaseReceipts();
    const statusReceipt = wrongStatus.appEvidenceHealth as {
      checks: Array<Record<string, unknown>>;
    };
    wrongStatus.appEvidenceHealth = {
      ...statusReceipt,
      checks: statusReceipt.checks.map((check) =>
        check.name === "authorized_health_projection" ? { ...check, status: 200 } : check)
    };
    expect(() => buildProductionEvidenceManifest(wrongStatus, config))
      .toThrow(/unexpected control status/i);

    const classificationDrift = releaseReceipts();
    const classificationReceipt = classificationDrift.appEvidenceHealth as Record<string, unknown>;
    const classificationEvidence = classificationReceipt.classificationEvidence as {
      cases: Array<Record<string, unknown>>;
    };
    classificationDrift.appEvidenceHealth = {
      ...classificationReceipt,
      classificationEvidence: {
        cases: classificationEvidence.cases.map((item) =>
          item.status === "expired" ? { ...item, observedHealth: "healthy" } : item)
      }
    };
    expect(() => buildProductionEvidenceManifest(classificationDrift, config))
      .toThrow(/classification fixture set/i);
  });

  it("rejects snapshot evidence from another Storage origin or with a missing denial control", () => {
    const wrongOrigin = releaseReceipts();
    wrongOrigin.appSnapshots = {
      ...(wrongOrigin.appSnapshots as Record<string, unknown>),
      targetOrigin: "https://other.supabase.co"
    };
    expect(() => buildProductionEvidenceManifest(wrongOrigin, config))
      .toThrow(/exact protected Storage origin/i);

    const missingControl = releaseReceipts();
    const snapshot = missingControl.appSnapshots as { checks: Array<Record<string, unknown>> };
    missingControl.appSnapshots = { ...snapshot, checks: snapshot.checks.slice(1) };
    expect(() => buildProductionEvidenceManifest(missingControl, config)).toThrow();
  });

  it("rejects a mutation fence probe for another scope or with an incomplete control set", () => {
    const wrongScope = releaseReceipts();
    wrongScope.appSnapshotFenceProbe = {
      ...(wrongScope.appSnapshotFenceProbe as Record<string, unknown>),
      scopeDigest: `sha256:${"f".repeat(64)}`
    };
    expect(() => buildProductionEvidenceManifest(wrongScope, config))
      .toThrow(/mutation fence probe.*protected Storage and tenant scope/i);

    const duplicatedControl = releaseReceipts();
    const probe = duplicatedControl.appSnapshotFenceProbe as {
      checks: Array<Record<string, unknown>>;
    };
    duplicatedControl.appSnapshotFenceProbe = {
      ...probe,
      checks: [probe.checks[0], ...probe.checks.slice(0, -1)]
    };
    expect(() => buildProductionEvidenceManifest(duplicatedControl, config))
      .toThrow(/omitted or duplicated/i);
  });

  it("rejects learning/entity evidence for another scope or with an inexact control set", () => {
    const wrongScope = releaseReceipts();
    wrongScope.learningEntities = {
      ...(wrongScope.learningEntities as Record<string, unknown>),
      scopeDigest: `sha256:${"f".repeat(64)}`
    };
    expect(() => buildProductionEvidenceManifest(wrongScope, config))
      .toThrow(/learning and entity evidence.*protected Storage and tenant scope/i);

    const duplicatedControl = releaseReceipts();
    const receipt = duplicatedControl.learningEntities as {
      checks: Array<Record<string, unknown>>;
    };
    duplicatedControl.learningEntities = {
      ...receipt,
      checks: [receipt.checks[0], ...receipt.checks.slice(0, -1)]
    };
    expect(() => buildProductionEvidenceManifest(duplicatedControl, config))
      .toThrow(/omitted or duplicated/i);

    const extraControl = releaseReceipts();
    const extraReceipt = extraControl.learningEntities as {
      checks: Array<Record<string, unknown>>;
    };
    extraControl.learningEntities = {
      ...extraReceipt,
      checks: [...extraReceipt.checks, { name: "unexpected", ok: true }]
    };
    expect(() => buildProductionEvidenceManifest(extraControl, config)).toThrow();
  });

  it("binds learning/entity evidence content and freshness into promotion", () => {
    const baseline = releaseReceipts();
    const baselineManifest = buildProductionEvidenceManifest(baseline, config);
    const changed = releaseReceipts();
    changed.learningEntities = {
      ...(changed.learningEntities as Record<string, unknown>),
      durationMs: 3_001
    };
    const changedManifest = buildProductionEvidenceManifest(changed, config);
    expect(changedManifest.evidence.learningEntities.digest)
      .not.toBe(baselineManifest.evidence.learningEntities.digest);
    expect(changedManifest.evidenceSetDigest).not.toBe(baselineManifest.evidenceSetDigest);

    const stale = releaseReceipts();
    stale.learningEntities = {
      ...(stale.learningEntities as Record<string, unknown>),
      checkedAt: "2026-08-16T01:30:00.000Z"
    };
    expect(() => buildProductionEvidenceManifest(stale, config))
      .toThrow(/hosted learning and entity validation.*evidence window/i);
  });

  it("rejects snapshot recovery evidence for another source, target, or incomplete restore proof", () => {
    const wrongSource = releaseReceipts();
    wrongSource.appSnapshotRecovery = {
      ...(wrongSource.appSnapshotRecovery as Record<string, unknown>),
      sourceOrigin: "https://other-source.supabase.co"
    };
    expect(() => buildProductionEvidenceManifest(wrongSource, config))
      .toThrow(/protected source.*isolated restore origin/i);

    const wrongTarget = releaseReceipts();
    wrongTarget.appSnapshotRecovery = {
      ...(wrongTarget.appSnapshotRecovery as Record<string, unknown>),
      restoreOrigin: "https://other-restore.supabase.co"
    };
    expect(() => buildProductionEvidenceManifest(wrongTarget, config))
      .toThrow(/protected source.*isolated restore origin/i);

    const incomplete = releaseReceipts();
    const recovery = incomplete.appSnapshotRecovery as { checks: Array<Record<string, unknown>> };
    incomplete.appSnapshotRecovery = { ...recovery, checks: recovery.checks.slice(1) };
    expect(() => buildProductionEvidenceManifest(incomplete, config)).toThrow();
  });

  it("rejects snapshot reconciliation for another scope or any unhealthy inventory", () => {
    const wrongScope = releaseReceipts();
    const wrongScopeDigest = `sha256:${"f".repeat(64)}`;
    wrongScope.appSnapshotReconciliation = {
      ...(wrongScope.appSnapshotReconciliation as Record<string, unknown>),
      scopeDigest: wrongScopeDigest,
      inventoryFenceDigest: canonicalAppDigest({
        scopeDigest: wrongScopeDigest,
        status: HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS
      }),
      inventoryGenerationDigest: canonicalAppDigest({
        scopeDigest: wrongScopeDigest,
        generation: 3
      })
    };
    expect(() => buildProductionEvidenceManifest(wrongScope, config))
      .toThrow(/protected Storage and tenant scope/i);

    const unattestedFence = releaseReceipts();
    unattestedFence.appSnapshotReconciliation = {
      ...(unattestedFence.appSnapshotReconciliation as Record<string, unknown>),
      inventoryFenceDigest: `sha256:${"0".repeat(64)}`
    };
    expect(() => buildProductionEvidenceManifest(unattestedFence, config))
      .toThrow(/fence digest/i);

    const missing = releaseReceipts();
    missing.appSnapshotReconciliation = {
      ...(missing.appSnapshotReconciliation as Record<string, unknown>),
      verifiedSnapshots: 2,
      missingSnapshots: 1,
      healthy: false
    };
    expect(() => buildProductionEvidenceManifest(missing, config)).toThrow();

    const incomplete = releaseReceipts();
    const receipt = incomplete.appSnapshotReconciliation as { checks: Array<Record<string, unknown>> };
    incomplete.appSnapshotReconciliation = { ...receipt, checks: receipt.checks.slice(1) };
    expect(() => buildProductionEvidenceManifest(incomplete, config)).toThrow();

    const impossibleInventory = releaseReceipts();
    impossibleInventory.appSnapshotReconciliation = {
      ...(impossibleInventory.appSnapshotReconciliation as Record<string, unknown>),
      storageObjects: 4,
      referencedStorageObjects: 4
    };
    expect(() => buildProductionEvidenceManifest(impossibleInventory, config)).toThrow();
  });

  it("rejects an unreviewed or substituted App snapshot retention inventory", () => {
    const substituted = releaseReceipts();
    substituted.appSnapshotReconciliation = {
      ...(substituted.appSnapshotReconciliation as Record<string, unknown>),
      unreferencedSnapshots: 1,
      storageObjects: 4,
      unreferencedInventoryDigest: canonicalAppDigest({
        objectKeyDigests: [canonicalAppDigest({ objectKey: "opaque-substitute" })]
      })
    };
    expect(() => buildProductionEvidenceManifest(substituted, config))
      .toThrow(/protected retention inventory/i);

    expect(() => buildProductionEvidenceManifest(releaseReceipts(), {
      ...config,
      expectedAppSnapshotUnreferencedInventoryDigest: `sha256:${"f".repeat(64)}`
    })).toThrow(/protected retention inventory/i);
  });

  it("rejects an exactly-once proof built from another source commit", () => {
    const receipts = releaseReceipts();
    receipts.appActionExactlyOnce = exactlyOnceReceipt(
      "2026-08-17T01:30:00.000Z",
      "c".repeat(40)
    );
    expect(() => buildProductionEvidenceManifest(receipts, config))
      .toThrow(/does not belong to the promoted source commit/i);
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
        { name: "marketplace", sequence: 42, hash: "6".repeat(64) },
        { name: "app_evidence_health", sequence: 44, hash: "7".repeat(64) },
        { name: "cli_sessions", sequence: 45, hash: "8".repeat(64) },
        { name: "cli_admin", sequence: 46, hash: "9".repeat(64) },
        { name: "marketplace_release_revocation", sequence: 47, hash: "a".repeat(64) },
        { name: "workload_issuer_rotation", sequence: 48, hash: "b".repeat(64) }
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
        { name: "marketplace", sequence: 51, hash: "7".repeat(64) },
        { name: "app_evidence_health", sequence: 44, hash: "7".repeat(64) },
        { name: "cli_sessions", sequence: 45, hash: "8".repeat(64) },
        { name: "cli_admin", sequence: 46, hash: "9".repeat(64) },
        { name: "marketplace_release_revocation", sequence: 47, hash: "a".repeat(64) },
        { name: "workload_issuer_rotation", sequence: 48, hash: "b".repeat(64) }
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

    const revocationReceipts = releaseReceipts();
    revocationReceipts.marketplaceReleaseRevocation = {
      ...(revocationReceipts.marketplaceReleaseRevocation as Record<string, unknown>),
      checkedAt: "2026-08-17T01:00:00.000Z"
    };
    const revocationConfig = {
      ...config,
      generatedAt: new Date("2026-08-17T02:00:00.000Z")
    };
    const revocationManifest = buildProductionEvidenceManifest(
      revocationReceipts,
      revocationConfig
    );
    expect(() => verifyProductionEvidenceManifest({
      manifest: revocationManifest,
      receipts: revocationReceipts,
      config: withoutGeneratedAt(revocationConfig),
      now: new Date("2026-08-17T07:01:00.000Z")
    })).toThrow(/marketplace release revocation validation.*evidence window/i);

    const rotationReceipts = releaseReceipts();
    rotationReceipts.workloadIssuerRotation = {
      ...(rotationReceipts.workloadIssuerRotation as Record<string, unknown>),
      checkedAt: "2026-08-17T01:00:00.000Z"
    };
    const rotationManifest = buildProductionEvidenceManifest(rotationReceipts, revocationConfig);
    expect(() => verifyProductionEvidenceManifest({
      manifest: rotationManifest,
      receipts: rotationReceipts,
      config: withoutGeneratedAt(revocationConfig),
      now: new Date("2026-08-17T07:01:00.000Z")
    })).toThrow(/workload issuer rotation validation.*evidence window/i);
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
    storageOrigin: value.storageOrigin,
    snapshotRestoreOrigin: value.snapshotRestoreOrigin,
    organizationId: value.organizationId,
    projectKey: value.projectKey,
    databaseIdentityDigest: value.databaseIdentityDigest,
    marketplaceApp: value.marketplaceApp,
    expectedAppSnapshotUnreferencedInventoryDigest:
      value.expectedAppSnapshotUnreferencedInventoryDigest,
    expectedMarketplaceReleaseRevocationArtifactDigest:
      value.expectedMarketplaceReleaseRevocationArtifactDigest,
    expectedWorkloadIssuerRotationScopeDigest:
      value.expectedWorkloadIssuerRotationScopeDigest,
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
    appActionExactlyOnce: exactlyOnceReceipt(checkedAt),
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
    cliSessions: {
      schemaVersion: "hosted-cli-session-staging-validation/v1",
      primaryOrigin: deploymentOrigin,
      replicaOrigin: "https://staging-replica.loopgraph.test",
      organizationId,
      projectKey: "main",
      checkedAt,
      durationMs: 5_000,
      controls: {
        deviceFingerprintLimit: 5,
        requestRateLimit: 10,
        crossReplica: true,
        disposableSessionRevoked: true
      },
      auditEvidence: {
        afterSequence: 44,
        throughSequence: 45,
        headHash: "8".repeat(64),
        requestId: "cli_rate_12345678"
      },
      checks: [
        { name: "device_issuance_saturation", status: 429 },
        { name: "polling_slow_down", status: 429 },
        { name: "primary_refresh_rotation", status: 200 },
        { name: "cross_replica_refresh_rotation", status: 200 },
        { name: "stale_request_metadata_denial", status: 400 },
        { name: "suspended_membership_denial", status: 403 },
        { name: "revoked_session_denial", status: 401 },
        { name: "request_rate_saturation", status: 429 },
        { name: "refresh_replay_family_revocation", status: 400 },
        { name: "independent_audit_evidence", status: 200 }
      ].map(({ name, status }) => ({ name, status, ok: true, detail: `${name} passed` }))
    },
    cliAdmin: {
      schemaVersion: "hosted-cli-admin-staging-validation/v1",
      targetOrigin: deploymentOrigin,
      organizationId,
      projectKey: "main",
      checkedAt,
      durationMs: 1_000,
      controls: {
        aal1Denied: true,
        aal2Required: true,
        exactSessionScope: true,
        atomicAuditReceipt: true,
        disposableSessionRevoked: true
      },
      revocation: {
        revokedCount: 1,
        correlationId: "cli_session_revoke_123e4567-e89b-42d3-a456-426614174099"
      },
      auditEvidence: {
        afterSequence: 45,
        throughSequence: 46,
        headHash: "9".repeat(64),
        correlationId: "cli_session_revoke_123e4567-e89b-42d3-a456-426614174099"
      },
      checks: [
        { name: "aal1_step_up_denial", status: 403 },
        { name: "aal2_exact_session_revocation", status: 200 },
        { name: "post_revocation_inventory", status: 200 },
        { name: "revoked_cli_access_denial", status: 401 },
        { name: "independent_audit_evidence", status: 200 }
      ].map(({ name, status }) => ({ name, status, ok: true, detail: `${name} passed` }))
    },
    marketplaceReleaseRevocation: {
      schemaVersion: "hosted-marketplace-release-revocation-staging-validation/v1",
      targetOrigin: deploymentOrigin,
      organizationId,
      projectKey: "main",
      checkedAt,
      durationMs: 1_000,
      release: marketplaceReleaseRevocationApp,
      revocation: {
        changed: true,
        correlationId:
          "marketplace_release_status_123e4567-e89b-42d3-a456-426614174098"
      },
      auditEvidence: {
        afterSequence: 46,
        throughSequence: 47,
        headHash: "a".repeat(64),
        correlationId:
          "marketplace_release_status_123e4567-e89b-42d3-a456-426614174098"
      },
      checks: [
        { name: "verified_release_cached", status: 200 },
        { name: "aal1_step_up_denial", status: 403 },
        { name: "denied_request_preserves_release", status: 200 },
        { name: "aal2_exact_release_revocation", status: 200 },
        { name: "workload_revocation_and_cache_eviction", status: 404 },
        { name: "independent_audit_evidence", status: 200 }
      ].map(({ name, status }) => ({ name, status, ok: true, detail: `${name} passed` }))
    },
    workloadIssuerRotation: {
      schemaVersion: "hosted-workload-issuer-rotation-staging-validation/v1",
      primaryOrigin: deploymentOrigin,
      replicaOrigin: "https://staging-replica.loopgraph.test",
      organizationId,
      projectKey: "main",
      checkedAt,
      durationMs: 310_000,
      issuer: workloadIssuerRotation.issuer,
      jwksUri: workloadIssuerRotation.jwksUri,
      rotation: {
        rotationId: workloadIssuerRotation.rotationId,
        previousKid: workloadIssuerRotation.previousKid,
        nextKid: workloadIssuerRotation.nextKid,
        overlapReceiptDigest: `sha256:${"6".repeat(64)}`,
        retirementReceiptDigest: `sha256:${"7".repeat(64)}`
      },
      auditEvidence: {
        afterSequence: 47,
        throughSequence: 48,
        headHash: "b".repeat(64),
        requestId: "issuer_final_primary_12345678"
      },
      checks: [
        { name: "pre_rotation_jwks", status: 200 },
        { name: "previous_key_cross_replica_acceptance", status: 200 },
        { name: "overlap_published", status: 200 },
        { name: "next_key_cross_replica_acceptance", status: 200 },
        { name: "previous_key_retired", status: 200 },
        { name: "previous_key_cross_replica_denial", status: 401 },
        { name: "next_key_post_retirement_acceptance", status: 200 },
        { name: "independent_audit_evidence", status: 200 }
      ].map(({ name, status }) => ({ name, status, ok: true, detail: `${name} passed` }))
    },
    appEvidenceHealth: {
      schemaVersion: "hosted-app-evidence-health-staging-validation/v3",
      targetOrigin: deploymentOrigin,
      organizationId,
      projectKey: "main",
      checkedAt,
      durationMs: 500,
      auditEvidence: {
        afterSequence: 42,
        throughSequence: 44,
        headHash: "7".repeat(64),
        requestId: "app_evidence_health_12345678"
      },
      classificationEvidence: {
        cases: [
          { status: "invalid", expectedHealth: "blocked", observedHealth: "blocked", ok: true },
          { status: "expired", expectedHealth: "degraded", observedHealth: "degraded", ok: true },
          { status: "renew_soon", expectedHealth: "degraded", observedHealth: "degraded", ok: true },
          { status: "incomplete", expectedHealth: "healthy", observedHealth: "healthy", ok: true },
          { status: "current", expectedHealth: "healthy", observedHealth: "healthy", ok: true },
          { status: "not_applicable", expectedHealth: "healthy", observedHealth: "healthy", ok: true }
        ]
      },
      projection: {
        generatedAt: checkedAt,
        health: "degraded",
        totalInstallations: 5,
        totalMatched: 2,
        itemsReturned: 2,
        truncated: false,
        counts: {
          invalid: 0,
          expired: 0,
          renewSoon: 1,
          incomplete: 1,
          current: 2,
          notApplicable: 1
        }
      },
      metrics: {
        health: 0,
        totalInstallations: 5,
        itemsReturned: 2,
        truncated: 0,
        counts: {
          invalid: 0,
          expired: 0,
          renewSoon: 1,
          incomplete: 1,
          current: 2,
          notApplicable: 1
        }
      },
      checks: [
        { name: "unauthenticated_denial", status: 401 },
        { name: "cross_tenant_denial", status: 403 },
        { name: "authorized_health_projection", status: 202 },
        { name: "replay_denial", status: 409 },
        { name: "aggregate_only_contract" },
        { name: "metrics_projection_parity", status: 200 },
        { name: "classification_fixture_rehearsal" },
        { name: "independent_audit_evidence", status: 200 }
      ].map(({ name, status }) => ({
        name,
        ...(status === undefined ? {} : { status }),
        ok: true,
        detail: `${name} passed`
      }))
    },
    appSnapshotFenceProbe: {
      schemaVersion: "hosted-app-snapshot-fence-probe/v1",
      checkedAt,
      durationMs: 1_000,
      scopeDigest: canonicalAppDigest({
        origin: storageOrigin,
        organizationId,
        probeNamespace: "fence_probe"
      }),
      healthy: true,
      checks: [
        "registry_insert_advanced",
        "registry_update_advanced",
        "registry_delete_advanced",
        "storage_upload_advanced",
        "storage_replace_advanced",
        "storage_delete_advanced",
        "probe_authority_clean",
        "probe_generation_clean"
      ].map((name) => ({ name, ok: true }))
    },
    learningEntities: {
      schemaVersion: "hosted-learning-entity-staging-validation/v1",
      checkedAt,
      durationMs: 3_000,
      scopeDigest: canonicalAppDigest({
        origin: storageOrigin,
        organizationId,
        probeNamespace: "learning_probe"
      }),
      healthy: true,
      checks: [
        "distributed_measurement_claim",
        "stale_lease_rejected",
        "cross_replica_job_finalization",
        "metric_sample_immutable",
        "observed_outcome_immutable",
        "value_ledger_immutable",
        "cross_replica_entity_visibility",
        "provider_alias_single_owner",
        "probe_scope_clean"
      ].map((name) => ({ name, ok: true }))
    },
    appSnapshots: {
      schemaVersion: "hosted-app-snapshot-staging-validation/v1",
      targetOrigin: storageOrigin,
      organizationId,
      projectKey: "main",
      checkedAt,
      durationMs: 4_000,
      snapshotIdentityDigest: `sha256:${"1".repeat(64)}`,
      artifactDigest: `sha256:${"2".repeat(64)}`,
      filesDigest: `sha256:${"3".repeat(64)}`,
      checks: [
        "private_bounded_bucket",
        "authenticated_download_denial",
        "authenticated_insert_denial",
        "authenticated_update_denial",
        "authenticated_delete_denial",
        "immutable_first_writer",
        "cross_replica_exact_recovery",
        "cleanup_verified"
      ].map((name) => ({ name, ok: true, detail: `${name} passed` }))
    },
    appSnapshotRecovery: {
      schemaVersion: "hosted-app-snapshot-restore-rehearsal/v1",
      sourceOrigin: storageOrigin,
      restoreOrigin: snapshotRestoreOrigin,
      organizationId,
      projectKey: "main",
      startedAt: "2026-08-17T01:20:00.000Z",
      completedAt: checkedAt,
      durationMs: 10_000,
      archiveSizeBytes: 4_096,
      snapshotIdentityDigest: `sha256:${"4".repeat(64)}`,
      artifactDigest: `sha256:${"2".repeat(64)}`,
      filesDigest: `sha256:${"3".repeat(64)}`,
      checks: [
        "separate_private_bounded_buckets",
        "source_archive_exported",
        "target_first_writer_restore",
        "isolated_target_exact_load",
        "source_preserved_after_target_cleanup",
        "cleanup_verified"
      ].map((name) => ({ name, ok: true, detail: `${name} passed` }))
    },
    appSnapshotReconciliation: {
      schemaVersion: "hosted-app-snapshot-reconciliation/v3",
      checkedAt,
      durationMs: 8_000,
      scopeDigest: canonicalAppDigest({
        origin: storageOrigin,
        organizationId,
        projectKey: "main"
      }),
      inventoryFenceDigest: canonicalAppDigest({
        scopeDigest: canonicalAppDigest({
          origin: storageOrigin,
          organizationId,
          projectKey: "main"
        }),
        status: HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS
      }),
      inventoryPasses: 2,
      inventoryGeneration: 3,
      inventoryGenerationDigest: canonicalAppDigest({
        scopeDigest: canonicalAppDigest({
          origin: storageOrigin,
          organizationId,
          projectKey: "main"
        }),
        generation: 3
      }),
      registriesScanned: 4,
      detachedInstallations: 3,
      verifiedSnapshots: 3,
      missingSnapshots: 0,
      corruptSnapshots: 0,
      untrackedSnapshots: 0,
      unavailableSnapshots: 0,
      storageObjects: 3,
      referencedStorageObjects: 3,
      unreferencedSnapshots: 0,
      malformedStorageObjects: 0,
      unreferencedInventoryDigest,
      healthy: true,
      checks: [
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
      ].map((name) => ({ name, ok: true }))
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
      schemaVersion: "audit-drain/v8",
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
        { name: "marketplace", sequence: 42, hash: "6".repeat(64) },
        { name: "app_evidence_health", sequence: 44, hash: "7".repeat(64) },
        { name: "cli_sessions", sequence: 45, hash: "8".repeat(64) },
        { name: "cli_admin", sequence: 46, hash: "9".repeat(64) },
        { name: "marketplace_release_revocation", sequence: 47, hash: "a".repeat(64) },
        { name: "workload_issuer_rotation", sequence: 48, hash: "b".repeat(64) }
      ]
    }
  };
}

function exactlyOnceReceipt(checkedAt: string, sourceCommitSha = config.commitSha) {
  const base = {
    schemaVersion: "app-action-exactly-once-proof/v1" as const,
    sourceCommitSha,
    checkedAt,
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
      appCommitRequestedEvents: 1 as const,
      appTerminalEventsBeforeReconciliation: 0 as const,
      appTerminalEventsAfterReconciliation: 1 as const,
      reconciliationStatus: "resolved" as const,
      preparedActionStatus: "committed" as const,
      replayReturnedOriginalReceipt: true as const,
      originalBrokerReceiptDigest: `sha256:${"8".repeat(64)}`
    },
    outcome: "passed" as const
  };
  return { ...base, proofDigest: canonicalAppDigest(base) };
}
