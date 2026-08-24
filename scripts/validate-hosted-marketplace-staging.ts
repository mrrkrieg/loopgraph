import { randomUUID } from "node:crypto";
import { rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ensureRemoteHostedMarketplaceArtifact,
  HostedMarketplaceClient,
  HostedMarketplaceClientError,
  type WorkloadTokenProvider
} from "../packages/loopgraph/src/runtime";
import {
  readProjectedWorkloadTokenFile,
  validateProjectedWorkloadToken
} from "./projected-workload-token";
import {
  findAuthorizedMachineRequestAuditEvidence,
  readStagingAuditCheckpoint
} from "./staging-machine-audit-proof";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type HostedMarketplaceStagingConfig = {
  baseUrl: string;
  audience: string;
  organizationId: string;
  projectKey: string;
  appId: string;
  version: string;
  artifactDigest: string;
};

export type HostedMarketplaceStagingTokens = {
  allowed: string;
  foreignTenant: string;
  revoked: string;
  observability: string;
};

export type HostedMarketplaceStagingReceipt = {
  schemaVersion: "hosted-marketplace-staging-validation/v2";
  targetOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  durationMs: number;
  app: { id: string; version: string; artifactDigest: string };
  auditEvidence: {
    afterSequence: number;
    throughSequence: number;
    headHash: string;
    requestId: string;
  };
  checks: Array<{
    name: string;
    ok: true;
    status?: number;
    detail: string;
  }>;
};

export async function validateHostedMarketplaceStaging(
  config: HostedMarketplaceStagingConfig,
  tokens: HostedMarketplaceStagingTokens,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
    verifyArtifact?: typeof ensureRemoteHostedMarketplaceArtifact;
  } = {}
): Promise<HostedMarketplaceStagingReceipt> {
  const startedAt = Date.now();
  const baseUrl = trustedStagingOrigin(config.baseUrl);
  validateConfig(config);
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? (() => randomUUID());
  const verifyArtifact = dependencies.verifyArtifact ?? ensureRemoteHostedMarketplaceArtifact;
  const checks: HostedMarketplaceStagingReceipt["checks"] = [];
  const allowedProvider = new FixedWorkloadTokenProvider(tokens.allowed);
  const client = marketplaceClient(config, allowedProvider, fetcher);
  const auditAfter = await readStagingAuditCheckpoint({
    baseUrl,
    fetcher,
    token: tokens.observability,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `marketplace_checkpoint_${requestId()}`,
    timestamp: now().toISOString(),
    label: "Marketplace staging"
  });

  const unauthenticated = await fetcher(
    new URL("api/marketplace/client/catalog", ensureTrailingSlash(baseUrl)),
    { redirect: "error", signal: AbortSignal.timeout(15_000) }
  );
  expectStatus(unauthenticated.status, [401], "Unauthenticated catalog request");
  checks.push({
    name: "unauthenticated_denial",
    ok: true,
    status: unauthenticated.status,
    detail: "Catalog access fails closed without workload identity."
  });

  const app = await client.getApp(config.appId, { includeDeprecated: false });
  if (!app) throw new Error("Allowed workload could not resolve the staging app");
  const exactVersion = app.versions.find((candidate) =>
    candidate.version === config.version &&
    candidate.digest === config.artifactDigest &&
    candidate.provenanceVerified
  );
  if (!exactVersion) {
    throw new Error("Allowed workload did not receive the exact verified staging release");
  }
  checks.push({
    name: "tenant_catalog_visibility",
    ok: true,
    status: 200,
    detail: "Allowed tenant resolved the exact verified app release."
  });

  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-gate-"));
  try {
    const staged = await verifyArtifact({
      client,
      projectRoot,
      appId: config.appId,
      version: config.version,
      artifactDigest: config.artifactDigest,
      includeDeprecated: false
    });
    if (
      staged.appId !== config.appId ||
      staged.version !== config.version ||
      staged.digest !== config.artifactDigest ||
      staged.provenanceVerified !== true ||
      staged.source.sourceType !== "hosted"
    ) {
      throw new Error("Staging artifact verification returned a different release identity");
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
  checks.push({
    name: "artifact_signature_and_cache",
    ok: true,
    status: 200,
    detail: "Exact archive digest, publisher key, signature, manifest identity, and hosted cache provenance verified."
  });

  const foreignStatus = await deniedClientStatus(
    marketplaceClient(
      config,
      new FixedWorkloadTokenProvider(tokens.foreignTenant),
      fetcher
    ).getApp(config.appId),
    "Foreign-tenant workload"
  );
  expectStatus(foreignStatus, [401, 403, 404], "Foreign-tenant workload");
  checks.push({
    name: "cross_tenant_denial",
    ok: true,
    status: foreignStatus,
    detail: "A workload from another tenant cannot read target-tenant catalog metadata."
  });

  const revokedStatus = await deniedClientStatus(
    marketplaceClient(
      config,
      new FixedWorkloadTokenProvider(tokens.revoked),
      fetcher
    ).getApp(config.appId),
    "Revoked workload"
  );
  expectStatus(revokedStatus, [403], "Revoked workload");
  checks.push({
    name: "durable_revocation",
    ok: true,
    status: revokedStatus,
    detail: "A valid workload JWT with a revoked principal or marketplace.consume grant is denied."
  });

  const replayId = `marketplace_gate_${requestId()}`;
  const replayUrl = new URL("api/marketplace/client/catalog", ensureTrailingSlash(baseUrl));
  replayUrl.searchParams.set("appId", config.appId);
  const replayHeaders = machineHeaders({
    token: tokens.allowed,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: replayId,
    timestamp: now().toISOString()
  });
  const firstReplayAttempt = await fetcher(replayUrl, {
    headers: replayHeaders,
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(firstReplayAttempt.status, [200], "Fresh replay-control request");
  const repeated = await fetcher(replayUrl, {
    headers: replayHeaders,
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(repeated.status, [403, 409], "Repeated request identity");
  checks.push({
    name: "replay_denial",
    ok: true,
    status: repeated.status,
    detail: "Reusing the same workload request identity is rejected by the durable guard."
  });

  const auditEvidence = await findAuthorizedMachineRequestAuditEvidence({
    baseUrl,
    fetcher,
    token: tokens.observability,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    targetRequestId: replayId,
    capability: "marketplace.consume",
    afterSequence: auditAfter,
    requestId,
    now,
    requestIdPrefix: "marketplace_audit",
    label: "Marketplace staging"
  });
  checks.push({
    name: "independent_audit_evidence",
    ok: true,
    status: auditEvidence.status,
    detail: "Verified tenant audit chain contains the accepted marketplace.consume request."
  });

  return {
    schemaVersion: "hosted-marketplace-staging-validation/v2",
    targetOrigin: baseUrl.origin,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    checkedAt: now().toISOString(),
    durationMs: Date.now() - startedAt,
    app: {
      id: config.appId,
      version: config.version,
      artifactDigest: config.artifactDigest
    },
    auditEvidence: {
      afterSequence: auditEvidence.afterSequence,
      throughSequence: auditEvidence.throughSequence,
      headHash: auditEvidence.headHash,
      requestId: replayId
    },
    checks
  };
}

class FixedWorkloadTokenProvider implements WorkloadTokenProvider {
  constructor(private readonly token: string) {
    validateProjectedWorkloadToken(token, "Staging workload token");
  }

  async getToken() {
    return this.token;
  }
}

function marketplaceClient(
  config: HostedMarketplaceStagingConfig,
  tokenProvider: WorkloadTokenProvider,
  fetcher: typeof fetch
) {
  return new HostedMarketplaceClient({
    baseUrl: config.baseUrl,
    audience: config.audience,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    tokenProvider,
    fetcher
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
    throw new Error("Hosted marketplace staging URL must use HTTPS as one origin without credentials, path, query, or fragment state");
  }
  return url;
}

function validateConfig(config: HostedMarketplaceStagingConfig) {
  if (!config.audience.trim() || config.audience.length > 512) {
    throw new Error("Marketplace staging audience is invalid");
  }
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("Marketplace staging organization ID is invalid");
  }
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) {
    throw new Error("Marketplace staging project key is invalid");
  }
  if (!config.appId.trim() || !config.version.trim()) {
    throw new Error("Marketplace staging app ID and version are required");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(config.artifactDigest)) {
    throw new Error("Marketplace staging artifact digest must be an exact SHA-256 identity");
  }
}

async function deniedClientStatus(promise: Promise<unknown>, label: string) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HostedMarketplaceClientError) return error.status;
    throw error;
  }
  throw new Error(`${label} unexpectedly received marketplace data`);
}

function expectStatus(actual: number, expected: number[], label: string) {
  if (!expected.includes(actual)) {
    throw new Error(`${label} returned ${actual}; expected ${expected.join(" or ")}`);
  }
}

function machineHeaders(input: {
  token: string;
  organizationId: string;
  projectKey: string;
  requestId: string;
  timestamp: string;
}) {
  return {
    authorization: `Bearer ${input.token}`,
    accept: "application/json",
    "x-loopgraph-organization-id": input.organizationId,
    "x-loopgraph-project-key": input.projectKey,
    "x-loopgraph-request-id": input.requestId,
    "x-loopgraph-timestamp": input.timestamp
  };
}

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

async function tokenFromFile(name: string) {
  return readProjectedWorkloadTokenFile(required(name), name);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; marketplace staging cannot pass without it`);
  return value;
}

async function main() {
  const receipt = await validateHostedMarketplaceStaging({
    baseUrl: process.env.LOOPGRAPH_STAGING_MARKETPLACE_URL?.trim() || required("LOOPGRAPH_STAGING_URL"),
    audience: required("LOOPGRAPH_STAGING_MARKETPLACE_AUDIENCE"),
    organizationId: required("LOOPGRAPH_STAGING_MARKETPLACE_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_MARKETPLACE_PROJECT_KEY"),
    appId: required("LOOPGRAPH_STAGING_MARKETPLACE_APP_ID"),
    version: required("LOOPGRAPH_STAGING_MARKETPLACE_APP_VERSION"),
    artifactDigest: required("LOOPGRAPH_STAGING_MARKETPLACE_ARTIFACT_DIGEST")
  }, {
    allowed: await tokenFromFile("LOOPGRAPH_STAGING_MARKETPLACE_ALLOWED_TOKEN_FILE"),
    foreignTenant: await tokenFromFile("LOOPGRAPH_STAGING_MARKETPLACE_FOREIGN_TOKEN_FILE"),
    revoked: await tokenFromFile("LOOPGRAPH_STAGING_MARKETPLACE_REVOKED_TOKEN_FILE"),
    observability: await tokenFromFile("LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE")
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
