import { generateKeyPairSync, sign } from "node:crypto";
import {
  retentionAcknowledgementSchema,
  retentionAcknowledgementSigningPayload,
  type AuditEvent,
  type RetentionAcknowledgement,
  type RetentionBatch
} from "./audit-retention-protocol";

const organizationId = "123e4567-e89b-42d3-a456-426614174000";
const projectKey = "main";

export function event(
  sequence: number,
  previousHash: string,
  eventHash: string
): AuditEvent {
  return {
    sequence_number: sequence,
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    organization_id: organizationId,
    project_key: projectKey,
    occurred_at: "2026-08-17T00:00:00.000Z",
    event_type: "machine.request.authorized",
    outcome: "accepted",
    actor_type: "machine",
    actor_id: "audit_exporter",
    capability: "observability.read",
    request_id: `request_${sequence}`,
    correlation_id: `request_${sequence}`,
    source: "machine_request_guard",
    resource_type: null,
    resource_id: null,
    metadata: {},
    previous_hash: previousHash,
    event_hash: eventHash
  };
}

export function page(
  events: AuditEvent[],
  afterSequence: number,
  throughSequence: number,
  hasMore: boolean,
  headHash: string,
  currentHeadSequence = throughSequence
) {
  return {
    schemaVersion: "loopgraph-security-audit-export/v2",
    organizationId,
    projectKey,
    exportedAt: "2026-08-17T00:00:00.000Z",
    afterSequence,
    throughSequence,
    nextCursor: events.at(-1)?.sequence_number ?? afterSequence,
    hasMore,
    integrity: {
      valid: true,
      eventsChecked: throughSequence,
      headSequence: throughSequence,
      currentHeadSequence,
      headHash
    },
    events
  };
}

export function signedAcknowledgement(input: {
  batch: RetentionBatch;
  payloadDigest: string;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  receiptSequence: number;
  retainedAt?: string;
  immutableUntil?: string;
}): RetentionAcknowledgement {
  const acknowledgement = retentionAcknowledgementSchema.parse({
    schemaVersion: "loopgraph-audit-retention-ack/v1",
    statement: {
      receiverId: "retention_receiver_1",
      receiptId: `receipt_${input.receiptSequence}`,
      receiptSequence: input.receiptSequence,
      organizationId: input.batch.organizationId,
      projectKey: input.batch.projectKey,
      batchId: input.batch.batchId,
      payloadDigest: input.payloadDigest,
      previousReceiptDigest: input.batch.previousReceiptDigest,
      firstSequence: input.batch.range.firstSequence,
      lastSequence: input.batch.range.lastSequence,
      eventCount: input.batch.range.eventCount,
      lastEventHash: input.batch.range.lastEventHash,
      retainedAt: input.retainedAt ?? "2026-08-17T00:00:00.000Z",
      immutableUntil: input.immutableUntil ?? "2033-08-17T00:00:00.000Z"
    },
    signature: {
      algorithm: "ed25519",
      keyId: "retention_key_1",
      value: "A".repeat(86)
    }
  });
  return retentionAcknowledgementSchema.parse({
    ...acknowledgement,
    signature: {
      ...acknowledgement.signature,
      value: sign(
        null,
        Buffer.from(retentionAcknowledgementSigningPayload(acknowledgement)),
        input.privateKey
      ).toString("base64url")
    }
  });
}
