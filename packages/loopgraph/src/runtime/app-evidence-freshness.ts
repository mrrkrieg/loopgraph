import type { AppEvalRun } from "../core";

export const APP_ACTIVATION_REPLAY_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const APP_ACTIVATION_PRODUCTION_EVIDENCE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const APP_ACTIVATION_EVIDENCE_FUTURE_SKEW_SECONDS = 5 * 60;

export type TimestampedAppEvidence = {
  reference: string;
  observedAt: string;
};

export function boundTimestampedAppEvidence(
  evidence: TimestampedAppEvidence | undefined,
  references: string[]
): TimestampedAppEvidence | undefined {
  return evidence && references.includes(evidence.reference) ? evidence : undefined;
}

export function appEvidenceFreshnessFailure(
  requirement: {
    label: string;
    evidence?: TimestampedAppEvidence;
    maxAgeSeconds: number;
  },
  now: Date
): string[] {
  if (!requirement.evidence) return [`${requirement.label} is missing`];
  const observedAt = Date.parse(requirement.evidence.observedAt);
  const futureSkewMs = APP_ACTIVATION_EVIDENCE_FUTURE_SKEW_SECONDS * 1_000;
  if (!Number.isFinite(observedAt)) return [`${requirement.label} has an invalid timestamp`];
  if (observedAt > now.getTime() + futureSkewMs) return [`${requirement.label} is dated too far in the future`];
  if (now.getTime() - observedAt > requirement.maxAgeSeconds * 1_000) {
    return [`${requirement.label} is older than ${requirement.maxAgeSeconds / (24 * 60 * 60)} days`];
  }
  return [];
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
