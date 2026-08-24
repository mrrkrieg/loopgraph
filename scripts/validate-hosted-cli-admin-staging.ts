import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readBoundedResponseJson } from "./bounded-response";
import { readProjectedSecretFile } from "./projected-secret-file";
import {
  createSupabaseSessionCookieHeader,
  readProjectedSupabaseSessionFile
} from "./projected-supabase-session";
import { readProjectedWorkloadTokenFile } from "./projected-workload-token";
import {
  findStagingAuditEventEvidence,
  readStagingAuditCheckpoint
} from "./staging-machine-audit-proof";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ACCESS_TOKEN_PATTERN = /^lgcli_access_[A-Za-z0-9_-]{43}$/;
const CORRELATION_ID_PATTERN =
  /^cli_session_revoke_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVOCATION_REASON = "Disposable staging CLI MFA revocation drill";

export type HostedCliAdminStagingConfig = {
  baseUrl: string;
  organizationId: string;
  projectKey: string;
  targetSessionId: string;
};

export type HostedCliAdminStagingCredentials = {
  aal1AdminCookie: string;
  aal2AdminCookie: string;
  targetAccessToken: string;
  observabilityToken: string;
};

export type HostedCliAdminStagingReceipt = {
  schemaVersion: "hosted-cli-admin-staging-validation/v1";
  targetOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  durationMs: number;
  controls: {
    aal1Denied: true;
    aal2Required: true;
    exactSessionScope: true;
    atomicAuditReceipt: true;
    disposableSessionRevoked: true;
  };
  revocation: {
    revokedCount: 1;
    correlationId: string;
  };
  auditEvidence: {
    afterSequence: number;
    throughSequence: number;
    headHash: string;
    correlationId: string;
  };
  checks: Array<{
    name:
      | "aal1_step_up_denial"
      | "aal2_exact_session_revocation"
      | "post_revocation_inventory"
      | "revoked_cli_access_denial"
      | "independent_audit_evidence";
    ok: true;
    status: number;
    detail: string;
  }>;
};

export async function validateHostedCliAdminStaging(
  config: HostedCliAdminStagingConfig,
  credentials: HostedCliAdminStagingCredentials,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
  } = {}
): Promise<HostedCliAdminStagingReceipt> {
  const startedAt = Date.now();
  const baseUrl = trustedOrigin(config.baseUrl);
  validateConfig(config);
  validateCredentials(credentials);
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? randomUUID;
  const checks: HostedCliAdminStagingReceipt["checks"] = [];
  const auditAfter = await readStagingAuditCheckpoint({
    baseUrl,
    fetcher,
    token: credentials.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_admin_checkpoint_${requestId()}`,
    timestamp: now().toISOString(),
    label: "CLI administrator staging"
  });

  const aal1Denied = await revokeSession({
    baseUrl,
    fetcher,
    cookie: credentials.aal1AdminCookie,
    targetSessionId: config.targetSessionId
  });
  expectError(aal1Denied, 403, "step_up_required", "AAL1 CLI administrator revocation");
  checks.push({
    name: "aal1_step_up_denial",
    ok: true,
    status: aal1Denied.status,
    detail: "An authenticated administrator without MFA step-up cannot revoke a CLI session."
  });

  const revoked = await revokeSession({
    baseUrl,
    fetcher,
    cookie: credentials.aal2AdminCookie,
    targetSessionId: config.targetSessionId
  });
  expectStatus(revoked.status, [200], "AAL2 CLI administrator revocation");
  const revocation = parseRevocationReceipt(revoked.body);
  if (revocation.revokedCount !== 1) {
    throw new Error("CLI administrator staging AAL1 denial did not preserve the exact revocable target");
  }
  checks.push({
    name: "aal2_exact_session_revocation",
    ok: true,
    status: revoked.status,
    detail: "An MFA-stepped administrator revoked exactly one disposable CLI session."
  });

  const after = await readInventory({
    baseUrl,
    fetcher,
    cookie: credentials.aal2AdminCookie
  });
  if (findTargetSession(after.body, config.targetSessionId).status !== "revoked") {
    throw new Error("CLI administrator staging inventory did not project the target as revoked");
  }
  checks.push({
    name: "post_revocation_inventory",
    ok: true,
    status: after.status,
    detail: "The safe administrator inventory projects the exact disposable target as revoked."
  });

  const accessDenied = await catalogRequest({
    baseUrl,
    fetcher,
    token: credentials.targetAccessToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_admin_access_${requestId()}`,
    timestamp: now().toISOString()
  });
  expectError(
    accessDenied,
    401,
    "invalid_or_expired_session",
    "Revoked CLI administrator staging target"
  );
  checks.push({
    name: "revoked_cli_access_denial",
    ok: true,
    status: accessDenied.status,
    detail: "The revoked disposable access token is denied at the Hermes marketplace boundary."
  });

  const reasonDigest = createHash("sha256").update(REVOCATION_REASON, "utf8").digest("hex");
  const auditEvidence = await findStagingAuditEventEvidence({
    baseUrl,
    fetcher,
    token: credentials.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    afterSequence: auditAfter,
    requestId,
    now,
    requestIdPrefix: "cli_admin_audit",
    label: "CLI administrator staging",
    omittedEventLabel: "exact CLI session revocation",
    matches: (event) => {
      const metadata = recordValue(event.metadata);
      return event.event_type === "cli.session.revoked" &&
        event.outcome === "accepted" &&
        event.actor_type === "user" &&
        event.capability === "marketplace.consume" &&
        event.correlation_id === revocation.correlationId &&
        event.source === "cli-session-admin" &&
        event.resource_type === "cli_access_session_session" &&
        event.resource_id === config.targetSessionId &&
        metadata?.scope === "session" &&
        metadata.revoked_count === 1 &&
        metadata.reason_recorded === true &&
        metadata.reason_sha256 === reasonDigest;
    }
  });
  checks.push({
    name: "independent_audit_evidence",
    ok: true,
    status: auditEvidence.status,
    detail: "The verified tenant audit chain contains the exact atomic revocation receipt and reason digest."
  });

  return {
    schemaVersion: "hosted-cli-admin-staging-validation/v1",
    targetOrigin: baseUrl.origin,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    checkedAt: now().toISOString(),
    durationMs: Date.now() - startedAt,
    controls: {
      aal1Denied: true,
      aal2Required: true,
      exactSessionScope: true,
      atomicAuditReceipt: true,
      disposableSessionRevoked: true
    },
    revocation,
    auditEvidence: {
      afterSequence: auditEvidence.afterSequence,
      throughSequence: auditEvidence.throughSequence,
      headHash: auditEvidence.headHash,
      correlationId: revocation.correlationId
    },
    checks
  };
}

async function readInventory(input: {
  baseUrl: URL;
  fetcher: typeof fetch;
  cookie: string;
}) {
  const url = new URL("api/auth/cli-sessions?offset=0&limit=100", ensureTrailingSlash(input.baseUrl));
  const response = await input.fetcher(url, {
    headers: browserHeaders(input.baseUrl, input.cookie),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  const body = await readBoundedResponseJson(
    response,
    1024 * 1024,
    "CLI administrator staging inventory"
  );
  expectStatus(response.status, [200], "CLI administrator staging inventory");
  return { status: response.status, body };
}

async function revokeSession(input: {
  baseUrl: URL;
  fetcher: typeof fetch;
  cookie: string;
  targetSessionId: string;
}) {
  const response = await input.fetcher(
    new URL("api/auth/cli-sessions", ensureTrailingSlash(input.baseUrl)),
    {
      method: "DELETE",
      headers: {
        ...browserHeaders(input.baseUrl, input.cookie),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        scope: "session",
        sessionId: input.targetSessionId,
        reason: REVOCATION_REASON
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    }
  );
  return {
    status: response.status,
    body: await readBoundedResponseJson(
      response,
      1024 * 1024,
      "CLI administrator staging revocation"
    )
  };
}

async function catalogRequest(input: {
  baseUrl: URL;
  fetcher: typeof fetch;
  token: string;
  organizationId: string;
  projectKey: string;
  requestId: string;
  timestamp: string;
}) {
  const response = await input.fetcher(
    new URL("api/marketplace/client/catalog?limit=1", ensureTrailingSlash(input.baseUrl)),
    {
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
    }
  );
  return {
    status: response.status,
    body: await readBoundedResponseJson(
      response,
      1024 * 1024,
      "CLI administrator staging catalog denial"
    )
  };
}

function browserHeaders(baseUrl: URL, cookie: string) {
  return {
    accept: "application/json",
    cookie,
    origin: baseUrl.origin
  };
}

function findTargetSession(value: unknown, targetSessionId: string) {
  if (!isRecord(value) || value.schemaVersion !== "cli-session-admin/v1") {
    throw new Error("CLI administrator staging inventory returned an invalid contract");
  }
  const sessions = Array.isArray(value.sessions) ? value.sessions : [];
  const target = sessions.find((session) =>
    isRecord(session) && session.id === targetSessionId
  );
  if (!isRecord(target) || typeof target.status !== "string") {
    throw new Error("CLI administrator staging target is absent from the bounded inventory page");
  }
  return { status: target.status };
}

function parseRevocationReceipt(value: unknown): HostedCliAdminStagingReceipt["revocation"] {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "cli-session-revocation/v1" ||
    value.accepted !== true ||
    value.revokedCount !== 1 ||
    typeof value.correlationId !== "string" ||
    !CORRELATION_ID_PATTERN.test(value.correlationId)
  ) {
    throw new Error("CLI administrator staging revocation returned an invalid exact-session receipt");
  }
  return { revokedCount: 1, correlationId: value.correlationId };
}

function expectError(
  response: { status: number; body: unknown },
  status: number,
  code: string,
  label: string
) {
  expectStatus(response.status, [status], label);
  if (!isRecord(response.body) || response.body.code !== code && response.body.error !== code) {
    throw new Error(`${label} returned ${status} without ${code}`);
  }
}

function expectStatus(actual: number, expected: number[], label: string) {
  if (!expected.includes(actual)) {
    throw new Error(`${label} returned ${actual}; expected ${expected.join(" or ")}`);
  }
}

function trustedOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CLI administrator staging URL must be one HTTPS origin without credentials or path state");
  }
  return url;
}

function validateConfig(config: HostedCliAdminStagingConfig) {
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("CLI administrator staging organization ID is invalid");
  }
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) {
    throw new Error("CLI administrator staging project key is invalid");
  }
  if (!UUID_PATTERN.test(config.targetSessionId)) {
    throw new Error("CLI administrator staging target session ID is invalid");
  }
}

function validateCredentials(credentials: HostedCliAdminStagingCredentials) {
  for (const [label, value] of [
    ["AAL1 administrator", credentials.aal1AdminCookie],
    ["AAL2 administrator", credentials.aal2AdminCookie]
  ] as const) {
    if (!value || value.length > 128 * 1024 || /[\r\n\0]/.test(value)) {
      throw new Error(`CLI administrator staging ${label} cookie is invalid`);
    }
  }
  if (!ACCESS_TOKEN_PATTERN.test(credentials.targetAccessToken)) {
    throw new Error("CLI administrator staging target access token is invalid");
  }
  if (credentials.observabilityToken.length < 20 || /[\r\n\0]/.test(credentials.observabilityToken)) {
    throw new Error("CLI administrator staging observability identity is invalid");
  }
}

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; CLI administrator staging cannot pass without it`);
  return value;
}

async function main() {
  const supabaseUrl = required("LOOPGRAPH_STAGING_SUPABASE_URL");
  const publishableKey = required("LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY");
  const adminCookie = async (name: string) => createSupabaseSessionCookieHeader({
    supabaseUrl,
    publishableKey,
    session: await readProjectedSupabaseSessionFile(required(name), name)
  });
  const receipt = await validateHostedCliAdminStaging({
    baseUrl: required("LOOPGRAPH_STAGING_CLI_ADMIN_URL"),
    organizationId: required("LOOPGRAPH_STAGING_CLI_ADMIN_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_CLI_ADMIN_PROJECT_KEY"),
    targetSessionId: required("LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_SESSION_ID")
  }, {
    aal1AdminCookie: await adminCookie("LOOPGRAPH_STAGING_CLI_ADMIN_AAL1_SESSION_FILE"),
    aal2AdminCookie: await adminCookie("LOOPGRAPH_STAGING_CLI_ADMIN_AAL2_SESSION_FILE"),
    targetAccessToken: await readProjectedSecretFile(
      required("LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_ACCESS_TOKEN_FILE"),
      "LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_ACCESS_TOKEN_FILE"
    ),
    observabilityToken: await readProjectedWorkloadTokenFile(
      required("LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE"),
      "LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE"
    )
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
