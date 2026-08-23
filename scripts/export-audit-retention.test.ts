import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  retentionBatchSchema,
  sha256Digest,
  type RetentionAcknowledgement,
  type RetentionBatch
} from "./audit-retention-protocol";
import { drainAuditRetention } from "./export-audit-retention";
import { event, page, signedAcknowledgement } from "./audit-retention-test-fixtures";

const organizationId = "123e4567-e89b-42d3-a456-426614174000";
const projectKey = "main";

describe("workload-authenticated audit retention drain", () => {
  it("paginates one verified head and advances signed receiver receipts", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const first = event(1, "0".repeat(64), "1".repeat(64));
    const second = event(2, first.event_hash, "2".repeat(64));
    const third = event(3, second.event_hash, "3".repeat(64));
    let sourceCalls = 0;
    let receiptSequence = 0;
    const receivedBatches: RetentionBatch[] = [];
    const acknowledgements: RetentionAcknowledgement[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(url instanceof Request ? url.url : url.toString());
      if (parsedUrl.origin === "https://loopgraph.example") {
        sourceCalls += 1;
        return Response.json(sourceCalls === 1
          ? page([first, second], 0, 3, true, third.event_hash, 5)
          : page([third], 2, 3, false, third.event_hash, 6));
      }
      expect(parsedUrl.href).toBe("https://retention.example/v1/loopgraph/audit-retention");
      const batch = retentionBatchSchema.parse(JSON.parse(String(init?.body)));
      receivedBatches.push(batch);
      const payloadDigest = init?.headers instanceof Headers
        ? init.headers.get("x-loopgraph-payload-digest")
        : (init?.headers as Record<string, string>)["x-loopgraph-payload-digest"];
      receiptSequence += 1;
      const acknowledgement = signedAcknowledgement({
        batch,
        payloadDigest: payloadDigest!,
        privateKey,
        receiptSequence
      });
      acknowledgements.push(acknowledgement);
      return Response.json(acknowledgement, { status: 201 });
    });

    const receipt = await drainAuditRetention({
      sourceUrl: "https://loopgraph.example",
      destinationUrl: "https://retention.example",
      organizationId,
      projectKey,
      pageSize: 2,
      minimumRetentionDays: 365,
      acknowledgementKeyId: "retention_key_1",
      acknowledgementPublicKey: publicKey,
      releaseCheckpoints: [
        { name: "staging", sequence: 2, hash: second.event_hash },
        { name: "marketplace", sequence: 3, hash: third.event_hash },
        { name: "app_evidence_health", sequence: 3, hash: third.event_hash },
        { name: "cli_sessions", sequence: 3, hash: third.event_hash },
        { name: "cli_admin", sequence: 3, hash: third.event_hash },
        { name: "marketplace_release_revocation", sequence: 3, hash: third.event_hash }
      ]
    }, {
      source: async () => "source.token.signature",
      destination: async () => "destination.token.signature"
    }, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-17T00:01:00.000Z"),
      requestId: () => `request_${sourceCalls}_${receiptSequence}`
    });

    expect(receipt).toMatchObject({
      schemaVersion: "audit-drain/v7",
      fromSequence: 0,
      throughSequence: 3,
      eventCount: 3,
      batchCount: 2,
      headHash: third.event_hash,
      verifiedReleaseCheckpoints: [
        { name: "staging", sequence: 2, hash: second.event_hash },
        { name: "marketplace", sequence: 3, hash: third.event_hash },
        { name: "app_evidence_health", sequence: 3, hash: third.event_hash },
        { name: "cli_sessions", sequence: 3, hash: third.event_hash },
        { name: "cli_admin", sequence: 3, hash: third.event_hash },
        { name: "marketplace_release_revocation", sequence: 3, hash: third.event_hash }
      ]
    });
    expect(receivedBatches[1]?.previousReceiptDigest).toBe(
      sha256Digest(canonicalJson(acknowledgements[0]))
    );
    expect(receivedBatches[0]?.previousReceiptDigest).toBeNull();
    expect(receivedBatches[1]?.previousReceiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.lastDestinationAcknowledgement?.statement.receiptSequence).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("refuses a source page whose event link is broken", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const broken = event(1, "f".repeat(64), "1".repeat(64));
    const fetcher = vi.fn(async () => Response.json(
      page([broken], 0, 1, false, broken.event_hash)
    ));

    await expect(drainAuditRetention({
      sourceUrl: "https://loopgraph.example",
      destinationUrl: "https://retention.example",
      organizationId,
      projectKey,
      pageSize: 100,
      minimumRetentionDays: 365,
      acknowledgementKeyId: "retention_key_1",
      acknowledgementPublicKey: publicKey,
      releaseCheckpoints: [
        { name: "staging", sequence: 1, hash: broken.event_hash },
        { name: "marketplace", sequence: 1, hash: broken.event_hash },
        { name: "app_evidence_health", sequence: 1, hash: broken.event_hash },
        { name: "cli_sessions", sequence: 1, hash: broken.event_hash },
        { name: "cli_admin", sequence: 1, hash: broken.event_hash },
        { name: "marketplace_release_revocation", sequence: 1, hash: broken.event_hash }
      ]
    }, {
      source: async () => "source.token.signature",
      destination: async () => "destination.token.signature"
    }, { fetcher: fetcher as typeof fetch })).rejects.toThrow(/broken tenant event sequence/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses a later page that changes the selected checkpoint hash", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const first = event(1, "0".repeat(64), "1".repeat(64));
    const second = event(2, first.event_hash, "2".repeat(64));
    let sourceCalls = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(url instanceof Request ? url.url : url.toString());
      if (parsedUrl.origin === "https://loopgraph.example") {
        sourceCalls += 1;
        return Response.json(sourceCalls === 1
          ? page([first], 0, 2, true, second.event_hash)
          : page([second], 1, 2, false, "f".repeat(64)));
      }
      const batch = retentionBatchSchema.parse(JSON.parse(String(init?.body)));
      return Response.json(signedAcknowledgement({
        batch,
        payloadDigest: (init?.headers as Record<string, string>)["x-loopgraph-payload-digest"],
        privateKey,
        receiptSequence: 1
      }));
    });

    await expect(drainAuditRetention({
      sourceUrl: "https://loopgraph.example",
      destinationUrl: "https://retention.example",
      organizationId,
      projectKey,
      pageSize: 1,
      minimumRetentionDays: 365,
      acknowledgementKeyId: "retention_key_1",
      acknowledgementPublicKey: publicKey,
      releaseCheckpoints: [
        { name: "staging", sequence: 1, hash: first.event_hash },
        { name: "marketplace", sequence: 2, hash: second.event_hash },
        { name: "app_evidence_health", sequence: 2, hash: second.event_hash },
        { name: "cli_sessions", sequence: 2, hash: second.event_hash },
        { name: "cli_admin", sequence: 2, hash: second.event_hash },
        { name: "marketplace_release_revocation", sequence: 2, hash: second.event_hash }
      ]
    }, {
      source: async () => "source.token.signature",
      destination: async () => "destination.token.signature"
    }, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-17T00:01:00.000Z")
    })).rejects.toThrow(/verified checkpoint/i);
  });

  it("rejects a covered release sequence when its exact checkpoint hash differs", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const first = event(1, "0".repeat(64), "1".repeat(64));
    const second = event(2, first.event_hash, "2".repeat(64));
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(url instanceof Request ? url.url : url.toString());
      if (parsedUrl.origin === "https://loopgraph.example") {
        return Response.json(page([first, second], 0, 2, false, second.event_hash));
      }
      const batch = retentionBatchSchema.parse(JSON.parse(String(init?.body)));
      return Response.json(signedAcknowledgement({
        batch,
        payloadDigest: (init?.headers as Record<string, string>)["x-loopgraph-payload-digest"],
        privateKey,
        receiptSequence: 1
      }));
    });

    await expect(drainAuditRetention({
      sourceUrl: "https://loopgraph.example",
      destinationUrl: "https://retention.example",
      organizationId,
      projectKey,
      pageSize: 100,
      minimumRetentionDays: 365,
      acknowledgementKeyId: "retention_key_1",
      acknowledgementPublicKey: publicKey,
      releaseCheckpoints: [
        { name: "staging", sequence: 1, hash: "f".repeat(64) },
        { name: "marketplace", sequence: 2, hash: second.event_hash },
        { name: "app_evidence_health", sequence: 2, hash: second.event_hash },
        { name: "cli_sessions", sequence: 2, hash: second.event_hash },
        { name: "cli_admin", sequence: 2, hash: second.event_hash },
        { name: "marketplace_release_revocation", sequence: 2, hash: second.event_hash }
      ]
    }, {
      source: async () => "source.token.signature",
      destination: async () => "destination.token.signature"
    }, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-17T00:01:00.000Z")
    })).rejects.toThrow(/checkpoint staging hash/i);
  });
});
