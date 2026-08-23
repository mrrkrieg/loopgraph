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
import {
  APP_ACTIVATION_PRODUCTION_EVIDENCE_MAX_AGE_SECONDS,
  APP_ACTIVATION_REPLAY_MAX_AGE_SECONDS,
  APP_OPERATIONAL_EVIDENCE_RENEWAL_LEAD_SECONDS,
  assessAppEvidenceFreshness,
  boundTimestampedAppEvidence,
  historicalReplayEvidenceTimestamp,
  type TimestampedAppEvidence
} from "./app-evidence-freshness";

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
    latestCompletedRun?: TimestampedAppEvidence;
    latestObservedOutcome?: TimestampedAppEvidence;
    latestObservedValue?: TimestampedAppEvidence;
  };
  verificationReceipts?: AppIndependentVerificationReceipt[];
  trustedVerifierKeys?: AppVerifierTrustKey[];
  now?: Date;
}): AppOperationalMaturityAssessment {
  const evaluatedAt = input.now ?? new Date();
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
  const replayObservedAt = replay ? historicalReplayEvidenceTimestamp(replay) : undefined;
  const freshnessRequirements = [
    {
      id: "historical_replay" as const,
      label: "historical replay",
      evidence: replay && replayObservedAt ? { reference: replay.id, observedAt: replayObservedAt } : undefined,
      maxAgeSeconds: APP_ACTIVATION_REPLAY_MAX_AGE_SECONDS
    },
    {
      id: "completed_run" as const,
      label: "completed App run",
      evidence: boundTimestampedAppEvidence(
        input.operatingEvidence.latestCompletedRun,
        input.operatingEvidence.completedRunRefs
      ),
      maxAgeSeconds: APP_ACTIVATION_PRODUCTION_EVIDENCE_MAX_AGE_SECONDS
    },
    {
      id: "observed_outcome" as const,
      label: "observed outcome",
      evidence: boundTimestampedAppEvidence(
        input.operatingEvidence.latestObservedOutcome,
        input.operatingEvidence.observedOutcomeRefs
      ),
      maxAgeSeconds: APP_ACTIVATION_PRODUCTION_EVIDENCE_MAX_AGE_SECONDS
    },
    {
      id: "observed_value" as const,
      label: "observed value",
      evidence: boundTimestampedAppEvidence(
        input.operatingEvidence.latestObservedValue,
        input.operatingEvidence.observedValueRefs
      ),
      maxAgeSeconds: APP_ACTIVATION_PRODUCTION_EVIDENCE_MAX_AGE_SECONDS
    }
  ];
  const freshnessResults = freshnessRequirements.map((requirement) =>
    assessAppEvidenceFreshness(requirement, evaluatedAt));
  const freshnessFailures = freshnessResults
    .filter((result) => !["current", "renew_soon"].includes(result.status))
    .map((result) => result.summary);
  const productionEvidenceFresh = freshnessFailures.length === 0;
  const productionProofComplete = connected &&
    replay?.status === "passed" &&
    replay.writeBlocked &&
    replayProviderWrites === 0 &&
    replay.scenarios.length >= MIN_REVIEWED_HISTORICAL_EVENTS &&
    reviewed.length === replay.scenarios.length &&
    routingAccuracy >= MIN_ROUTING_ACCURACY &&
    input.operatingEvidence.completedRunRefs.length > 0 &&
    input.operatingEvidence.observedOutcomeRefs.length > 0 &&
    input.operatingEvidence.observedValueRefs.length > 0;
  const productionProven = productionProofComplete && productionEvidenceFresh;
  const freshness = operationalEvidenceFreshnessSummary({
    results: freshnessResults,
    productionProofComplete: Boolean(productionProofComplete),
    hasAnyEvidence: Boolean(replay) ||
      input.operatingEvidence.completedRunRefs.length > 0 ||
      input.operatingEvidence.observedOutcomeRefs.length > 0 ||
      input.operatingEvidence.observedValueRefs.length > 0
  });

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
        : productionProofComplete && freshnessFailures.length > 0
          ? `Production proof expired because ${freshnessFailures.join("; ")}.`
          : "Production proof requires reviewed historical behavior, completed work, and observed outcome plus net-value evidence.",
      evidenceRefs: productionProven
        ? [replay!.id, ...input.operatingEvidence.completedRunRefs, ...input.operatingEvidence.observedOutcomeRefs, ...input.operatingEvidence.observedValueRefs]
        : [],
      ...(!productionProven ? {
        remediation: productionProofComplete
          ? "Run a fresh reviewed replay and record recent completed work, observed outcomes, and observed net value."
          : `Review at least ${MIN_REVIEWED_HISTORICAL_EVENTS} historical decisions at 95%+ accuracy, then record completed runs, observed outcomes, and observed value.`
      } : {})
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
    freshness,
    evaluatedAt: evaluatedAt.toISOString(),
    evidenceDerived: true
  });
}

function operationalEvidenceFreshnessSummary(input: {
  results: ReturnType<typeof assessAppEvidenceFreshness>[];
  productionProofComplete: boolean;
  hasAnyEvidence: boolean;
}): AppOperationalMaturityAssessment["freshness"] {
  const expiryTimes = input.results.flatMap((result) =>
    result.expiresAt ? [Date.parse(result.expiresAt)] : []);
  const allExpiriesKnown = expiryTimes.length === input.results.length;
  const validUntilMs = allExpiriesKnown ? Math.min(...expiryTimes) : undefined;
  const validUntil = validUntilMs === undefined ? undefined : new Date(validUntilMs).toISOString();
  const renewalRecommendedAt = validUntilMs === undefined
    ? undefined
    : new Date(validUntilMs - APP_OPERATIONAL_EVIDENCE_RENEWAL_LEAD_SECONDS * 1_000).toISOString();
  const invalid = input.results.some((result) => ["missing", "invalid", "future"].includes(result.status));
  const expired = input.results.some((result) => result.status === "expired");
  const renewSoon = input.results.some((result) => result.status === "renew_soon");
  const status: AppOperationalMaturityAssessment["freshness"]["status"] = !input.hasAnyEvidence
    ? "not_applicable"
    : !input.productionProofComplete
      ? "incomplete"
      : invalid
        ? "invalid"
        : expired
          ? "expired"
          : renewSoon
            ? "renew_soon"
            : "current";
  const summary = status === "not_applicable"
    ? "Production evidence has not been recorded yet."
    : status === "incomplete"
      ? "Production evidence exists but the complete reviewed proof set has not been established."
      : status === "invalid"
        ? "Production proof contains missing, invalid, unbound, or future-dated evidence."
        : status === "expired"
          ? `Production proof expired${validUntil ? ` at ${validUntil}` : ""}.`
          : status === "renew_soon"
            ? `Production proof is current but should be renewed before ${validUntil}.`
            : `Production proof is current through ${validUntil}.`;
  return {
    status,
    summary,
    ...(validUntil ? { validUntil } : {}),
    ...(renewalRecommendedAt ? { renewalRecommendedAt } : {}),
    requirements: input.results
  };
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
