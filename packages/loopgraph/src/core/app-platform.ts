import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DepartmentTypeSchema } from "./department-skills";
import { contentDigest } from "./hash";

/**
 * Public, versioned contracts for the Loopgraph App Platform.
 *
 * These schemas deliberately reject unknown fields. A LoopPack is untrusted
 * input until it has passed these schemas, content verification, path
 * confinement, compatibility checks, and conformance tests.
 */
export const APP_PLATFORM_SCHEMA_VERSION = "loopgraph-app-platform/v1alpha1" as const;
export const LOOP_PACK_SCHEMA_VERSION = "loopgraph-pack/v1alpha1" as const;
export const MARKETPLACE_SCHEMA_VERSION = "loopgraph-marketplace/v1alpha1" as const;
export const APP_INSTALL_SCHEMA_VERSION = "loopgraph-app-install/v1alpha1" as const;
export const COMPANY_CONTEXT_SCHEMA_VERSION = "loopgraph-company-context/v1alpha1" as const;
export const CONNECTOR_RECIPE_SCHEMA_VERSION = "loopgraph-connector-recipe/v1alpha1" as const;
export const APP_CONFIGURATION_SCHEMA_VERSION = "loopgraph-app-configuration/v1alpha1" as const;
export const APP_EVAL_SCHEMA_VERSION = "loopgraph-app-eval/v1alpha1" as const;

export const APP_PLATFORM_INVARIANTS = [
  "LoopPacks are immutable and addressed by a canonical SHA-256 digest.",
  "Every installation pins an exact semantic version and artifact digest.",
  "LoopPacks never contain credentials, access tokens, or private customer data.",
  "A LoopPack is untrusted until schema, content, path, compatibility, permission, and conformance validation pass.",
  "Installation is atomic, reversible, and protected by an installation lock.",
  "Installation never enables provider writes.",
  "New applications begin in simulation or shadow mode.",
  "Permission changes during upgrade require explicit review.",
  "Generated LoopSpecs must pass existing validation and promotion rehearsals.",
  "Hermes, CLI, MCP, and browser clients use the same application services.",
  "Uninstall removes only assets exclusively owned by that installation.",
  "Shared connectors, mappings, entities, context, and evidence survive uninstall.",
  "Workspace customization is stored as an overlay and never mutates the pinned artifact.",
  "Quality and maturity labels are derived from recorded evidence.",
  "Low-level implementation details are hidden behind an explicit Advanced surface."
] as const;

const idPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const capabilityPattern = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*){2,}$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const relativePackPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0]+$/;

export const appIdSchema = z.string().min(3).max(160).regex(idPattern);
export const appVersionSchema = z.string().regex(semverPattern, "Expected an exact semantic version");
export const appVersionRangeSchema = z.string().min(1).max(100);
export const artifactDigestSchema = z.string().regex(digestPattern, "Expected sha256:<64 lowercase hex characters>");
export const packRelativePathSchema = z.string().min(1).max(512).regex(relativePackPathPattern, "Expected a confined relative pack path");
export const logicalCapabilitySchema = z.string().regex(capabilityPattern, "Expected a provider-independent capability such as crm.lead.read");
export const isoDateTimeSchema = z.string().datetime();
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

export const appVisibilitySchema = z.enum(["official", "public", "private", "local"]);
export const appMaturitySchema = z.enum([
  "concept",
  "tested",
  "connected",
  "production_proven",
  "loopgraph_verified"
]);
export const appRolloutModeSchema = z.enum([
  "simulation",
  "shadow",
  "recommend",
  "execute_with_approval",
  "live"
]);
export const appInstallationStateSchema = z.enum([
  "selected",
  "resolving",
  "waiting_for_connections",
  "waiting_for_configuration",
  "ready_to_test",
  "simulation_passed",
  "shadow",
  "recommend",
  "execute_with_approval",
  "live",
  "paused",
  "broken",
  "degraded",
  "update_available",
  "deprecated",
  "revoked",
  "uninstalling",
  "rolled_back"
]);
export const appAssetKindSchema = z.enum([
  "loop_spec",
  "hermes_skill",
  "routing_card",
  "event_contract",
  "connection_binding",
  "field_mapping",
  "schedule",
  "metric",
  "fixture",
  "evaluation",
  "graph_node",
  "graph_edge",
  "dashboard"
]);
export const permissionRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export const permissionModeSchema = z.enum(["required", "optional"]);
export const actionAuthoritySchema = z.enum(["read", "draft", "approve", "execute"]);

const publisherSchema = z.object({
  id: appIdSchema,
  name: z.string().min(1).max(120),
  url: z.string().url().optional(),
  verified: z.boolean().default(false)
}).strict();

const compatibilitySchema = z.object({
  loopgraph: appVersionRangeSchema,
  hermes: appVersionRangeSchema,
  node: appVersionRangeSchema.optional(),
  platforms: z.array(z.enum(["darwin", "linux", "win32"])).default(["darwin", "linux", "win32"])
}).strict();

const packPermissionSchema = z.object({
  capability: logicalCapabilitySchema,
  authority: actionAuthoritySchema,
  mode: permissionModeSchema,
  risk: permissionRiskSchema,
  purpose: z.string().min(1).max(500),
  customerFacing: z.boolean().default(false),
  defaultPolicy: z.enum(["allowed", "approval_required", "forbidden"]),
  dataClasses: z.array(z.string().min(1)).default([])
}).strict().superRefine((permission, ctx) => {
  if (permission.authority === "execute" && permission.defaultPolicy === "allowed") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultPolicy"],
      message: "Execute permissions cannot be enabled by a pack; use approval_required or forbidden"
    });
  }
});

const packDependencySchema = z.object({
  appId: appIdSchema,
  version: appVersionRangeSchema,
  optional: z.boolean().default(false),
  reason: z.string().min(1)
}).strict();

const packModuleSchema = z.object({
  id: appIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  defaultEnabled: z.boolean(),
  dependsOn: z.array(appIdSchema).default([]),
  assets: z.array(packRelativePathSchema).min(1)
}).strict();

const packPresetSchema = z.object({
  id: appIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  path: packRelativePathSchema,
  providerFamily: z.string().min(1).optional()
}).strict();

const packEntryPointsSchema = z.object({
  loops: z.array(packRelativePathSchema).min(1),
  skills: z.array(packRelativePathSchema).default([]),
  connectors: z.array(packRelativePathSchema).default([]),
  setup: z.array(packRelativePathSchema).default([]),
  policies: z.array(packRelativePathSchema).default([]),
  fixtures: z.array(packRelativePathSchema).default([]),
  evals: z.array(packRelativePathSchema).default([]),
  dashboards: z.array(packRelativePathSchema).default([]),
  assets: z.array(packRelativePathSchema).default([])
}).strict();

export const loopPackManifestSchema = z.object({
  schemaVersion: z.literal(LOOP_PACK_SCHEMA_VERSION),
  kind: z.literal("LoopPack"),
  metadata: z.object({
    id: appIdSchema,
    name: z.string().min(1).max(120),
    version: appVersionSchema,
    summary: z.string().min(1).max(180),
    description: z.string().min(1).max(5000),
    department: DepartmentTypeSchema,
    publisher: publisherSchema,
    license: z.string().min(1),
    visibility: appVisibilitySchema,
    tags: z.array(z.string().min(1).max(40)).max(20).default([]),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional()
  }).strict(),
  compatibility: compatibilitySchema,
  dependencies: z.array(packDependencySchema).default([]),
  modules: z.array(packModuleSchema).default([]),
  presets: z.array(packPresetSchema).min(1),
  permissions: z.array(packPermissionSchema).min(1),
  requiredCapabilities: z.array(logicalCapabilitySchema).min(1),
  optionalCapabilities: z.array(logicalCapabilitySchema).default([]),
  entrypoints: packEntryPointsSchema,
  ownership: z.object({
    defaultOwnerRole: z.string().min(1),
    reviewRoles: z.array(z.string().min(1)).default([]),
    supportUrl: z.string().url().optional()
  }).strict(),
  defaultRolloutMode: z.enum(["simulation", "shadow"]).default("shadow")
}).strict().superRefine((manifest, ctx) => {
  const allCapabilities = [...manifest.requiredCapabilities, ...manifest.optionalCapabilities];
  if (new Set(allCapabilities).size !== allCapabilities.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredCapabilities"], message: "Capabilities must be unique" });
  }
  const permissionCapabilities = new Set(manifest.permissions.map((permission) => permission.capability));
  for (const capability of manifest.requiredCapabilities) {
    if (!permissionCapabilities.has(capability)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions"],
        message: `Required capability ${capability} must have an explicit permission declaration`
      });
    }
  }
});

export const loopPackFileSchema = z.object({
  path: packRelativePathSchema,
  digest: artifactDigestSchema,
  sizeBytes: z.number().int().nonnegative(),
  mediaType: z.string().min(1)
}).strict();

export const loopPackArtifactSchema = z.object({
  schemaVersion: z.literal(LOOP_PACK_SCHEMA_VERSION),
  manifest: loopPackManifestSchema,
  digest: artifactDigestSchema,
  files: z.array(loopPackFileSchema).min(1),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  provenance: z.object({
    sourceType: z.enum(["official", "filesystem", "github", "hosted"]),
    sourceUri: z.string().min(1),
    sourceRef: z.string().min(1).optional(),
    builderId: z.string().min(1).optional(),
    signature: z.object({
      algorithm: z.enum(["ed25519", "ecdsa-p256-sha256"]),
      keyId: z.string().min(1),
      value: z.string().min(1)
    }).strict().optional()
  }).strict()
}).strict();

export const marketplaceAppVersionSchema = z.object({
  schemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION),
  appId: appIdSchema,
  version: appVersionSchema,
  digest: artifactDigestSchema,
  publishedAt: isoDateTimeSchema,
  compatibility: compatibilitySchema,
  dependencies: z.array(packDependencySchema).default([]),
  permissions: z.array(packPermissionSchema),
  requiredCapabilities: z.array(logicalCapabilitySchema),
  presets: z.array(packPresetSchema),
  modules: z.array(packModuleSchema),
  maturity: appMaturitySchema,
  deprecated: z.boolean().default(false),
  deprecationMessage: z.string().min(1).optional(),
  revokedAt: isoDateTimeSchema.optional(),
  revocationReason: z.string().min(1).optional(),
  artifactUri: z.string().min(1),
  provenanceVerified: z.boolean().default(false)
}).strict();

export const marketplaceAppSchema = z.object({
  schemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION),
  id: appIdSchema,
  name: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1),
  department: DepartmentTypeSchema,
  publisher: publisherSchema,
  visibility: appVisibilitySchema,
  tags: z.array(z.string().min(1)).default([]),
  latestVersion: appVersionSchema,
  versions: z.array(marketplaceAppVersionSchema).min(1),
  searchTerms: z.array(z.string().min(1)).default([]),
  iconUri: z.string().min(1).optional(),
  readmeUri: z.string().min(1).optional()
}).strict().superRefine((app, ctx) => {
  if (!app.versions.some((version) => version.version === app.latestVersion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["latestVersion"], message: "latestVersion must exist in versions" });
  }
  if (app.versions.some((version) => version.appId !== app.id)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["versions"], message: "All versions must belong to this app" });
  }
});

export const marketplaceCatalogSourceSchema = z.object({
  schemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION),
  id: appIdSchema,
  type: z.enum(["official", "filesystem", "github", "hosted"]),
  uri: z.string().min(1),
  pinnedRef: z.string().min(1).optional(),
  expectedDigest: artifactDigestSchema.optional(),
  enabled: z.boolean().default(true),
  trustPolicy: z.enum(["official_only", "signed", "explicit_local"]),
  refreshedAt: isoDateTimeSchema.optional()
}).strict();

export const companyContextValueSchema = z.object({
  key: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "string_list", "object", "reference"]),
  value: jsonValueSchema,
  provenance: z.object({
    source: z.enum(["user", "hermes_inference", "provider", "import", "policy"]),
    sourceRef: z.string().min(1).optional(),
    observedAt: isoDateTimeSchema
  }).strict(),
  verified: z.boolean(),
  confidence: z.number().min(0).max(1),
  owner: z.string().min(1),
  visibility: z.enum(["workspace", "department", "installation", "private"]),
  confirmedAt: isoDateTimeSchema.optional(),
  confirmedBy: z.string().min(1).optional(),
  consumerInstallationIds: z.array(appIdSchema).default([])
}).strict();

export const companyContextSchema = z.object({
  schemaVersion: z.literal(COMPANY_CONTEXT_SCHEMA_VERSION),
  workspaceId: appIdSchema,
  companyId: appIdSchema,
  revision: z.number().int().nonnegative(),
  values: z.array(companyContextValueSchema).default([]),
  updatedAt: isoDateTimeSchema,
  updatedBy: z.string().min(1)
}).strict().superRefine((context, ctx) => {
  const keys = context.values.map((value) => value.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["values"], message: "Company context keys must be unique" });
  }
});

export const connectorFieldMappingSchema = z.object({
  schemaVersion: z.literal(CONNECTOR_RECIPE_SCHEMA_VERSION),
  id: appIdSchema,
  workspaceId: appIdSchema,
  connectionId: appIdSchema,
  objectType: z.string().min(1),
  logicalField: z.string().min(1),
  providerField: z.string().min(1),
  direction: z.enum(["read", "write", "bidirectional"]),
  transform: z.object({
    kind: z.enum(["identity", "enum", "date", "number", "boolean", "template"]),
    config: z.record(jsonValueSchema).default({})
  }).strict(),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
  confirmedBy: z.string().min(1).optional(),
  dependentInstallationIds: z.array(appIdSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict();

const providerCapabilityBindingSchema = z.object({
  logicalCapability: logicalCapabilitySchema,
  providerOperation: z.string().min(1),
  minimumScopes: z.array(z.string().min(1)).default([]),
  authority: actionAuthoritySchema,
  risk: permissionRiskSchema,
  rateLimitBucket: z.string().min(1).optional()
}).strict();

export const connectorRecipeSchema = z.object({
  schemaVersion: z.literal(CONNECTOR_RECIPE_SCHEMA_VERSION),
  id: appIdSchema,
  providerId: appIdSchema,
  providerFamily: z.string().min(1),
  displayName: z.string().min(1),
  capabilities: z.array(providerCapabilityBindingSchema).min(1),
  eventSources: z.array(z.object({
    eventFamily: z.string().min(1),
    providerEvent: z.string().min(1),
    transport: z.enum(["webhook", "poll", "stream"]),
    normalizationTransformer: z.string().min(1),
    signatureStrategy: z.string().min(1).optional(),
    replayProtection: z.boolean().default(true),
    fallbackPollMinutes: z.number().int().positive().optional()
  }).strict()).default([]),
  fieldMappings: z.array(z.object({
    objectType: z.string().min(1),
    requiredLogicalFields: z.array(z.string().min(1)).default([]),
    optionalLogicalFields: z.array(z.string().min(1)).default([])
  }).strict()).default([]),
  healthCheck: z.object({
    capability: logicalCapabilitySchema,
    sampleQuery: z.record(jsonValueSchema).default({}),
    timeoutMs: z.number().int().positive().max(30_000).default(10_000)
  }).strict(),
  supportsBoundedSamples: z.boolean().default(true)
}).strict();

export const appConfigFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  valueType: z.enum(["string", "number", "boolean", "string_list", "object"]),
  requirement: z.enum(["required", "optional", "conditional"]),
  infer: z.boolean().default(true),
  ask: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  defaultValue: jsonValueSchema.optional(),
  contextRef: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    allowedValues: z.array(jsonValueSchema).optional()
  }).strict().optional()
}).strict();

export const appConfigurationSchema = z.object({
  schemaVersion: z.literal(APP_CONFIGURATION_SCHEMA_VERSION),
  appId: appIdSchema,
  version: appVersionSchema,
  fields: z.array(appConfigFieldSchema).default([]),
  values: z.record(jsonValueSchema).default({}),
  provenance: z.record(z.object({
    layer: z.enum(["pack_default", "preset", "company_context", "install_config", "overlay"]),
    sourceRef: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    confirmed: z.boolean().default(false)
  }).strict()).default({}),
  completedAt: isoDateTimeSchema.optional()
}).strict();

export const appOverlayOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: z.string().startsWith("/"), value: jsonValueSchema }).strict(),
  z.object({ op: z.literal("remove"), path: z.string().startsWith("/") }).strict(),
  z.object({ op: z.literal("enable_module"), moduleId: appIdSchema }).strict(),
  z.object({ op: z.literal("disable_module"), moduleId: appIdSchema }).strict()
]);

export const appOverlaySchema = z.object({
  schemaVersion: z.literal(APP_CONFIGURATION_SCHEMA_VERSION),
  id: appIdSchema,
  installationId: appIdSchema,
  basedOnVersion: appVersionSchema,
  basedOnDigest: artifactDigestSchema,
  revision: z.number().int().positive(),
  operations: z.array(appOverlayOperationSchema).default([]),
  createdAt: isoDateTimeSchema,
  createdBy: z.string().min(1)
}).strict();

const plannedAssetSchema = z.object({
  id: appIdSchema,
  kind: appAssetKindSchema,
  action: z.enum(["create", "reuse", "update", "retain", "remove"]),
  digest: artifactDigestSchema.optional(),
  shared: z.boolean().default(false),
  sourcePath: packRelativePathSchema.optional(),
  dependencies: z.array(appIdSchema).default([])
}).strict();

const permissionDecisionSchema = z.object({
  capability: logicalCapabilitySchema,
  authority: actionAuthoritySchema,
  decision: z.enum(["allow", "approval_required", "forbid", "unresolved"]),
  reason: z.string().min(1),
  changedFromInstalled: z.boolean().default(false)
}).strict();

export const appInstallPlanSchema = z.object({
  schemaVersion: z.literal(APP_INSTALL_SCHEMA_VERSION),
  id: appIdSchema,
  workspaceId: appIdSchema,
  appId: appIdSchema,
  version: appVersionSchema,
  artifactDigest: artifactDigestSchema,
  planDigest: artifactDigestSchema,
  selectedModules: z.array(appIdSchema).default([]),
  presetId: appIdSchema,
  dependencyResolutions: z.array(z.object({
    appId: appIdSchema,
    version: appVersionSchema,
    digest: artifactDigestSchema,
    reused: z.boolean()
  }).strict()).default([]),
  capabilityResolutions: z.array(z.object({
    capability: logicalCapabilitySchema,
    required: z.boolean(),
    connectionId: appIdSchema.optional(),
    recipeId: appIdSchema.optional(),
    status: z.enum(["connected", "reusable", "missing", "degraded"])
  }).strict()).default([]),
  missingConfigurationKeys: z.array(z.string().min(1)).default([]),
  fieldMappingIds: z.array(appIdSchema).default([]),
  permissions: z.array(permissionDecisionSchema).min(1),
  assets: z.array(plannedAssetSchema).min(1),
  graphDiff: z.object({
    nodesAdded: z.array(appIdSchema).default([]),
    nodesReused: z.array(appIdSchema).default([]),
    edgesAdded: z.array(appIdSchema).default([]),
    edgesRemoved: z.array(appIdSchema).default([])
  }).strict(),
  requiredTests: z.array(z.string().min(1)).min(1),
  initialMode: z.enum(["simulation", "shadow"]),
  rollback: z.object({
    previousLockDigest: artifactDigestSchema.optional(),
    removeStagedAssets: z.boolean(),
    preserveSharedAssets: z.boolean()
  }).strict(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema
}).strict().superRefine((plan, ctx) => {
  if (plan.permissions.some((permission) => permission.authority === "execute" && permission.decision === "allow")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["permissions"], message: "Install plans cannot enable provider execution" });
  }
  const digestInput = { ...plan, planDigest: undefined };
  if (canonicalAppDigest(digestInput) !== plan.planDigest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planDigest"], message: "Plan digest does not match canonical plan content" });
  }
});

export const appAssetOwnershipSchema = z.object({
  assetId: appIdSchema,
  kind: appAssetKindSchema,
  ownerInstallationIds: z.array(appIdSchema).min(1),
  refCount: z.number().int().positive(),
  shared: z.boolean(),
  digest: artifactDigestSchema
}).strict().superRefine((ownership, ctx) => {
  if (ownership.refCount !== new Set(ownership.ownerInstallationIds).size) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["refCount"], message: "refCount must equal unique owner installations" });
  }
});

export const workspaceAppInstallationSchema = z.object({
  schemaVersion: z.literal(APP_INSTALL_SCHEMA_VERSION),
  id: appIdSchema,
  workspaceId: appIdSchema,
  appId: appIdSchema,
  version: appVersionSchema,
  artifactDigest: artifactDigestSchema,
  state: appInstallationStateSchema,
  mode: appRolloutModeSchema,
  selectedModules: z.array(appIdSchema).default([]),
  presetId: appIdSchema,
  configuration: appConfigurationSchema,
  overlay: appOverlaySchema.optional(),
  connectionBindings: z.record(appIdSchema).default({}),
  fieldMappingIds: z.array(appIdSchema).default([]),
  permissions: z.array(permissionDecisionSchema),
  ownedAssets: z.array(appAssetOwnershipSchema),
  installedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  installedBy: z.string().min(1),
  lastHealthyAt: isoDateTimeSchema.optional(),
  failureReason: z.string().min(1).optional()
}).strict().superRefine((installation, ctx) => {
  if (installation.configuration.appId !== installation.appId || installation.configuration.version !== installation.version) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration"], message: "Configuration must match the installed app and version" });
  }
});

export const appInstallationLockSchema = z.object({
  schemaVersion: z.literal(APP_INSTALL_SCHEMA_VERSION),
  workspaceId: appIdSchema,
  revision: z.number().int().nonnegative(),
  lockDigest: artifactDigestSchema,
  installations: z.array(z.object({
    installationId: appIdSchema,
    appId: appIdSchema,
    version: appVersionSchema,
    artifactDigest: artifactDigestSchema,
    configurationDigest: artifactDigestSchema,
    overlayDigest: artifactDigestSchema.optional(),
    selectedModules: z.array(appIdSchema).default([])
  }).strict()).default([]),
  generatedAt: isoDateTimeSchema
}).strict().superRefine((lock, ctx) => {
  const digestInput = { ...lock, lockDigest: undefined };
  if (canonicalAppDigest(digestInput) !== lock.lockDigest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lockDigest"], message: "Lock digest does not match canonical lock content" });
  }
});

export const appEvalRunSchema = z.object({
  schemaVersion: z.literal(APP_EVAL_SCHEMA_VERSION),
  id: appIdSchema,
  installationId: appIdSchema,
  appId: appIdSchema,
  appVersion: appVersionSchema,
  artifactDigest: artifactDigestSchema,
  level: z.enum(["synthetic", "sample", "historical_replay", "live_shadow", "recommend", "execute_with_approval", "live"]),
  status: z.enum(["queued", "running", "passed", "failed", "cancelled"]),
  replay: z.boolean(),
  writeBlocked: z.boolean(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.optional(),
  scenarios: z.array(z.object({
    id: appIdSchema,
    status: z.enum(["passed", "failed", "skipped"]),
    expectedRoute: z.string().min(1).optional(),
    actualRoute: z.string().min(1).optional(),
    humanLabel: z.enum(["correct", "incomplete", "false_positive"]).optional(),
    evidenceRefs: z.array(z.string().min(1)).default([]),
    reviewMinutes: z.number().nonnegative().optional()
  }).strict()).default([]),
  metrics: z.record(z.number()).default({}),
  evidenceRefs: z.array(z.string().min(1)).default([])
}).strict().superRefine((run, ctx) => {
  if (run.level === "historical_replay" && (!run.replay || !run.writeBlocked)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["writeBlocked"], message: "Historical replay must be marked replay and block all writes" });
  }
});

export const appReadinessSchema = z.object({
  schemaVersion: z.literal(APP_EVAL_SCHEMA_VERSION),
  installationId: appIdSchema,
  state: z.enum(["blocked", "needs_attention", "ready_for_simulation", "ready_for_shadow", "ready_for_recommend", "ready_for_approval_execution", "production_ready"]),
  score: z.number().min(0).max(100),
  maturity: appMaturitySchema,
  checks: z.array(z.object({
    id: appIdSchema,
    category: z.enum(["artifact", "connection", "mapping", "configuration", "permission", "simulation", "routing", "outcome", "operations"]),
    status: z.enum(["pass", "warn", "fail", "not_applicable"]),
    summary: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).default([]),
    remediation: z.string().min(1).optional()
  }).strict()).min(1),
  evaluatedAt: isoDateTimeSchema,
  evidenceDerived: z.literal(true)
}).strict();

export const appUpdatePlanSchema = z.object({
  schemaVersion: z.literal(APP_INSTALL_SCHEMA_VERSION),
  id: appIdSchema,
  installationId: appIdSchema,
  fromVersion: appVersionSchema,
  fromDigest: artifactDigestSchema,
  toVersion: appVersionSchema,
  toDigest: artifactDigestSchema,
  baseInstallPlan: appInstallPlanSchema,
  permissionChanges: z.array(z.object({
    capability: logicalCapabilitySchema,
    authority: actionAuthoritySchema,
    change: z.enum(["added", "removed", "risk_increased", "risk_decreased", "unchanged"]),
    requiresReview: z.boolean()
  }).strict()).default([]),
  graphDiff: z.object({
    nodesAdded: z.array(appIdSchema).default([]),
    nodesRemoved: z.array(appIdSchema).default([]),
    edgesAdded: z.array(appIdSchema).default([]),
    edgesRemoved: z.array(appIdSchema).default([])
  }).strict(),
  merge: z.object({
    originalBaseDigest: artifactDigestSchema,
    overlayDigest: artifactDigestSchema.optional(),
    newBaseDigest: artifactDigestSchema,
    conflicts: z.array(z.object({
      path: z.string().startsWith("/"),
      baseValue: jsonValueSchema.optional(),
      overlayValue: jsonValueSchema.optional(),
      newValue: jsonValueSchema.optional(),
      resolution: z.enum(["unresolved", "keep_overlay", "take_new", "custom"])
    }).strict()).default([])
  }).strict(),
  rollbackVersion: appVersionSchema,
  rollbackDigest: artifactDigestSchema,
  createdAt: isoDateTimeSchema
}).strict();

export type LoopPackManifest = z.infer<typeof loopPackManifestSchema>;
export type LoopPackArtifact = z.infer<typeof loopPackArtifactSchema>;
export type MarketplaceApp = z.infer<typeof marketplaceAppSchema>;
export type MarketplaceAppVersion = z.infer<typeof marketplaceAppVersionSchema>;
export type MarketplaceCatalogSource = z.infer<typeof marketplaceCatalogSourceSchema>;
export type AppInstallPlan = z.infer<typeof appInstallPlanSchema>;
export type WorkspaceAppInstallation = z.infer<typeof workspaceAppInstallationSchema>;
export type AppInstallationLock = z.infer<typeof appInstallationLockSchema>;
export type CompanyContext = z.infer<typeof companyContextSchema>;
export type CompanyContextValue = z.infer<typeof companyContextValueSchema>;
export type ConnectorRecipe = z.infer<typeof connectorRecipeSchema>;
export type ConnectorFieldMapping = z.infer<typeof connectorFieldMappingSchema>;
export type AppConfiguration = z.infer<typeof appConfigurationSchema>;
export type AppConfigField = z.infer<typeof appConfigFieldSchema>;
export type AppOverlay = z.infer<typeof appOverlaySchema>;
export type AppEvalRun = z.infer<typeof appEvalRunSchema>;
export type AppReadiness = z.infer<typeof appReadinessSchema>;
export type AppUpdatePlan = z.infer<typeof appUpdatePlanSchema>;
export type AppInstallationState = z.infer<typeof appInstallationStateSchema>;
export type AppRolloutMode = z.infer<typeof appRolloutModeSchema>;

export function canonicalAppDigest(value: unknown): string {
  return `sha256:${contentDigest(value)}`;
}

export function appPlatformJsonSchemas(): Record<string, Record<string, unknown>> {
  return {
    LoopPackManifest: zodToJsonSchema(loopPackManifestSchema, "LoopPackManifest") as Record<string, unknown>,
    LoopPackArtifact: zodToJsonSchema(loopPackArtifactSchema, "LoopPackArtifact") as Record<string, unknown>,
    MarketplaceApp: zodToJsonSchema(marketplaceAppSchema, "MarketplaceApp") as Record<string, unknown>,
    AppInstallPlan: zodToJsonSchema(appInstallPlanSchema, "AppInstallPlan") as Record<string, unknown>,
    WorkspaceAppInstallation: zodToJsonSchema(workspaceAppInstallationSchema, "WorkspaceAppInstallation") as Record<string, unknown>,
    AppInstallationLock: zodToJsonSchema(appInstallationLockSchema, "AppInstallationLock") as Record<string, unknown>,
    CompanyContext: zodToJsonSchema(companyContextSchema, "CompanyContext") as Record<string, unknown>,
    ConnectorRecipe: zodToJsonSchema(connectorRecipeSchema, "ConnectorRecipe") as Record<string, unknown>,
    ConnectorFieldMapping: zodToJsonSchema(connectorFieldMappingSchema, "ConnectorFieldMapping") as Record<string, unknown>,
    AppConfiguration: zodToJsonSchema(appConfigurationSchema, "AppConfiguration") as Record<string, unknown>,
    AppOverlay: zodToJsonSchema(appOverlaySchema, "AppOverlay") as Record<string, unknown>,
    AppEvalRun: zodToJsonSchema(appEvalRunSchema, "AppEvalRun") as Record<string, unknown>,
    AppReadiness: zodToJsonSchema(appReadinessSchema, "AppReadiness") as Record<string, unknown>,
    AppUpdatePlan: zodToJsonSchema(appUpdatePlanSchema, "AppUpdatePlan") as Record<string, unknown>
  };
}

export function assertSafeInitialRollout(mode: z.infer<typeof appRolloutModeSchema>): void {
  if (mode !== "simulation" && mode !== "shadow") {
    throw new Error(`New app installations must begin in simulation or shadow mode, received ${mode}`);
  }
}
