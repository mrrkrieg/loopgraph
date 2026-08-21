import { createPrivateKey, createPublicKey, sign as signDigest, verify as verifyDigest } from "node:crypto";
import {
  APP_INDEPENDENT_VERIFICATION_SCHEMA_VERSION,
  APP_OPERATIONAL_MATURITY_SCHEMA_VERSION,
  appIndependentVerificationReceiptSchema,
  appOperationalMaturityAssessmentSchema,
  appVerifierTrustKeySchema,
  canonicalAppDigest,
  contentHash,
  type AppEvalRun,
  type AppIndependentVerificationReceipt,
  type AppOperationalMaturityAssessment,
  type AppReadiness,
  type AppVerifierTrustKey,
  type WorkspaceAppInstallation
} from "../core";

const MIN_REVIEWED_HISTORICAL_EVENTS = 5;
const MIN_ROUTING_ACCURACY = 0.95;

export function assessAppOperationalMaturity(input: {
  installation: WorkspaceAppInstallation;
  readiness: AppReadiness;
  evaluations: AppEvalRun[];
  operatingEvidence: {
    completedRunRefs: string[];
    observedOutcomeRefs: string[];
    observedValueRefs: string[];
  };
  verificationReceipts?: AppIndependentVerificationReceipt[];
  trustedVerifierKeys?: AppVerifierTrustKey[];
  now?: Date;
}): AppOperationalMaturityAssessment {
  const exactEvaluations = input.evaluations.filter((evaluation) =>
    evaluation.installationId === input.installation.id &&
    evaluation.artifactDigest === input.installation.artifactDigest);
  const synthetic = [...exactEvaluations].reverse().find((evaluation) => evaluation.level === "synthetic");
  const syntheticProviderWrites = numberMetric(synthetic, "providerWrites");
  const tested = Boolean(
    synthetic?.status === "passed" &&
    synthetic.writeBlocked &&
    syntheticProviderWrites === 0 &&
    synthetic.scenarios.length >= 13 &&
    synthetic.scenarios.every((scenario) => scenario.status === "passed")
  );

  const connectionChecks = input.readiness.checks.filter((check) => check.category === "connection");
  const supportingChecks = input.readiness.checks.filter((check) => ["mapping", "configuration", "permission"].includes(check.category));
  const connected = tested &&
    Object.keys(input.installation.operationBindings).length > 0 &&
    connectionChecks.length > 0 &&
    connectionChecks.every((check) => check.status === "pass") &&
    supportingChecks.every((check) => !["fail", "warn"].includes(check.status));

  const replay = [...exactEvaluations].reverse().find((evaluation) => evaluation.level === "historical_replay");
  const reviewed = replay?.scenarios.filter((scenario) => scenario.humanLabel) ?? [];
  const correct = reviewed.filter((scenario) => scenario.humanLabel === "correct").length;
  const routingAccuracy = reviewed.length > 0 ? correct / reviewed.length : 0;
  const replayProviderWrites = numberMetric(replay, "providerWrites");
  const productionProven = connected &&
    replay?.status === "passed" &&
    replay.writeBlocked &&
    replayProviderWrites === 0 &&
    replay.scenarios.length >= MIN_REVIEWED_HISTORICAL_EVENTS &&
    reviewed.length === replay.scenarios.length &&
    routingAccuracy >= MIN_ROUTING_ACCURACY &&
    input.operatingEvidence.completedRunRefs.length > 0 &&
    input.operatingEvidence.observedOutcomeRefs.length > 0 &&
    input.operatingEvidence.observedValueRefs.length > 0;

  const trustedKeys = (input.trustedVerifierKeys ?? []).map((key) => appVerifierTrustKeySchema.parse(key));
  const verification = (input.verificationReceipts ?? [])
    .map((receipt) => appIndependentVerificationReceiptSchema.parse(receipt))
    .find((receipt) => {
      if (
        receipt.installationId !== input.installation.id ||
        receipt.appId !== input.installation.appId ||
        receipt.artifactDigest !== input.installation.artifactDigest ||
        receipt.status !== "passed"
      ) return false;
      const key = trustedKeys.find((candidate) =>
        !candidate.revokedAt &&
        candidate.verifierId === receipt.verifierId &&
        candidate.keyId === receipt.signature.keyId &&
        candidate.algorithm === receipt.signature.algorithm);
      return key ? verifyAppIndependentVerificationReceipt(receipt, key) : false;
    });
  const verified = productionProven && Boolean(verification);
  const gates: AppOperationalMaturityAssessment["gates"] = [
    {
      level: "tested",
      status: tested ? "achieved" : "blocked",
      summary: tested
        ? `${synthetic!.scenarios.length} digest-bound synthetic routing and safety scenarios passed with zero provider writes.`
        : "A complete passing synthetic conformance run for this exact artifact digest is required.",
      evidenceRefs: synthetic ? [synthetic.id, input.installation.artifactDigest] : [],
      ...(!tested ? { remediation: "Run the write-blocked conformance suite and resolve every failed or missing safety category." } : {})
    },
    {
      level: "connected",
      status: connected ? "achieved" : "blocked",
      summary: connected
        ? `${Object.keys(input.installation.operationBindings).length} executable capability bindings and their setup checks are ready.`
        : "Every required capability must resolve to an exact executable operation, and every mapping, configuration value, and permission decision must be ready after testing passes.",
      evidenceRefs: connected
        ? [
            ...Object.values(input.installation.operationBindings).map((binding) => `${binding.providerId}:${binding.operation}`),
            ...connectionChecks.flatMap((check) => check.evidenceRefs)
          ]
        : [],
      ...(!connected ? { remediation: "Re-plan unsupported operations, then resolve all required connection, mapping, configuration, and permission readiness checks." } : {})
    },
    {
      level: "production_proven",
      status: productionProven ? "achieved" : "blocked",
      summary: productionProven
        ? `${reviewed.length} historical decisions were reviewed at ${(routingAccuracy * 100).toFixed(1)}% accuracy and observed outcome/value evidence was recorded.`
        : "Production proof requires reviewed historical behavior, completed work, and observed outcome plus net-value evidence.",
      evidenceRefs: productionProven
        ? [replay!.id, ...input.operatingEvidence.completedRunRefs, ...input.operatingEvidence.observedOutcomeRefs, ...input.operatingEvidence.observedValueRefs]
        : [],
      ...(!productionProven ? { remediation: `Review at least ${MIN_REVIEWED_HISTORICAL_EVENTS} historical decisions at 95%+ accuracy, then record completed runs, observed outcomes, and observed value.` } : {})
    },
    {
      level: "loopgraph_verified",
      status: verified ? "achieved" : "blocked",
      summary: verified
        ? `Independent verification ${verification!.id} passed for this exact installation and artifact digest.`
        : "No passing independent verification receipt is recorded for the production-proven installation.",
      evidenceRefs: verification ? [verification.id, verification.verificationDigest, ...verification.evidenceRefs] : [],
      ...(!verified ? { remediation: "Complete independent verification after production proof; catalog signatures and publisher tests do not satisfy this gate." } : {})
    }
  ];
  const maturity = verified
    ? "loopgraph_verified"
    : productionProven
      ? "production_proven"
      : connected
        ? "connected"
        : tested
          ? "tested"
          : "concept";
  return appOperationalMaturityAssessmentSchema.parse({
    schemaVersion: APP_OPERATIONAL_MATURITY_SCHEMA_VERSION,
    installationId: input.installation.id,
    appId: input.installation.appId,
    artifactDigest: input.installation.artifactDigest,
    maturity,
    gates,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    evidenceDerived: true
  });
}

export function verifyAppIndependentVerificationReceipt(
  receiptInput: AppIndependentVerificationReceipt,
  keyInput: AppVerifierTrustKey
): boolean {
  const receipt = appIndependentVerificationReceiptSchema.parse(receiptInput);
  const key = appVerifierTrustKeySchema.parse(keyInput);
  if (
    key.revokedAt ||
    key.verifierId !== receipt.verifierId ||
    key.keyId !== receipt.signature.keyId ||
    key.algorithm !== receipt.signature.algorithm
  ) return false;
  try {
    return verifyDigest(
      null,
      Buffer.from(receipt.verificationDigest, "utf8"),
      createPublicKey(key.publicKey),
      Buffer.from(receipt.signature.value, "base64url")
    );
  } catch {
    return false;
  }
}

export function validateAppVerifierPublicKey(keyInput: AppVerifierTrustKey): boolean {
  const key = appVerifierTrustKeySchema.parse(keyInput);
  try {
    return createPublicKey(key.publicKey).asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

export function createAppIndependentVerificationReceipt(input: {
  installationId: string;
  appId: string;
  artifactDigest: string;
  verifierId: string;
  verifierType: "loopgraph" | "accredited_third_party";
  status: "passed" | "failed";
  evidenceRefs: string[];
  verifiedAt: string;
  keyId: string;
  privateKeyPem: string;
}): AppIndependentVerificationReceipt {
  const verifiedContent = {
    installationId: input.installationId,
    appId: input.appId,
    artifactDigest: input.artifactDigest,
    verifierId: input.verifierId,
    verifierType: input.verifierType,
    status: input.status,
    evidenceRefs: input.evidenceRefs,
    verifiedAt: input.verifiedAt
  };
  const content = {
    schemaVersion: APP_INDEPENDENT_VERIFICATION_SCHEMA_VERSION,
    id: `app-verification.${contentHash(verifiedContent)}`,
    ...verifiedContent
  };
  const verificationDigest = canonicalAppDigest({ ...content, verificationDigest: undefined, signature: undefined });
  return appIndependentVerificationReceiptSchema.parse({
    ...content,
    verificationDigest,
    signature: {
      algorithm: "ed25519",
      keyId: input.keyId,
      value: signDigest(null, Buffer.from(verificationDigest, "utf8"), createPrivateKey(input.privateKeyPem)).toString("base64url")
    }
  });
}

function numberMetric(evaluation: AppEvalRun | undefined, key: string): number | undefined {
  const value = evaluation?.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
