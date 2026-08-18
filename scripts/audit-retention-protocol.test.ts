import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditDrainReceiptSchema,
  canonicalJson,
  createRetentionBatch,
  parsePreviousDrainReceipt,
  sha256Digest,
  validateAuditPage,
  verifyRetentionAcknowledgement,
  writeAuditDrainReceiptState
} from "./audit-retention-protocol";
import { event, page, signedAcknowledgement } from "./audit-retention-test-fixtures";

const organizationId = "123e4567-e89b-42d3-a456-426614174000";
const projectKey = "main";
const zeroHash = "0".repeat(64);

describe("audit retention protocol", () => {
  it("validates tenant event links against one verified export checkpoint", () => {
    const first = event(4, zeroHash, "a".repeat(64));
    const second = event(7, first.event_hash, "b".repeat(64));
    const validated = validateAuditPage({
      value: page([first, second], 0, 7, false, second.event_hash),
      organizationId,
      projectKey,
      afterSequence: 0,
      previousEventHash: zeroHash
    });
    expect(validated.lastEventHash).toBe(second.event_hash);

    expect(() => validateAuditPage({
      value: page([{ ...first, previous_hash: "f".repeat(64) }], 0, 4, false, first.event_hash),
      organizationId,
      projectKey,
      afterSequence: 0,
      previousEventHash: zeroHash
    })).toThrow(/broken tenant event sequence/i);
  });

  it("requires a signed exact acknowledgement with a sufficient immutable period", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const retainedEvent = event(1, zeroHash, "a".repeat(64));
    const batch = createRetentionBatch({
      sourceOrigin: "https://loopgraph.example",
      organizationId,
      projectKey,
      checkpoint: { headSequence: 1, headHash: retainedEvent.event_hash },
      afterSequence: 0,
      previousEventHash: zeroHash,
      previousReceiptDigest: null,
      events: [retainedEvent]
    });
    const payloadDigest = sha256Digest(canonicalJson(batch));
    const acknowledgement = signedAcknowledgement({
      batch,
      payloadDigest,
      privateKey,
      receiptSequence: 1
    });

    const verified = verifyRetentionAcknowledgement({
      value: acknowledgement,
      batch,
      payloadDigest,
      expectedKeyId: "retention_key_1",
      publicKey,
      minimumRetentionDays: 365,
      now: new Date("2026-08-17T00:01:00.000Z")
    });
    expect(verified.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(() => verifyRetentionAcknowledgement({
      value: {
        ...acknowledgement,
        signature: { ...acknowledgement.signature, value: "A".repeat(86) }
      },
      batch,
      payloadDigest,
      expectedKeyId: "retention_key_1",
      publicKey,
      minimumRetentionDays: 365,
      now: new Date("2026-08-17T00:01:00.000Z")
    })).toThrow(/signature/i);
  });

  it("binds the next run to the prior independently signed acknowledgement", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const retainedEvent = event(2, zeroHash, "b".repeat(64));
    const batch = createRetentionBatch({
      sourceOrigin: "https://loopgraph.example",
      organizationId,
      projectKey,
      checkpoint: { headSequence: 2, headHash: retainedEvent.event_hash },
      afterSequence: 0,
      previousEventHash: zeroHash,
      previousReceiptDigest: null,
      events: [retainedEvent]
    });
    const payloadDigest = sha256Digest(canonicalJson(batch));
    const acknowledgement = signedAcknowledgement({
      batch,
      payloadDigest,
      privateKey,
      receiptSequence: 1
    });
    const destinationDigest = sha256Digest(canonicalJson(acknowledgement));
    const receipt = auditDrainReceiptSchema.parse({
      schemaVersion: "audit-drain/v2",
      organizationId,
      projectKey,
      sourceOrigin: "https://loopgraph.example",
      destinationOrigin: "https://retention.example",
      startedAt: "2026-08-17T00:00:00.000Z",
      completedAt: "2026-08-17T00:01:00.000Z",
      fromSequence: 0,
      throughSequence: 2,
      eventCount: 1,
      batchCount: 1,
      headHash: retainedEvent.event_hash,
      lastDestinationReceiptDigest: destinationDigest,
      lastDestinationAcknowledgement: acknowledgement
    });

    expect(parsePreviousDrainReceipt({
      value: receipt,
      organizationId,
      projectKey,
      sourceOrigin: "https://loopgraph.example",
      destinationOrigin: "https://retention.example",
      trustedPublicKeys: new Map([["retention_key_1", publicKey]]),
      minimumRetentionDays: 365,
      now: new Date("2026-08-18T00:00:00.000Z")
    }).throughSequence).toBe(2);
  });

  it("atomically persists a mode-restricted signed predecessor receipt", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "loopgraph-audit-state-"));
    const file = path.join(directory, "audit-drain.json");
    const receipt = auditDrainReceiptSchema.parse({
      schemaVersion: "audit-drain/v2",
      organizationId,
      projectKey,
      sourceOrigin: "https://loopgraph.example",
      destinationOrigin: "https://retention.example",
      startedAt: "2026-08-17T00:00:00.000Z",
      completedAt: "2026-08-17T00:01:00.000Z",
      fromSequence: 0,
      throughSequence: 0,
      eventCount: 0,
      batchCount: 0,
      headHash: zeroHash,
      lastDestinationReceiptDigest: null,
      lastDestinationAcknowledgement: null
    });

    try {
      await writeAuditDrainReceiptState(file, receipt);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(receipt);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
