import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MarketplaceAppVersion } from "loopgraph/core";
import {
  ensureRemoteHostedMarketplaceArtifact,
  hasRemoteHostedMarketplaceArtifact,
  HostedMarketplaceClient,
  type WorkloadTokenProvider
} from "../packages/loopgraph/src/runtime";
import { readBoundedResponseJson } from "./bounded-response";
import {
  createSupabaseSessionCookieHeader,
  readProjectedSupabaseSessionFile
} from "./projected-supabase-session";
import {
  readProjectedWorkloadTokenFile,
  validateProjectedWorkloadToken
} from "./projected-workload-token";
import {
  findStagingAuditEventEvidence,
  readStagingAuditCheckpoint
} from "./staging-machine-audit-proof";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CORRELATION_ID_PATTERN =
  /^marketplace_release_status_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVOCATION_REASON = "Disposable staging marketplace release revocation drill";

export type HostedMarketplaceReleaseRevocationConfig = {
  baseUrl: string;
  audience: string;
  organizationId: string;
  projectKey: string;
  appId: string;
  version: string;
  artifactDigest: string;
};

export type HostedMarketplaceReleaseRevocationCredentials = {
  aal1AdminCookie: string;
  aal2AdminCookie: string;
  allowedWorkloadToken: string;
  observabilityToken: string;
};

export type HostedMarketplaceReleaseRevocationReceipt = {
  schemaVersion: "hosted-marketplace-release-revocation-staging-validation/v1";
  targetOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  durationMs: number;
  release: { appId: string; version: string; artifactDigest: string };
  revocation: { changed: true; correlationId: string };
  auditEvidence: {
    afterSequence: number;
    throughSequence: number;
    headHash: string;
    correlationId: string;
  };
  checks: Array<{
    name:
      | "verified_release_cached"
      | "aal1_step_up_denial"
      | "denied_request_preserves_release"
      | "aal2_exact_release_revocation"
      | "workload_revocation_and_cache_eviction"
      | "independent_audit_evidence";
    ok: true;
    status: number;
    detail: string;
  }>;
};

export async function validateHostedMarketplaceReleaseRevocationStaging(
  config: HostedMarketplaceReleaseRevocationConfig,
  credentials: HostedMarketplaceReleaseRevocationCredentials,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
    ensureArtifact?: typeof ensureRemoteHostedMarketplaceArtifact;
    hasArtifact?: typeof hasRemoteHostedMarketplaceArtifact;
  } = {}
): Promise<HostedMarketplaceReleaseRevocationReceipt> {
  const startedAt = Date.now();
  const baseUrl = trustedOrigin(config.baseUrl);
  validateConfig(config);
  validateCredentials(credentials);
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? randomUUID;
  const ensureArtifact = dependencies.ensureArtifact ?? ensureRemoteHostedMarketplaceArtifact;
  const hasArtifact = dependencies.hasArtifact ?? hasRemoteHostedMarketplaceArtifact;
  const client = new HostedMarketplaceClient({
    baseUrl: baseUrl.origin,
    audience: config.audience,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    tokenProvider: new FixedTokenProvider(credentials.allowedWorkloadToken),
    fetcher
  });
  const checks: HostedMarketplaceReleaseRevocationReceipt["checks"] = [];
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "loopgraph-release-revocation-gate-")
  );

  try {
    const staged = await ensureArtifact({
      client,
      projectRoot,
      appId: config.appId,
      version: config.version,
      artifactDigest: config.artifactDigest,
      includeDeprecated: false
    });
    assertExactRelease(staged, config);
    if (!await hasArtifact(releaseCacheQuery(projectRoot, config))) {
      throw new Error("Marketplace release revocation staging cache was not materialized");
    }
    checks.push({
      name: "verified_release_cached",
      ok: true,
      status: 200,
      detail: "The exact active signed release entered the disposable workload cache."
    });

    const auditAfter = await readStagingAuditCheckpoint({
      baseUrl,
      fetcher,
      token: credentials.observabilityToken,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      requestId: `release_revocation_checkpoint_${requestId()}`,
      timestamp: now().toISOString(),
      label: "Marketplace release revocation staging"
    });

    const aal1Denied = await changeReleaseStatus({
      baseUrl,
      fetcher,
      cookie: credentials.aal1AdminCookie,
      config
    });
    expectError(aal1Denied, 403, "step_up_required", "AAL1 marketplace release revocation");
    checks.push({
      name: "aal1_step_up_denial",
      ok: true,
      status: 403,
      detail: "An authenticated publisher without MFA step-up cannot revoke a release."
    });

    const preserved = await ensureArtifact({
      client,
      projectRoot,
      appId: config.appId,
      version: config.version,
      artifactDigest: config.artifactDigest,
      includeDeprecated: false
    });
    assertExactRelease(preserved, config);
    if (!await hasArtifact(releaseCacheQuery(projectRoot, config))) {
      throw new Error("Denied release revocation unexpectedly removed the disposable cache");
    }
    checks.push({
      name: "denied_request_preserves_release",
      ok: true,
      status: 200,
      detail: "The denied AAL1 request left the exact active release and cache usable."
    });

    const revokedResponse = await changeReleaseStatus({
      baseUrl,
      fetcher,
      cookie: credentials.aal2AdminCookie,
      config
    });
    expectStatus(revokedResponse.status, [200], "AAL2 marketplace release revocation");
    const revocation = parseRevocationReceipt(revokedResponse.body, config);
    checks.push({
      name: "aal2_exact_release_revocation",
      ok: true,
      status: 200,
      detail: "An MFA-stepped publisher revoked exactly the disposable active release."
    });

    let unavailable = false;
    try {
      await ensureArtifact({
        client,
        projectRoot,
        appId: config.appId,
        version: config.version,
        artifactDigest: config.artifactDigest,
        includeDeprecated: false
      });
    } catch {
      unavailable = true;
    }
    if (!unavailable || await hasArtifact(releaseCacheQuery(projectRoot, config))) {
      throw new Error("Revoked marketplace release remained workload-visible or cached");
    }
    checks.push({
      name: "workload_revocation_and_cache_eviction",
      ok: true,
      status: 404,
      detail: "Workload re-authorization denied the revoked release and evicted its exact cache source."
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
      requestIdPrefix: "release_revocation_audit",
      label: "Marketplace release revocation staging",
      omittedEventLabel: "exact marketplace release revocation",
      matches: (event) => {
        const metadata = recordValue(event.metadata);
        return event.event_type === "marketplace.release.status_changed" &&
          event.outcome === "accepted" &&
          event.actor_type === "user" &&
          event.capability === "marketplace.publish" &&
          event.correlation_id === revocation.correlationId &&
          event.source === "marketplace-release-admin" &&
          event.resource_type === "marketplace_release" &&
          event.resource_id === `${config.appId}@${config.version}` &&
          metadata?.previous_status === "active" &&
          metadata.release_status === "revoked" &&
          metadata.changed === true &&
          metadata.artifact_digest === config.artifactDigest &&
          metadata.reason_recorded === true &&
          metadata.reason_sha256 === reasonDigest;
      }
    });
    checks.push({
      name: "independent_audit_evidence",
      ok: true,
      status: auditEvidence.status,
      detail: "The verified tenant audit chain contains the exact atomic release revocation."
    });

    return {
      schemaVersion: "hosted-marketplace-release-revocation-staging-validation/v1",
      targetOrigin: baseUrl.origin,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      checkedAt: now().toISOString(),
      durationMs: Date.now() - startedAt,
      release: {
        appId: config.appId,
        version: config.version,
        artifactDigest: config.artifactDigest
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
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

class FixedTokenProvider implements WorkloadTokenProvider {
  constructor(private readonly token: string) {}
  async getToken() {
    return this.token;
  }
}

async function changeReleaseStatus(input: {
  baseUrl: URL;
  fetcher: typeof fetch;
  cookie: string;
  config: HostedMarketplaceReleaseRevocationConfig;
}) {
  const response = await input.fetcher(
    new URL("api/marketplace/releases", ensureTrailingSlash(input.baseUrl)),
    {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: input.cookie,
        origin: input.baseUrl.origin
      },
      body: JSON.stringify({
        appId: input.config.appId,
        version: input.config.version,
        status: "revoked",
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
      "Marketplace release revocation staging response"
    )
  };
}

function parseRevocationReceipt(
  value: unknown,
  config: HostedMarketplaceReleaseRevocationConfig
): HostedMarketplaceReleaseRevocationReceipt["revocation"] {
  const release = isRecord(value) ? recordValue(value.release) : undefined;
  if (
    !isRecord(value) ||
    value.schemaVersion !== "hosted-marketplace-release-status/v1" ||
    value.accepted !== true ||
    release?.appId !== config.appId ||
    release.version !== config.version ||
    release.artifactDigest !== config.artifactDigest ||
    release.previousStatus !== "active" ||
    release.releaseStatus !== "revoked" ||
    release.changed !== true ||
    typeof release.correlationId !== "string" ||
    !CORRELATION_ID_PATTERN.test(release.correlationId)
  ) {
    throw new Error("Marketplace release revocation returned an invalid exact-release receipt");
  }
  return { changed: true, correlationId: release.correlationId };
}

function assertExactRelease(
  version: MarketplaceAppVersion,
  config: HostedMarketplaceReleaseRevocationConfig
) {
  if (
    version.appId !== config.appId ||
    version.version !== config.version ||
    version.digest !== config.artifactDigest ||
    version.provenanceVerified !== true ||
    version.deprecated ||
    version.revokedAt
  ) {
    throw new Error("Marketplace release revocation staging resolved a different release identity");
  }
}

function releaseCacheQuery(
  projectRoot: string,
  config: HostedMarketplaceReleaseRevocationConfig
) {
  return {
    projectRoot,
    appId: config.appId,
    version: config.version,
    artifactDigest: config.artifactDigest
  };
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
    throw new Error("Marketplace release revocation staging URL must be one HTTPS origin");
  }
  return url;
}

function validateConfig(config: HostedMarketplaceReleaseRevocationConfig) {
  if (!config.audience.trim() || config.audience.length > 512) {
    throw new Error("Marketplace release revocation staging audience is invalid");
  }
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("Marketplace release revocation staging organization ID is invalid");
  }
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) {
    throw new Error("Marketplace release revocation staging project key is invalid");
  }
  if (!APP_ID_PATTERN.test(config.appId) || config.appId.length < 3 || config.appId.length > 160) {
    throw new Error("Marketplace release revocation staging app ID is invalid");
  }
  if (!SEMVER_PATTERN.test(config.version)) {
    throw new Error("Marketplace release revocation staging version is invalid");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(config.artifactDigest)) {
    throw new Error("Marketplace release revocation staging artifact digest is invalid");
  }
}

function validateCredentials(credentials: HostedMarketplaceReleaseRevocationCredentials) {
  for (const [label, value] of [
    ["AAL1 administrator cookie", credentials.aal1AdminCookie],
    ["AAL2 administrator cookie", credentials.aal2AdminCookie]
  ] as const) {
    if (!value || value.length > 128 * 1024 || /[\r\n\0]/.test(value)) {
      throw new Error(`Marketplace release revocation staging ${label} is invalid`);
    }
  }
  validateProjectedWorkloadToken(
    credentials.allowedWorkloadToken,
    "Marketplace release revocation staging workload identity"
  );
  validateProjectedWorkloadToken(
    credentials.observabilityToken,
    "Marketplace release revocation staging observability identity"
  );
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
  if (!value) throw new Error(`${name} is required; release revocation staging cannot pass without it`);
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
  const receipt = await validateHostedMarketplaceReleaseRevocationStaging({
    baseUrl: required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_URL"),
    audience: required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_AUDIENCE"),
    organizationId: required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_PROJECT_KEY"),
    appId: required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_ID"),
    version: required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_VERSION"),
    artifactDigest: required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_ARTIFACT_DIGEST")
  }, {
    aal1AdminCookie: await adminCookie(
      "LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL1_SESSION_FILE"
    ),
    aal2AdminCookie: await adminCookie(
      "LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL2_SESSION_FILE"
    ),
    allowedWorkloadToken: await readProjectedWorkloadTokenFile(
      required("LOOPGRAPH_STAGING_RELEASE_REVOCATION_WORKLOAD_TOKEN_FILE"),
      "LOOPGRAPH_STAGING_RELEASE_REVOCATION_WORKLOAD_TOKEN_FILE"
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
