import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { credentialReferenceSchema } from "./credential-reference";

export const CONNECTION_PLAN_SCHEMA_VERSION = "connection-plan/v1alpha1" as const;
export const CONNECTOR_MANIFEST_SCHEMA_VERSION = "connector-manifest/v1alpha1" as const;
export const CONNECTION_INSTANCE_SCHEMA_VERSION = "connection-instance/v1alpha1" as const;
export const MANUAL_CONNECTION_FALLBACKS_SCHEMA_VERSION = "manual-connection-fallbacks/v1alpha1" as const;

export const connectionRequiredForSchema = z.enum(["design", "simulation", "execution", "routing"]);
export const connectionCapabilityStatusSchema = z.enum(["missing", "manual_fallback", "connected", "degraded"]);
export const connectorTransportSchema = z.enum(["native_adapter", "mcp", "http_api", "file_import", "manual"]);
export const connectorAuthTypeSchema = z.enum(["none", "api_key", "oauth2", "hmac", "provider_app", "service_account", "manual"]);
export const connectorCapabilityDirectionSchema = z.enum(["read", "event", "draft_write", "approved_write"]);
export const connectorRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export const connectionEnvironmentSchema = z.enum(["simulate", "sandbox", "live"]);
export const connectionSourceSchema = z.enum(["local_registry", "hermes_connector_broker"]);
export { credentialReferenceSchema };
export const connectorCategorySchema = z.enum([
  "ads",
  "analytics",
  "data_warehouse",
  "crm",
  "content_repository",
  "cms",
  "messaging",
  "database",
  "billing",
  "finance",
  "approval",
  "repository",
  "issue_tracker",
  "ci",
  "incident",
  "support",
  "ats",
  "hris",
  "legal",
  "compliance",
  "project",
  "calendar",
  "email",
  "manual",
  "custom"
]);

export const connectorCapabilitySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  direction: connectorCapabilityDirectionSchema,
  minimumScopes: z.array(z.string()).default([]),
  riskLevel: connectorRiskLevelSchema.default("low"),
  manualFallback: z.string().optional()
});

export const connectorWebhookSchema = z.object({
  sourcePatterns: z.array(z.string().min(1)).default([]),
  eventTypePatterns: z.array(z.string().min(1)).default([]),
  subscription: z.string().min(1),
  signature: z.string().min(1),
  routeNameTemplate: z.string().min(1),
  filterHints: z.array(z.string()).default([]),
  transformVersion: z.string().min(1),
  stableDeliveryId: z.string().min(1),
  subjectIdPath: z.string().min(1),
  maxPayloadKb: z.number().int().min(1).default(256),
  burstLimitPerMinute: z.number().int().min(1).default(120),
  exampleEventTypes: z.array(z.string()).default([])
});

export const connectorManifestSchema = z.object({
  schemaVersion: z.literal(CONNECTOR_MANIFEST_SCHEMA_VERSION).default(CONNECTOR_MANIFEST_SCHEMA_VERSION),
  id: z.string().min(1),
  label: z.string().min(1),
  category: connectorCategorySchema,
  transport: connectorTransportSchema,
  authType: connectorAuthTypeSchema,
  capabilities: z.array(connectorCapabilitySchema).min(1),
  webhook: connectorWebhookSchema.optional(),
  healthCheck: z.object({
    mode: z.enum(["none", "manual", "read_probe", "mcp_tool", "http_probe"]).default("manual"),
    description: z.string().optional()
  }).default({ mode: "manual" }),
  notes: z.array(z.string()).default([])
});

export const connectionInstanceSchema = z.object({
  schemaVersion: z.literal(CONNECTION_INSTANCE_SCHEMA_VERSION).default(CONNECTION_INSTANCE_SCHEMA_VERSION),
  id: z.string().min(1),
  manifestId: z.string().min(1),
  source: connectionSourceSchema.default("local_registry"),
  externalInstallationId: z.string().min(1).optional(),
  brokerCapabilities: z.array(z.string().min(1)).default([]),
  accountLabel: z.string().optional(),
  capabilityKeys: z.array(z.string().min(1)).default([]),
  credentialRef: credentialReferenceSchema.optional(),
  grantedScopes: z.array(z.string()).default([]),
  status: connectionCapabilityStatusSchema,
  statusReason: z.string().optional(),
  environment: connectionEnvironmentSchema.default("simulate"),
  readPolicy: z.enum(["not_allowed", "manual_fallback", "read_only"]).default("manual_fallback"),
  writePolicy: z.enum(["not_allowed", "draft_only", "approved_only"]).default("not_allowed"),
  lastHealthCheckAt: z.string().datetime().optional(),
  health: z.object({
    status: z.enum(["connected", "degraded", "missing"]),
    checkedAt: z.string().datetime(),
    checkedBy: z.string().min(1),
    latencyMs: z.number().int().min(0).optional(),
    errorCode: z.string().min(1).optional(),
    evidenceRefs: z.array(z.string().min(1)).default([])
  }).optional()
});

export const connectionInstancesFileSchema = z.object({
  schemaVersion: z.literal(CONNECTION_INSTANCE_SCHEMA_VERSION).default(CONNECTION_INSTANCE_SCHEMA_VERSION),
  instances: z.array(connectionInstanceSchema).default([])
});

export const connectorSuggestionSchema = z.object({
  manifestId: z.string().min(1),
  label: z.string().min(1),
  category: connectorCategorySchema,
  transport: connectorTransportSchema,
  authType: connectorAuthTypeSchema,
  capabilities: z.array(z.string()).default([]),
  minimumScopes: z.array(z.string()).default([]),
  riskLevel: connectorRiskLevelSchema.default("low"),
  manualFallback: z.string().optional()
});

export const webhookRouteHintSchema = z.object({
  manifestId: z.string().min(1),
  routeNameTemplate: z.string().min(1),
  sourcePatterns: z.array(z.string()).default([]),
  eventTypePatterns: z.array(z.string()).default([]),
  signature: z.string().min(1),
  transformVersion: z.string().min(1),
  stableDeliveryId: z.string().min(1),
  subjectIdPath: z.string().min(1),
  filterHints: z.array(z.string()).default([])
});

export const connectionAuthoritySchema = z.object({
  hermesReceivesEvents: z.boolean().default(false),
  loopgraphCanRead: z.boolean().default(false),
  loopgraphCanWrite: z.boolean().default(false),
  notes: z.array(z.string()).default([])
});

export const connectionLoopRequirementSchema = z.object({
  loopId: z.string(),
  loopName: z.string(),
  department: DepartmentTypeSchema.optional(),
  requiredFor: connectionRequiredForSchema,
  reason: z.string()
});

export const connectionPlanItemSchema = z.object({
  capability: z.string().min(1),
  status: connectionCapabilityStatusSchema,
  requiredFor: z.array(connectionRequiredForSchema).default([]),
  loops: z.array(connectionLoopRequirementSchema).default([]),
  manualFallbacks: z.array(z.string()).default([]),
  requiredFromUser: z.array(z.object({
    label: z.string(),
    reason: z.string()
  })).default([]),
  suggestedConnectors: z.array(connectorSuggestionSchema).default([]),
  compatibleConnections: z.array(z.object({
    instanceId: z.string().min(1),
    manifestId: z.string().min(1),
    label: z.string().optional(),
    status: connectionCapabilityStatusSchema,
    environment: connectionEnvironmentSchema
  })).default([]),
  webhookRouteHints: z.array(webhookRouteHintSchema).default([]),
  authority: connectionAuthoritySchema.default({
    hermesReceivesEvents: false,
    loopgraphCanRead: false,
    loopgraphCanWrite: false,
    notes: []
  }),
  blockingFor: z.array(connectionRequiredForSchema).default([]),
  sourceRefs: z.array(z.string()).default([])
});

export const connectionPlanSchema = z.object({
  schemaVersion: z.literal(CONNECTION_PLAN_SCHEMA_VERSION).default(CONNECTION_PLAN_SCHEMA_VERSION),
  projectRootId: z.string(),
  generatedAt: z.string().datetime(),
  summary: z.object({
    totalCapabilities: z.number().int().min(0),
    missingCapabilities: z.number().int().min(0),
    manualFallbackCapabilities: z.number().int().min(0),
    connectedCapabilities: z.number().int().min(0),
    readyForRouting: z.boolean(),
    readyForSimulation: z.boolean(),
    readyForExecution: z.boolean()
  }),
  items: z.array(connectionPlanItemSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export const manualConnectionFallbackSchema = z.object({
  capability: z.string().min(1),
  label: z.string().min(1),
  instructions: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string().datetime()
});

export const manualConnectionFallbacksFileSchema = z.object({
  schemaVersion: z.literal(MANUAL_CONNECTION_FALLBACKS_SCHEMA_VERSION).default(MANUAL_CONNECTION_FALLBACKS_SCHEMA_VERSION),
  fallbacks: z.array(manualConnectionFallbackSchema).default([])
});

export type ConnectionRequiredFor = z.infer<typeof connectionRequiredForSchema>;
export type ConnectionCapabilityStatus = z.infer<typeof connectionCapabilityStatusSchema>;
export type ConnectorTransport = z.infer<typeof connectorTransportSchema>;
export type ConnectorAuthType = z.infer<typeof connectorAuthTypeSchema>;
export type ConnectorCapabilityDirection = z.infer<typeof connectorCapabilityDirectionSchema>;
export type ConnectorRiskLevel = z.infer<typeof connectorRiskLevelSchema>;
export type ConnectionSource = z.infer<typeof connectionSourceSchema>;
export type ConnectorCategory = z.infer<typeof connectorCategorySchema>;
export type ConnectorCapability = z.infer<typeof connectorCapabilitySchema>;
export type ConnectorWebhook = z.infer<typeof connectorWebhookSchema>;
export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;
export type ConnectionInstance = z.infer<typeof connectionInstanceSchema>;
export type ConnectionInstancesFile = z.infer<typeof connectionInstancesFileSchema>;
export type ConnectorSuggestion = z.infer<typeof connectorSuggestionSchema>;
export type WebhookRouteHint = z.infer<typeof webhookRouteHintSchema>;
export type ConnectionAuthority = z.infer<typeof connectionAuthoritySchema>;
export type ConnectionLoopRequirement = z.infer<typeof connectionLoopRequirementSchema>;
export type ConnectionPlanItem = z.infer<typeof connectionPlanItemSchema>;
export type ConnectionPlan = z.infer<typeof connectionPlanSchema>;
export type ManualConnectionFallback = z.infer<typeof manualConnectionFallbackSchema>;
export type ManualConnectionFallbacksFile = z.infer<typeof manualConnectionFallbacksFileSchema>;
