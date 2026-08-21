import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  readProjectedWorkloadTokenFile,
  validateProjectedWorkloadToken
} from "./projected-workload-token";
import {
  readBoundedResponseJson,
  readBoundedResponseText
} from "./bounded-response";
import {
  createSupabaseSessionCookieHeader,
  readProjectedSupabaseSessionFile
} from "./projected-supabase-session";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type StagingDeploymentReceipt = {
  schemaVersion: "staging-validation/v4";
  targetOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  auditCheckpoint: {
    headSequence: number;
    headHash: string;
  };
  results: Array<{
    name:
      | "readiness"
      | "operational_metrics"
      | "audit_integrity"
      | "unauthenticated_user_denial"
      | "cross_tenant_user_denial"
      | "suspended_user_denial"
      | "user_api_quota_saturation";
    status: number;
    ok: true;
    detail: string;
  }>;
  quotaEvidence: {
    bucket: "admin";
    limit: number;
    allowedRequests: number;
    deniedStatus: 429;
    retryAfterSeconds: number;
  };
};

export async function validateStagingDeployment(
  config: {
    baseUrl: string;
    organizationId: string;
    projectKey: string;
    observabilityToken: string;
    userCookies: {
      allowed: string;
      foreignTenant: string;
      suspended: string;
    };
    expectedUserApiQuotaLimit: number;
    maximumQuotaWaitSeconds?: number;
  },
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
    nowMs?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<StagingDeploymentReceipt> {
  const baseUrl = trustedStagingOrigin(config.baseUrl);
  if (!UUID_PATTERN.test(config.organizationId)) throw new Error("Staging organization ID is invalid");
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) throw new Error("Staging project key is invalid");
  validateProjectedWorkloadToken(config.observabilityToken, "Staging observability token");
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? (() => randomUUID());
  const nowMs = dependencies.nowMs ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const quotaLimit = boundedInteger(
    config.expectedUserApiQuotaLimit,
    1,
    10,
    "Staging user API quota limit"
  );
  const maximumQuotaWaitSeconds = boundedInteger(
    config.maximumQuotaWaitSeconds ?? 5,
    1,
    30,
    "Maximum staging quota wait"
  );
  for (const [label, cookie] of Object.entries(config.userCookies)) {
    validateCookieHeader(cookie, `${label} staging user session`);
  }

  const readinessResponse = await fetcher(
    new URL("api/health/ready", ensureTrailingSlash(baseUrl)),
    { redirect: "error", signal: AbortSignal.timeout(15_000) }
  );
  requireStatus(readinessResponse, "Staging readiness");
  const readiness = await readBoundedResponseJson(
    readinessResponse,
    1024 * 1024,
    "Staging readiness"
  );
  if (!isRecord(readiness) || readiness.status !== "ready") {
    throw new Error("Staging readiness response did not report ready");
  }

  const metricsResponse = await authenticatedGet({
    baseUrl,
    path: "api/operations/metrics",
    token: config.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `staging_metrics_${requestId()}`,
    timestamp: now().toISOString(),
    fetcher
  });
  requireStatus(metricsResponse, "Staging operational metrics");
  const metrics = await readBoundedResponseText(
    metricsResponse,
    4 * 1024 * 1024,
    "Staging operational metrics"
  );
  for (const requiredMetric of [
    "loopgraph_ready 1",
    "loopgraph_security_audit_head_sequence",
    "loopgraph_operational_degraded 0",
    "loopgraph_app_lifecycle_recovery_pending 0",
    "loopgraph_app_lifecycle_recovery_stale 0",
    "loopgraph_app_lifecycle_recovery_oldest_age_seconds"
  ]) {
    if (!metrics.includes(requiredMetric)) {
      throw new Error(`Staging operational metrics omitted ${requiredMetric}`);
    }
  }

  const auditResponse = await authenticatedGet({
    baseUrl,
    path: "api/operations/audit-export?limit=1",
    token: config.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `staging_audit_${requestId()}`,
    timestamp: now().toISOString(),
    fetcher
  });
  requireStatus(auditResponse, "Staging audit integrity");
  const audit = await readBoundedResponseJson(
    auditResponse,
    4 * 1024 * 1024,
    "Staging audit export"
  );
  if (!isRecord(audit) || !isRecord(audit.integrity) || audit.integrity.valid !== true) {
    throw new Error("Staging audit chain did not return integrity.valid=true");
  }
  const headSequence = Number(audit.integrity.headSequence);
  const headHash = audit.integrity.headHash;
  if (!Number.isSafeInteger(headSequence) || headSequence < 0 ||
      typeof headHash !== "string" || !/^[a-f0-9]{64}$/.test(headHash)) {
    throw new Error("Staging audit chain returned an invalid checkpoint identity");
  }

  const userBoundary = await validateHostedUserBoundary({
    baseUrl,
    fetcher,
    cookies: config.userCookies,
    expectedQuotaLimit: quotaLimit,
    maximumQuotaWaitSeconds,
    nowMs,
    sleep
  });

  return {
    schemaVersion: "staging-validation/v4",
    targetOrigin: baseUrl.origin,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    checkedAt: now().toISOString(),
    auditCheckpoint: { headSequence, headHash },
    results: [
      {
        name: "readiness",
        status: readinessResponse.status,
        ok: true,
        detail: "Hosted configuration, database, audit RPC, and runtime namespace are ready."
      },
      {
        name: "operational_metrics",
        status: metricsResponse.status,
        ok: true,
        detail: "Protected metrics report deployment readiness and an audit-chain head."
      },
      {
        name: "audit_integrity",
        status: auditResponse.status,
        ok: true,
        detail: "The tenant audit chain verifies without exporting event bodies into the receipt."
      },
      ...userBoundary.results
    ],
    quotaEvidence: userBoundary.quotaEvidence
  };
}

async function validateHostedUserBoundary(input: {
  baseUrl: URL;
  fetcher: typeof fetch;
  cookies: {
    allowed: string;
    foreignTenant: string;
    suspended: string;
  };
  expectedQuotaLimit: number;
  maximumQuotaWaitSeconds: number;
  nowMs: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}) {
  const unauthenticated = await userApiGet(input, undefined);
  await discardBoundedUserResponse(unauthenticated, "Unauthenticated user API denial");
  requireExactStatus(unauthenticated, 401, "Unauthenticated user API denial");

  const foreign = await userApiGet(input, input.cookies.foreignTenant);
  await discardBoundedUserResponse(foreign, "Cross-tenant user API denial");
  requireExactStatus(foreign, 403, "Cross-tenant user API denial");

  const suspended = await userApiGet(input, input.cookies.suspended);
  await discardBoundedUserResponse(suspended, "Suspended-user API denial");
  requireExactStatus(suspended, 403, "Suspended-user API denial");

  const quotaReset = await freshQuotaWindowStart(input);
  for (let expectedRemaining = input.expectedQuotaLimit - 2; expectedRemaining >= 0; expectedRemaining -= 1) {
    const response = await userApiGet(input, input.cookies.allowed);
    requireStatus(response, "Allowed staging user API quota request");
    requireQuotaHeaders(response, input.expectedQuotaLimit, expectedRemaining, quotaReset);
    await discardBoundedUserResponse(response, "Allowed staging user API quota request");
  }
  const limited = await userApiGet(input, input.cookies.allowed);
  requireExactStatus(limited, 429, "Staging user API quota saturation");
  requireQuotaHeaders(limited, input.expectedQuotaLimit, 0, quotaReset);
  const retryAfterSeconds = responsePositiveInteger(limited, "retry-after");
  if (retryAfterSeconds > input.maximumQuotaWaitSeconds) {
    throw new Error("Staging user API quota returned an unexpectedly long retry window");
  }
  await discardBoundedUserResponse(limited, "Staging user API quota saturation");

  return {
    results: [
      {
        name: "unauthenticated_user_denial" as const,
        status: unauthenticated.status,
        ok: true as const,
        detail: "A request without a browser session was denied before the user API handler."
      },
      {
        name: "cross_tenant_user_denial" as const,
        status: foreign.status,
        ok: true as const,
        detail: "A valid user from another tenant could not enter the deployment organization."
      },
      {
        name: "suspended_user_denial" as const,
        status: suspended.status,
        ok: true as const,
        detail: "A valid user with suspended membership could not enter the organization."
      },
      {
        name: "user_api_quota_saturation" as const,
        status: limited.status,
        ok: true as const,
        detail: "One allowed session consumed its database-owned admin bucket and received a bounded 429."
      }
    ],
    quotaEvidence: {
      bucket: "admin" as const,
      limit: input.expectedQuotaLimit,
      allowedRequests: input.expectedQuotaLimit,
      deniedStatus: 429 as const,
      retryAfterSeconds
    }
  };
}

async function freshQuotaWindowStart(input: Parameters<typeof validateHostedUserBoundary>[0]) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await userApiGet(input, input.cookies.allowed);
    const limit = optionalResponseInteger(response, "x-ratelimit-limit");
    const remaining = optionalResponseInteger(response, "x-ratelimit-remaining");
    const reset = optionalResponseInteger(response, "x-ratelimit-reset");
    if (
      response.ok &&
      limit === input.expectedQuotaLimit &&
      remaining === input.expectedQuotaLimit - 1 &&
      reset !== undefined &&
      reset > 0
    ) {
      await discardBoundedUserResponse(response, "Allowed staging user API quota request");
      return reset;
    }
    const waitSeconds = response.status === 429
      ? optionalResponseInteger(response, "retry-after")
      : secondsUntilReset(response, input.nowMs());
    await discardBoundedUserResponse(response, "Staging user API quota window synchronization");
    if (!waitSeconds || waitSeconds > input.maximumQuotaWaitSeconds || attempt > 0) {
      throw new Error("Staging user API quota did not start a fresh bounded window");
    }
    await input.sleep(waitSeconds * 1000 + 100);
  }
  throw new Error("Staging user API quota did not start a fresh bounded window");
}

function userApiGet(
  input: Pick<Parameters<typeof validateHostedUserBoundary>[0], "baseUrl" | "fetcher">,
  cookie: string | undefined
) {
  return input.fetcher(new URL("api/integrations", ensureTrailingSlash(input.baseUrl)), {
    headers: {
      accept: "application/json",
      ...(cookie ? { cookie } : {})
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
}

async function discardBoundedUserResponse(response: Response, label: string) {
  await readBoundedResponseText(response, 4 * 1024 * 1024, label);
}

function requireExactStatus(response: Response, expected: number, label: string) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}; expected ${expected}`);
  }
}

function requireQuotaHeaders(
  response: Response,
  limit: number,
  remaining: number,
  expectedReset: number
) {
  if (
    responsePositiveInteger(response, "x-ratelimit-limit") !== limit ||
    responseNonNegativeInteger(response, "x-ratelimit-remaining") !== remaining ||
    responsePositiveInteger(response, "x-ratelimit-reset") !== expectedReset
  ) {
    throw new Error("Staging user API quota headers did not match the expected window state");
  }
}

function secondsUntilReset(response: Response, nowMs: number) {
  const reset = optionalResponseInteger(response, "x-ratelimit-reset");
  return reset ? Math.max(1, Math.ceil(reset - nowMs / 1000)) : undefined;
}

function responsePositiveInteger(response: Response, name: string) {
  const value = optionalResponseInteger(response, name);
  if (!value || value < 1) throw new Error(`Staging response omitted a valid ${name} header`);
  return value;
}

function responseNonNegativeInteger(response: Response, name: string) {
  const value = optionalResponseInteger(response, name);
  if (value === undefined || value < 0) {
    throw new Error(`Staging response omitted a valid ${name} header`);
  }
  return value;
}

function optionalResponseInteger(response: Response, name: string) {
  const raw = response.headers.get(name);
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function validateCookieHeader(value: string, label: string) {
  if (!value || value.length > 128 * 1024 || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

async function authenticatedGet(input: {
  baseUrl: URL;
  path: string;
  token: string;
  organizationId: string;
  projectKey: string;
  requestId: string;
  timestamp: string;
  fetcher: typeof fetch;
}) {
  return input.fetcher(new URL(input.path, ensureTrailingSlash(input.baseUrl)), {
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: "application/json",
      "x-loopgraph-organization-id": input.organizationId,
      "x-loopgraph-project-key": input.projectKey,
      "x-loopgraph-request-id": input.requestId,
      "x-loopgraph-timestamp": input.timestamp
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
}

function trustedStagingOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Staging URL must use HTTPS as one origin without credentials, path, query, or fragment state");
  }
  return url;
}

function requireStatus(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} failed with ${response.status}`);
}

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; staging validation cannot pass without it`);
  return value;
}

async function main() {
  const tokenFile = required("LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE");
  const supabaseUrl = required("LOOPGRAPH_STAGING_SUPABASE_URL");
  const publishableKey = required("LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY");
  const sessionCookie = async (name: string) => createSupabaseSessionCookieHeader({
    supabaseUrl,
    publishableKey,
    session: await readProjectedSupabaseSessionFile(required(name), name)
  });
  const receipt = await validateStagingDeployment({
    baseUrl: required("LOOPGRAPH_STAGING_URL"),
    organizationId: required("LOOPGRAPH_STAGING_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_PROJECT_KEY"),
    observabilityToken: await readProjectedWorkloadTokenFile(
      tokenFile,
      "LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE"
    ),
    userCookies: {
      allowed: await sessionCookie("LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE"),
      foreignTenant: await sessionCookie("LOOPGRAPH_STAGING_FOREIGN_USER_SESSION_FILE"),
      suspended: await sessionCookie("LOOPGRAPH_STAGING_SUSPENDED_USER_SESSION_FILE")
    },
    expectedUserApiQuotaLimit: requiredPositiveInteger(
      "LOOPGRAPH_STAGING_USER_API_ADMIN_QUOTA_LIMIT",
      1,
      10
    ),
    maximumQuotaWaitSeconds: requiredPositiveInteger(
      "LOOPGRAPH_STAGING_USER_API_QUOTA_MAX_WAIT_SECONDS",
      1,
      30
    )
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

function requiredPositiveInteger(name: string, minimum: number, maximum: number) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
