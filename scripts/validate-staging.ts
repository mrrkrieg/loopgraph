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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type StagingDeploymentReceipt = {
  schemaVersion: "staging-validation/v3";
  targetOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  auditCheckpoint: {
    headSequence: number;
    headHash: string;
  };
  results: Array<{
    name: "readiness" | "operational_metrics" | "audit_integrity";
    status: number;
    ok: true;
    detail: string;
  }>;
};

export async function validateStagingDeployment(
  config: {
    baseUrl: string;
    organizationId: string;
    projectKey: string;
    observabilityToken: string;
  },
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
  } = {}
): Promise<StagingDeploymentReceipt> {
  const baseUrl = trustedStagingOrigin(config.baseUrl);
  if (!UUID_PATTERN.test(config.organizationId)) throw new Error("Staging organization ID is invalid");
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) throw new Error("Staging project key is invalid");
  validateProjectedWorkloadToken(config.observabilityToken, "Staging observability token");
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? (() => randomUUID());

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
    "loopgraph_security_audit_head_sequence"
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

  return {
    schemaVersion: "staging-validation/v3",
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
      }
    ]
  };
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
  const receipt = await validateStagingDeployment({
    baseUrl: required("LOOPGRAPH_STAGING_URL"),
    organizationId: required("LOOPGRAPH_STAGING_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_PROJECT_KEY"),
    observabilityToken: await readProjectedWorkloadTokenFile(
      tokenFile,
      "LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE"
    )
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
