import { randomUUID, type KeyObject } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  auditDrainReceiptSchema,
  auditExportPageSchema,
  canonicalJson,
  createRetentionBatch,
  parsePreviousDrainReceipt,
  readBoundedIntegrityFile,
  readRetentionPublicKey,
  releaseAuditCheckpointSetSchema,
  sha256Digest,
  validateAuditPage,
  verifyRetentionAcknowledgement,
  writeAuditDrainReceiptState,
  type AuditDrainReceipt,
  type ReleaseAuditCheckpoint,
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
  releaseCheckpoints: ReleaseAuditCheckpoint[];
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
  const releaseCheckpoints = releaseAuditCheckpointSetSchema.parse(config.releaseCheckpoints);

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
  const verifiedReleaseCheckpoints = new Map<string, ReleaseAuditCheckpoint>();
  for (const checkpoint of releaseCheckpoints) {
    if (checkpoint.sequence < fromSequence) {
      throw new Error(
        `Release audit checkpoint ${checkpoint.name} precedes the retained audit state and cannot be independently verified`
      );
    }
    if (checkpoint.sequence === fromSequence) {
      if (checkpoint.hash !== previousEventHash) {
        throw new Error(`Release audit checkpoint ${checkpoint.name} does not match the retained audit head`);
      }
      verifiedReleaseCheckpoints.set(checkpoint.name, checkpoint);
    }
  }

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
    for (const checkpoint of releaseCheckpoints) {
      if (checkpoint.sequence > throughSequence) {
        throw new Error(`Release audit checkpoint ${checkpoint.name} is beyond the pinned export head`);
      }
    }
    for (const event of page.events) {
      for (const checkpoint of releaseCheckpoints) {
        if (event.sequence_number !== checkpoint.sequence) continue;
        if (event.event_hash !== checkpoint.hash) {
          throw new Error(`Release audit checkpoint ${checkpoint.name} hash does not match the verified event chain`);
        }
        verifiedReleaseCheckpoints.set(checkpoint.name, checkpoint);
      }
    }

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
      if (verifiedReleaseCheckpoints.size !== releaseCheckpoints.length) {
        throw new Error("Audit retention did not verify every required release checkpoint");
      }
      const completedAt = now();
      return auditDrainReceiptSchema.parse({
        schemaVersion: "audit-drain/v3",
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
        lastDestinationAcknowledgement: lastAcknowledgement,
        verifiedReleaseCheckpoints: releaseCheckpoints
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
  const releaseCheckpoints = await readReleaseCheckpoints({
    stagingFile: required("LOOPGRAPH_AUDIT_STAGING_RECEIPT_FILE"),
    marketplaceFile: required("LOOPGRAPH_AUDIT_MARKETPLACE_RECEIPT_FILE"),
    sourceOrigin: source.origin,
    organizationId,
    projectKey
  });
  const receipt = await drainAuditRetention({
    sourceUrl,
    destinationUrl,
    organizationId,
    projectKey,
    pageSize: positiveInteger("LOOPGRAPH_AUDIT_PAGE_SIZE", 100),
    minimumRetentionDays,
    acknowledgementKeyId,
    acknowledgementPublicKey,
    releaseCheckpoints,
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

const stagingCheckpointReceiptSchema = z.object({
  schemaVersion: z.literal("staging-validation/v4"),
  targetOrigin: z.string().url(),
  organizationId: z.string().uuid(),
  projectKey: z.string(),
  auditCheckpoint: z.object({
    headSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    headHash: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()
}).passthrough();

const marketplaceCheckpointReceiptSchema = z.object({
  schemaVersion: z.literal("hosted-marketplace-staging-validation/v2"),
  targetOrigin: z.string().url(),
  organizationId: z.string().uuid(),
  projectKey: z.string(),
  auditEvidence: z.object({
    throughSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    headHash: z.string().regex(/^[a-f0-9]{64}$/)
  }).passthrough()
}).passthrough();

async function readReleaseCheckpoints(input: {
  stagingFile: string;
  marketplaceFile: string;
  sourceOrigin: string;
  organizationId: string;
  projectKey: string;
}) {
  const staging = stagingCheckpointReceiptSchema.parse(JSON.parse(await readBoundedIntegrityFile(
    input.stagingFile,
    "LOOPGRAPH_AUDIT_STAGING_RECEIPT_FILE",
    1024 * 1024
  )));
  const marketplace = marketplaceCheckpointReceiptSchema.parse(JSON.parse(await readBoundedIntegrityFile(
    input.marketplaceFile,
    "LOOPGRAPH_AUDIT_MARKETPLACE_RECEIPT_FILE",
    1024 * 1024
  )));
  for (const receipt of [staging, marketplace]) {
    if (
      trustedEndpoint(receipt.targetOrigin, "Release checkpoint origin", true).origin !== input.sourceOrigin ||
      receipt.organizationId !== input.organizationId ||
      receipt.projectKey !== input.projectKey
    ) {
      throw new Error("Release audit checkpoint receipt belongs to a different source or tenant scope");
    }
  }
  return releaseAuditCheckpointSetSchema.parse([
    {
      name: "staging",
      sequence: staging.auditCheckpoint.headSequence,
      hash: staging.auditCheckpoint.headHash
    },
    {
      name: "marketplace",
      sequence: marketplace.auditEvidence.throughSequence,
      hash: marketplace.auditEvidence.headHash
    }
  ]);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
