import type { AppEvalRun } from "../core";

export const APP_ACTIVATION_REPLAY_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const APP_ACTIVATION_PRODUCTION_EVIDENCE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const APP_ACTIVATION_EVIDENCE_FUTURE_SKEW_SECONDS = 5 * 60;
export const APP_OPERATIONAL_EVIDENCE_RENEWAL_LEAD_SECONDS = 7 * 24 * 60 * 60;

export type TimestampedAppEvidence = {
  reference: string;
  observedAt: string;
};

export type AppEvidenceFreshnessRequirement = {
  id: "historical_replay" | "completed_run" | "observed_outcome" | "observed_value";
  label: string;
  evidence?: TimestampedAppEvidence;
  maxAgeSeconds: number;
};

export type AppEvidenceFreshnessResult = {
  id: AppEvidenceFreshnessRequirement["id"];
  status: "current" | "renew_soon" | "expired" | "missing" | "invalid" | "future";
  summary: string;
  evidenceRef?: string;
  observedAt?: string;
  expiresAt?: string;
};

export function boundTimestampedAppEvidence(
  evidence: TimestampedAppEvidence | undefined,
  references: string[]
): TimestampedAppEvidence | undefined {
  return evidence && references.includes(evidence.reference) ? evidence : undefined;
}

export function appEvidenceFreshnessFailure(
  requirement: Omit<AppEvidenceFreshnessRequirement, "id">,
  now: Date
): string[] {
  const result = assessAppEvidenceFreshness({ id: "historical_replay", ...requirement }, now);
  return ["current", "renew_soon"].includes(result.status) ? [] : [result.summary];
}

export function assessAppEvidenceFreshness(
  requirement: AppEvidenceFreshnessRequirement,
  now: Date
): AppEvidenceFreshnessResult {
  if (!requirement.evidence) {
    return { id: requirement.id, status: "missing", summary: `${requirement.label} is missing` };
  }
  const observedAtMs = Date.parse(requirement.evidence.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return {
      id: requirement.id,
      status: "invalid",
      summary: `${requirement.label} has an invalid timestamp`,
      evidenceRef: requirement.evidence.reference
    };
  }
  const observedAt = new Date(observedAtMs).toISOString();
  const expiresAtMs = observedAtMs + requirement.maxAgeSeconds * 1_000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const base = {
    id: requirement.id,
    evidenceRef: requirement.evidence.reference,
    observedAt,
    expiresAt
  };
  if (observedAtMs > now.getTime() + APP_ACTIVATION_EVIDENCE_FUTURE_SKEW_SECONDS * 1_000) {
    return { ...base, status: "future", summary: `${requirement.label} is dated too far in the future` };
  }
  if (now.getTime() > expiresAtMs) {
    return {
      ...base,
      status: "expired",
      summary: `${requirement.label} is older than ${requirement.maxAgeSeconds / (24 * 60 * 60)} days`
    };
  }
  if (now.getTime() >= expiresAtMs - APP_OPERATIONAL_EVIDENCE_RENEWAL_LEAD_SECONDS * 1_000) {
    return { ...base, status: "renew_soon", summary: `${requirement.label} should be renewed before ${expiresAt}` };
  }
  return { ...base, status: "current", summary: `${requirement.label} is current through ${expiresAt}` };
}

export function historicalReplayEvidenceTimestamp(replay: AppEvalRun): string | undefined {
  if (replay.sourceWindow?.to) return replay.sourceWindow.to;
  const windowRef = replay.evidenceRefs.find((reference) => reference.startsWith("historical-window:"));
  if (!windowRef) return undefined;
  const separator = windowRef.indexOf("/", "historical-window:".length);
  if (separator < 0) return undefined;
  const to = windowRef.slice(separator + 1);
  return Number.isFinite(Date.parse(to)) ? new Date(to).toISOString() : undefined;
}
