import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  CliDeviceAuthorizationClient,
  CliDeviceAuthorizationError
} from "../packages/loopgraph/src/runtime/cli-device-auth";
import { readBoundedResponseJson } from "./bounded-response";
import { readProjectedSecretFile } from "./projected-secret-file";
import { readProjectedWorkloadTokenFile } from "./projected-workload-token";
import {
  findAuthorizedMachineRequestAuditEvidence,
  readStagingAuditCheckpoint
} from "./staging-machine-audit-proof";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REFRESH_TOKEN_PATTERN = /^lgcli_refresh_[A-Za-z0-9_-]{43}$/;
const ACCESS_TOKEN_PATTERN = /^lgcli_access_[A-Za-z0-9_-]{43}$/;

export type HostedCliSessionStagingConfig = {
  primaryBaseUrl: string;
  replicaBaseUrl: string;
  organizationId: string;
  projectKey: string;
  requestRateLimit: number;
};

export type HostedCliSessionStagingCredentials = {
  disposableRefreshToken: string;
  suspendedAccessToken: string;
  revokedAccessToken: string;
  observabilityToken: string;
};

export type HostedCliSessionStagingReceipt = {
  schemaVersion: "hosted-cli-session-staging-validation/v1";
  primaryOrigin: string;
  replicaOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  durationMs: number;
  controls: {
    deviceFingerprintLimit: 5;
    requestRateLimit: number;
    crossReplica: true;
    disposableSessionRevoked: true;
  };
  auditEvidence: {
    afterSequence: number;
    throughSequence: number;
    headHash: string;
    requestId: string;
  };
  checks: Array<{
    name: string;
    ok: true;
    status: number;
    detail: string;
  }>;
};

export async function validateHostedCliSessionStaging(
  config: HostedCliSessionStagingConfig,
  credentials: HostedCliSessionStagingCredentials,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<HostedCliSessionStagingReceipt> {
  const startedAt = Date.now();
  const primary = trustedOrigin(config.primaryBaseUrl, "primary");
  const replica = trustedOrigin(config.replicaBaseUrl, "replica");
  validateConfig(config, primary, replica);
  validateCredentials(credentials);
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? randomUUID;
  const sleep = dependencies.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const checks: HostedCliSessionStagingReceipt["checks"] = [];
  const authorizationFetcher = withGateFingerprint(fetcher, `loopgraph-cli-staging/${requestId()}`);
  const primaryClient = new CliDeviceAuthorizationClient(primary.origin, { fetcher: authorizationFetcher });
  const replicaClient = new CliDeviceAuthorizationClient(replica.origin, { fetcher: authorizationFetcher });
  const auditAfter = await readStagingAuditCheckpoint({
    baseUrl: primary,
    fetcher,
    token: credentials.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_checkpoint_${requestId()}`,
    timestamp: now().toISOString(),
    label: "CLI session staging"
  });

  const devices = [];
  for (let index = 0; index < 5; index += 1) {
    devices.push(await primaryClient.requestDeviceCode());
  }
  const issuanceDenied = await expectCliError(
    primaryClient.requestDeviceCode(),
    "slow_down",
    429,
    "Device-code issuance saturation"
  );
  checks.push({
    name: "device_issuance_saturation",
    ok: true,
    status: issuanceDenied.status,
    detail: "One request fingerprint receives five device codes and the sixth request is denied."
  });

  const pendingDevice = devices[0]!;
  const pending = await expectCliError(
    primaryClient.exchangeDeviceCode(pendingDevice.device_code),
    "authorization_pending",
    400,
    "Initial device-code poll"
  );
  const slowed = await expectCliError(
    primaryClient.exchangeDeviceCode(pendingDevice.device_code),
    "slow_down",
    429,
    "Repeated device-code poll"
  );
  checks.push({
    name: "polling_slow_down",
    ok: true,
    status: slowed.status,
    detail: `An unapproved code remains ${pending.code}; an immediate repeat is throttled.`
  });

  const firstRotation = await primaryClient.refresh(credentials.disposableRefreshToken);
  checks.push({
    name: "primary_refresh_rotation",
    ok: true,
    status: 200,
    detail: "The primary replica rotated one disposable current refresh generation."
  });
  const secondRotation = await replicaClient.refresh(firstRotation.refresh_token);
  checks.push({
    name: "cross_replica_refresh_rotation",
    ok: true,
    status: 200,
    detail: "A distinct replica observed and rotated the next generation from shared durable state."
  });

  const stale = await catalogRequest({
    baseUrl: primary,
    fetcher,
    token: secondRotation.access_token,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_stale_${requestId()}`,
    timestamp: new Date(now().getTime() - 10 * 60_000).toISOString()
  });
  expectApiError(stale, [400], "invalid_or_stale_request_metadata", "Stale CLI request metadata");
  checks.push({
    name: "stale_request_metadata_denial",
    ok: true,
    status: stale.status,
    detail: "A valid session cannot authorize a marketplace request outside the five-minute clock window."
  });

  const suspended = await catalogRequest({
    baseUrl: primary,
    fetcher,
    token: credentials.suspendedAccessToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_suspended_${requestId()}`,
    timestamp: now().toISOString()
  });
  expectApiError(suspended, [403], "membership_required", "Suspended CLI membership");
  checks.push({
    name: "suspended_membership_denial",
    ok: true,
    status: suspended.status,
    detail: "A session whose organization membership was suspended is denied and revoked."
  });

  const revoked = await catalogRequest({
    baseUrl: primary,
    fetcher,
    token: credentials.revokedAccessToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_revoked_${requestId()}`,
    timestamp: now().toISOString()
  });
  expectApiError(revoked, [401], "invalid_or_expired_session", "Revoked CLI session");
  checks.push({
    name: "revoked_session_denial",
    ok: true,
    status: revoked.status,
    detail: "An explicitly revoked human session cannot read marketplace metadata."
  });

  let acceptedRequestId = "";
  const startSecond = now().getUTCSeconds();
  if (startSecond > 50) await sleep((62 - startSecond) * 1_000);
  for (let index = 0; index < config.requestRateLimit; index += 1) {
    const currentRequestId = `cli_rate_${requestId()}`;
    acceptedRequestId ||= currentRequestId;
    const response = await catalogRequest({
      baseUrl: index % 2 === 0 ? primary : replica,
      fetcher,
      token: secondRotation.access_token,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      requestId: currentRequestId,
      timestamp: now().toISOString()
    });
    expectStatus(response.status, [200], `CLI rate-window request ${index + 1}`);
  }
  const saturated = await catalogRequest({
    baseUrl: replica,
    fetcher,
    token: secondRotation.access_token,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_rate_${requestId()}`,
    timestamp: now().toISOString()
  });
  expectApiError(saturated, [429], "rate_limited", "CLI request-rate saturation");
  checks.push({
    name: "request_rate_saturation",
    ok: true,
    status: saturated.status,
    detail: `Exactly ${config.requestRateLimit} requests were accepted before the durable tenant rate window denied the next request.`
  });

  const replay = await expectCliError(
    replicaClient.refresh(credentials.disposableRefreshToken),
    "refresh_token_reused",
    400,
    "Replaced refresh-token replay"
  );
  const revokedFamily = await catalogRequest({
    baseUrl: primary,
    fetcher,
    token: secondRotation.access_token,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `cli_family_${requestId()}`,
    timestamp: now().toISOString()
  });
  expectApiError(revokedFamily, [401], "invalid_or_expired_session", "Replayed CLI session family");
  checks.push({
    name: "refresh_replay_family_revocation",
    ok: true,
    status: replay.status,
    detail: "Replaying generation zero revoked the newest generation across replicas."
  });

  const auditEvidence = await findAuthorizedMachineRequestAuditEvidence({
    baseUrl: primary,
    fetcher,
    token: credentials.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    targetRequestId: acceptedRequestId,
    capability: "marketplace.consume",
    afterSequence: auditAfter,
    requestId,
    now,
    requestIdPrefix: "cli_audit",
    label: "CLI session staging"
  });
  checks.push({
    name: "independent_audit_evidence",
    ok: true,
    status: auditEvidence.status,
    detail: "The verified tenant audit chain contains the accepted human-session marketplace request."
  });

  return {
    schemaVersion: "hosted-cli-session-staging-validation/v1",
    primaryOrigin: primary.origin,
    replicaOrigin: replica.origin,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    checkedAt: now().toISOString(),
    durationMs: Date.now() - startedAt,
    controls: {
      deviceFingerprintLimit: 5,
      requestRateLimit: config.requestRateLimit,
      crossReplica: true,
      disposableSessionRevoked: true
    },
    auditEvidence: {
      afterSequence: auditEvidence.afterSequence,
      throughSequence: auditEvidence.throughSequence,
      headHash: auditEvidence.headHash,
      requestId: acceptedRequestId
    },
    checks
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
  const url = new URL("api/marketplace/client/catalog?limit=1", ensureTrailingSlash(input.baseUrl));
  const response = await input.fetcher(url, {
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
  const body = await readBoundedResponseJson(response, 4 * 1024 * 1024, "CLI staging catalog response");
  return { status: response.status, body };
}

async function expectCliError(
  promise: Promise<unknown>,
  code: string,
  status: number,
  label: string
) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliDeviceAuthorizationError && error.code === code && error.status === status) {
      return error;
    }
    throw new Error(`${label} returned a different authorization error`, { cause: error });
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function expectApiError(
  response: { status: number; body: unknown },
  statuses: number[],
  code: string,
  label: string
) {
  expectStatus(response.status, statuses, label);
  if (!isRecord(response.body) || response.body.error !== code) {
    throw new Error(`${label} returned ${response.status} without ${code}`);
  }
}

function expectStatus(actual: number, expected: number[], label: string) {
  if (!expected.includes(actual)) {
    throw new Error(`${label} returned ${actual}; expected ${expected.join(" or ")}`);
  }
}

function trustedOrigin(value: string, label: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`CLI staging ${label} URL must be one HTTPS origin without credentials or path state`);
  }
  return url;
}

function validateConfig(config: HostedCliSessionStagingConfig, primary: URL, replica: URL) {
  if (primary.origin === replica.origin) {
    throw new Error("CLI staging requires distinct primary and replica origins backed by the same tenant database");
  }
  if (!UUID_PATTERN.test(config.organizationId)) throw new Error("CLI staging organization ID is invalid");
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) throw new Error("CLI staging project key is invalid");
  if (!Number.isInteger(config.requestRateLimit) || config.requestRateLimit < 2 || config.requestRateLimit > 20) {
    throw new Error("CLI staging request rate limit must be an integer from 2 through 20");
  }
}

function validateCredentials(credentials: HostedCliSessionStagingCredentials) {
  if (!REFRESH_TOKEN_PATTERN.test(credentials.disposableRefreshToken)) {
    throw new Error("CLI staging disposable refresh token is invalid");
  }
  for (const [label, value] of [
    ["suspended", credentials.suspendedAccessToken],
    ["revoked", credentials.revokedAccessToken]
  ] as const) {
    if (!ACCESS_TOKEN_PATTERN.test(value)) throw new Error(`CLI staging ${label} access token is invalid`);
  }
  if (credentials.observabilityToken.length < 20 || /[\r\n\0]/.test(credentials.observabilityToken)) {
    throw new Error("CLI staging observability identity is invalid");
  }
}

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function withGateFingerprint(fetcher: typeof fetch, userAgent: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("user-agent", userAgent);
    return fetcher(input, { ...init, headers });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; CLI session staging cannot pass without it`);
  return value;
}

async function cliSecret(name: string) {
  return readProjectedSecretFile(required(name), name);
}

async function main() {
  const receipt = await validateHostedCliSessionStaging({
    primaryBaseUrl: required("LOOPGRAPH_STAGING_CLI_PRIMARY_URL"),
    replicaBaseUrl: required("LOOPGRAPH_STAGING_CLI_REPLICA_URL"),
    organizationId: required("LOOPGRAPH_STAGING_CLI_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_CLI_PROJECT_KEY"),
    requestRateLimit: Number(required("LOOPGRAPH_STAGING_CLI_REQUEST_RATE_LIMIT"))
  }, {
    disposableRefreshToken: await cliSecret("LOOPGRAPH_STAGING_CLI_DISPOSABLE_REFRESH_TOKEN_FILE"),
    suspendedAccessToken: await cliSecret("LOOPGRAPH_STAGING_CLI_SUSPENDED_ACCESS_TOKEN_FILE"),
    revokedAccessToken: await cliSecret("LOOPGRAPH_STAGING_CLI_REVOKED_ACCESS_TOKEN_FILE"),
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
