import {
  createHash,
  createPublicKey,
  randomUUID,
  verify,
  type KeyObject
} from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);
const projectKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const auditEventSchema = z.object({
  sequence_number: safeInteger,
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_key: projectKey,
  occurred_at: z.string().datetime({ offset: true }),
  event_type: z.string().min(1).max(128),
  outcome: z.string().min(1).max(64),
  actor_type: z.string().min(1).max(64),
  actor_id: z.string().min(1).max(256),
  capability: z.string().max(128).nullable(),
  request_id: z.string().max(256).nullable(),
  correlation_id: z.string().min(1).max(256),
  source: z.string().min(1).max(128),
  resource_type: z.string().max(128).nullable(),
  resource_id: z.string().max(256).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  previous_hash: hashSchema,
  event_hash: hashSchema
}).strict();

export const auditExportPageSchema = z.object({
  schemaVersion: z.literal("loopgraph-security-audit-export/v2"),
  organizationId: z.string().uuid(),
  projectKey,
  exportedAt: z.string().datetime({ offset: true }),
  afterSequence: safeInteger,
  throughSequence: safeInteger,
  nextCursor: safeInteger,
  hasMore: z.boolean(),
  integrity: z.object({
    valid: z.literal(true),
    eventsChecked: safeInteger,
    headSequence: safeInteger,
    currentHeadSequence: safeInteger,
    headHash: hashSchema
  }).strict(),
  events: z.array(auditEventSchema).max(500)
}).strict();

export const retentionBatchSchema = z.object({
  schemaVersion: z.literal("loopgraph-audit-retention-batch/v1"),
  batchId: identifier,
  sourceOrigin: z.string().url(),
  organizationId: z.string().uuid(),
  projectKey,
  checkpoint: z.object({
    headSequence: safeInteger,
    headHash: hashSchema
  }).strict(),
  range: z.object({
    afterSequence: safeInteger,
    firstSequence: safeInteger,
    lastSequence: safeInteger,
    eventCount: z.number().int().positive().max(500),
    previousEventHash: hashSchema,
    lastEventHash: hashSchema
  }).strict(),
  previousReceiptDigest: digestSchema.nullable(),
  events: z.array(auditEventSchema).min(1).max(500)
}).strict();

export const retentionAcknowledgementSchema = z.object({
  schemaVersion: z.literal("loopgraph-audit-retention-ack/v1"),
  statement: z.object({
    receiverId: identifier,
    receiptId: identifier,
    receiptSequence: safeInteger,
    organizationId: z.string().uuid(),
    projectKey,
    batchId: identifier,
    payloadDigest: digestSchema,
    previousReceiptDigest: digestSchema.nullable(),
    firstSequence: safeInteger,
    lastSequence: safeInteger,
    eventCount: z.number().int().positive().max(500),
    lastEventHash: hashSchema,
    retainedAt: z.string().datetime({ offset: true }),
    immutableUntil: z.string().datetime({ offset: true })
  }).strict(),
  signature: z.object({
    algorithm: z.literal("ed25519"),
    keyId: identifier,
    value: z.string().length(86).regex(/^[A-Za-z0-9_-]+$/)
  }).strict()
}).strict();

export const auditDrainReceiptSchema = z.object({
  schemaVersion: z.literal("audit-drain/v2"),
  organizationId: z.string().uuid(),
  projectKey,
  sourceOrigin: z.string().url(),
  destinationOrigin: z.string().url(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  fromSequence: safeInteger,
  throughSequence: safeInteger,
  eventCount: safeInteger,
  batchCount: safeInteger,
  headHash: hashSchema,
  lastDestinationReceiptDigest: digestSchema.nullable(),
  lastDestinationAcknowledgement: retentionAcknowledgementSchema.nullable()
}).strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditExportPage = z.infer<typeof auditExportPageSchema>;
export type RetentionBatch = z.infer<typeof retentionBatchSchema>;
export type RetentionAcknowledgement = z.infer<typeof retentionAcknowledgementSchema>;
export type AuditDrainReceipt = z.infer<typeof auditDrainReceiptSchema>;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sha256Digest(value: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function retentionAcknowledgementSigningPayload(
  acknowledgement: RetentionAcknowledgement
) {
  return canonicalJson({
    schemaVersion: acknowledgement.schemaVersion,
    statement: acknowledgement.statement,
    signature: {
      algorithm: acknowledgement.signature.algorithm,
      keyId: acknowledgement.signature.keyId
    }
  });
}

export function verifyRetentionAcknowledgement(input: {
  value: unknown;
  batch: RetentionBatch;
  payloadDigest: string;
  expectedKeyId: string;
  publicKey: KeyObject;
  minimumRetentionDays: number;
  now: Date;
  previousAcknowledgement?: RetentionAcknowledgement | null;
}) {
  const acknowledgement = retentionAcknowledgementSchema.parse(input.value);
  const statement = acknowledgement.statement;
  if (acknowledgement.signature.keyId !== input.expectedKeyId) {
    throw new Error("Audit retention acknowledgement used an unexpected signing key");
  }
  if (
    statement.organizationId !== input.batch.organizationId ||
    statement.projectKey !== input.batch.projectKey ||
    statement.batchId !== input.batch.batchId ||
    statement.payloadDigest !== input.payloadDigest ||
    statement.previousReceiptDigest !== input.batch.previousReceiptDigest ||
    statement.firstSequence !== input.batch.range.firstSequence ||
    statement.lastSequence !== input.batch.range.lastSequence ||
    statement.eventCount !== input.batch.range.eventCount ||
    statement.lastEventHash !== input.batch.range.lastEventHash
  ) {
    throw new Error("Audit retention acknowledgement does not match the submitted batch");
  }
  if (input.previousAcknowledgement && (
    statement.receiverId !== input.previousAcknowledgement.statement.receiverId ||
    statement.receiptSequence <= input.previousAcknowledgement.statement.receiptSequence
  )) {
    throw new Error("Audit retention acknowledgement did not advance the receiver receipt chain");
  }
  const signature = Buffer.from(acknowledgement.signature.value, "base64url");
  if (signature.length !== 64 || !verify(
    null,
    Buffer.from(retentionAcknowledgementSigningPayload(acknowledgement)),
    input.publicKey,
    signature
  )) {
    throw new Error("Audit retention acknowledgement signature is invalid");
  }

  const retainedAt = Date.parse(statement.retainedAt);
  const immutableUntil = Date.parse(statement.immutableUntil);
  if (Math.abs(retainedAt - input.now.getTime()) > 5 * 60_000) {
    throw new Error("Audit retention acknowledgement time is outside the allowed clock skew");
  }
  const minimumImmutableUntil = retainedAt + input.minimumRetentionDays * 24 * 60 * 60_000;
  if (immutableUntil < minimumImmutableUntil) {
    throw new Error("Audit retention acknowledgement does not satisfy the minimum retention period");
  }
  return {
    acknowledgement,
    receiptDigest: sha256Digest(canonicalJson(acknowledgement))
  };
}

export function validateAuditPage(input: {
  value: unknown;
  organizationId: string;
  projectKey: string;
  afterSequence: number;
  throughSequence?: number;
  headHash?: string;
  previousEventHash: string;
}) {
  const page = auditExportPageSchema.parse(input.value);
  if (
    page.organizationId !== input.organizationId ||
    page.projectKey !== input.projectKey ||
    page.afterSequence !== input.afterSequence ||
    page.integrity.headSequence !== page.throughSequence ||
    page.integrity.currentHeadSequence < page.throughSequence ||
    (input.throughSequence !== undefined && page.throughSequence !== input.throughSequence) ||
    (input.headHash !== undefined && page.integrity.headHash !== input.headHash)
  ) {
    throw new Error("Audit export page does not match the requested verified checkpoint");
  }
  let previousSequence = input.afterSequence;
  let previousHash = input.previousEventHash;
  for (const event of page.events) {
    if (
      event.organization_id !== input.organizationId ||
      event.project_key !== input.projectKey ||
      event.sequence_number <= previousSequence ||
      event.sequence_number > page.throughSequence ||
      event.previous_hash !== previousHash
    ) {
      throw new Error("Audit export page contains a broken tenant event sequence");
    }
    previousSequence = event.sequence_number;
    previousHash = event.event_hash;
  }
  const expectedCursor = page.events.at(-1)?.sequence_number ?? input.afterSequence;
  if (page.nextCursor !== expectedCursor || (page.hasMore && page.events.length === 0)) {
    throw new Error("Audit export pagination did not make bounded progress");
  }
  if (!page.hasMore && previousHash !== page.integrity.headHash) {
    throw new Error("Audit export final event does not match the verified checkpoint hash");
  }
  return { page, lastEventHash: previousHash };
}

export function createRetentionBatch(input: {
  sourceOrigin: string;
  organizationId: string;
  projectKey: string;
  checkpoint: { headSequence: number; headHash: string };
  afterSequence: number;
  previousEventHash: string;
  previousReceiptDigest: string | null;
  events: AuditEvent[];
}) {
  const first = input.events[0];
  const last = input.events.at(-1);
  if (!first || !last) throw new Error("Cannot retain an empty audit batch");
  const batchIdentity = sha256Digest(canonicalJson({
    organizationId: input.organizationId,
    projectKey: input.projectKey,
    checkpoint: input.checkpoint,
    afterSequence: input.afterSequence,
    firstSequence: first.sequence_number,
    lastSequence: last.sequence_number,
    previousReceiptDigest: input.previousReceiptDigest,
    eventHashes: input.events.map((event) => event.event_hash)
  })).slice("sha256:".length, "sha256:".length + 40);
  return retentionBatchSchema.parse({
    schemaVersion: "loopgraph-audit-retention-batch/v1",
    batchId: `audit_${batchIdentity}`,
    sourceOrigin: input.sourceOrigin,
    organizationId: input.organizationId,
    projectKey: input.projectKey,
    checkpoint: input.checkpoint,
    range: {
      afterSequence: input.afterSequence,
      firstSequence: first.sequence_number,
      lastSequence: last.sequence_number,
      eventCount: input.events.length,
      previousEventHash: input.previousEventHash,
      lastEventHash: last.event_hash
    },
    previousReceiptDigest: input.previousReceiptDigest,
    events: input.events
  });
}

export function parsePreviousDrainReceipt(input: {
  value: unknown;
  organizationId: string;
  projectKey: string;
  sourceOrigin: string;
  destinationOrigin: string;
  trustedPublicKeys: ReadonlyMap<string, KeyObject>;
  minimumRetentionDays: number;
  now: Date;
}) {
  const receipt = auditDrainReceiptSchema.parse(input.value);
  if (
    receipt.organizationId !== input.organizationId ||
    receipt.projectKey !== input.projectKey ||
    receipt.sourceOrigin !== input.sourceOrigin ||
    receipt.destinationOrigin !== input.destinationOrigin
  ) {
    throw new Error("Previous audit drain receipt belongs to a different retention scope");
  }
  if (receipt.lastDestinationAcknowledgement) {
    const acknowledgement = receipt.lastDestinationAcknowledgement;
    const trustedKey = input.trustedPublicKeys.get(acknowledgement.signature.keyId);
    const signature = Buffer.from(acknowledgement.signature.value, "base64url");
    if (!trustedKey || signature.length !== 64 || !verify(
      null,
      Buffer.from(retentionAcknowledgementSigningPayload(acknowledgement)),
      trustedKey,
      signature
    )) {
      throw new Error("Previous audit drain acknowledgement signature is invalid");
    }
    const digest = sha256Digest(canonicalJson(acknowledgement));
    if (
      receipt.lastDestinationReceiptDigest !== digest ||
      acknowledgement.statement.lastSequence !== receipt.throughSequence ||
      acknowledgement.statement.lastEventHash !== receipt.headHash
    ) {
      throw new Error("Previous audit drain receipt is not bound to its signed acknowledgement");
    }
    const retainedAt = Date.parse(acknowledgement.statement.retainedAt);
    const immutableUntil = Date.parse(acknowledgement.statement.immutableUntil);
    if (
      immutableUntil < retainedAt + input.minimumRetentionDays * 24 * 60 * 60_000 ||
      immutableUntil < input.now.getTime()
    ) {
      throw new Error("Previous audit drain acknowledgement no longer proves required immutability");
    }
  } else if (
    receipt.lastDestinationReceiptDigest !== null ||
    receipt.throughSequence !== 0 ||
    receipt.headHash !== "0".repeat(64)
  ) {
    throw new Error("Previous audit drain receipt is missing its destination acknowledgement");
  }
  return receipt;
}

export async function readBoundedIntegrityFile(
  file: string,
  label: string,
  maximum = 256 * 1024
) {
  if (!path.isAbsolute(file)) throw new Error(`${label} must be an absolute path`);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximum) {
      throw new Error(`${label} must reference one bounded regular file`);
    }
    if ((metadata.mode & 0o022) !== 0) {
      throw new Error(`${label} must not be writable by group or other users`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle?.close();
  }
}

export async function readRetentionPublicKey(
  file: string,
  label = "LOOPGRAPH_AUDIT_RETENTION_PUBLIC_KEY_FILE"
) {
  const pem = await readBoundedIntegrityFile(file, label, 64 * 1024);
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new Error("Audit retention public key file does not contain a valid public key");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Audit retention acknowledgement key must be Ed25519");
  }
  return key;
}

export async function writeAuditDrainReceiptState(
  file: string,
  receipt: AuditDrainReceipt,
  label = "LOOPGRAPH_AUDIT_RECEIPT_STATE_FILE"
) {
  if (!path.isAbsolute(file)) throw new Error(`${label} must be an absolute path`);
  const value = `${JSON.stringify(auditDrainReceiptSchema.parse(receipt), null, 2)}\n`;
  if (Buffer.byteLength(value) > 256 * 1024) {
    throw new Error(`${label} exceeds the bounded receipt size`);
  }
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>(
      (result, key) => {
        result[key] = sortKeys((value as Record<string, unknown>)[key]);
        return result;
      },
      {}
    );
  }
  return value;
}
