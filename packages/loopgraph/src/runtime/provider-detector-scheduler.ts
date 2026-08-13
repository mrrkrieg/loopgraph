import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  eventEnvelopeSchema,
  type ConnectorInstallationAdmin,
  type EventEnvelope,
  type ProviderId
} from "../core";
import type { HermesConnectorBroker } from "./connector-broker";
import { normalizeProviderEvent } from "./provider-normalizers";
import { assertSecretFree } from "./secret-redaction";
import type { WorkloadTokenProvider } from "./workload-token-provider";

export const PROVIDER_DETECTOR_RECEIPT_VERSION = "provider-detector-receipt/v1" as const;

export const warehouseDetectorProviderSchema = z.enum(["bigquery", "snowflake"]);
export type WarehouseDetectorProvider = z.infer<typeof warehouseDetectorProviderSchema>;

export const providerDetectorDefinitionSchema = z.object({
  providerId: warehouseDetectorProviderSchema,
  detectorKey: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  eventType: z.string().min(3).max(160),
  subjectType: z.string().regex(/^[a-z][a-z0-9_]{1,95}$/),
  cadenceMinutes: z.number().int().min(5).max(1440),
  windowMinutes: z.number().int().min(5).max(525_600),
  overlapMinutes: z.number().int().min(0).max(1440)
}).strict().refine((value) => value.overlapMinutes < value.windowMinutes, {
  path: ["overlapMinutes"],
  message: "Detector overlap must be shorter than its evidence window"
});

export type ProviderDetectorDefinition = z.infer<typeof providerDetectorDefinitionSchema>;

export const PROVIDER_DETECTOR_CATALOG: ProviderDetectorDefinition[] = [
  detector("bigquery", "company-metrics", "company-metrics.detect", "management.company_metric_anomaly", "company_metric_anomaly"),
  detector("bigquery", "finance-forecast", "finance-forecast.detect", "finance.forecast_variance_detected", "forecast_window"),
  detector("bigquery", "capacity-plan", "capacity-plan.detect", "capacity.plan_changed", "capacity_plan"),
  detector("snowflake", "company-metrics", "company-metrics.detect", "management.company_metric_anomaly", "company_metric_anomaly"),
  detector("snowflake", "finance-forecast", "finance-forecast.detect", "finance.forecast_variance_detected", "forecast_window"),
  detector("snowflake", "capacity-plan", "capacity-plan.detect", "capacity.plan_changed", "capacity_plan")
];

export const providerDetectorClaimSchema = z.object({
  scheduleId: z.string().min(8).max(160),
  runId: z.string().uuid(),
  tenant: z.object({ organizationId: z.string().min(1).max(128), projectKey: z.string().min(1).max(64) }),
  installationId: z.string().min(1).max(128),
  providerId: warehouseDetectorProviderSchema,
  detectorKey: z.string().min(3).max(64),
  operation: z.string().min(3).max(128),
  eventType: z.string().min(3).max(160),
  subjectType: z.string().min(1).max(96),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  attemptCount: z.number().int().min(1).max(100),
  leaseToken: z.string().uuid()
}).strict().refine((value) => Date.parse(value.windowStart) < Date.parse(value.windowEnd), {
  path: ["windowEnd"],
  message: "Detector window must end after it starts"
});

export type ProviderDetectorClaim = z.infer<typeof providerDetectorClaimSchema>;

export const providerDetectorReceiptSchema = z.object({
  schemaVersion: z.literal(PROVIDER_DETECTOR_RECEIPT_VERSION),
  id: z.string().min(8).max(160),
  scheduleId: z.string().min(8).max(160),
  runId: z.string().uuid(),
  organizationId: z.string().min(1).max(128),
  projectKey: z.string().min(1).max(64),
  providerId: warehouseDetectorProviderSchema,
  installationId: z.string().min(1).max(128),
  detectorKey: z.string().min(3).max(64),
  operation: z.string().min(3).max(128),
  eventType: z.string().min(3).max(160),
  sourceEventId: z.string().min(1).max(256),
  brokerReceiptId: z.string().min(8).max(160),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  signer: z.literal("hermes-connector-broker"),
  keyId: z.string().min(1).max(160),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  attestation: z.string().min(32).max(256)
}).strict();

export type ProviderDetectorReceipt = z.infer<typeof providerDetectorReceiptSchema>;

export interface ProviderDetectorStore {
  syncSchedules(input: { definitions: ProviderDetectorDefinition[]; now: string }): Promise<number>;
  claimDue(input: { limit: number; leaseSeconds: number; now: string }): Promise<ProviderDetectorClaim[]>;
  finalize(input: {
    claim: ProviderDetectorClaim;
    outcome: "forwarded" | "no_change" | "retry" | "dead_letter";
    brokerReceiptId?: string;
    resultHash?: string;
    eventIds?: string[];
    errorCode?: string;
    retryAt?: string;
    completedAt: string;
  }): Promise<boolean>;
}

export interface ProviderDetectorEventForwarder {
  forward(input: { event: EventEnvelope; receipt: ProviderDetectorReceipt }): Promise<void>;
}

export class ProviderDetectorScheduler {
  constructor(private readonly dependencies: {
    store: ProviderDetectorStore;
    broker: Pick<HermesConnectorBroker, "execute">;
    forwarder: ProviderDetectorEventForwarder;
    receiptSigningKey: string;
    receiptKeyId: string;
    now?: () => Date;
    maxAttempts?: number;
  }) {
    if (dependencies.receiptSigningKey.length < 32) throw new Error("Detector receipt signing key must contain at least 32 characters");
  }

  async run(input: { limit?: number; leaseSeconds?: number } = {}) {
    const now = this.now();
    const provisioned = await this.dependencies.store.syncSchedules({
      definitions: PROVIDER_DETECTOR_CATALOG,
      now: now.toISOString()
    });
    const claims = await this.dependencies.store.claimDue({
      limit: Math.min(Math.max(input.limit ?? 20, 1), 100),
      leaseSeconds: Math.min(Math.max(input.leaseSeconds ?? 90, 30), 300),
      now: now.toISOString()
    });
    const summary = {
      provisioned,
      claimed: claims.length,
      forwardedRuns: 0,
      emittedEvents: 0,
      noChangeRuns: 0,
      retriedRuns: 0,
      deadLetteredRuns: 0,
      workerFailures: 0
    };
    const outcomes = await Promise.allSettled(claims.map((rawClaim) =>
      this.process(providerDetectorClaimSchema.parse(rawClaim))
    ));
    for (const settled of outcomes) {
      if (settled.status === "rejected") {
        summary.workerFailures += 1;
        continue;
      }
      const outcome = settled.value;
      if (outcome.outcome === "forwarded") {
        summary.forwardedRuns += 1;
        summary.emittedEvents += outcome.eventIds.length;
      } else if (outcome.outcome === "no_change") summary.noChangeRuns += 1;
      else if (outcome.outcome === "retry") summary.retriedRuns += 1;
      else summary.deadLetteredRuns += 1;
    }
    return summary;
  }

  private async process(claim: ProviderDetectorClaim): Promise<{ outcome: "forwarded" | "no_change" | "retry" | "dead_letter"; eventIds: string[] }> {
    let brokerReceiptId: string | undefined;
    let resultHash: string | undefined;
    let result: { outcome: "forwarded" | "no_change" | "retry" | "dead_letter"; eventIds: string[] };
    let finalization: {
      outcome: "forwarded" | "no_change" | "retry" | "dead_letter";
      brokerReceiptId?: string;
      resultHash?: string;
      eventIds: string[];
      errorCode?: string;
      retryAt?: string;
    };
    try {
      const issuedAt = this.now();
      const response = await this.dependencies.broker.execute({
        protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
        requestId: `detector_${randomUUID()}`,
        idempotencyKey: `detector:${claim.scheduleId}:${claim.windowEnd}:attempt:${claim.attemptCount}`,
        tenant: claim.tenant,
        actor: { type: "system", subject: "system:provider-detector" },
        providerId: claim.providerId,
        installationId: claim.installationId,
        capability: "provider.events.emit",
        operation: claim.operation,
        input: { windowStart: claim.windowStart, windowEnd: claim.windowEnd, limit: 100 },
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
        correlationId: `detector_run_${claim.runId}`
      });
      brokerReceiptId = response.receipt.receiptId;
      if (response.status !== "succeeded" || !response.result) {
        throw new ProviderDetectorError(
          response.error?.code ?? "detector_provider_query_failed",
          response.error?.retryable ?? false
        );
      }
      resultHash = sha256(stableJson(response.result));
      const rows = extractWarehouseDetectorRows(claim.providerId, response.result, claim);
      if (rows.length === 0) {
        finalization = { outcome: "no_change", brokerReceiptId, resultHash, eventIds: [] };
        result = { outcome: "no_change", eventIds: [] };
      } else {
        const prepared: Array<{ event: EventEnvelope; receipt: ProviderDetectorReceipt }> = [];
        for (const row of rows) {
          let baseEvent: EventEnvelope;
          try {
            baseEvent = normalizeProviderEvent({
              providerId: claim.providerId,
              workspaceId: claim.tenant.projectKey,
              companyId: claim.tenant.organizationId,
              sourceRoute: `connector-broker/detector/${claim.providerId}/${claim.installationId}/${claim.detectorKey}`,
              deliveryId: row.eventId,
              receivedAt: this.now().toISOString(),
              signatureVerified: true,
              signer: "hermes-connector-broker"
            }, {
              ...row.payload,
              id: row.subjectId,
              eventType: claim.eventType,
              occurredAt: row.occurredAt,
              detector: {
                scheduleId: claim.scheduleId,
                runId: claim.runId,
                windowStart: claim.windowStart,
                windowEnd: claim.windowEnd
              }
            });
          } catch {
            throw new ProviderDetectorError("detector_event_invalid", false);
          }
          const receipt = signProviderDetectorReceipt({
            claim,
            event: baseEvent,
            brokerReceiptId,
            resultHash,
            signingKey: this.dependencies.receiptSigningKey,
            keyId: this.dependencies.receiptKeyId,
            now: this.now()
          });
          let event: EventEnvelope;
          try {
            event = eventEnvelopeSchema.parse({
              ...baseEvent,
              subject: { ...baseEvent.subject, type: claim.subjectType },
              correlationId: row.correlationId ?? baseEvent.correlationId,
              evidenceRefs: [
                ...baseEvent.evidenceRefs,
                `connector-receipt:${brokerReceiptId}`,
                `detector-receipt:${receipt.id}`
              ],
              trust: {
                ...baseEvent.trust,
                untrustedFields: [...new Set([...baseEvent.trust.untrustedFields, ...row.untrustedFields])]
              }
            });
          } catch {
            throw new ProviderDetectorError("detector_event_invalid", false);
          }
          prepared.push({ event, receipt });
        }
        const eventIds: string[] = [];
        for (let offset = 0; offset < prepared.length; offset += 10) {
          const batch = prepared.slice(offset, offset + 10);
          await Promise.all(batch.map((item) => this.dependencies.forwarder.forward(item)));
          eventIds.push(...batch.map((item) => item.event.id));
        }
        finalization = { outcome: "forwarded", brokerReceiptId, resultHash, eventIds };
        result = { outcome: "forwarded", eventIds };
      }
    } catch (error) {
      const known = error instanceof ProviderDetectorError ? error : undefined;
      const terminal = known?.retryable === false || claim.attemptCount >= (this.dependencies.maxAttempts ?? 10);
      const outcome = terminal ? "dead_letter" as const : "retry" as const;
      const delaySeconds = Math.min(300 * 2 ** Math.max(claim.attemptCount - 1, 0), 3600);
      finalization = {
        outcome,
        brokerReceiptId,
        resultHash,
        eventIds: [],
        errorCode: known?.code ?? "detector_worker_failed",
        ...(terminal ? {} : { retryAt: new Date(this.now().getTime() + delaySeconds * 1_000).toISOString() })
      };
      result = { outcome, eventIds: [] };
    }
    await this.finalize(claim, finalization);
    return result;
  }

  private async finalize(claim: ProviderDetectorClaim, input: {
    outcome: "forwarded" | "no_change" | "retry" | "dead_letter";
    brokerReceiptId?: string;
    resultHash?: string;
    eventIds: string[];
    errorCode?: string;
    retryAt?: string;
  }) {
    const finalized = await this.dependencies.store.finalize({
      claim,
      ...input,
      completedAt: this.now().toISOString()
    });
    if (!finalized) throw new ProviderDetectorError("detector_lease_conflict", true);
  }

  private now() { return this.dependencies.now?.() ?? new Date(); }
}

export class HttpHermesProviderDetectorForwarder implements ProviderDetectorEventForwarder {
  private readonly target: URL;

  constructor(private readonly options: {
    url: string;
    audience: string;
    tokenProvider: WorkloadTokenProvider;
    fetcher?: typeof fetch;
  }) {
    this.target = trustedHermesUrl(options.url);
  }

  async forward(input: { event: EventEnvelope; receipt: ProviderDetectorReceipt }) {
    const token = await this.options.tokenProvider.getToken({ audience: this.options.audience });
    const response = await (this.options.fetcher ?? fetch)(this.target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-loopgraph-detector-receipt-id": input.receipt.id,
        "x-loopgraph-correlation-id": input.event.id
      },
      body: JSON.stringify({
        schemaVersion: "hermes-provider-detector-event/v1",
        event: input.event,
        detectorReceipt: input.receipt
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw new ProviderDetectorError(
        response.status === 429 ? "hermes_rate_limited" : "hermes_forward_failed",
        response.status === 429 || response.status >= 500
      );
    }
  }
}

export function signProviderDetectorReceipt(input: {
  claim: ProviderDetectorClaim;
  event: EventEnvelope;
  brokerReceiptId: string;
  resultHash: string;
  signingKey: string;
  keyId: string;
  now: Date;
}) {
  const unsigned = {
    schemaVersion: PROVIDER_DETECTOR_RECEIPT_VERSION,
    id: `provider_detector_receipt_${randomUUID()}`,
    scheduleId: input.claim.scheduleId,
    runId: input.claim.runId,
    organizationId: input.claim.tenant.organizationId,
    projectKey: input.claim.tenant.projectKey,
    providerId: input.claim.providerId,
    installationId: input.claim.installationId,
    detectorKey: input.claim.detectorKey,
    operation: input.claim.operation,
    eventType: input.claim.eventType,
    sourceEventId: input.event.id,
    brokerReceiptId: input.brokerReceiptId,
    resultHash: input.resultHash,
    windowStart: input.claim.windowStart,
    windowEnd: input.claim.windowEnd,
    signer: "hermes-connector-broker" as const,
    keyId: input.keyId,
    issuedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + 24 * 60 * 60 * 1_000).toISOString()
  };
  return providerDetectorReceiptSchema.parse({
    ...unsigned,
    attestation: createHmac("sha256", input.signingKey).update(stableJson(unsigned)).digest("base64url")
  });
}

export function verifyProviderDetectorReceipt(receipt: ProviderDetectorReceipt, signingKey: string, now = new Date()) {
  const parsed = providerDetectorReceiptSchema.safeParse(receipt);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) < now.getTime() || Date.parse(parsed.data.issuedAt) > now.getTime() + 30_000) return false;
  const { attestation, ...unsigned } = parsed.data;
  const expected = createHmac("sha256", signingKey).update(stableJson(unsigned)).digest("base64url");
  return constantTimeEqual(attestation, expected);
}

export function providerDetectorScheduleId(installation: Pick<ConnectorInstallationAdmin, "id" | "tenant" | "providerId">, detectorKey: string) {
  return `provider_detector_${sha256(stableJson({
    tenant: installation.tenant,
    installationId: installation.id,
    providerId: installation.providerId,
    detectorKey
  })).slice(0, 32)}`;
}

export function definitionsForProvider(providerId: ProviderId) {
  return PROVIDER_DETECTOR_CATALOG.filter((definition) => definition.providerId === providerId);
}

type DetectorRow = {
  eventId: string;
  subjectId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  untrustedFields: string[];
};

export function extractWarehouseDetectorRows(providerId: WarehouseDetectorProvider, result: Record<string, unknown>, claim: Pick<ProviderDetectorClaim, "windowStart" | "windowEnd">): DetectorRow[] {
  const records = providerId === "bigquery" ? bigQueryRecords(result) : snowflakeRecords(result);
  if (records.length > 100) throw new ProviderDetectorError("detector_result_too_large", false);
  const accepted = new Map<string, { row: DetectorRow; hash: string }>();
  for (const record of records) {
    const material = detectorBoolean(readCaseInsensitive(record, "material", "is_material"));
    if (material === undefined) throw new ProviderDetectorError("detector_materiality_missing", false);
    if (!material) continue;
    const eventId = boundedIdentifier(readCaseInsensitive(record, "event_id", "eventId"), "event_id");
    const subjectId = boundedIdentifier(readCaseInsensitive(record, "subject_id", "subjectId"), "subject_id");
    const occurredAt = detectorTimestamp(readCaseInsensitive(record, "occurred_at", "occurredAt"), claim);
    const payload = detectorJsonObject(readCaseInsensitive(record, "payload_json", "payload"));
    const correlationValue = readCaseInsensitive(record, "correlation_id", "correlationId");
    const correlationId = correlationValue === undefined || correlationValue === null
      ? undefined
      : boundedIdentifier(correlationValue, "correlation_id");
    const untrustedFields = detectorUntrustedFields(readCaseInsensitive(record, "untrusted_fields_json", "untrustedFields"));
    const row = { eventId, subjectId, occurredAt, payload, ...(correlationId ? { correlationId } : {}), untrustedFields };
    const hash = sha256(stableJson(row));
    const existing = accepted.get(eventId);
    if (existing && existing.hash !== hash) throw new ProviderDetectorError("detector_event_identity_conflict", false);
    if (!existing) accepted.set(eventId, { row, hash });
  }
  return [...accepted.values()].map((value) => value.row);
}

function bigQueryRecords(result: Record<string, unknown>) {
  const schema = asRecord(result.schema);
  const fields = Array.isArray(schema.fields) ? schema.fields.map((field) => String(asRecord(field).name ?? "")) : [];
  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (rows.length > 0 && fields.length === 0) throw new ProviderDetectorError("detector_schema_missing", false);
  return rows.map((candidate) => {
    const cells = Array.isArray(asRecord(candidate).f) ? asRecord(candidate).f as unknown[] : [];
    if (cells.length !== fields.length) throw new ProviderDetectorError("detector_row_shape_invalid", false);
    return Object.fromEntries(fields.map((field, index) => [field, bigQueryCell(asRecord(cells[index]).v, 0)]));
  });
}

function bigQueryCell(value: unknown, depth: number): unknown {
  if (depth > 5) throw new ProviderDetectorError("detector_row_depth_exceeded", false);
  if (Array.isArray(value)) return value.map((item) => bigQueryCell(asRecord(item).v, depth + 1));
  if (value && typeof value === "object") {
    const nested = asRecord(value);
    if (Array.isArray(nested.f)) return nested.f.map((item) => bigQueryCell(asRecord(item).v, depth + 1));
  }
  return value;
}

function snowflakeRecords(result: Record<string, unknown>) {
  const metadata = asRecord(result.resultSetMetaData);
  const columns = Array.isArray(metadata.rowType) ? metadata.rowType.map((column) => String(asRecord(column).name ?? "")) : [];
  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (rows.length > 0 && columns.length === 0) throw new ProviderDetectorError("detector_schema_missing", false);
  return rows.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length !== columns.length) throw new ProviderDetectorError("detector_row_shape_invalid", false);
    return Object.fromEntries(columns.map((column, index) => [column, candidate[index]]));
  });
}

function detectorBoolean(value: unknown) {
  if (value === true || value === 1 || value === "1" || value === "true" || value === "TRUE") return true;
  if (value === false || value === 0 || value === "0" || value === "false" || value === "FALSE") return false;
  return undefined;
}

function detectorTimestamp(value: unknown, claim: Pick<ProviderDetectorClaim, "windowStart" | "windowEnd">) {
  if (typeof value !== "string") throw new ProviderDetectorError("detector_occurred_at_invalid", false);
  const parsed = z.string().datetime().safeParse(value);
  if (!parsed.success) throw new ProviderDetectorError("detector_occurred_at_invalid", false);
  const occurred = Date.parse(parsed.data);
  if (occurred < Date.parse(claim.windowStart) || occurred > Date.parse(claim.windowEnd) + 5 * 60 * 1_000) {
    throw new ProviderDetectorError("detector_event_outside_window", false);
  }
  return parsed.data;
}

function detectorJsonObject(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > 128 * 1024) throw new ProviderDetectorError("detector_payload_too_large", false);
    try { parsed = JSON.parse(value); } catch { throw new ProviderDetectorError("detector_payload_invalid", false); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProviderDetectorError("detector_payload_invalid", false);
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > 128 * 1024) throw new ProviderDetectorError("detector_payload_too_large", false);
  try {
    assertSecretFree(parsed, "provider_detector.payload");
  } catch {
    throw new ProviderDetectorError("detector_payload_secret_like", false);
  }
  return parsed as Record<string, unknown>;
}

function detectorUntrustedFields(value: unknown) {
  if (value === undefined || value === null || value === "") return [];
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new ProviderDetectorError("detector_untrusted_fields_invalid", false); }
  }
  if (!Array.isArray(parsed) || parsed.length > 50) throw new ProviderDetectorError("detector_untrusted_fields_invalid", false);
  return parsed.map((item) => {
    const field = String(item);
    if (!/^normalizedPayload(?:\.[A-Za-z0-9_-]+){1,8}$/.test(field) || field.length > 512) {
      throw new ProviderDetectorError("detector_untrusted_fields_invalid", false);
    }
    return field;
  });
}

function boundedIdentifier(value: unknown, field: string) {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length < 1 || String(value).length > 256) {
    throw new ProviderDetectorError(`detector_${field}_invalid`, false);
  }
  return String(value);
}

function readCaseInsensitive(record: Record<string, unknown>, ...names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return Object.entries(record).find(([key]) => wanted.has(key.toLowerCase()))?.[1];
}

function trustedHermesUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Hermes detector URL cannot contain credentials, query, or fragment");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Production Hermes detector URL must use HTTPS");
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Hermes detector URL protocol is invalid");
  return url;
}

function detector(providerId: WarehouseDetectorProvider, detectorKey: string, operation: string, eventType: string, subjectType: string) {
  return providerDetectorDefinitionSchema.parse({
    providerId,
    detectorKey,
    operation,
    eventType,
    subjectType,
    cadenceMinutes: 60,
    windowMinutes: 60,
    overlapMinutes: 5
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return leftDigest.length === rightDigest.length && timingSafeEqual(leftDigest, rightDigest);
}

export class ProviderDetectorError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = "ProviderDetectorError";
  }
}
