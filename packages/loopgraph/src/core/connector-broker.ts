import { createHash } from "node:crypto";
import { z } from "zod";
import {
  credentialReferenceSchema,
  customerManagedKeyReferenceSchema,
  type CredentialReference
} from "./credential-reference";
import { providerIdSchema } from "./provider-onboarding";

export const CONNECTOR_BROKER_PROTOCOL_VERSION = "hermes-connector-broker/v1" as const;
export const CONNECTOR_AUDIT_RECEIPT_VERSION = "connector-audit-receipt/v1" as const;
export const CONNECTOR_CAPABILITY_MANIFEST_VERSION = "connector-capability-manifest/v1" as const;
export const CONNECTOR_PREPARED_ACTION_VERSION = "connector-prepared-action/v1" as const;

export const connectorTenantSchema = z.object({
  organizationId: z.string().min(1).max(128),
  projectKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
});

export const connectorActorSchema = z.object({
  type: z.enum(["workload", "user", "system"]),
  subject: z.string().min(1).max(512),
  issuer: z.string().min(1).max(512).optional(),
  audience: z.string().min(1).max(512).optional()
});

export const brokerCapabilitySchema = z.enum([
  "provider.oauth.authorize",
  "provider.oauth.exchange",
  "provider.oauth.refresh",
  "provider.oauth.revoke",
  "provider.webhooks.subscribe",
  "provider.webhooks.verify",
  "provider.health.read",
  "provider.data.read",
  "provider.draft.write",
  "provider.action.execute",
  "provider.disconnect"
]);

export const connectorOperationSchema = z.string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9_.-]+$/);

export const connectorCompanyObjectSchema = z.object({
  type: z.string().min(1).max(96).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
  id: z.string().min(1).max(256).optional(),
  externalRef: z.string().min(1).max(512).optional()
}).strict();

export const connectorInvocationContextSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  environment: z.enum(["development", "staging", "production"]),
  agentInstanceId: z.string().min(1).max(256),
  companyObject: connectorCompanyObjectSchema,
  loopId: z.string().min(1).max(256),
  loopSpecHash: z.string().regex(/^[a-f0-9]{64}$/),
  routeJobId: z.string().min(1).max(256),
  activationMode: z.enum(["shadow", "recommend", "execute"])
}).strict();

export const connectorBrokerRequestSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_BROKER_PROTOCOL_VERSION).default(CONNECTOR_BROKER_PROTOCOL_VERSION),
  requestId: z.string().min(8).max(128),
  idempotencyKey: z.string().min(8).max(192),
  tenant: connectorTenantSchema,
  actor: connectorActorSchema,
  providerId: providerIdSchema,
  installationId: z.string().min(1).max(128),
  capability: brokerCapabilitySchema,
  operation: connectorOperationSchema,
  input: z.record(z.string(), z.unknown()).default({}),
  context: connectorInvocationContextSchema.optional(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  correlationId: z.string().min(8).max(128)
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt must be after issuedAt" });
  }
});

const connectorActionEnvelopeShape = {
  protocolVersion: z.literal(CONNECTOR_BROKER_PROTOCOL_VERSION).default(CONNECTOR_BROKER_PROTOCOL_VERSION),
  requestId: z.string().min(8).max(128),
  idempotencyKey: z.string().min(8).max(192),
  tenant: connectorTenantSchema,
  actor: connectorActorSchema,
  providerId: providerIdSchema,
  installationId: z.string().min(1).max(128),
  capability: brokerCapabilitySchema,
  operation: connectorOperationSchema,
  context: connectorInvocationContextSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  correlationId: z.string().min(8).max(128)
} satisfies z.ZodRawShape;

export const connectorActionPrepareRequestSchema = z.object({
  ...connectorActionEnvelopeShape,
  input: z.record(z.string(), z.unknown())
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt must be after issuedAt" });
  }
});

export const connectorPreparedActionSchema = z.object({
  schemaVersion: z.literal(CONNECTOR_PREPARED_ACTION_VERSION),
  actionId: z.string().min(8).max(160),
  tenant: connectorTenantSchema,
  providerId: providerIdSchema,
  installationId: z.string().min(1).max(128),
  capability: brokerCapabilitySchema,
  operation: connectorOperationSchema,
  context: connectorInvocationContextSchema,
  canonicalInput: z.record(z.string(), z.unknown()),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  preparedBy: z.string().min(1).max(512),
  preparedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: z.enum(["prepared", "committing", "committed", "expired", "revoked"]),
  approvalRequired: z.boolean(),
  riskClass: z.enum(["read", "draft", "write", "privileged"])
}).strict();

export const connectorActionCommitRequestSchema = z.object({
  ...connectorActionEnvelopeShape,
  preparedActionId: z.string().min(8).max(160),
  preparedActionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approvalReceiptId: z.string().min(1).max(512).optional()
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt must be after issuedAt" });
  }
});

export const connectorManifestOperationSchema = z.object({
  operationId: connectorOperationSchema,
  capability: brokerCapabilitySchema,
  mode: z.enum(["read", "draft", "write"]),
  inputSchemaVersion: z.string().min(1).max(128),
  outputSchemaVersion: z.string().min(1).max(128),
  requiredScopes: z.array(z.string()),
  permittedObjectTypes: z.array(z.string().min(1)).min(1),
  riskClass: z.enum(["read", "draft", "write", "privileged"]),
  approvalPolicy: z.enum(["none", "fingerprint", "fingerprint_and_human"]),
  idempotencySupport: z.enum(["read_safe", "provider", "broker"]),
  evidenceFields: z.array(z.string().min(1))
}).strict();

export const connectorCapabilityManifestSchema = z.object({
  schemaVersion: z.literal(CONNECTOR_CAPABILITY_MANIFEST_VERSION),
  providerId: providerIdSchema,
  adapterVersion: z.string().min(1).max(64),
  generatedAt: z.string().datetime(),
  operations: z.array(connectorManifestOperationSchema),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().min(16),
  keyId: z.string().min(1).max(128)
}).strict();

export const connectorAuditReceiptSchema = z.object({
  schemaVersion: z.literal(CONNECTOR_AUDIT_RECEIPT_VERSION).default(CONNECTOR_AUDIT_RECEIPT_VERSION),
  receiptId: z.string().min(8),
  requestId: z.string().min(8),
  correlationId: z.string().min(8),
  organizationId: z.string().min(1),
  projectKey: z.string().min(1),
  installationId: z.string().min(1),
  providerId: providerIdSchema,
  capability: brokerCapabilitySchema,
  operation: connectorOperationSchema,
  actorSubject: z.string().min(1),
  actorType: z.enum(["workload", "user", "system"]),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  environment: z.enum(["development", "staging", "production"]).optional(),
  workspaceId: z.string().min(1).max(128).optional(),
  agentInstanceId: z.string().min(1).max(256).optional(),
  companyObjectType: z.string().min(1).max(96).optional(),
  companyObjectId: z.string().min(1).max(256).optional(),
  loopId: z.string().min(1).max(256).optional(),
  loopSpecHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  routeJobId: z.string().min(1).max(256).optional(),
  activationMode: z.enum(["shadow", "recommend", "execute"]).optional(),
  outcome: z.enum(["accepted", "denied", "error"]),
  reasonCode: z.string().min(1).max(128).optional(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  occurredAt: z.string().datetime(),
  durationMs: z.number().int().min(0)
});

export const connectorBrokerResponseSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_BROKER_PROTOCOL_VERSION),
  requestId: z.string().min(8),
  status: z.enum(["succeeded", "denied", "failed"]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(512),
    retryable: z.boolean().default(false)
  }).optional(),
  receipt: connectorAuditReceiptSchema
});

export const connectorActionPrepareResponseSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_BROKER_PROTOCOL_VERSION),
  requestId: z.string().min(8),
  status: z.literal("prepared"),
  preparedAction: connectorPreparedActionSchema,
  receipt: connectorAuditReceiptSchema
}).strict();

export const connectorActionCommitResponseSchema = connectorBrokerResponseSchema;

export const connectorInstallationAdminSchema = z.object({
  id: z.string().min(1),
  tenant: connectorTenantSchema,
  providerId: providerIdSchema,
  displayName: z.string().min(1).max(120),
  environment: z.enum(["development", "staging", "production"]).default("development"),
  status: z.enum([
    "prepared",
    "awaiting_consent",
    "exchanging",
    "connected",
    "subscription_pending",
    "active",
    "degraded",
    "rotating",
    "disabling",
    "locally_disabled",
    "provider_revocation_pending",
    "subscriptions_removing",
    "revoking",
    "revoked",
    "deletion_pending",
    "deleted",
    "disconnected",
    "failed"
  ]),
  credentialRef: credentialReferenceSchema,
  credentialNamespace: z.string().min(1).max(512),
  grantedScopes: z.array(z.string().min(1)).default([]),
  allowedCapabilities: z.array(brokerCapabilitySchema).default([]),
  customerManagedKeyRef: customerManagedKeyReferenceSchema.optional(),
  webhookSecretRef: credentialReferenceSchema.optional(),
  webhookSecretPreviousRef: credentialReferenceSchema.optional(),
  providerSubscriptionId: z.string().min(1).max(256).optional(),
  webhookStatus: z.enum(["not_configured", "pending", "active", "degraded", "revoked"]).default("not_configured"),
  connectedBy: z.string().min(1).max(512).optional(),
  connectedAt: z.string().datetime().optional(),
  lastHealthCheckAt: z.string().datetime().optional(),
  lastRotatedAt: z.string().datetime().optional(),
  tokenExpiresAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const connectorInstallationViewSchema = connectorInstallationAdminSchema.omit({
  credentialRef: true,
  credentialNamespace: true,
  customerManagedKeyRef: true,
  webhookSecretRef: true,
  webhookSecretPreviousRef: true
}).extend({
  customerManagedKeyConfigured: z.boolean()
});

export function buildCredentialNamespace(input: {
  organizationId: string;
  projectKey: string;
  providerId: z.infer<typeof providerIdSchema>;
  installationId: string;
  environment?: "development" | "staging" | "production";
}) {
  const safe = (value: string) => encodeURIComponent(value).replace(/%2F/gi, "_");
  return [
    "organizations",
    safe(input.organizationId),
    "projects",
    safe(input.projectKey),
    "environments",
    safe(input.environment ?? "development"),
    "providers",
    safe(input.providerId),
    "installations",
    safe(input.installationId)
  ].join("/");
}

export function credentialNamespaceFingerprint(namespace: string) {
  return createHash("sha256").update(namespace).digest("hex").slice(0, 24);
}

export function connectorInstallationHasExpectedNamespace(installation: Pick<
  ConnectorInstallationAdmin,
  "id" | "tenant" | "providerId" | "environment" | "credentialNamespace"
>) {
  return installation.credentialNamespace === buildCredentialNamespace({
    ...installation.tenant,
    providerId: installation.providerId,
    installationId: installation.id,
    environment: installation.environment
  });
}

export function credentialReferenceMatchesNamespace(reference: string, namespace: string) {
  const parsedReference = credentialReferenceSchema.safeParse(reference);
  if (!parsedReference.success || !namespace || namespace.includes("..")) return false;
  const resourceSegments = reference
    .slice(reference.indexOf("://") + 3)
    .split("/")
    .filter(Boolean);
  const namespaceSegments = namespace.split("/").filter(Boolean);
  const fingerprint = credentialNamespaceFingerprint(namespace);
  if (resourceSegments.some((segment) => segment === fingerprint || segment.startsWith(`${fingerprint}--`))) return true;
  if (namespaceSegments.length === 0 || namespaceSegments.length > resourceSegments.length) return false;
  return resourceSegments.some((_, offset) => namespaceSegments.every(
    (segment, index) => resourceSegments[offset + index] === segment
  ));
}

export function deriveCredentialChildReference(reference: CredentialReference, purpose: string) {
  const parsed = credentialReferenceSchema.parse(reference);
  if (!/^[a-z0-9][a-z0-9/_-]{1,127}$/i.test(purpose) || purpose.includes("..")) {
    throw new Error("Credential child purpose is invalid");
  }
  const scheme = parsed.slice(0, parsed.indexOf("://"));
  const resource = parsed.slice(parsed.indexOf("://") + 3);
  const suffix = createHash("sha256").update(purpose).digest("hex").slice(0, 16);
  if (["aws-sm", "vault", "broker", "hermes"].includes(scheme)) {
    return credentialReferenceSchema.parse(`${parsed.replace(/\/+$/, "")}/${purpose}`);
  }
  if (scheme === "gcp-sm") {
    const match = /^(projects\/[^/]+\/secrets\/[^/]+)(?:\/versions\/[^/]+)?$/.exec(resource);
    if (!match) throw new Error("GCP credential reference must identify a Secret Manager secret");
    return credentialReferenceSchema.parse(`gcp-sm://${match[1]}--${suffix}`);
  }
  if (scheme === "azure-kv") {
    const [vault, secret] = resource.split("/");
    if (!vault || !secret) throw new Error("Azure credential reference must identify a vault secret");
    return credentialReferenceSchema.parse(`azure-kv://${vault}/${secret}--${suffix}`);
  }
  if (scheme === "keychain") {
    const [service, account] = resource.split("/");
    if (!service || !account) throw new Error("Keychain credential reference must identify a service and account");
    return credentialReferenceSchema.parse(`keychain://${service}/${account}--${suffix}`);
  }
  throw new Error(`${scheme} credential references cannot store child material`);
}

export type ConnectorTenant = z.infer<typeof connectorTenantSchema>;
export type BrokerCapability = z.infer<typeof brokerCapabilitySchema>;
export type ConnectorBrokerRequest = z.infer<typeof connectorBrokerRequestSchema>;
export type ConnectorBrokerResponse = z.infer<typeof connectorBrokerResponseSchema>;
export type ConnectorInvocationContext = z.infer<typeof connectorInvocationContextSchema>;
export type ConnectorActionPrepareRequest = z.infer<typeof connectorActionPrepareRequestSchema>;
export type ConnectorPreparedAction = z.infer<typeof connectorPreparedActionSchema>;
export type ConnectorActionPrepareResponse = z.infer<typeof connectorActionPrepareResponseSchema>;
export type ConnectorActionCommitRequest = z.infer<typeof connectorActionCommitRequestSchema>;
export type ConnectorCapabilityManifest = z.infer<typeof connectorCapabilityManifestSchema>;
export type ConnectorAuditReceipt = z.infer<typeof connectorAuditReceiptSchema>;
export type ConnectorInstallationAdmin = z.infer<typeof connectorInstallationAdminSchema>;
export type ConnectorInstallationView = z.infer<typeof connectorInstallationViewSchema>;
