import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APP_EVAL_SCHEMA_VERSION,
  APP_INSTALL_SCHEMA_VERSION,
  appEvalRunSchema,
  appReadinessSchema,
  canonicalAppDigest,
  workspaceAppInstallationSchema,
  type AppEvalRun
} from "../core";
import { assessAppOperationalMaturity, createAppIndependentVerificationReceipt } from "./app-operational-maturity";

const now = "2026-08-21T12:00:00.000Z";
const artifactDigest = canonicalAppDigest("operational-app");
const verifierKey = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const trustedVerifierKeys = [{
  verifierId: "loopgraph-verifier",
  keyId: "loopgraph.verifier.primary",
  algorithm: "ed25519" as const,
  publicKey: verifierKey.publicKey
}];
const installation = workspaceAppInstallationSchema.parse({
  schemaVersion: APP_INSTALL_SCHEMA_VERSION,
  id: "install.operational-app",
  workspaceId: "acme",
  appId: "acme.operations.app",
  version: "1.0.0",
  artifactDigest,
  state: "shadow",
  mode: "shadow",
  selectedModules: ["core"],
  presetId: "default",
  configuration: {
    schemaVersion: "loopgraph-app-configuration/v1alpha1",
    appId: "acme.operations.app",
    version: "1.0.0",
    fields: [],
    values: {},
    provenance: {},
    completedAt: now
  },
  connectionBindings: { "crm.account.read": "connection.crm" },
  fieldMappingIds: ["mapping.account"],
  permissions: [],
  ownedAssets: [],
  history: [],
  installedAt: now,
  updatedAt: now,
  installedBy: "operator"
});
const readiness = appReadinessSchema.parse({
  schemaVersion: APP_EVAL_SCHEMA_VERSION,
  installationId: installation.id,
  state: "ready_for_recommend",
  score: 100,
  maturity: "connected",
  checks: [
    { id: "connections", category: "connection", status: "pass", summary: "Required capabilities are bound.", evidenceRefs: ["connection.crm"] },
    { id: "mappings", category: "mapping", status: "pass", summary: "Mappings are confirmed.", evidenceRefs: ["mapping.account"] },
    { id: "configuration", category: "configuration", status: "pass", summary: "Configuration is complete.", evidenceRefs: [] },
    { id: "permissions", category: "permission", status: "pass", summary: "Permissions are explicit.", evidenceRefs: [] }
  ],
  evaluatedAt: now,
  evidenceDerived: true
});

describe("installed App operational maturity", () => {
  it("requires every evidence gate in order and never treats activity as proof", () => {
    const none = assessAppOperationalMaturity({ installation, readiness, evaluations: [], operatingEvidence: emptyEvidence(), now: new Date(now) });
    expect(none.maturity).toBe("concept");

    const synthetic = syntheticRun();
    const connected = assessAppOperationalMaturity({ installation, readiness, evaluations: [synthetic], operatingEvidence: emptyEvidence(), now: new Date(now) });
    expect(connected.maturity).toBe("connected");
    expect(connected.gates.map((gate) => gate.status)).toEqual(["achieved", "achieved", "blocked", "blocked"]);

    const replay = replayRun();
    const production = assessAppOperationalMaturity({
      installation,
      readiness,
      evaluations: [synthetic, replay],
      operatingEvidence: {
        completedRunRefs: ["run:completed-1"],
        observedOutcomeRefs: ["outcome:qualified-pipeline"],
        observedValueRefs: ["value:net-time-saved"]
      },
      now: new Date(now)
    });
    expect(production.maturity).toBe("production_proven");
    expect(production.gates[2]).toMatchObject({ status: "achieved", evidenceRefs: expect.arrayContaining([replay.id, "outcome:qualified-pipeline"]) });
    expect(production.gates[3]).toMatchObject({ status: "blocked" });
  });

  it("requires an independently digest-bound receipt for Loopgraph verified", () => {
    const receipt = createAppIndependentVerificationReceipt({
      installationId: installation.id,
      appId: installation.appId,
      artifactDigest,
      verifierId: "loopgraph-verifier",
      verifierType: "loopgraph",
      status: "passed",
      evidenceRefs: ["audit:verification-2026-08"],
      verifiedAt: now,
      keyId: "loopgraph.verifier.primary",
      privateKeyPem: verifierKey.privateKey
    });
    const assessment = assessAppOperationalMaturity({
      installation,
      readiness,
      evaluations: [syntheticRun(), replayRun()],
      operatingEvidence: {
        completedRunRefs: ["run:completed-1"],
        observedOutcomeRefs: ["outcome:qualified-pipeline"],
        observedValueRefs: ["value:net-time-saved"]
      },
      verificationReceipts: [receipt],
      trustedVerifierKeys,
      now: new Date(now)
    });
    expect(assessment.maturity).toBe("loopgraph_verified");
    expect(assessment.gates[3]).toMatchObject({ status: "achieved", evidenceRefs: expect.arrayContaining([receipt.id, receipt.verificationDigest]) });

    const wrongDigestReceipt = createAppIndependentVerificationReceipt({
      installationId: installation.id,
      appId: installation.appId,
      artifactDigest: canonicalAppDigest("another-app"),
      verifierId: "loopgraph-verifier",
      verifierType: "loopgraph",
      status: "passed",
      evidenceRefs: ["audit:verification-2026-08"],
      verifiedAt: now,
      keyId: "loopgraph.verifier.primary",
      privateKeyPem: verifierKey.privateKey
    });
    const withoutMatchingReceipt = assessAppOperationalMaturity({
      installation,
      readiness,
      evaluations: [syntheticRun(), replayRun()],
      operatingEvidence: {
        completedRunRefs: ["run:completed-1"],
        observedOutcomeRefs: ["outcome:qualified-pipeline"],
        observedValueRefs: ["value:net-time-saved"]
      },
      verificationReceipts: [wrongDigestReceipt],
      trustedVerifierKeys,
      now: new Date(now)
    });
    expect(withoutMatchingReceipt.maturity).toBe("production_proven");
  });
});

function syntheticRun(): AppEvalRun {
  return appEvalRunSchema.parse({
    schemaVersion: APP_EVAL_SCHEMA_VERSION,
    id: "eval.synthetic",
    installationId: installation.id,
    appId: installation.appId,
    appVersion: installation.version,
    artifactDigest,
    level: "synthetic",
    status: "passed",
    replay: false,
    writeBlocked: true,
    startedAt: now,
    completedAt: now,
    scenarios: Array.from({ length: 13 }, (_, index) => ({ id: `synthetic-${index + 1}`, status: "passed", evidenceRefs: [`fixture:${index + 1}`] })),
    metrics: { providerWrites: 0, total: 13, passed: 13 },
    evidenceRefs: ["eval-suite:conformance"]
  });
}

function replayRun(): AppEvalRun {
  return appEvalRunSchema.parse({
    schemaVersion: APP_EVAL_SCHEMA_VERSION,
    id: "eval.historical",
    installationId: installation.id,
    appId: installation.appId,
    appVersion: installation.version,
    artifactDigest,
    level: "historical_replay",
    status: "passed",
    replay: true,
    writeBlocked: true,
    startedAt: now,
    completedAt: now,
    scenarios: Array.from({ length: 5 }, (_, index) => ({ id: `historical-${index + 1}`, status: "passed", humanLabel: "correct", reviewMinutes: 1, evidenceRefs: [`historical-event:${index + 1}`] })),
    metrics: { providerWrites: 0, eventCount: 5, labeled: 5, correct: 5 },
    evidenceRefs: ["historical-window:bounded"]
  });
}

function emptyEvidence() {
  return { completedRunRefs: [], observedOutcomeRefs: [], observedValueRefs: [] };
}
