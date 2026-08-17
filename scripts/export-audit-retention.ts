import { randomUUID, type KeyObject } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  auditDrainReceiptSchema,
  auditExportPageSchema,
  canonicalJson,
  createRetentionBatch,
  parsePreviousDrainReceipt,
  readBoundedIntegrityFile,
  readRetentionPublicKey,
  sha256Digest,
  validateAuditPage,
  verifyRetentionAcknowledgement,
  writeAuditDrainReceiptState,
  type AuditDrainReceipt,
  type RetentionAcknowledgement
} from "./audit-retention-protocol";
import { readBoundedResponseJson } from "./bounded-response";
import { readProjectedWorkloadTokenFile } from "./projected-workload-token";

const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 10_000;

export type AuditRetentionConfig = {
  sourceUrl: string;
  destinationUrl: string;
  organizationId: string;
  projectKey: string;
  pageSize: number;
  minimumRetentionDays: number;
  acknowledgementKeyId: string;
  acknowledgementPublicKey: KeyObject;
  previousReceipt?: AuditDrainReceipt;
};

export type AuditRetentionTokens = {
  source: () => Promise<string>;
  destination: () => Promise<string>;
};

export async function drainAuditRetention(
  config: AuditRetentionConfig,
  tokens: AuditRetentionTokens,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => Date;
    requestId?: () => string;
  } = {}
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const requestId = dependencies.requestId ?? (() => randomUUID());
  const source = trustedEndpoint(config.sourceUrl, "Loopgraph audit source", true);
  const destination = trustedEndpoint(config.destinationUrl, "Audit retention destination", true);
  const retentionEndpoint = new URL("/v1/loopgraph/audit-retention", destination);
  if (source.origin === destination.origin) {
    throw new Error("Independent audit retention must use a different origin from Loopgraph");
  }
  if (!Number.isInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 500) {
    throw new Error("Audit retention page size must be an integer from 1 to 500");
  }
  if (
    !Number.isInteger(config.minimumRetentionDays) ||
    config.minimumRetentionDays < 1 ||
    config.minimumRetentionDays > 36_500
  ) {
    throw new Error("Minimum audit retention days must be an integer from 1 to 36500");
  }

  const startedAt = now();
  const previousReceipt = config.previousReceipt;
  let afterSequence = previousReceipt?.throughSequence ?? 0;
  const fromSequence = afterSequence;
  let throughSequence: number | undefined;
  let checkpointHeadHash: string | undefined;
  let previousEventHash = previousReceipt?.headHash ?? "0".repeat(64);
  let previousReceiptDigest = previousReceipt?.lastDestinationReceiptDigest ?? null;
  let lastAcknowledgement: RetentionAcknowledgement | null =
    previousReceipt?.lastDestinationAcknowledgement ?? null;
  let eventCount = 0;
  let batchCount = 0;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const pageUrl = new URL("api/operations/audit-export", ensureTrailingSlash(source));
    pageUrl.searchParams.set("after", String(afterSequence));
    pageUrl.searchParams.set("limit", String(config.pageSize));
    if (throughSequence !== undefined) {
      pageUrl.searchParams.set("through", String(throughSequence));
    }
    const requestedAt = now();
    const sourceResponse = await fetcher(pageUrl, {
      headers: machineHeaders({
        token: await tokens.source(),
        organizationId: config.organizationId,
        projectKey: config.projectKey,
        requestId: `audit_source_${requestId()}`,
        timestamp: requestedAt.toISOString()
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    });
    if (sourceResponse.status !== 200) {
      throw new Error(`Verified audit source rejected export with ${sourceResponse.status}`);
    }
    const parsedPage = auditExportPageSchema.parse(await readBoundedResponseJson(
      sourceResponse,
      MAX_PAGE_BYTES,
      "Verified audit export"
    ));
    const validated = validateAuditPage({
      value: parsedPage,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      afterSequence,
      ...(throughSequence === undefined ? {} : { throughSequence }),
      ...(checkpointHeadHash === undefined ? {} : { headHash: checkpointHeadHash }),
      previousEventHash
    });
    const page = validated.page;
    throughSequence ??= page.throughSequence;
    checkpointHeadHash ??= page.integrity.headHash;

    if (page.events.length > 0) {
      const batch = createRetentionBatch({
        sourceOrigin: source.origin,
        organizationId: config.organizationId,
        projectKey: config.projectKey,
        checkpoint: {
          headSequence: throughSequence,
          headHash: checkpointHeadHash
        },
        afterSequence,
        previousEventHash,
        previousReceiptDigest,
        events: page.events
      });
      const body = canonicalJson(batch);
      if (Buffer.byteLength(body) > MAX_PAGE_BYTES) {
        throw new Error("Audit retention batch exceeds 8 MiB; reduce LOOPGRAPH_AUDIT_PAGE_SIZE");
      }
      const payloadDigest = sha256Digest(body);
      const retentionResponse = await fetcher(retentionEndpoint, {
        method: "POST",
        headers: {
          ...machineHeaders({
            token: await tokens.destination(),
            organizationId: config.organizationId,
            projectKey: config.projectKey,
            requestId: batch.batchId,
            timestamp: now().toISOString()
          }),
          "content-type": "application/json",
          "x-loopgraph-audit-batch-id": batch.batchId,
          "x-loopgraph-payload-digest": payloadDigest
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(30_000)
      });
      if (![200, 201].includes(retentionResponse.status)) {
        throw new Error(
          `Independent audit retention target rejected batch with ${retentionResponse.status}`
        );
      }
      const verified = verifyRetentionAcknowledgement({
        value: await readBoundedResponseJson(
          retentionResponse,
          256 * 1024,
          "Audit retention acknowledgement"
        ),
        batch,
        payloadDigest,
        expectedKeyId: config.acknowledgementKeyId,
        publicKey: config.acknowledgementPublicKey,
        minimumRetentionDays: config.minimumRetentionDays,
        now: now(),
        previousAcknowledgement: lastAcknowledgement
      });
      previousReceiptDigest = verified.receiptDigest;
      lastAcknowledgement = verified.acknowledgement;
      eventCount += page.events.length;
      batchCount += 1;
    }

    previousEventHash = validated.lastEventHash;
    if (!page.hasMore) {
      const completedAt = now();
      return auditDrainReceiptSchema.parse({
        schemaVersion: "audit-drain/v2",
        organizationId: config.organizationId,
        projectKey: config.projectKey,
        sourceOrigin: source.origin,
        destinationOrigin: destination.origin,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        fromSequence,
        throughSequence,
        eventCount,
        batchCount,
        headHash: checkpointHeadHash,
        lastDestinationReceiptDigest: previousReceiptDigest,
        lastDestinationAcknowledgement: lastAcknowledgement
      });
    }
    if (page.nextCursor <= afterSequence) {
      throw new Error("Audit export cursor did not advance");
    }
    afterSequence = page.nextCursor;
  }
  throw new Error(`Audit retention exceeded the ${MAX_PAGES}-page safety bound`);
}

function trustedEndpoint(value: string, label: string, requireOriginOnly: boolean) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (requireOriginOnly && url.pathname !== "/")
  ) {
    throw new Error(
      `${label} must use HTTPS without credentials, query, fragment, or unexpected path state`
    );
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

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required; audit retention cannot silently fall back to local storage`);
  }
  return value;
}

function positiveInteger(name: string, fallback?: number) {
  const raw = process.env[name]?.trim();
  if (!raw && fallback !== undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function optionalPreviousReceipt(input: {
  file?: string;
  allowMissing: boolean;
  sourceOrigin: string;
  destinationOrigin: string;
  organizationId: string;
  projectKey: string;
  trustedPublicKeys: ReadonlyMap<string, KeyObject>;
  minimumRetentionDays: number;
  now: Date;
}) {
  const file = input.file;
  if (!file) return undefined;
  try {
    const value = JSON.parse(await readBoundedIntegrityFile(
      file,
      input.allowMissing
        ? "LOOPGRAPH_AUDIT_RECEIPT_STATE_FILE"
        : "LOOPGRAPH_AUDIT_PREVIOUS_RECEIPT_FILE"
    )) as unknown;
    return parsePreviousDrainReceipt({
      value,
      sourceOrigin: input.sourceOrigin,
      destinationOrigin: input.destinationOrigin,
      organizationId: input.organizationId,
      projectKey: input.projectKey,
      trustedPublicKeys: input.trustedPublicKeys,
      minimumRetentionDays: input.minimumRetentionDays,
      now: input.now
    });
  } catch (error) {
    if (input.allowMissing && isFileNotFound(error)) return undefined;
    throw error;
  }
}

async function main() {
  const sourceUrl = required("LOOPGRAPH_AUDIT_SOURCE_URL");
  const destinationUrl = required("LOOPGRAPH_AUDIT_RETENTION_URL");
  const source = trustedEndpoint(sourceUrl, "Loopgraph audit source", true);
  const destination = trustedEndpoint(destinationUrl, "Audit retention destination", true);
  const organizationId = required("LOOPGRAPH_AUDIT_ORGANIZATION_ID");
  const projectKey = required("LOOPGRAPH_AUDIT_PROJECT_KEY");
  const minimumRetentionDays = positiveInteger("LOOPGRAPH_AUDIT_MIN_RETENTION_DAYS");
  const acknowledgementKeyId = required("LOOPGRAPH_AUDIT_RETENTION_KEY_ID");
  const acknowledgementPublicKey = await readRetentionPublicKey(
    required("LOOPGRAPH_AUDIT_RETENTION_PUBLIC_KEY_FILE")
  );
  const trustedPublicKeys = new Map<string, KeyObject>([
    [acknowledgementKeyId, acknowledgementPublicKey]
  ]);
  const previousKeyId = process.env.LOOPGRAPH_AUDIT_RETENTION_PREVIOUS_KEY_ID?.trim();
  const previousKeyFile = process.env.LOOPGRAPH_AUDIT_RETENTION_PREVIOUS_PUBLIC_KEY_FILE?.trim();
  if (Boolean(previousKeyId) !== Boolean(previousKeyFile)) {
    throw new Error(
      "Set both LOOPGRAPH_AUDIT_RETENTION_PREVIOUS_KEY_ID and LOOPGRAPH_AUDIT_RETENTION_PREVIOUS_PUBLIC_KEY_FILE during key rotation"
    );
  }
  if (previousKeyId && previousKeyFile) {
    if (previousKeyId === acknowledgementKeyId) {
      throw new Error("Previous audit retention key ID must differ from the active key ID");
    }
    trustedPublicKeys.set(previousKeyId, await readRetentionPublicKey(
      previousKeyFile,
      "LOOPGRAPH_AUDIT_RETENTION_PREVIOUS_PUBLIC_KEY_FILE"
    ));
  }
  const sourceTokenFile = required("LOOPGRAPH_AUDIT_SOURCE_TOKEN_FILE");
  const destinationTokenFile = required("LOOPGRAPH_AUDIT_RETENTION_TOKEN_FILE");
  const stateFile = process.env.LOOPGRAPH_AUDIT_RECEIPT_STATE_FILE?.trim();
  const legacyPreviousReceiptFile = process.env.LOOPGRAPH_AUDIT_PREVIOUS_RECEIPT_FILE?.trim();
  if (stateFile && legacyPreviousReceiptFile) {
    throw new Error(
      "Use LOOPGRAPH_AUDIT_RECEIPT_STATE_FILE instead of also setting LOOPGRAPH_AUDIT_PREVIOUS_RECEIPT_FILE"
    );
  }
  const receipt = await drainAuditRetention({
    sourceUrl,
    destinationUrl,
    organizationId,
    projectKey,
    pageSize: positiveInteger("LOOPGRAPH_AUDIT_PAGE_SIZE", 100),
    minimumRetentionDays,
    acknowledgementKeyId,
    acknowledgementPublicKey,
    previousReceipt: await optionalPreviousReceipt({
      file: stateFile ?? legacyPreviousReceiptFile,
      allowMissing: Boolean(stateFile),
      sourceOrigin: source.origin,
      destinationOrigin: destination.origin,
      organizationId,
      projectKey,
      trustedPublicKeys,
      minimumRetentionDays,
      now: new Date()
    })
  }, {
    source: () => readProjectedWorkloadTokenFile(
      sourceTokenFile,
      "LOOPGRAPH_AUDIT_SOURCE_TOKEN_FILE"
    ),
    destination: () => readProjectedWorkloadTokenFile(
      destinationTokenFile,
      "LOOPGRAPH_AUDIT_RETENTION_TOKEN_FILE"
    )
  });
  if (stateFile) {
    await writeAuditDrainReceiptState(stateFile, receipt);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
