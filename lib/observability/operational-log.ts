type OperationalLogLevel = "info" | "warn" | "error";

export type OperationalLogInput = {
  level: OperationalLogLevel;
  event: string;
  outcome: "accepted" | "denied" | "error" | "observed";
  capability?: string;
  credentialId?: string;
  organizationId?: string;
  projectKey?: string;
  requestId?: string;
  correlationId?: string;
  reason?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY = /authorization|cookie|credential|password|payload|secret|signature|token/i;
const LOG_EVENT_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,127}$/;

export function emitOperationalLog(input: OperationalLogInput): void {
  const record = {
    timestamp: new Date().toISOString(),
    service: "loopgraph",
    level: input.level,
    event: LOG_EVENT_PATTERN.test(input.event) ? input.event : "operational.invalid_event",
    outcome: input.outcome,
    ...(input.capability ? { capability: bounded(input.capability) } : {}),
    ...(input.credentialId ? { credentialId: bounded(input.credentialId) } : {}),
    ...(input.organizationId ? { organizationId: bounded(input.organizationId) } : {}),
    ...(input.projectKey ? { projectKey: bounded(input.projectKey) } : {}),
    ...(input.requestId ? { requestId: bounded(input.requestId) } : {}),
    ...(input.correlationId ? { correlationId: bounded(input.correlationId) } : {}),
    ...(input.reason ? { reason: bounded(input.reason) } : {}),
    ...(Number.isFinite(input.durationMs)
      ? { durationMs: Math.max(0, Math.round(input.durationMs ?? 0)) }
      : {}),
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {})
  };
  const line = JSON.stringify(record);
  if (input.level === "error") {
    console.error(line);
  } else if (input.level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export function sanitizeMetadata(
  metadata: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)
    .filter(([candidate]) => !SENSITIVE_KEY.test(candidate))
    .slice(0, 32)) {
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      result[bounded(key, 64)] = value;
    } else if (typeof value === "string") {
      result[bounded(key, 64)] = bounded(value);
    }
  }
  return result;
}

function bounded(value: string, length = 256): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, length);
}
