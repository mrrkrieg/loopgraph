import {
  createEventEnvelopeId,
  eventEnvelopeSchema,
  type EventEnvelope,
  type ProviderId
} from "../core";

export type ProviderNormalizationContext = {
  providerId: ProviderId;
  workspaceId: string;
  companyId: string;
  sourceRoute: string;
  deliveryId: string;
  receivedAt?: string;
  signatureVerified: boolean;
  signer?: string;
};

export function normalizeProviderEvent(context: ProviderNormalizationContext, payload: unknown): EventEnvelope {
  const record = asRecord(payload);
  const normalized = providerFields(context.providerId, record);
  const receivedAt = context.receivedAt ?? new Date().toISOString();
  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId({ workspaceId: context.workspaceId, source: context.providerId, sourceDeliveryId: context.deliveryId, eventType: normalized.eventType }),
    workspaceId: context.workspaceId,
    companyId: context.companyId,
    source: context.providerId,
    sourceRoute: context.sourceRoute,
    sourceDeliveryId: context.deliveryId,
    eventType: normalized.eventType,
    occurredAt: normalized.occurredAt ?? receivedAt,
    receivedAt,
    subject: normalized.subject,
    correlationId: normalized.correlationId ?? `${context.providerId}:${normalized.subject.id}`,
    normalizedPayload: normalized.payload,
    trust: {
      signatureVerified: context.signatureVerified,
      signer: context.signer,
      untrustedFields: normalized.untrustedFields
    },
    sensitivity: normalized.sensitivity ?? "confidential"
  });
}

type ProviderFields = {
  eventType: string;
  occurredAt?: string;
  correlationId?: string;
  subject: { type: string; id: string; display?: string };
  payload: Record<string, unknown>;
  untrustedFields: string[];
  sensitivity?: EventEnvelope["sensitivity"];
};

function providerFields(provider: ProviderId, event: Record<string, unknown>): ProviderFields {
  const occurredAt = iso(event.occurredAt ?? event.created ?? event.timestamp ?? event.eventTime);
  if (provider === "github") {
    const issue = asRecord(event.issue);
    const pull = asRecord(event.pull_request);
    const repository = asRecord(event.repository);
    const subjectId = string(issue.number ?? pull.number ?? repository.full_name ?? event.id, "unknown");
    const kind = Object.keys(issue).length ? "issue" : Object.keys(pull).length ? "pull_request" : "repository";
    return fields(`${kind}.${string(event.action, "updated")}`, kind, subjectId, event, occurredAt, ["normalizedPayload.issue.title", "normalizedPayload.issue.body", "normalizedPayload.comment.body"]);
  }
  if (provider === "hubspot") {
    const objectId = string(event.objectId ?? event.object_id, "unknown");
    const subscription = string(event.subscriptionType ?? event.subscription_type, "object.propertyChange");
    const type = subscription.split(".")[0] || "crm_object";
    return fields(subscription, mapEntityType(type), objectId, event, occurredAt, ["normalizedPayload.propertyValue"]);
  }
  if (provider === "stripe") {
    const object = asRecord(asRecord(event.data).object);
    return fields(string(event.type, "stripe.event"), mapEntityType(string(object.object, "payment_object")), string(object.id ?? event.id, "unknown"), { object, livemode: event.livemode }, occurredAt, []);
  }
  if (provider === "slack") {
    const slackEvent = asRecord(event.event);
    return fields(string(slackEvent.type ?? event.type, "slack.event"), "conversation", string(slackEvent.channel ?? slackEvent.ts ?? event.event_id, "unknown"), slackEvent, iso(slackEvent.event_ts) ?? occurredAt, ["normalizedPayload.text"]);
  }
  if (provider === "notion") {
    const entity = asRecord(event.entity);
    return fields(string(event.type, "page.updated"), "document", string(entity.id ?? event.id, "unknown"), event, occurredAt, ["normalizedPayload.data"]);
  }
  if (provider === "salesforce") {
    const data = asRecord(event.data);
    return fields(string(event.eventType ?? event.type, "salesforce.change"), mapEntityType(string(event.objectType ?? (data.ChangeEventHeader ? "account" : undefined), "account")), string(event.recordId ?? data.Id ?? event.id, "unknown"), event, occurredAt, []);
  }
  if (provider === "google_ads") {
    const campaign = asRecord(event.campaign);
    return fields(string(event.eventType ?? event.type, "campaign.performance_anomaly"), "campaign", string(campaign.id ?? event.campaignId ?? event.id, "unknown"), event, occurredAt, []);
  }
  if (["zendesk", "intercom"].includes(provider)) {
    const ticket = asRecord(event.ticket);
    const conversation = asRecord(event.conversation);
    return fields(string(event.type, "support.updated"), "support_ticket", string(ticket.id ?? conversation.id ?? event.id, "unknown"), event, occurredAt, ["normalizedPayload.description", "normalizedPayload.body"]);
  }
  if (["workday", "greenhouse"].includes(provider)) {
    return fields(string(event.type, "employee.updated"), event.candidateId ? "candidate" : "employee", string(event.employeeId ?? event.candidateId ?? event.id, "unknown"), event, occurredAt, ["normalizedPayload.name", "normalizedPayload.email"], "restricted");
  }
  return fields(string(event.type, "finance.updated"), event.invoiceId ? "invoice" : "account", string(event.invoiceId ?? event.accountId ?? event.id, "unknown"), event, occurredAt, []);
}

function fields(eventType: string, type: string, id: string, payload: Record<string, unknown>, occurredAt: string | undefined, untrustedFields: string[], sensitivity?: EventEnvelope["sensitivity"]): ProviderFields {
  return { eventType, occurredAt, subject: { type, id }, payload: boundedPayload(payload), untrustedFields, sensitivity };
}
function boundedPayload(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) > 256 * 1024) throw new Error("Provider payload exceeds the 256 KiB normalization limit");
  return payload;
}
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown, fallback: string) { return typeof value === "string" || typeof value === "number" ? String(value) : fallback; }
function iso(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
function mapEntityType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("compan") || normalized === "account") return "account";
  if (normalized.includes("campaign")) return "campaign";
  if (normalized.includes("incident")) return "incident";
  if (normalized.includes("contract") || normalized.includes("subscription")) return "contract";
  if (normalized.includes("contact") || normalized.includes("customer")) return "customer";
  if (normalized.includes("deal") || normalized.includes("opportun")) return "deal";
  if (normalized.includes("invoice")) return "invoice";
  return normalized.replace(/[^a-z0-9_]/g, "_") || "object";
}
