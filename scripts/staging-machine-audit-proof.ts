import { readBoundedResponseJson, readBoundedResponseText } from "./bounded-response";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export type StagingMachineAuditEvidence = {
  status: number;
  afterSequence: number;
  throughSequence: number;
  headHash: string;
  requestId: string;
};

export async function readStagingAuditCheckpoint(input: {
  baseUrl: URL;
  fetcher: typeof fetch;
  token: string;
  organizationId: string;
  projectKey: string;
  requestId: string;
  timestamp: string;
  label: string;
}) {
  const response = await input.fetcher(
    new URL("api/operations/metrics", ensureTrailingSlash(input.baseUrl)),
    {
      headers: machineHeaders(input),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    }
  );
  expectStatus(response.status, [200], `${input.label} audit checkpoint metrics`);
  const metrics = await readBoundedResponseText(
    response,
    4 * 1024 * 1024,
    `${input.label} audit checkpoint metrics`
  );
  const matches = [
    ...metrics.matchAll(/^loopgraph_security_audit_head_sequence\s+(\d+)$/gm)
  ];
  const checkpoint = matches.length === 1 ? Number(matches[0]![1]) : Number.NaN;
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) {
    throw new Error(`${input.label} audit checkpoint metric is missing or invalid`);
  }
  return checkpoint;
}

export async function findAuthorizedMachineRequestAuditEvidence(input: {
  baseUrl: URL;
  fetcher: typeof fetch;
  token: string;
  organizationId: string;
  projectKey: string;
  targetRequestId: string;
  capability: string;
  afterSequence: number;
  requestId: () => string;
  now: () => Date;
  requestIdPrefix: string;
  label: string;
}): Promise<StagingMachineAuditEvidence> {
  let after = input.afterSequence;
  let through: number | undefined;
  let checkpointHash: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const auditUrl = new URL("api/operations/audit-export", ensureTrailingSlash(input.baseUrl));
    auditUrl.searchParams.set("after", String(after));
    auditUrl.searchParams.set("limit", "500");
    if (through !== undefined) auditUrl.searchParams.set("through", String(through));
    const response = await input.fetcher(auditUrl, {
      headers: machineHeaders({
        token: input.token,
        organizationId: input.organizationId,
        projectKey: input.projectKey,
        requestId: `${input.requestIdPrefix}_${input.requestId()}`,
        timestamp: input.now().toISOString()
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    expectStatus(response.status, [200], `${input.label} verified audit export`);
    const audit = await readBoundedResponseJson(
      response,
      4 * 1024 * 1024,
      `${input.label} audit export`
    );
    if (!isRecord(audit) || !isRecord(audit.integrity) || audit.integrity.valid !== true) {
      throw new Error(`${input.label} audit export did not verify its hash chain`);
    }
    if (
      audit.schemaVersion !== "loopgraph-security-audit-export/v2" ||
      audit.organizationId !== input.organizationId ||
      audit.projectKey !== input.projectKey ||
      Number(audit.afterSequence) !== after
    ) {
      throw new Error(`${input.label} audit export crossed its requested tenant or cursor scope`);
    }
    const pageThrough = Number(audit.throughSequence);
    const pageHeadHash = audit.integrity.headHash;
    if (
      !Number.isSafeInteger(pageThrough) || pageThrough < input.afterSequence ||
      typeof pageHeadHash !== "string" || !HASH_PATTERN.test(pageHeadHash) ||
      (through !== undefined && pageThrough !== through) ||
      (checkpointHash !== undefined && pageHeadHash !== checkpointHash)
    ) {
      throw new Error(`${input.label} audit pagination changed its verified checkpoint`);
    }
    through ??= pageThrough;
    checkpointHash ??= pageHeadHash;
    const events = Array.isArray(audit.events) ? audit.events : [];
    if (events.some((event) =>
      isRecord(event) &&
      event.event_type === "machine.request.authorized" &&
      event.capability === input.capability &&
      event.request_id === input.targetRequestId
    )) {
      return {
        status: response.status,
        afterSequence: input.afterSequence,
        throughSequence: through,
        headHash: checkpointHash,
        requestId: input.targetRequestId
      };
    }
    if (audit.hasMore !== true) break;
    const nextCursor = Number(audit.nextCursor);
    if (!Number.isSafeInteger(nextCursor) || nextCursor <= after || nextCursor > through) {
      throw new Error(`${input.label} audit pagination did not advance within its checkpoint`);
    }
    after = nextCursor;
  }
  throw new Error(`${input.label} audit export omitted the accepted machine request`);
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

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
