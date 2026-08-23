import { z } from "zod";

export const HERMES_ROUTE_ACTIVATION_PLAN_SCHEMA_VERSION = "hermes-route-activation-plan/v1alpha1" as const;
export const HERMES_ROUTE_CONTROLLER_REQUEST_SCHEMA_VERSION = "hermes-route-controller-request/v1alpha1" as const;
export const HERMES_ROUTE_CONTROLLER_RECEIPT_SCHEMA_VERSION = "hermes-route-controller-receipt/v1alpha1" as const;
export const HERMES_ROUTE_ACTIVATION_RECORD_SCHEMA_VERSION = "hermes-route-activation-record/v1alpha1" as const;

const digestSchema = z.string().regex(/^[a-f0-9]{16}$/);
const routeKindSchema = z.enum(["provider_event", "loopgraph_lifecycle"]);
const routeProfileSchema = z.enum(["loopgraph_webhook_router", "loopgraph_lifecycle_router"]);

export const hermesRouteActivationRouteSchema = z.object({
  routeId: z.string().min(1),
  routeName: z.string().min(1),
  routeKind: routeKindSchema,
  sourcePattern: z.string().min(1),
  eventTypePatterns: z.array(z.string().min(1)).min(1),
  subjectTypes: z.array(z.string().min(1)),
  loopIds: z.array(z.string().min(1)),
  profileId: routeProfileSchema,
  skills: z.array(z.string().min(1)).min(1),
  restrictedMcpTools: z.array(z.string().min(1)).min(1),
  deliveryMode: z.literal("log"),
  activationMode: z.literal("shadow"),
  authentication: z.object({
    owner: z.literal("hermes"),
    signatureVerificationRequired: z.literal(true),
    secretStoredInLoopgraph: z.literal(false)
  }).strict(),
  transformation: z.object({
    transformerId: z.string().min(1),
    outputSchema: z.literal("EventEnvelope"),
    dropsRawPayload: z.literal(true),
    stableDeliveryIdRequired: z.literal(true)
  }).strict(),
  subscription: z.object({
    owner: z.literal("hermes"),
    policy: z.enum(["configure_if_connected", "notification_only"]),
    connectionIds: z.array(z.string().min(1)),
    required: z.boolean()
  }).strict(),
  filters: z.array(z.string().min(1)).min(1),
  configDigest: digestSchema
}).strict();

export const hermesRouteActivationPlanSchema = z.object({
  schemaVersion: z.literal(HERMES_ROUTE_ACTIVATION_PLAN_SCHEMA_VERSION),
  projectRootHash: digestSchema,
  catalogVersion: z.string().min(1),
  manifestDigest: digestSchema,
  planDigest: digestSchema,
  generatedAt: z.string().datetime(),
  controllerProtocol: z.literal(HERMES_ROUTE_CONTROLLER_REQUEST_SCHEMA_VERSION),
  destructiveChangesAllowed: z.literal(false),
  routes: z.array(hermesRouteActivationRouteSchema).min(1),
  warnings: z.array(z.string().min(1)),
  nextActions: z.array(z.string().min(1))
}).strict();

export const hermesRouteControllerRequestSchema = z.object({
  schemaVersion: z.literal(HERMES_ROUTE_CONTROLLER_REQUEST_SCHEMA_VERSION),
  requestId: z.string().min(1),
  requestedAt: z.string().datetime(),
  projectRootHash: digestSchema,
  catalogVersion: z.string().min(1),
  manifestDigest: digestSchema,
  planDigest: digestSchema,
  operation: z.literal("reconcile_shadow_routes"),
  destructiveChangesAllowed: z.literal(false),
  routes: z.array(hermesRouteActivationRouteSchema).min(1)
}).strict();

export const hermesRouteControllerRouteReceiptSchema = z.object({
  routeId: z.string().min(1),
  routeName: z.string().min(1),
  state: z.enum(["shadow", "pending_connection", "pending_confirmation", "degraded", "rejected"]),
  appliedConfigDigest: digestSchema,
  profileId: routeProfileSchema,
  skills: z.array(z.string().min(1)).min(1),
  restrictedMcpTools: z.array(z.string().min(1)).min(1),
  transformerId: z.string().min(1),
  signatureVerificationConfigured: z.boolean(),
  secretStoredInHermes: z.literal(true),
  subscriptionState: z.enum(["active", "pending_connection", "pending_confirmation", "not_applicable", "failed"]),
  routeUrl: z.string().url().optional(),
  evidenceRefs: z.array(z.string().min(1)).max(50).default([]),
  errors: z.array(z.string().min(1)).max(20).default([])
}).strict();

export const hermesRouteControllerReceiptSchema = z.object({
  schemaVersion: z.literal(HERMES_ROUTE_CONTROLLER_RECEIPT_SCHEMA_VERSION),
  requestId: z.string().min(1),
  controllerInstanceId: z.string().min(1),
  appliedAt: z.string().datetime(),
  projectRootHash: digestSchema,
  catalogVersion: z.string().min(1),
  manifestDigest: digestSchema,
  planDigest: digestSchema,
  destructiveChangesApplied: z.literal(false),
  routes: z.array(hermesRouteControllerRouteReceiptSchema).min(1)
}).strict();

export const hermesRouteActivationRecordSchema = z.object({
  schemaVersion: z.literal(HERMES_ROUTE_ACTIVATION_RECORD_SCHEMA_VERSION),
  activatedAt: z.string().datetime(),
  controllerOrigin: z.string().url(),
  ready: z.boolean(),
  requestDigest: digestSchema,
  plan: hermesRouteActivationPlanSchema,
  receipt: hermesRouteControllerReceiptSchema
}).strict();

export type HermesRouteActivationRoute = z.infer<typeof hermesRouteActivationRouteSchema>;
export type HermesRouteActivationPlan = z.infer<typeof hermesRouteActivationPlanSchema>;
export type HermesRouteControllerRequest = z.infer<typeof hermesRouteControllerRequestSchema>;
export type HermesRouteControllerRouteReceipt = z.infer<typeof hermesRouteControllerRouteReceiptSchema>;
export type HermesRouteControllerReceipt = z.infer<typeof hermesRouteControllerReceiptSchema>;
export type HermesRouteActivationRecord = z.infer<typeof hermesRouteActivationRecordSchema>;
