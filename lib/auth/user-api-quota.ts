export type UserApiQuotaClass = "read" | "write" | "compute" | "admin";

export type UserApiQuotaPolicy = {
  bucket: UserApiQuotaClass;
};

export type UserApiQuotaDecision = {
  allowed: boolean;
  reason: string;
  remaining: number;
  limit: number;
  retryAfterSeconds?: number;
  resetAt: string;
};

const ADMIN_ROUTE_PREFIXES = [
  "/api/audit/export",
  "/api/auth/cli-sessions",
  "/api/integrations",
  "/api/marketplace"
] as const;

export function resolveUserApiQuotaPolicy(
  pathname: string,
  method: string
): UserApiQuotaPolicy | undefined {
  if (!pathname.startsWith("/api/") || method.toUpperCase() === "OPTIONS") return undefined;
  return { bucket: classifyUserApiQuota(pathname, method) };
}

export function classifyUserApiQuota(
  pathname: string,
  method: string
): UserApiQuotaClass {
  if (ADMIN_ROUTE_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  )) {
    return "admin";
  }
  if (isUnsafeMethod(method) && isComputeRoute(pathname)) return "compute";
  return isUnsafeMethod(method) ? "write" : "read";
}

export function parseUserApiQuotaDecision(value: unknown): UserApiQuotaDecision | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return undefined;
  const row = candidate as Record<string, unknown>;
  if (
    typeof row.allowed !== "boolean" ||
    typeof row.reason !== "string" ||
    !isNonNegativeInteger(row.remaining) ||
    !isPositiveInteger(row.quota_limit) ||
    typeof row.reset_at !== "string" ||
    !Number.isFinite(Date.parse(row.reset_at))
  ) {
    return undefined;
  }
  const retryAfterSeconds = row.retry_after_seconds;
  if (
    retryAfterSeconds !== null &&
    retryAfterSeconds !== undefined &&
    !isPositiveInteger(retryAfterSeconds)
  ) {
    return undefined;
  }
  return {
    allowed: row.allowed,
    reason: row.reason,
    remaining: row.remaining,
    limit: row.quota_limit,
    ...(typeof retryAfterSeconds === "number" ? { retryAfterSeconds } : {}),
    resetAt: row.reset_at
  };
}

export function quotaResponseHeaders(decision: UserApiQuotaDecision): Record<string, string> {
  return {
    "cache-control": "no-store",
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(Math.ceil(Date.parse(decision.resetAt) / 1000)),
    ...(decision.retryAfterSeconds
      ? { "retry-after": String(decision.retryAfterSeconds) }
      : {})
  };
}

function isComputeRoute(pathname: string): boolean {
  return pathname === "/api/daily-summary/generate" ||
    pathname === "/api/opportunities" ||
    pathname === "/api/hermes/design-tasks" ||
    /^\/api\/loops\/[^/]+\/run$/.test(pathname) ||
    /^\/api\/discovery\/session\/[^/]+\/(?:access-plan|build-process-inventory|infer-departments|materialize|metric-plan|recommend)$/.test(pathname);
}

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
