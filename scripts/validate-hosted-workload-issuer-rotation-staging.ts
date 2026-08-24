import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { canonicalJson, sha256Digest } from "./audit-retention-protocol";
import { readBoundedResponseJson } from "./bounded-response";
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
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const MAXIMUM_JWKS_KEYS = 100;
const MARKETPLACE_CAPABILITY = "marketplace.consume";

const controllerReceiptSchema = z.object({
  schemaVersion: z.literal("loopgraph-issuer-rotation-controller-receipt/v1"),
  receiptId: z.string().regex(ROTATION_ID_PATTERN),
  rotationId: z.string().regex(ROTATION_ID_PATTERN),
  issuer: z.string().url(),
  operation: z.enum(["publish_overlap", "retire_previous"]),
  previousKid: z.string().regex(KEY_ID_PATTERN),
  nextKid: z.string().regex(KEY_ID_PATTERN),
  changed: z.literal(true),
  completedAt: z.string().datetime({ offset: true })
}).strict();

const catalogResponseSchema = z.object({
  schemaVersion: z.literal("hosted-marketplace-machine-search/v1"),
  query: z.record(z.string(), z.unknown()),
  results: z.array(z.unknown()).max(100)
}).passthrough();

type RotationOperation = "publish_overlap" | "retire_previous";

export type HostedWorkloadIssuerRotationConfig = {
  primaryUrl: string;
  replicaUrl: string;
  audience: string;
  organizationId: string;
  projectKey: string;
  issuer: string;
  jwksUri: string;
  controllerUrl: string;
  rotationId: string;
  previousKid: string;
  nextKid: string;
  maximumPropagationSeconds?: number;
  retirementCacheGraceSeconds?: number;
};

export type HostedWorkloadIssuerRotationCredentials = {
  previousToken: string;
  nextToken: string;
  controllerToken: string;
  observabilityToken: string;
};

export type HostedWorkloadIssuerRotationReceipt = {
  schemaVersion: "hosted-workload-issuer-rotation-staging-validation/v1";
  primaryOrigin: string;
  replicaOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  durationMs: number;
  issuer: string;
  jwksUri: string;
  rotation: {
    rotationId: string;
    previousKid: string;
    nextKid: string;
    overlapReceiptDigest: string;
    retirementReceiptDigest: string;
  };
  auditEvidence: {
    afterSequence: number;
    throughSequence: number;
    headHash: string;
    requestId: string;
  };
  checks: Array<{
    name:
      | "pre_rotation_jwks"
      | "previous_key_cross_replica_acceptance"
      | "overlap_published"
      | "next_key_cross_replica_acceptance"
      | "previous_key_retired"
      | "previous_key_cross_replica_denial"
      | "next_key_post_retirement_acceptance"
      | "independent_audit_evidence";
    ok: true;
    status: number;
    detail: string;
  }>;
};

export async function validateHostedWorkloadIssuerRotationStaging(
  config: HostedWorkloadIssuerRotationConfig,
  credentials: HostedWorkloadIssuerRotationCredentials,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
    wait?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<HostedWorkloadIssuerRotationReceipt> {
  const startedAt = Date.now();
  const primary = trustedOrigin(config.primaryUrl, "Issuer rotation primary URL");
  const replica = trustedOrigin(config.replicaUrl, "Issuer rotation replica URL");
  if (primary.origin === replica.origin) {
    throw new Error("Issuer rotation staging requires a distinct replica origin");
  }
  const issuer = trustedOrigin(config.issuer, "Workload issuer");
  const jwksUri = trustedHttpsUrl(config.jwksUri, "Workload JWKS URI");
  const controllerUrl = trustedHttpsUrl(config.controllerUrl, "Issuer rotation controller URL");
  validateConfig(config, issuer, jwksUri);
  validateProjectedWorkloadToken(
    credentials.controllerToken,
    "Issuer rotation controller token"
  );
  validateProjectedWorkloadToken(
    credentials.observabilityToken,
    "Issuer rotation observability token"
  );
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? randomUUID;
  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  validateRotationWorkloadToken(credentials.previousToken, {
    label: "Previous-key workload token",
    issuer: issuer.origin,
    audience: config.audience,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    kid: config.previousKid,
    now: now()
  });
  validateRotationWorkloadToken(credentials.nextToken, {
    label: "Next-key workload token",
    issuer: issuer.origin,
    audience: config.audience,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    kid: config.nextKid,
    now: now()
  });

  const checks: HostedWorkloadIssuerRotationReceipt["checks"] = [];
  const initialKeys = await readJwksKeyIds(fetcher, jwksUri);
  requireKeyState(initialKeys, [config.previousKid], [config.nextKid], "pre-rotation JWKS");
  checks.push({
    name: "pre_rotation_jwks",
    ok: true,
    status: 200,
    detail: "The live JWKS contains exactly one usable previous key and not the next key."
  });

  const auditAfter = await readStagingAuditCheckpoint({
    baseUrl: primary,
    fetcher,
    token: credentials.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    requestId: `issuer_rotation_checkpoint_${requestId()}`,
    timestamp: now().toISOString(),
    label: "Workload issuer rotation staging"
  });

  await Promise.all([
    catalogRequest({
      baseUrl: primary,
      token: credentials.previousToken,
      config,
      fetcher,
      requestId: `issuer_previous_primary_${requestId()}`,
      timestamp: now().toISOString(),
      expectedStatuses: [200],
      label: "Previous key at primary"
    }),
    catalogRequest({
      baseUrl: replica,
      token: credentials.previousToken,
      config,
      fetcher,
      requestId: `issuer_previous_replica_${requestId()}`,
      timestamp: now().toISOString(),
      expectedStatuses: [200],
      label: "Previous key at replica"
    })
  ]);
  checks.push({
    name: "previous_key_cross_replica_acceptance",
    ok: true,
    status: 200,
    detail: "Both deployed origins accepted the previous key before rotation."
  });

  const overlapReceipt = await changeIssuerKeys({
    controllerUrl,
    issuer: issuer.origin,
    operation: "publish_overlap",
    config,
    token: credentials.controllerToken,
    fetcher,
    requestId: `issuer_overlap_${requestId()}`
  });
  await waitForKeyState({
    fetcher,
    jwksUri,
    required: [config.previousKid, config.nextKid],
    forbidden: [],
    maximumPropagationSeconds: config.maximumPropagationSeconds ?? 120,
    wait
  });
  checks.push({
    name: "overlap_published",
    ok: true,
    status: 200,
    detail: "The rotation controller published an observable old/new overlap set."
  });

  await Promise.all([
    catalogRequest({
      baseUrl: primary,
      token: credentials.nextToken,
      config,
      fetcher,
      requestId: `issuer_next_primary_${requestId()}`,
      timestamp: now().toISOString(),
      expectedStatuses: [200],
      label: "Next key at primary"
    }),
    catalogRequest({
      baseUrl: replica,
      token: credentials.nextToken,
      config,
      fetcher,
      requestId: `issuer_next_replica_${requestId()}`,
      timestamp: now().toISOString(),
      expectedStatuses: [200],
      label: "Next key at replica"
    })
  ]);
  checks.push({
    name: "next_key_cross_replica_acceptance",
    ok: true,
    status: 200,
    detail: "Both origins accepted the next key before their cached JWKS TTL expired."
  });

  const retirementReceipt = await changeIssuerKeys({
    controllerUrl,
    issuer: issuer.origin,
    operation: "retire_previous",
    config,
    token: credentials.controllerToken,
    fetcher,
    requestId: `issuer_retirement_${requestId()}`
  });
  await waitForKeyState({
    fetcher,
    jwksUri,
    required: [config.nextKid],
    forbidden: [config.previousKid],
    maximumPropagationSeconds: config.maximumPropagationSeconds ?? 120,
    wait
  });
  checks.push({
    name: "previous_key_retired",
    ok: true,
    status: 200,
    detail: "The live JWKS retained the next key and removed the previous key."
  });

  // The deployed verifier caps even a provider-advertised long JWKS TTL at five minutes. Waiting
  // beyond that bound proves retirement, rather than merely proving new-key miss refresh behavior.
  await wait((config.retirementCacheGraceSeconds ?? 305) * 1_000);

  await Promise.all([
    catalogRequest({
      baseUrl: primary,
      token: credentials.previousToken,
      config,
      fetcher,
      requestId: `issuer_retired_primary_${requestId()}`,
      timestamp: now().toISOString(),
      expectedStatuses: [401],
      label: "Retired key at primary"
    }),
    catalogRequest({
      baseUrl: replica,
      token: credentials.previousToken,
      config,
      fetcher,
      requestId: `issuer_retired_replica_${requestId()}`,
      timestamp: now().toISOString(),
      expectedStatuses: [401],
      label: "Retired key at replica"
    })
  ]);
  checks.push({
    name: "previous_key_cross_replica_denial",
    ok: true,
    status: 401,
    detail: "Both origins rejected the retired key after observing the overlap transition."
  });

  const finalRequestId = `issuer_final_primary_${requestId()}`;
  await Promise.all([
    catalogRequest({
      baseUrl: primary,
      token: credentials.nextToken,
      config,
      fetcher,
      requestId: finalRequestId,
      timestamp: now().toISOString(),
      expectedStatuses: [200],
      label: "Next key after retirement at primary"
    }),
    catalogRequest({
      baseUrl: replica,
      token: credentials.nextToken,
      config,
      fetcher,
      requestId: `issuer_final_replica_${requestId()}`,
      timestamp: now().toISOString(),
      expectedStatuses: [200],
      label: "Next key after retirement at replica"
    })
  ]);
  checks.push({
    name: "next_key_post_retirement_acceptance",
    ok: true,
    status: 200,
    detail: "Both origins kept accepting the next key after retirement completed."
  });

  const auditEvidence = await findAuthorizedMachineRequestAuditEvidence({
    baseUrl: primary,
    fetcher,
    token: credentials.observabilityToken,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    targetRequestId: finalRequestId,
    capability: MARKETPLACE_CAPABILITY,
    afterSequence: auditAfter,
    requestId,
    now,
    requestIdPrefix: "issuer_rotation_audit",
    label: "Workload issuer rotation staging"
  });
  checks.push({
    name: "independent_audit_evidence",
    ok: true,
    status: auditEvidence.status,
    detail: "The verified tenant audit chain contains a post-retirement next-key request."
  });

  return {
    schemaVersion: "hosted-workload-issuer-rotation-staging-validation/v1",
    primaryOrigin: primary.origin,
    replicaOrigin: replica.origin,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    checkedAt: now().toISOString(),
    durationMs: Date.now() - startedAt,
    issuer: issuer.origin,
    jwksUri: jwksUri.href,
    rotation: {
      rotationId: config.rotationId,
      previousKid: config.previousKid,
      nextKid: config.nextKid,
      overlapReceiptDigest: sha256Digest(canonicalJson(overlapReceipt)),
      retirementReceiptDigest: sha256Digest(canonicalJson(retirementReceipt))
    },
    auditEvidence: {
      afterSequence: auditEvidence.afterSequence,
      throughSequence: auditEvidence.throughSequence,
      headHash: auditEvidence.headHash,
      requestId: finalRequestId
    },
    checks
  };
}

async function catalogRequest(input: {
  baseUrl: URL;
  token: string;
  config: HostedWorkloadIssuerRotationConfig;
  fetcher: typeof fetch;
  requestId: string;
  timestamp: string;
  expectedStatuses: number[];
  label: string;
}) {
  const url = new URL("api/marketplace/client/catalog?limit=1", trailingSlash(input.baseUrl));
  const response = await input.fetcher(url, {
    headers: machineHeaders({
      token: input.token,
      organizationId: input.config.organizationId,
      projectKey: input.config.projectKey,
      requestId: input.requestId,
      timestamp: input.timestamp
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(response.status, input.expectedStatuses, input.label);
  if (response.status === 200) {
    catalogResponseSchema.parse(await readBoundedResponseJson(
      response,
      4 * 1024 * 1024,
      `${input.label} catalog response`
    ));
  }
}

async function changeIssuerKeys(input: {
  controllerUrl: URL;
  issuer: string;
  operation: RotationOperation;
  config: HostedWorkloadIssuerRotationConfig;
  token: string;
  fetcher: typeof fetch;
  requestId: string;
}) {
  const response = await input.fetcher(input.controllerUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: "application/json",
      "content-type": "application/json",
      "x-loopgraph-request-id": input.requestId
    },
    body: JSON.stringify({
      schemaVersion: "loopgraph-issuer-rotation-controller-request/v1",
      rotationId: input.config.rotationId,
      issuer: input.issuer,
      operation: input.operation,
      previousKid: input.config.previousKid,
      nextKid: input.config.nextKid
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  expectStatus(response.status, [200], `Issuer rotation controller ${input.operation}`);
  const receipt = controllerReceiptSchema.parse(await readBoundedResponseJson(
    response,
    64 * 1024,
    `Issuer rotation controller ${input.operation} receipt`
  ));
  if (
    receipt.rotationId !== input.config.rotationId ||
    receipt.issuer !== input.issuer ||
    receipt.operation !== input.operation ||
    receipt.previousKid !== input.config.previousKid ||
    receipt.nextKid !== input.config.nextKid
  ) {
    throw new Error("Issuer rotation controller receipt changed the protected rotation scope");
  }
  return receipt;
}

async function waitForKeyState(input: {
  fetcher: typeof fetch;
  jwksUri: URL;
  required: string[];
  forbidden: string[];
  maximumPropagationSeconds: number;
  wait: (milliseconds: number) => Promise<void>;
}) {
  const attempts = Math.max(1, Math.ceil(input.maximumPropagationSeconds / 2));
  let last: Set<string> | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await readJwksKeyIds(input.fetcher, input.jwksUri);
    if (
      input.required.every((kid) => last?.has(kid)) &&
      input.forbidden.every((kid) => !last?.has(kid))
    ) return;
    if (attempt + 1 < attempts) await input.wait(2_000);
  }
  throw new Error(
    `Issuer JWKS did not reach the required bounded rotation state; observed ${last?.size ?? 0} key IDs`
  );
}

async function readJwksKeyIds(fetcher: typeof fetch, jwksUri: URL) {
  const response = await fetcher(jwksUri, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  expectStatus(response.status, [200], "Live issuer JWKS");
  const value = await readBoundedResponseJson(response, 1024 * 1024, "Live issuer JWKS");
  if (!isRecord(value) || !Array.isArray(value.keys) || value.keys.length > MAXIMUM_JWKS_KEYS) {
    throw new Error("Live issuer JWKS is malformed or exceeds the bounded key count");
  }
  const ids = new Set<string>();
  for (const key of value.keys) {
    if (!isRecord(key) || typeof key.kid !== "string" || !KEY_ID_PATTERN.test(key.kid)) {
      throw new Error("Live issuer JWKS contains an invalid key identity");
    }
    if (key.use !== undefined && key.use !== "sig") continue;
    if (key.alg !== undefined && key.alg !== "RS256" && key.alg !== "ES256") continue;
    if (ids.has(key.kid)) throw new Error("Live issuer JWKS contains duplicate usable key IDs");
    ids.add(key.kid);
  }
  return ids;
}

function requireKeyState(
  ids: Set<string>,
  required: string[],
  forbidden: string[],
  label: string
) {
  if (
    required.some((kid) => !ids.has(kid)) ||
    forbidden.some((kid) => ids.has(kid))
  ) {
    throw new Error(`${label} does not match the protected previous/next key state`);
  }
}

function validateRotationWorkloadToken(token: string, expected: {
  label: string;
  issuer: string;
  audience: string;
  organizationId: string;
  projectKey: string;
  kid: string;
  now: Date;
}) {
  validateProjectedWorkloadToken(token, expected.label);
  const segments = token.split(".");
  const header = parseJwtSegment(segments[0]!, `${expected.label} header`);
  const claims = parseJwtSegment(segments[1]!, `${expected.label} claims`);
  const audience = Array.isArray(claims.aud)
    ? claims.aud.filter((item): item is string => typeof item === "string")
    : typeof claims.aud === "string" ? [claims.aud] : [];
  const capabilities = Array.isArray(claims.capabilities)
    ? claims.capabilities.filter((item): item is string => typeof item === "string")
    : typeof claims.scope === "string" ? claims.scope.split(/[ ,]+/).filter(Boolean) : [];
  if (
    header.kid !== expected.kid ||
    !["RS256", "ES256"].includes(String(header.alg)) ||
    claims.iss !== expected.issuer ||
    !audience.includes(expected.audience) ||
    claims.organization_id !== expected.organizationId ||
    claims.project_key !== expected.projectKey ||
    !capabilities.includes(MARKETPLACE_CAPABILITY) ||
    typeof claims.jti !== "string" || claims.jti.length < 8 ||
    typeof claims.exp !== "number" ||
    claims.exp * 1_000 < expected.now.getTime() + 120_000
  ) {
    throw new Error(`${expected.label} does not match the exact rotation scope or lifetime`);
  }
}

function parseJwtSegment(segment: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new Error(`${label} is malformed`);
  }
}

function validateConfig(
  config: HostedWorkloadIssuerRotationConfig,
  issuer: URL,
  jwksUri: URL
) {
  if (!config.audience.trim() || config.audience.length > 512) {
    throw new Error("Issuer rotation audience is invalid");
  }
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("Issuer rotation organization ID is invalid");
  }
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) {
    throw new Error("Issuer rotation project key is invalid");
  }
  if (!ROTATION_ID_PATTERN.test(config.rotationId)) {
    throw new Error("Issuer rotation ID is invalid");
  }
  if (
    !KEY_ID_PATTERN.test(config.previousKid) ||
    !KEY_ID_PATTERN.test(config.nextKid) ||
    config.previousKid === config.nextKid
  ) {
    throw new Error("Issuer rotation requires distinct bounded previous and next key IDs");
  }
  if (jwksUri.origin !== issuer.origin) {
    throw new Error("Issuer rotation JWKS must share the exact trusted issuer origin");
  }
  const propagation = config.maximumPropagationSeconds ?? 120;
  if (!Number.isInteger(propagation) || propagation < 2 || propagation > 600) {
    throw new Error("Issuer rotation propagation window must be an integer from 2 to 600 seconds");
  }
  const retirementGrace = config.retirementCacheGraceSeconds ?? 305;
  if (!Number.isInteger(retirementGrace) || retirementGrace < 301 || retirementGrace > 600) {
    throw new Error("Issuer rotation retirement cache grace must be an integer from 301 to 600 seconds");
  }
}

function trustedOrigin(value: string, label: string) {
  const url = trustedHttpsUrl(value, label);
  if (url.pathname !== "/") throw new Error(`${label} must be one exact origin`);
  return url;
}

function trustedHttpsUrl(value: string, label: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash
  ) {
    throw new Error(`${label} must use HTTPS without credentials, query, or fragment state`);
  }
  return url;
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

function trailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function expectStatus(actual: number, expected: number[], label: string) {
  if (!expected.includes(actual)) {
    throw new Error(`${label} returned ${actual}; expected ${expected.join(" or ")}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; issuer rotation staging cannot pass without it`);
  return value;
}

async function tokenFromFile(name: string) {
  return readProjectedWorkloadTokenFile(required(name), name);
}

async function main() {
  const receipt = await validateHostedWorkloadIssuerRotationStaging({
    primaryUrl: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_PRIMARY_URL"),
    replicaUrl: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_REPLICA_URL"),
    audience: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_AUDIENCE"),
    organizationId: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_PROJECT_KEY"),
    issuer: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_ISSUER"),
    jwksUri: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_JWKS_URI"),
    controllerUrl: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_CONTROLLER_URL"),
    rotationId: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_ID"),
    previousKid: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_PREVIOUS_KID"),
    nextKid: required("LOOPGRAPH_STAGING_ISSUER_ROTATION_NEXT_KID"),
    maximumPropagationSeconds: Number(
      process.env.LOOPGRAPH_STAGING_ISSUER_ROTATION_MAX_PROPAGATION_SECONDS?.trim() || "120"
    ),
    retirementCacheGraceSeconds: Number(
      process.env.LOOPGRAPH_STAGING_ISSUER_ROTATION_RETIREMENT_GRACE_SECONDS?.trim() || "305"
    )
  }, {
    previousToken: await tokenFromFile("LOOPGRAPH_STAGING_ISSUER_ROTATION_PREVIOUS_TOKEN_FILE"),
    nextToken: await tokenFromFile("LOOPGRAPH_STAGING_ISSUER_ROTATION_NEXT_TOKEN_FILE"),
    controllerToken: await tokenFromFile("LOOPGRAPH_STAGING_ISSUER_ROTATION_CONTROLLER_TOKEN_FILE"),
    observabilityToken: await tokenFromFile("LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE")
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
