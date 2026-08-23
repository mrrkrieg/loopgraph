import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readBoundedResponseJson, readBoundedResponseText } from "./bounded-response";
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
const FOREIGN_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const HEALTH_SCHEMA_VERSION = "loopgraph-hosted-app-evidence-health/v1alpha1";
const RECEIPT_SCHEMA_VERSION = "hosted-app-evidence-health-staging-validation/v2";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const COUNT_NAMES = [
  "invalid",
  "expired",
  "renewSoon",
  "incomplete",
  "current",
  "notApplicable"
] as const;

const METRIC_NAMES = {
  health: "loopgraph_app_evidence_health",
  totalInstallations: "loopgraph_app_evidence_installations_total",
  invalid: "loopgraph_app_evidence_invalid",
  expired: "loopgraph_app_evidence_expired",
  renewSoon: "loopgraph_app_evidence_renew_soon",
  incomplete: "loopgraph_app_evidence_incomplete",
  current: "loopgraph_app_evidence_current",
  notApplicable: "loopgraph_app_evidence_not_applicable",
  itemsReturned: "loopgraph_app_evidence_items_returned",
  truncated: "loopgraph_app_evidence_plan_truncated"
} as const;

type AppEvidenceCounts = Record<(typeof COUNT_NAMES)[number], number>;

export type HostedAppEvidenceHealthStagingConfig = {
  baseUrl: string;
  organizationId: string;
  projectKey: string;
};

export type HostedAppEvidenceHealthStagingTokens = {
  schedule: string;
  observability: string;
};

export type HostedAppEvidenceHealthStagingReceipt = {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  targetOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  durationMs: number;
  auditEvidence: {
    afterSequence: number;
    throughSequence: number;
    headHash: string;
    requestId: string;
  };
  projection: {
    generatedAt: string;
    health: "healthy" | "degraded" | "blocked";
    totalInstallations: number;
    totalMatched: number;
    itemsReturned: number;
    truncated: boolean;
    counts: AppEvidenceCounts;
  };
  metrics: {
    health: 0 | 1;
    totalInstallations: number;
    itemsReturned: number;
    truncated: 0 | 1;
    counts: AppEvidenceCounts;
  };
  checks: Array<{
    name:
      | "unauthenticated_denial"
      | "cross_tenant_denial"
      | "authorized_health_projection"
      | "replay_denial"
      | "aggregate_only_contract"
      | "metrics_projection_parity"
      | "independent_audit_evidence";
    ok: true;
    status?: number;
    detail: string;
  }>;
};

export async function validateHostedAppEvidenceHealthStaging(
  config: HostedAppEvidenceHealthStagingConfig,
  tokens: HostedAppEvidenceHealthStagingTokens,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
    nowMs?: () => number;
  } = {}
): Promise<HostedAppEvidenceHealthStagingReceipt> {
  const startedAt = (dependencies.nowMs ?? Date.now)();
  const baseUrl = trustedStagingOrigin(config.baseUrl);
  validateConfig(config);
  validateProjectedWorkloadToken(tokens.schedule, "App evidence schedule token");
  validateProjectedWorkloadToken(tokens.observability, "App evidence observability token");
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? (() => randomUUID());
  const checks: HostedAppEvidenceHealthStagingReceipt["checks"] = [];
  const scheduleUrl = new URL(
    "api/cron/app-evidence-health",
    ensureTrailingSlash(baseUrl)
  );
  const auditAfter = await readStagingAuditCheckpoint({
    baseUrl,
    fetcher,
    token: tokens.observability,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `app_evidence_checkpoint_${requestId()}`,
    timestamp: now().toISOString(),
    label: "App evidence health staging"
  });

  const unauthenticated = await fetcher(scheduleUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(unauthenticated.status, [401], "Unauthenticated App evidence schedule");
  checks.push({
    name: "unauthenticated_denial",
    ok: true,
    status: unauthenticated.status,
    detail: "The App evidence schedule fails closed without workload identity."
  });

  const crossTenant = await fetcher(scheduleUrl, {
    headers: machineHeaders({
      token: tokens.schedule,
      organizationId: foreignOrganization(config.organizationId),
      projectKey: config.projectKey,
      requestId: `app_evidence_cross_tenant_${requestId()}`,
      timestamp: now().toISOString()
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(crossTenant.status, [403], "Cross-tenant App evidence schedule");
  const crossTenantMetrics = await fetcher(
    new URL("api/operations/metrics", ensureTrailingSlash(baseUrl)),
    {
      headers: machineHeaders({
        token: tokens.observability,
        organizationId: foreignOrganization(config.organizationId),
        projectKey: config.projectKey,
        requestId: `app_evidence_cross_tenant_metrics_${requestId()}`,
        timestamp: now().toISOString()
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    }
  );
  expectStatus(crossTenantMetrics.status, [403], "Cross-tenant App evidence metrics");
  checks.push({
    name: "cross_tenant_denial",
    ok: true,
    status: crossTenant.status,
    detail: "Neither the schedule nor observability workload identity can request another tenant scope."
  });

  const acceptedRequestId = `app_evidence_health_${requestId()}`;
  const acceptedTimestamp = now().toISOString();
  const acceptedHeaders = machineHeaders({
    token: tokens.schedule,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: acceptedRequestId,
    timestamp: acceptedTimestamp
  });
  const accepted = await fetcher(scheduleUrl, {
    headers: acceptedHeaders,
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(accepted.status, [202], "Authorized App evidence schedule");
  requireNoStore(accepted, "Authorized App evidence schedule");
  const projection = parseProjection(
    await readBoundedResponseJson(accepted, 64 * 1024, "App evidence health projection"),
    config.projectKey,
    now()
  );
  checks.push({
    name: "authorized_health_projection",
    ok: true,
    status: accepted.status,
    detail: "The schedule returned one fresh tenant-scoped aggregate fleet projection."
  });

  const replay = await fetcher(scheduleUrl, {
    headers: acceptedHeaders,
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(replay.status, [403, 409], "Repeated App evidence schedule request");
  checks.push({
    name: "replay_denial",
    ok: true,
    status: replay.status,
    detail: "Reusing the accepted request identity is rejected before another schedule run."
  });

  checks.push({
    name: "aggregate_only_contract",
    ok: true,
    detail: "The strict response contract contains aggregate counts only, with no App, provider, credential, action, or payload details."
  });

  const metricsResponse = await fetcher(
    new URL("api/operations/metrics", ensureTrailingSlash(baseUrl)),
    {
      headers: machineHeaders({
        token: tokens.observability,
        organizationId: config.organizationId,
        projectKey: config.projectKey,
        requestId: `app_evidence_metrics_${requestId()}`,
        timestamp: now().toISOString()
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    }
  );
  expectStatus(metricsResponse.status, [200], "App evidence operational metrics");
  requireNoStore(metricsResponse, "App evidence operational metrics");
  const metrics = parseMetrics(await readBoundedResponseText(
    metricsResponse,
    4 * 1024 * 1024,
    "App evidence operational metrics"
  ));
  assertMetricParity(projection, metrics);
  checks.push({
    name: "metrics_projection_parity",
    ok: true,
    status: metricsResponse.status,
    detail: "Protected Prometheus gauges exactly match the accepted schedule projection."
  });

  const auditEvidence = await findAuthorizedMachineRequestAuditEvidence({
    baseUrl,
    fetcher,
    token: tokens.observability,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    targetRequestId: acceptedRequestId,
    capability: "schedule.app_evidence_health",
    afterSequence: auditAfter,
    requestId,
    now,
    requestIdPrefix: "app_evidence_audit",
    label: "App evidence health staging"
  });
  checks.push({
    name: "independent_audit_evidence",
    ok: true,
    status: auditEvidence.status,
    detail: "The verified tenant audit chain contains the accepted schedule.app_evidence_health request."
  });

  const checkedAt = now().toISOString();
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    targetOrigin: baseUrl.origin,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    checkedAt,
    durationMs: Math.max(0, (dependencies.nowMs ?? Date.now)() - startedAt),
    auditEvidence: {
      afterSequence: auditEvidence.afterSequence,
      throughSequence: auditEvidence.throughSequence,
      headHash: auditEvidence.headHash,
      requestId: auditEvidence.requestId
    },
    projection,
    metrics,
    checks
  };
}

function parseProjection(
  value: unknown,
  projectKey: string,
  now: Date
): HostedAppEvidenceHealthStagingReceipt["projection"] {
  const record = exactRecord(value, [
    "schemaVersion",
    "workspaceId",
    "generatedAt",
    "health",
    "totalInstallations",
    "totalMatched",
    "itemsReturned",
    "truncated",
    "counts"
  ], "App evidence health projection");
  if (record.schemaVersion !== HEALTH_SCHEMA_VERSION) {
    throw new Error("App evidence health projection used an unsupported schema");
  }
  if (record.workspaceId !== projectKey) {
    throw new Error("App evidence health projection crossed the requested workspace");
  }
  const generatedAt = requireDate(record.generatedAt, "App evidence generatedAt");
  if (Math.abs(now.getTime() - generatedAt.getTime()) > MAX_CLOCK_SKEW_MS) {
    throw new Error("App evidence health projection is stale or future-dated");
  }
  if (!["healthy", "degraded", "blocked"].includes(String(record.health))) {
    throw new Error("App evidence health projection returned an invalid health state");
  }
  const totalInstallations = nonnegativeInteger(record.totalInstallations, "totalInstallations");
  const totalMatched = nonnegativeInteger(record.totalMatched, "totalMatched");
  const itemsReturned = nonnegativeInteger(record.itemsReturned, "itemsReturned");
  if (totalMatched > totalInstallations || itemsReturned > totalMatched) {
    throw new Error("App evidence health projection returned inconsistent fleet totals");
  }
  if (typeof record.truncated !== "boolean" || record.truncated !== (itemsReturned < totalMatched)) {
    throw new Error("App evidence health projection returned an inconsistent truncation state");
  }
  const countRecord = exactRecord(record.counts, [...COUNT_NAMES], "App evidence counts");
  const counts = Object.fromEntries(COUNT_NAMES.map((name) => [
    name,
    nonnegativeInteger(countRecord[name], `counts.${name}`)
  ])) as AppEvidenceCounts;
  const countedInstallations = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(countedInstallations) || countedInstallations !== totalInstallations) {
    throw new Error("App evidence status counts do not cover the installed fleet exactly once");
  }
  const expectedHealth = counts.invalid > 0
    ? "blocked"
    : counts.expired > 0 || counts.renewSoon > 0
      ? "degraded"
      : "healthy";
  if (record.health !== expectedHealth) {
    throw new Error("App evidence health state does not match its aggregate counts");
  }
  return {
    generatedAt: generatedAt.toISOString(),
    health: expectedHealth,
    totalInstallations,
    totalMatched,
    itemsReturned,
    truncated: record.truncated,
    counts
  };
}

function parseMetrics(text: string): HostedAppEvidenceHealthStagingReceipt["metrics"] {
  const read = (name: string) => {
    const matches = [...text.matchAll(new RegExp(`^${name}\\s+([0-9]+)$`, "gm"))];
    if (matches.length !== 1) {
      throw new Error(`Operational metrics must contain exactly one unlabeled ${name} gauge`);
    }
    return nonnegativeInteger(Number(matches[0]![1]), name);
  };
  const counts = Object.fromEntries(COUNT_NAMES.map((name) => [
    name,
    read(METRIC_NAMES[name])
  ])) as AppEvidenceCounts;
  const health = read(METRIC_NAMES.health);
  const truncated = read(METRIC_NAMES.truncated);
  if ((health !== 0 && health !== 1) || (truncated !== 0 && truncated !== 1)) {
    throw new Error("App evidence health and truncation gauges must be binary");
  }
  return {
    health,
    totalInstallations: read(METRIC_NAMES.totalInstallations),
    itemsReturned: read(METRIC_NAMES.itemsReturned),
    truncated,
    counts
  };
}

function assertMetricParity(
  projection: HostedAppEvidenceHealthStagingReceipt["projection"],
  metrics: HostedAppEvidenceHealthStagingReceipt["metrics"]
) {
  const expectedHealth = projection.health === "healthy" ? 1 : 0;
  if (
    metrics.health !== expectedHealth ||
    metrics.totalInstallations !== projection.totalInstallations ||
    metrics.itemsReturned !== projection.itemsReturned ||
    metrics.truncated !== (projection.truncated ? 1 : 0) ||
    COUNT_NAMES.some((name) => metrics.counts[name] !== projection.counts[name])
  ) {
    throw new Error("App evidence operational metrics do not match the schedule projection");
  }
}

function exactRecord(value: unknown, keys: string[], label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contained fields outside its aggregate-only contract`);
  }
  return record;
}

function nonnegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  return value;
}

function requireDate(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO timestamp`);
  }
  return date;
}

function trustedStagingOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("App evidence staging URL must use HTTPS as one origin without credentials, path, query, or fragment state");
  }
  return url;
}

function validateConfig(config: HostedAppEvidenceHealthStagingConfig) {
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("App evidence staging organization ID is invalid");
  }
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) {
    throw new Error("App evidence staging project key is invalid");
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

function expectStatus(actual: number, expected: number[], label: string) {
  if (!expected.includes(actual)) {
    throw new Error(`${label} returned ${actual}; expected ${expected.join(" or ")}`);
  }
}

function requireNoStore(response: Response, label: string) {
  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (!cacheControl.split(",").some((directive) => directive.trim() === "no-store")) {
    throw new Error(`${label} must set cache-control: no-store`);
  }
}

function foreignOrganization(organizationId: string) {
  return organizationId.toLowerCase() === FOREIGN_ORGANIZATION_ID
    ? "00000000-0000-4000-8000-000000000002"
    : FOREIGN_ORGANIZATION_ID;
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
  if (!value) throw new Error(`${name} is required; App evidence staging cannot pass without it`);
  return value;
}

async function main() {
  const receipt = await validateHostedAppEvidenceHealthStaging({
    baseUrl: process.env.LOOPGRAPH_STAGING_APP_EVIDENCE_URL?.trim() || required("LOOPGRAPH_STAGING_URL"),
    organizationId: required("LOOPGRAPH_STAGING_APP_EVIDENCE_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_APP_EVIDENCE_PROJECT_KEY")
  }, {
    schedule: await tokenFromFile("LOOPGRAPH_STAGING_APP_EVIDENCE_SCHEDULE_TOKEN_FILE"),
    observability: await tokenFromFile("LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE")
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
