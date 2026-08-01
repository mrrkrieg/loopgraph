import { createHash } from "node:crypto";

const SENSITIVE_KEY = /(?:^|[_-])(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|payload|private[_-]?key|refresh[_-]?token|secret|signature|webhook[_-]?secret)(?:$|[_-])/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /([?&](?:access_token|api_key|client_secret|refresh_token|signature|token)=)[^&#\s]+/gi,
  /((?:access_token|api_key|authorization|client_secret|password|refresh_token|token|webhook_secret)\s*[:=]\s*)[^,}\]\s]+/gi
];

export const REDACTED_VALUE = "[REDACTED]";

export function redactSensitive<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED_VALUE as T;
  if (typeof value === "string") return redactSensitiveString(value) as T;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitive(item, depth + 1)) as T;
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED_VALUE : redactSensitive(child, depth + 1);
  }
  return output as T;
}

export function redactSensitiveString(value: string): string {
  let redacted = value.replace(/[\r\n\t]/g, " ");
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix: string | undefined) =>
      typeof prefix === "string" && match.startsWith(prefix)
        ? `${prefix}${REDACTED_VALUE}`
        : REDACTED_VALUE
    );
  }
  return redacted;
}

export function containsSecretMaterial(value: unknown): boolean {
  const serialized = safeSerialize(value);
  if (!serialized) return false;
  if (SECRET_VALUE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(serialized);
  })) return true;
  return hasSensitiveKey(value);
}

export function assertSecretFree(value: unknown, boundary: string): void {
  if (containsSecretMaterial(value)) {
    const fingerprint = createHash("sha256").update(safeSerialize(value)).digest("hex").slice(0, 12);
    throw new SecretBoundaryError(boundary, fingerprint);
  }
}

export class SecretBoundaryError extends Error {
  readonly code = "secret_boundary_violation";

  constructor(readonly boundary: string, readonly fingerprint: string) {
    super(`Secret-like material was blocked at ${boundary} (${fingerprint}).`);
    this.name = "SecretBoundaryError";
  }
}

function hasSensitiveKey(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => hasSensitiveKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    SENSITIVE_KEY.test(key) || hasSensitiveKey(child, depth + 1)
  );
}

function safeSerialize(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
}
