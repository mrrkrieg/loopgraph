import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  CONNECTOR_CAPABILITY_MANIFEST_VERSION,
  connectorCapabilityManifestSchema,
  type BrokerCapability,
  type ConnectorCapabilityManifest,
  type ProviderId
} from "../core";

export type ProviderOperationDescriptor = {
  providerId: ProviderId;
  operation: string;
  capability: BrokerCapability;
  minimumScopes: readonly string[];
  write: boolean;
  approvalRequired: boolean;
  permittedObjectTypes: readonly string[];
  riskClass: "read" | "draft" | "write" | "privileged";
  idempotencySupport: "read_safe" | "provider" | "broker";
  evidenceFields: readonly string[];
};

const common = (providerId: ProviderId): ProviderOperationDescriptor[] => [
  descriptor(providerId, "health.check", "provider.health.read"),
  descriptor(providerId, "oauth.exchange", "provider.oauth.exchange"),
  descriptor(providerId, "oauth.refresh", "provider.oauth.refresh"),
  descriptor(providerId, "oauth.revoke", "provider.oauth.revoke", [], true, true),
  descriptor(providerId, "webhook.subscribe", "provider.webhooks.subscribe", [], true, true),
  descriptor(providerId, "webhook.verify", "provider.webhooks.verify"),
  descriptor(providerId, "installation.disconnect", "provider.disconnect", [], true, true)
];

export const PROVIDER_OPERATION_CATALOG: ProviderOperationDescriptor[] = [
  ...provider("hubspot", [
    ["crm.companies.read", "provider.data.read", ["crm.objects.companies.read"]],
    ["crm.contacts.read", "provider.data.read", ["crm.objects.contacts.read"]],
    ["crm.deals.read", "provider.data.read", ["crm.objects.deals.read"]]
  ]),
  ...provider("google_ads", [
    ["ads.campaign_performance.read", "provider.data.read", ["https://www.googleapis.com/auth/adwords"]],
    ["ads.budget_change.execute", "provider.action.execute", ["https://www.googleapis.com/auth/adwords"], true, true]
  ]),
  ...provider("slack", [
    ["conversations.history.read", "provider.data.read", ["channels:history"]],
    ["message.draft.create", "provider.draft.write", ["chat:write"], true],
    ["message.send.execute", "provider.action.execute", ["chat:write"], true, true]
  ]),
  ...provider("notion", [
    ["page.read", "provider.data.read", ["read_content"]],
    ["page.draft.update", "provider.draft.write", ["update_content"], true]
  ]),
  ...provider("salesforce", [
    ["sobject.read", "provider.data.read", ["api"]],
    ["sobject.update.execute", "provider.action.execute", ["api"], true, true]
  ]),
  ...provider("stripe", [
    ["customer.read", "provider.data.read", ["read_only"]],
    ["subscription.read", "provider.data.read", ["read_only"]],
    ["refund.execute", "provider.action.execute", [], true, true]
  ]),
  ...provider("github", [
    ["repository.read", "provider.data.read", ["contents:read"]],
    ["issue.read", "provider.data.read", ["issues:read"]],
    ["issue.comment.draft", "provider.draft.write", ["issues:write"], true],
    ["pull_request.merge.execute", "provider.action.execute", ["pull_requests:write"], true, true]
  ]),
  ...provider("zendesk", [
    ["ticket.read", "provider.data.read", []],
    ["ticket.reply.draft", "provider.draft.write", [], true]
  ]),
  ...provider("intercom", [
    ["conversation.read", "provider.data.read", ["read_conversations"]],
    ["conversation.reply.draft", "provider.draft.write", [], true]
  ]),
  ...provider("workday", [["worker.read", "provider.data.read", []]]),
  ...provider("greenhouse", [
    ["candidate.read", "provider.data.read", ["candidates:read"]],
    ["job.read", "provider.data.read", ["jobs:read"]]
  ]),
  ...provider("netsuite", [["transaction.read", "provider.data.read", []]]),
  ...provider("quickbooks", [["accounting.read", "provider.data.read", []]]),
  ...provider("gmail", [
    ["threads.read", "provider.data.read", ["https://www.googleapis.com/auth/gmail.readonly"]],
    ["drafts.create", "provider.draft.write", ["https://www.googleapis.com/auth/gmail.compose"], true],
    ["messages.send", "provider.action.execute", ["https://www.googleapis.com/auth/gmail.send"], true, true]
  ]),
  ...provider("google_calendar", [
    ["events.read", "provider.data.read", ["https://www.googleapis.com/auth/calendar.events.readonly"]]
  ]),
  ...provider("outlook", [
    ["threads.read", "provider.data.read", ["Mail.Read"]],
    ["events.read", "provider.data.read", ["Calendars.Read"]],
    ["drafts.create", "provider.draft.write", ["Mail.ReadWrite"], true],
    ["message.draft", "provider.draft.write", ["Mail.ReadWrite"], true],
    ["message.send", "provider.action.execute", ["Mail.Send"], true, true]
  ]),
  ...provider("teams", [
    ["messages.draft", "provider.draft.write", ["ChannelMessage.Send"], true],
    ["channel.post", "provider.action.execute", ["ChannelMessage.Send"], true, true]
  ]),
  ...provider("posthog", [["insights.query", "provider.data.read", ["query:read"]]]),
  ...provider("amplitude", [["events.query", "provider.data.read", ["analytics:read"]]]),
  ...provider("linear", [
    ["issues.read", "provider.data.read", ["read"]],
    ["incidents.read", "provider.data.read", ["read"]],
    ["projects.read", "provider.data.read", ["read"]],
    ["issues.create", "provider.action.execute", ["write"], true, true],
    ["issues.update", "provider.action.execute", ["write"], true, true]
  ]),
  ...provider("jira", [
    ["issues.read", "provider.data.read", ["read:jira-work"]],
    ["incidents.read", "provider.data.read", ["read:jira-work"]],
    ["versions.read", "provider.data.read", ["read:jira-work"]],
    ["issues.create", "provider.action.execute", ["write:jira-work"], true, true],
    ["issues.update", "provider.action.execute", ["write:jira-work"], true, true]
  ]),
  ...provider("gitlab", [
    ["issues.read", "provider.data.read", ["read_api"]],
    ["deployments.read", "provider.data.read", ["read_api"]]
  ])
];

export function getProviderOperation(providerId: ProviderId, operation: string) {
  return PROVIDER_OPERATION_CATALOG.find((candidate) =>
    candidate.providerId === providerId && candidate.operation === operation
  );
}

export function buildSignedCapabilityManifest(input: {
  providerId: ProviderId;
  signingKey: string;
  keyId: string;
  adapterVersion?: string;
  now?: Date;
}): ConnectorCapabilityManifest {
  const operations = PROVIDER_OPERATION_CATALOG
    .filter((descriptor) => descriptor.providerId === input.providerId)
    .map((descriptor) => ({
      operationId: descriptor.operation,
      capability: descriptor.capability,
      mode: descriptor.capability === "provider.draft.write" ? "draft" as const : descriptor.write ? "write" as const : "read" as const,
      inputSchemaVersion: `${descriptor.providerId}.${descriptor.operation}.input/v1`,
      outputSchemaVersion: `${descriptor.providerId}.${descriptor.operation}.output/v1`,
      requiredScopes: [...descriptor.minimumScopes],
      permittedObjectTypes: [...descriptor.permittedObjectTypes],
      riskClass: descriptor.riskClass,
      approvalPolicy: descriptor.approvalRequired ? "fingerprint_and_human" as const : descriptor.write ? "fingerprint" as const : "none" as const,
      idempotencySupport: descriptor.idempotencySupport,
      evidenceFields: [...descriptor.evidenceFields]
    }));
  const body = {
    schemaVersion: CONNECTOR_CAPABILITY_MANIFEST_VERSION,
    providerId: input.providerId,
    adapterVersion: input.adapterVersion ?? "1.0.0",
    generatedAt: (input.now ?? new Date()).toISOString(),
    operations
  };
  const manifestHash = sha256(stableJson(body));
  return connectorCapabilityManifestSchema.parse({
    ...body,
    manifestHash,
    signature: createHmac("sha256", input.signingKey).update(manifestHash).digest("base64url"),
    keyId: input.keyId
  });
}

export function verifyCapabilityManifest(manifest: ConnectorCapabilityManifest, signingKey: string) {
  const parsed = connectorCapabilityManifestSchema.parse(manifest);
  const body = {
    schemaVersion: parsed.schemaVersion,
    providerId: parsed.providerId,
    adapterVersion: parsed.adapterVersion,
    generatedAt: parsed.generatedAt,
    operations: parsed.operations
  };
  const hash = sha256(stableJson(body));
  if (hash !== parsed.manifestHash) return false;
  const expected = Buffer.from(createHmac("sha256", signingKey).update(hash).digest("base64url"));
  const actual = Buffer.from(parsed.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function provider(
  providerId: ProviderId,
  rows: Array<[
    string,
    BrokerCapability,
    readonly string[],
    boolean?,
    boolean?
  ]>
) {
  return [...common(providerId), ...rows.map((row) => descriptor(providerId, ...row))];
}

function descriptor(
  providerId: ProviderId,
  operation: string,
  capability: BrokerCapability,
  minimumScopes: readonly string[] = [],
  write = false,
  approvalRequired = false,
  permittedObjectTypes: readonly string[] = ["CompanyObject"]
): ProviderOperationDescriptor {
  return {
    providerId,
    operation,
    capability,
    minimumScopes,
    write,
    approvalRequired,
    permittedObjectTypes,
    riskClass: approvalRequired ? "privileged" : capability === "provider.draft.write" ? "draft" : write ? "write" : "read",
    idempotencySupport: write ? "broker" : "read_safe",
    evidenceFields: ["providerObjectRef", "sourceTimestamp", "responseStatusClass"]
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
