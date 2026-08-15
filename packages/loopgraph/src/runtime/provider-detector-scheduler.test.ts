import { describe, expect, it, vi } from "vitest";
import { eventEnvelopeSchema, type ConnectorBrokerResponse, type EventEnvelope } from "../core";
import {
  PROVIDER_DETECTOR_CATALOG,
  ProviderDetectorScheduler,
  extractWarehouseDetectorRows,
  providerDetectorClaimSchema,
  signProviderDetectorReceipt,
  verifyProviderDetectorReceipt,
  type ProviderDetectorReceipt,
  type ProviderDetectorStore
} from "./provider-detector-scheduler";
import type { HermesConnectorBroker } from "./connector-broker";

const now = new Date("2026-08-13T12:00:00.000Z");
const claim = providerDetectorClaimSchema.parse({
  scheduleId: "provider_detector_0123456789abcdef",
  runId: "11111111-1111-4111-8111-111111111111",
  tenant: { organizationId: "org-1", projectKey: "main" },
  installationId: "bigquery-1",
  providerId: "bigquery",
  detectorKey: "company-metrics",
  operation: "company-metrics.detect",
  eventType: "management.company_metric_anomaly",
  subjectType: "company_metric_anomaly",
  windowStart: "2026-08-13T11:00:00.000Z",
  windowEnd: "2026-08-13T12:00:00.000Z",
  attemptCount: 1,
  leaseToken: "22222222-2222-4222-8222-222222222222"
});

describe("provider detector scheduler", () => {
  it("defines one fixed detector contract per warehouse business signal", () => {
    expect(PROVIDER_DETECTOR_CATALOG).toHaveLength(6);
    expect(PROVIDER_DETECTOR_CATALOG.map((definition) => `${definition.providerId}:${definition.operation}`)).toEqual([
      "bigquery:company-metrics.detect",
      "bigquery:finance-forecast.detect",
      "bigquery:capacity-plan.detect",
      "snowflake:company-metrics.detect",
      "snowflake:finance-forecast.detect",
      "snowflake:capacity-plan.detect"
    ]);
    for (const definition of PROVIDER_DETECTOR_CATALOG) {
      expect(definition).toMatchObject({ cadenceMinutes: 60, windowMinutes: 60, overlapMinutes: 5 });
    }
  });

  it("extracts only explicitly material BigQuery rows and rejects identity collisions", () => {
    const result = bigQueryResult([
      ["event-1", "metric-1", "2026-08-13T11:30:00.000Z", "true", JSON.stringify({ metric: { id: "metric-1", delta: 20 } }), null, JSON.stringify(["normalizedPayload.metric.dimensions"])],
      ["event-2", "metric-2", "2026-08-13T11:40:00.000Z", "false", JSON.stringify({ ignored: true }), null, null]
    ]);
    expect(extractWarehouseDetectorRows("bigquery", result, claim)).toEqual([{
      eventId: "event-1",
      subjectId: "metric-1",
      occurredAt: "2026-08-13T11:30:00.000Z",
      payload: { metric: { id: "metric-1", delta: 20 } },
      untrustedFields: ["normalizedPayload.metric.dimensions"]
    }]);

    expect(() => extractWarehouseDetectorRows("bigquery", bigQueryResult([
      ["event-1", "metric-1", "2026-08-13T11:30:00.000Z", "true", "{}", null, null],
      ["event-1", "metric-2", "2026-08-13T11:31:00.000Z", "true", "{}", null, null]
    ]), claim)).toThrowError(expect.objectContaining({ code: "detector_event_identity_conflict" }));
  });

  it("extracts Snowflake rows and fails closed without a materiality decision", () => {
    const metadata = { rowType: columns().map((name) => ({ name })) };
    expect(extractWarehouseDetectorRows("snowflake", {
      resultSetMetaData: metadata,
      rows: [["event-3", "forecast-1", "2026-08-13T11:45:00.000Z", true, "{\"forecast\":{\"id\":\"forecast-1\"}}", null, null]]
    }, claim)).toHaveLength(1);
    expect(() => extractWarehouseDetectorRows("snowflake", {
      resultSetMetaData: { rowType: columns().filter((name) => name !== "material").map((name) => ({ name })) },
      rows: [["event-3", "forecast-1", "2026-08-13T11:45:00.000Z", "{}", null, null]]
    }, claim)).toThrowError(expect.objectContaining({ code: "detector_materiality_missing" }));
  });

  it("forwards normalized events with signed evidence receipts before advancing the checkpoint", async () => {
    const store = memoryStore();
    const execute = vi.fn(async () => succeeded(bigQueryResult([
      ["event-1", "metric-1", "2026-08-13T11:30:00.000Z", "true", JSON.stringify({ metric: { id: "metric-1", delta: 20 } }), "problem-1", "[]"]
    ])));
    const forwardedEvents: Array<{ event: EventEnvelope; receipt: ProviderDetectorReceipt }> = [];
    const forward = vi.fn(async (input: { event: EventEnvelope; receipt: ProviderDetectorReceipt }) => {
      forwardedEvents.push(input);
    });
    const scheduler = new ProviderDetectorScheduler({
      store,
      broker: { execute } as Pick<HermesConnectorBroker, "execute">,
      forwarder: { forward },
      receiptSigningKey: "a-secure-detector-signing-key-with-32-chars",
      receiptKeyId: "detector-key-1",
      now: () => now
    });

    await expect(scheduler.run()).resolves.toMatchObject({ claimed: 1, forwardedRuns: 1, emittedEvents: 1 });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "system", subject: "system:provider-detector" },
      capability: "provider.events.emit",
      operation: "company-metrics.detect",
      input: { windowStart: claim.windowStart, windowEnd: claim.windowEnd, limit: 100 }
    }));
    expect(forward).toHaveBeenCalledTimes(1);
    const forwarded = forwardedEvents[0]!;
    expect(forwarded.event).toMatchObject({
      source: "bigquery",
      sourceDeliveryId: "event-1",
      eventType: claim.eventType,
      subject: { type: claim.subjectType, id: "metric-1" },
      correlationId: "problem-1"
    });
    expect(forwarded.event.evidenceRefs).toEqual(expect.arrayContaining([
      "connector-receipt:connector_receipt_1",
      expect.stringMatching(/^detector-receipt:/)
    ]));
    expect(verifyProviderDetectorReceipt(forwarded.receipt, "a-secure-detector-signing-key-with-32-chars", now)).toBe(true);
    expect(store.finalize).toHaveBeenCalledWith(expect.objectContaining({ outcome: "forwarded", eventIds: [forwarded.event.id] }));
    expect(forward.mock.invocationCallOrder[0]).toBeLessThan(store.finalize.mock.invocationCallOrder[0]!);
  });

  it("keeps the same window for retry and pauses a terminal malformed result", async () => {
    const retryStore = memoryStore();
    const retryScheduler = new ProviderDetectorScheduler({
      store: retryStore,
      broker: { execute: vi.fn(async () => succeeded(bigQueryResult([
        ["event-1", "metric-1", "2026-08-13T11:30:00.000Z", "true", "{}", null, null]
      ]))) } as Pick<HermesConnectorBroker, "execute">,
      forwarder: { forward: vi.fn(async () => { throw new Error("Hermes unavailable"); }) },
      receiptSigningKey: "a-secure-detector-signing-key-with-32-chars",
      receiptKeyId: "detector-key-1",
      now: () => now
    });
    await retryScheduler.run();
    expect(retryStore.finalize).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "retry",
      retryAt: "2026-08-13T12:05:00.000Z",
      errorCode: "detector_worker_failed"
    }));

    const terminalStore = memoryStore();
    const terminalScheduler = new ProviderDetectorScheduler({
      store: terminalStore,
      broker: { execute: vi.fn(async () => succeeded(bigQueryResult([
        ["event-1", "metric-1", "2026-08-13T11:30:00.000Z", null, "{}", null, null]
      ]))) } as Pick<HermesConnectorBroker, "execute">,
      forwarder: { forward: vi.fn() },
      receiptSigningKey: "a-secure-detector-signing-key-with-32-chars",
      receiptKeyId: "detector-key-1",
      now: () => now
    });
    await terminalScheduler.run();
    expect(terminalStore.finalize).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "dead_letter",
      errorCode: "detector_materiality_missing"
    }));
  });

  it("signs receipts over immutable schedule, provider, window, and result identity", () => {
    const event = eventEnvelopeSchema.parse({
      schemaVersion: "event-envelope/v1alpha1",
      id: "event_envelope_1",
      workspaceId: "main",
      companyId: "org-1",
      source: "bigquery",
      sourceRoute: "connector-broker/detector",
      sourceDeliveryId: "event-1",
      eventType: claim.eventType,
      occurredAt: "2026-08-13T11:30:00.000Z",
      receivedAt: now.toISOString(),
      subject: { type: claim.subjectType, id: "metric-1" },
      correlationId: "metric-1",
      normalizedPayload: {},
      evidenceRefs: [],
      trust: { signatureVerified: true, untrustedFields: [] },
      sensitivity: "confidential",
      hopCount: 0
    });
    const receipt = signProviderDetectorReceipt({
      claim,
      event,
      brokerReceiptId: "connector_receipt_1",
      resultHash: "a".repeat(64),
      signingKey: "a-secure-detector-signing-key-with-32-chars",
      keyId: "detector-key-1",
      now
    });
    expect(verifyProviderDetectorReceipt(receipt, "a-secure-detector-signing-key-with-32-chars", now)).toBe(true);
    expect(verifyProviderDetectorReceipt({ ...receipt, resultHash: "b".repeat(64) }, "a-secure-detector-signing-key-with-32-chars", now)).toBe(false);
  });

  it("reports lease-fencing failures without abandoning other claimed work", async () => {
    const store = memoryStore();
    store.finalize.mockResolvedValue(false);
    const scheduler = new ProviderDetectorScheduler({
      store,
      broker: { execute: vi.fn(async () => succeeded(bigQueryResult([]))) } as Pick<HermesConnectorBroker, "execute">,
      forwarder: { forward: vi.fn() },
      receiptSigningKey: "a-secure-detector-signing-key-with-32-chars",
      receiptKeyId: "detector-key-1",
      now: () => now
    });
    await expect(scheduler.run()).resolves.toMatchObject({ claimed: 1, workerFailures: 1, noChangeRuns: 0 });
  });
});

function columns() {
  return ["event_id", "subject_id", "occurred_at", "material", "payload_json", "correlation_id", "untrusted_fields_json"];
}

function bigQueryResult(rows: unknown[][]) {
  return {
    schema: { fields: columns().map((name) => ({ name })) },
    rows: rows.map((values) => ({ f: values.map((value) => ({ v: value })) }))
  };
}

function succeeded(result: Record<string, unknown>) {
  return {
    status: "succeeded",
    result,
    receipt: { receiptId: "connector_receipt_1" }
  } as ConnectorBrokerResponse;
}

function memoryStore() {
  return {
    syncSchedules: vi.fn(async () => PROVIDER_DETECTOR_CATALOG.length),
    claimDue: vi.fn(async () => [claim]),
    finalize: vi.fn(async () => true)
  } satisfies ProviderDetectorStore;
}
