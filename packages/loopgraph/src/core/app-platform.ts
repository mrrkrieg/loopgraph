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
export const PROVIDER_SCHEMA_SNAPSHOT_VERSION = "loopgraph-provider-schema/v1alpha1" as const;
export const FIELD_MAPPING_PLAN_SCHEMA_VERSION = "loopgraph-field-mapping-plan/v1alpha1" as const;
export const APP_CONFIGURATION_SCHEMA_VERSION = "loopgraph-app-configuration/v1alpha1" as const;
export const APP_EVAL_SCHEMA_VERSION = "loopgraph-app-eval/v1alpha1" as const;
export const APP_ONBOARDING_SCHEMA_VERSION = "loopgraph-app-onboarding/v1alpha1" as const;
export const APP_ACTIVATION_APPROVAL_SCHEMA_VERSION = "loopgraph-app-activation-approval/v1alpha1" as const;
export const APP_MATURITY_EVIDENCE_SCHEMA_VERSION = "loopgraph-app-maturity-evidence/v1alpha1" as const;
export const APP_OPERATIONAL_MATURITY_SCHEMA_VERSION = "loopgraph-app-operational-maturity/v1alpha1" as const;
export const APP_INDEPENDENT_VERIFICATION_SCHEMA_VERSION = "loopgraph-app-independent-verification/v1alpha1" as const;

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
  "Provider schema samples are connection-bound, short-lived, redacted-only, and never trusted as field mappings without confirmation.",
  "Workspace customization is stored as an overlay and never mutates the pinned artifact.",
  "Quality and maturity labels are derived from recorded evidence.",
  "App mode activation requires a content-bound, unexpired, single-use human approval receipt.",
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

export const appMaturityEvidenceSchema = z.object({
  schemaVersion: z.literal(APP_MATURITY_EVIDENCE_SCHEMA_VERSION),
  artifactDigest: artifactDigestSchema,
  basis: z.literal("synthetic_conformance"),
  status: z.enum(["passed", "failed"]),
  writeBlocked: z.literal(true),
  providerWrites: z.number().int().nonnegative(),
  scenarioCount: z.number().int().nonnegative(),
  passedScenarioCount: z.number().int().nonnegative(),
  evidenceRefs: z.array(z.string().min(1).max(1000)).max(100).default([]),
  evaluatedAt: isoDateTimeSchema,
  evidenceDigest: artifactDigestSchema
}).strict().superRefine((evidence, ctx) => {
  if (evidence.passedScenarioCount > evidence.scenarioCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["passedScenarioCount"], message: "Passed scenarios cannot exceed total scenarios" });
  }
  if (evidence.status === "passed" && (
    evidence.scenarioCount < 13 ||
    evidence.passedScenarioCount !== evidence.scenarioCount ||
    evidence.providerWrites !== 0
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "Passing maturity evidence requires all 13 safety categories to pass with zero provider writes"
    });
  }
  if (canonicalAppDigest({ ...evidence, evidenceDigest: undefined }) !== evidence.evidenceDigest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceDigest"], message: "Maturity evidence digest does not match the recorded content" });
  }
});

export const appIndependentVerificationReceiptSchema = z.object({
  schemaVersion: z.literal(APP_INDEPENDENT_VERIFICATION_SCHEMA_VERSION),
  id: appIdSchema,
  installationId: appIdSchema,
  appId: appIdSchema,
  artifactDigest: artifactDigestSchema,
  verifierId: z.string().min(1).max(300),
  verifierType: z.enum(["loopgraph", "accredited_third_party"]),
  status: z.enum(["passed", "failed"]),
  evidenceRefs: z.array(z.string().min(1).max(1000)).min(1).max(100),
  verifiedAt: isoDateTimeSchema,
  verificationDigest: artifactDigestSchema,
  signature: z.object({
    algorithm: z.literal("ed25519"),
    keyId: appIdSchema,
    value: z.string().min(32)
  }).strict()
}).strict().superRefine((receipt, ctx) => {
  if (canonicalAppDigest({ ...receipt, verificationDigest: undefined, signature: undefined }) !== receipt.verificationDigest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["verificationDigest"], message: "Independent verification digest does not match the recorded content" });
  }
});

export const appVerifierTrustKeySchema = z.object({
  verifierId: z.string().min(1).max(300),
  keyId: appIdSchema,
  algorithm: z.literal("ed25519"),
  publicKey: z.string().min(32).refine((value) => !/-----BEGIN (?:(?:ENCRYPTED|RSA|EC|OPENSSH) )?PRIVATE KEY-----/.test(value), {
    message: "Verifier trust accepts public keys only"
  }),
  approvedBy: z.string().min(1).max(300),
  approvalRef: z.string().min(1).max(1000),
  approvedAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.optional(),
  revokedBy: z.string().min(1).max(300).optional(),
  revocationRef: z.string().min(1).max(1000).optional()
}).strict().superRefine((key, ctx) => {
  if (new Set([Boolean(key.revokedAt), Boolean(key.revokedBy), Boolean(key.revocationRef)]).size > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revokedAt"], message: "Verifier key revocation requires timestamp, actor, and reference together" });
  }
});

const appOperationalMaturityGateSchema = z.object({
  level: appMaturitySchema.exclude(["concept"]),
  status: z.enum(["achieved", "blocked"]),
  summary: z.string().min(1).max(1000),
  evidenceRefs: z.array(z.string().min(1).max(1000)).max(100).default([]),
  remediation: z.string().min(1).max(1000).optional()
}).strict();

export const appOperationalMaturityAssessmentSchema = z.object({
  schemaVersion: z.literal(APP_OPERATIONAL_MATURITY_SCHEMA_VERSION),
  installationId: appIdSchema,
  appId: appIdSchema,
  artifactDigest: artifactDigestSchema,
  maturity: appMaturitySchema,
  gates: z.array(appOperationalMaturityGateSchema).length(4),
  evaluatedAt: isoDateTimeSchema,
  evidenceDerived: z.literal(true)
}).strict().superRefine((assessment, ctx) => {
  const levels = ["tested", "connected", "production_proven", "loopgraph_verified"] as const;
  if (assessment.gates.some((gate, index) => gate.level !== levels[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gates"], message: "Operational maturity gates must be complete and ordered" });
    return;
  }
  let expected: typeof assessment.maturity = "concept";
  for (const gate of assessment.gates) {
    if (gate.status !== "achieved") break;
    expected = gate.level;
  }
  if (assessment.maturity !== expected) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maturity"], message: `Operational maturity must equal the highest consecutively achieved gate (${expected})` });
  }
});
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
export const LOOP_PACK_SIGNATURE_SCHEMA_VERSION = "loopgraph-pack-signature/v1alpha1" as const;

export const loopPackSignatureSchema = z.object({
  schemaVersion: z.literal(LOOP_PACK_SIGNATURE_SCHEMA_VERSION),
  publisherId: appIdSchema,
  digest: artifactDigestSchema,
  algorithm: z.enum(["ed25519", "ecdsa-p256-sha256"]),
  keyId: appIdSchema,
  publicKey: z.string().min(32),
  value: z.string().min(32),
  signedAt: isoDateTimeSchema
}).strict();

export const publisherTrustKeySchema = z.object({
  publisherId: appIdSchema,
  keyId: appIdSchema,
  algorithm: z.enum(["ed25519", "ecdsa-p256-sha256"]),
  publicKey: z.string().min(32)
}).strict();

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

const packTopologyEndpointSchema = z.object({
  kind: z.enum(["loop", "object"]),
  id: appIdSchema
}).strict();

const packTopologyObjectSchema = z.object({
  id: appIdSchema,
  objectType: z.string().min(1).max(80).regex(idPattern),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  shared: z.boolean().default(true),
  identityKeys: z.array(z.string().min(1).max(120)).min(1)
}).strict();

const packTopologyFlowSchema = z.object({
  id: appIdSchema,
  source: packTopologyEndpointSchema,
  target: packTopologyEndpointSchema,
  type: z.enum(["evidence_in", "supports", "produces", "learning_return"]),
  reason: z.string().min(1).max(500),
  condition: z.string().min(1).max(500).optional()
}).strict().superRefine((flow, ctx) => {
  const expectedKinds = flow.type === "evidence_in"
    ? ["object", "loop"]
    : flow.type === "produces"
      ? ["loop", "object"]
      : ["loop", "loop"];
  if (flow.source.kind !== expectedKinds[0] || flow.target.kind !== expectedKinds[1]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${flow.type} flows require ${expectedKinds[0]} -> ${expectedKinds[1]}`
    });
  }
  if (flow.type === "supports" && !flow.condition) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["condition"],
      message: "Supporting-loop fan-out requires an explicit evidence condition"
    });
  }
});

const packTopologySchema = z.object({
  objects: z.array(packTopologyObjectSchema).default([]),
  flows: z.array(packTopologyFlowSchema).default([])
}).strict().superRefine((topology, ctx) => {
  const objectIds = new Set(topology.objects.map((object) => object.id));
  if (objectIds.size !== topology.objects.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objects"], message: "Topology object IDs must be unique" });
  }
  const flowIds = new Set(topology.flows.map((flow) => flow.id));
  if (flowIds.size !== topology.flows.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flows"], message: "Topology flow IDs must be unique" });
  }
  for (const [index, flow] of topology.flows.entries()) {
    for (const [side, endpoint] of [["source", flow.source], ["target", flow.target]] as const) {
      if (endpoint.kind === "object" && !objectIds.has(endpoint.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flows", index, side, "id"],
          message: `Topology flow references unknown object ${endpoint.id}`
        });
      }
    }
    if (flow.source.kind === flow.target.kind && flow.source.id === flow.target.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flows", index], message: "Topology flows cannot point to themselves" });
    }
  }
});

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
  topology: packTopologySchema.default({ objects: [], flows: [] }),
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
      publisherId: appIdSchema,
      keyId: z.string().min(1),
      publicKey: z.string().min(32),
      value: z.string().min(1)
    }).strict().optional()
  }).strict()
}).strict();

export const marketplaceArtifactSourceSchema = z.object({
  sourceId: appIdSchema,
  sourceType: z.enum(["official", "filesystem", "github", "hosted"]),
  sourceUri: z.string().min(1),
  sourceRef: z.string().min(1).optional(),
  snapshotDigest: artifactDigestSchema,
  trustPolicy: z.enum(["official_only", "signed", "explicit_local"]),
  synchronizedAt: isoDateTimeSchema
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
  optionalCapabilities: z.array(logicalCapabilitySchema).default([]),
  presets: z.array(packPresetSchema),
  modules: z.array(packModuleSchema),
  includedLoopCount: z.number().int().nonnegative().default(0),
  preview: z.object({
    synthetic: z.boolean(),
    sampleData: z.boolean(),
    historicalReplay: z.literal("installed_read_only")
  }).strict().default({
    synthetic: false,
    sampleData: false,
    historicalReplay: "installed_read_only"
  }),
  maturity: appMaturitySchema,
  maturityEvidence: appMaturityEvidenceSchema.optional(),
  deprecated: z.boolean().default(false),
  deprecationMessage: z.string().min(1).optional(),
  revokedAt: isoDateTimeSchema.optional(),
  revocationReason: z.string().min(1).optional(),
  artifactUri: z.string().min(1),
  source: marketplaceArtifactSourceSchema,
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
  trustedPublisherKeys: z.array(publisherTrustKeySchema).default([]),
  refreshedAt: isoDateTimeSchema.optional()
}).strict();

export const companyContextValueSchema = z.object({
  key: z.string().min(1).max(500),
  type: z.enum(["string", "number", "boolean", "string_list", "object", "reference"]),
  value: jsonValueSchema,
  provenance: z.object({
    source: z.enum(["user", "hermes_inference", "provider", "import", "policy"]),
    sourceRef: z.string().min(1).max(1000).optional(),
    observedAt: isoDateTimeSchema
  }).strict(),
  verified: z.boolean(),
  confidence: z.number().min(0).max(1),
  owner: z.string().min(1).max(300),
  visibility: z.enum(["workspace", "department", "installation", "private"]),
  confirmedAt: isoDateTimeSchema.optional(),
  confirmedBy: z.string().min(1).max(300).optional(),
  consumerInstallationIds: z.array(appIdSchema).max(1000).default([])
}).strict().superRefine((entry, ctx) => {
  const valid = entry.type === "string" || entry.type === "reference"
    ? typeof entry.value === "string"
    : entry.type === "number"
      ? typeof entry.value === "number" && Number.isFinite(entry.value)
      : entry.type === "boolean"
        ? typeof entry.value === "boolean"
        : entry.type === "string_list"
          ? Array.isArray(entry.value) && entry.value.every((value) => typeof value === "string")
          : Boolean(entry.value) && typeof entry.value === "object" && !Array.isArray(entry.value);
  if (!valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `Company context value does not match declared type ${entry.type}` });
  }
});

export const companyContextSchema = z.object({
  schemaVersion: z.literal(COMPANY_CONTEXT_SCHEMA_VERSION),
  workspaceId: appIdSchema,
  companyId: appIdSchema,
  revision: z.number().int().nonnegative(),
  values: z.array(companyContextValueSchema).max(500).default([]),
  updatedAt: isoDateTimeSchema,
  updatedBy: z.string().min(1).max(300)
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
  providerId: appIdSchema.optional(),
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
    providerId: appIdSchema.optional(),
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

export const providerSchemaFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  type: z.enum(["string", "number", "boolean", "date", "datetime", "enum", "object"]),
  writable: z.boolean(),
  sampleValues: z.array(jsonValueSchema).max(10).default([])
}).strict();

export const providerSchemaSnapshotSchema = z.object({
  schemaVersion: z.literal(PROVIDER_SCHEMA_SNAPSHOT_VERSION),
  workspaceId: appIdSchema,
  connectionId: appIdSchema,
  providerId: appIdSchema,
  source: z.enum(["provider_api", "connector_metadata", "manual"]),
  samplePolicy: z.literal("redacted_only"),
  objects: z.array(z.object({
    objectType: z.string().min(1),
    fields: z.array(providerSchemaFieldSchema).min(1)
  }).strict()).min(1),
  inspectedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.optional(),
  inspectedBy: z.string().min(1)
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.expiresAt && Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.inspectedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Provider schema expiry must follow inspection" });
  }
  const objectTypes = snapshot.objects.map((object) => object.objectType);
  if (new Set(objectTypes).size !== objectTypes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objects"], message: "Provider object types must be unique" });
  }
  snapshot.objects.forEach((object, index) => {
    const names = object.fields.map((field) => field.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objects", index, "fields"], message: "Provider field names must be unique per object" });
    }
  });
});

export const fieldMappingSuggestionSchema = z.object({
  logicalField: z.string().min(1),
  providerField: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  requiresConfirmation: z.boolean(),
  required: z.boolean()
}).strict();

export const appFieldMappingPlanSchema = z.object({
  schemaVersion: z.literal(FIELD_MAPPING_PLAN_SCHEMA_VERSION),
  workspaceId: appIdSchema,
  appId: appIdSchema,
  version: appVersionSchema,
  presetId: appIdSchema,
  complete: z.boolean(),
  requirements: z.array(z.object({
    recipeId: appIdSchema,
    providerId: appIdSchema,
    connectorOnboarding: z.enum(["available", "custom_required"]).default("custom_required"),
    connectionId: appIdSchema.optional(),
    objectType: z.string().min(1),
    requiredLogicalFields: z.array(z.string().min(1)).default([]),
    optionalLogicalFields: z.array(z.string().min(1)).default([]),
    schemaStatus: z.enum(["connected_snapshot", "connector_metadata", "connection_required"]),
    snapshotInspectedAt: isoDateTimeSchema.optional(),
    providerFields: z.array(providerSchemaFieldSchema).default([]),
    existingMappings: z.array(connectorFieldMappingSchema).default([]),
    suggestions: z.array(fieldMappingSuggestionSchema).default([]),
    missingRequiredFields: z.array(z.string().min(1)).default([]),
    unverifiedRequiredFields: z.array(z.string().min(1)).default([])
  }).strict()).default([])
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
  configuration: appConfigurationSchema,
  fieldMappingIds: z.array(appIdSchema).default([]),
  permissions: z.array(permissionDecisionSchema).min(1),
  assets: z.array(plannedAssetSchema).min(1),
  graphDiff: z.object({
    nodesAdded: z.array(appIdSchema).default([]),
    nodesReused: z.array(appIdSchema).default([]),
    edgesAdded: z.array(appIdSchema).default([]),
    edgesRemoved: z.array(appIdSchema).default([])
  }).strict(),
  conflicts: z.array(z.object({
    kind: z.enum(["shared_company_object", "duplicate_loop", "asset_contract", "dependency", "graph"]),
    resourceId: appIdSchema,
    reason: z.string().min(1),
    currentDigest: artifactDigestSchema.optional(),
    proposedDigest: artifactDigestSchema.optional(),
    blocking: z.boolean().default(true)
  }).strict()).default([]),
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

export const appInstallationRevisionSchema = z.object({
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
  capturedAt: isoDateTimeSchema,
  capturedBy: z.string().min(1),
  reason: z.enum(["configure", "overlay", "update", "rollback", "repair", "detach"])
}).strict();

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
  derivation: z.object({
    derivedAppId: appIdSchema,
    upstreamAppId: appIdSchema,
    upstreamVersion: appVersionSchema,
    upstreamDigest: artifactDigestSchema,
    parentInstallationId: appIdSchema.optional(),
    createdAt: isoDateTimeSchema,
    createdBy: z.string().min(1),
    detachedAt: isoDateTimeSchema.optional(),
    detachedBy: z.string().min(1).optional(),
    snapshotPath: packRelativePathSchema.optional()
  }).strict().optional(),
  history: z.array(appInstallationRevisionSchema).max(20).default([]),
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
    sourceEventId: z.string().min(1).max(512).optional(),
    expectedAction: z.enum(["route", "append_evidence", "request_human", "defer", "unhandled", "ignore"]).optional(),
    actualAction: z.enum(["route", "append_evidence", "request_human", "defer", "unhandled", "ignore"]).optional(),
    expectedRoute: z.string().min(1).optional(),
    actualRoute: z.string().min(1).optional(),
    approvalRequired: z.boolean().optional(),
    reason: z.string().min(1).optional(),
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

export const historicalReplayEventSchema = z.object({
  id: z.string().min(1).max(512),
  occurredAt: isoDateTimeSchema,
  source: z.string().min(1),
  eventType: z.string().min(1),
  subject: z.object({
    type: z.string().min(1),
    id: z.string().min(1)
  }).strict(),
  normalizedPayload: z.record(jsonValueSchema).default({}),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  connectorState: z.enum(["connected", "degraded", "unavailable"]).default("connected"),
  expectedAction: z.enum(["route", "append_evidence", "request_human", "defer", "unhandled", "ignore"]).optional(),
  expectedLoopId: z.string().min(1).optional()
}).strict();

export const appHistoricalReplayRequestSchema = z.object({
  schemaVersion: z.literal(APP_EVAL_SCHEMA_VERSION),
  installationId: appIdSchema,
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  maxEvents: z.number().int().min(1).max(500).default(100),
  events: z.array(historicalReplayEventSchema).min(1).max(500),
  requestedAt: isoDateTimeSchema,
  requestedBy: z.string().min(1)
}).strict().superRefine((request, ctx) => {
  const from = Date.parse(request.from);
  const to = Date.parse(request.to);
  if (from >= to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Historical replay end must be after its start" });
  }
  if (to - from > 90 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Historical replay is limited to a 90-day window" });
  }
  if (request.events.length > request.maxEvents) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events"], message: "Historical replay event count exceeds maxEvents" });
  }
  request.events.forEach((event, index) => {
    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt < from || occurredAt > to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events", index, "occurredAt"], message: "Historical event is outside the approved replay window" });
    }
  });
});

export const appEvalJudgmentSchema = z.object({
  schemaVersion: z.literal(APP_EVAL_SCHEMA_VERSION),
  runId: appIdSchema,
  scenarioId: appIdSchema,
  label: z.enum(["correct", "incomplete", "false_positive"]),
  reviewMinutes: z.number().nonnegative().max(480),
  notes: z.string().max(2000).optional(),
  reviewedBy: z.string().min(1),
  reviewedAt: isoDateTimeSchema
}).strict();

export const appPromotionRecommendationSchema = z.object({
  schemaVersion: z.literal(APP_EVAL_SCHEMA_VERSION),
  installationId: appIdSchema,
  recommendedMode: z.enum(["hold", "shadow", "recommend"]),
  canAutoPromote: z.literal(false),
  confidence: z.number().min(0).max(1),
  falsePositiveRate: z.number().min(0).max(1).optional(),
  incompleteRate: z.number().min(0).max(1).optional(),
  estimatedReviewMinutes: z.number().nonnegative(),
  gates: z.array(z.object({
    id: appIdSchema,
    status: z.enum(["pass", "warn", "fail"]),
    summary: z.string().min(1)
  }).strict()).min(1),
  requiredApprovals: z.array(z.string().min(1)).min(1),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  evaluatedAt: isoDateTimeSchema
}).strict();

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

export const appOnboardingStageSchema = z.enum([
  "choose_preset",
  "answer_questions",
  "connect_systems",
  "confirm_mappings",
  "review_install",
  "recover_lifecycle",
  "run_conformance",
  "resolve_test_failures",
  "activate_shadow",
  "operate",
  "resume",
  "unavailable"
]);

export const appOnboardingJourneySchema = z.object({
  schemaVersion: z.literal(APP_ONBOARDING_SCHEMA_VERSION),
  workspaceId: appIdSchema,
  app: z.object({
    id: appIdSchema,
    name: z.string().min(1).max(160),
    version: appVersionSchema,
    department: DepartmentTypeSchema,
    presets: z.array(z.object({
      id: appIdSchema,
      name: z.string().min(1).max(160),
      description: z.string().min(1).max(1000)
    }).strict()).min(1),
    presetId: appIdSchema.optional()
  }).strict(),
  installationId: appIdSchema.optional(),
  stage: appOnboardingStageSchema,
  headline: z.string().min(1).max(500),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive()
  }).strict().superRefine((progress, ctx) => {
    if (progress.completed > progress.total) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completed"], message: "Completed onboarding steps cannot exceed total steps" });
    }
  }),
  steps: z.array(z.object({
    id: z.enum(["select", "connect", "configure", "map", "review", "test", "shadow", "operate"]),
    label: z.string().min(1).max(120),
    status: z.enum(["complete", "current", "pending", "blocked", "optional"]),
    summary: z.string().min(1).max(500)
  }).strict()).length(8),
  questions: z.array(z.object({
    key: z.string().min(1).max(160),
    prompt: z.string().min(1).max(500),
    why: z.string().min(1).max(1000),
    valueType: z.enum(["string", "number", "boolean", "string_list", "object"]),
    requirement: z.enum(["required", "optional"]),
    confirmationRequired: z.boolean(),
    currentValue: jsonValueSchema.optional()
  }).strict()).max(20).default([]),
  blockers: z.array(z.object({
    kind: z.enum(["configuration", "connection", "mapping", "permission", "test", "lifecycle"]),
    id: z.string().min(1).max(300),
    summary: z.string().min(1).max(1000),
    remediation: z.string().min(1).max(1000)
  }).strict()).default([]),
  plan: appInstallPlanSchema.optional(),
  mappingPlan: appFieldMappingPlanSchema.optional(),
  installation: workspaceAppInstallationSchema.optional(),
  readiness: appReadinessSchema.optional(),
  recovery: z.object({
    operationId: z.string().min(1).max(160),
    action: z.enum(["install", "uninstall"]),
    status: z.enum(["prepared", "requires_reconciliation"]),
    targetArtifactDigest: artifactDigestSchema,
    startedAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    affected: z.object({
      loops: z.number().int().nonnegative().max(100),
      fieldMappings: z.number().int().nonnegative().max(200),
      companyContextValues: z.number().int().nonnegative().max(100)
    }).strict()
  }).strict().optional(),
  evidence: z.object({
    syntheticStatus: z.enum(["not_run", "passed", "failed"]),
    historicalReplayStatus: z.enum(["not_run", "passed", "failed"]),
    providerWritesBlocked: z.boolean()
  }).strict(),
  nextAction: z.object({
    kind: z.enum(["choose_preset", "answer_questions", "connect_providers", "confirm_mappings", "review_plan", "retry_exact_request", "call_tool", "inspect_failures", "monitor", "none"]),
    summary: z.string().min(1).max(1000),
    toolName: z.string().min(1).max(160).optional(),
    requiresHumanConfirmation: z.boolean(),
    input: z.record(jsonValueSchema).optional()
  }).strict().superRefine((action, ctx) => {
    if (action.kind === "call_tool" && !action.toolName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolName"], message: "Tool actions require an exact tool name" });
    }
  }),
  generatedAt: isoDateTimeSchema
}).strict().superRefine((journey, ctx) => {
  const currentSteps = journey.steps.filter((step) => step.status === "current");
  if (currentSteps.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps"], message: "An onboarding journey must have exactly one current step" });
  }
  if (journey.installation && journey.installation.id !== journey.installationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["installationId"], message: "Installation identity does not match the onboarding journey" });
  }
});

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
  permissionReviewRequired: z.boolean(),
  planDigest: artifactDigestSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema
}).strict().superRefine((plan, ctx) => {
  if (Date.parse(plan.expiresAt) <= Date.parse(plan.createdAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Update plan expiry must be after creation" });
  }
  if (canonicalAppDigest({ ...plan, planDigest: undefined }) !== plan.planDigest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planDigest"], message: "Update plan digest does not match canonical plan content" });
  }
});

export const appLifecycleReceiptSchema = z.object({
  schemaVersion: z.literal(APP_INSTALL_SCHEMA_VERSION),
  id: appIdSchema,
  workspaceId: appIdSchema,
  installationId: appIdSchema,
  action: z.enum(["configure", "overlay", "repair", "duplicate", "detach", "update", "rollback", "uninstall"]),
  actor: z.string().min(1),
  previousRevision: z.number().int().nonnegative(),
  resultingRevision: z.number().int().positive(),
  previousArtifactDigest: artifactDigestSchema.optional(),
  resultingArtifactDigest: artifactDigestSchema.optional(),
  removedAssetIds: z.array(appIdSchema).default([]),
  preservedSharedAssetIds: z.array(appIdSchema).default([]),
  evidenceRetained: z.boolean(),
  reversible: z.boolean(),
  reason: z.string().min(1).max(2000),
  createdAt: isoDateTimeSchema
}).strict();

const appActivatableModeSchema = z.enum(["shadow", "recommend", "execute_with_approval"]);

export const appActivationApprovalReceiptSchema = z.object({
  schemaVersion: z.literal(APP_ACTIVATION_APPROVAL_SCHEMA_VERSION),
  id: appIdSchema,
  workspaceId: appIdSchema,
  installationId: appIdSchema,
  appId: appIdSchema,
  artifactDigest: artifactDigestSchema,
  fromState: appInstallationStateSchema,
  requestedMode: appActivatableModeSchema,
  approvedBy: z.string().min(1).max(300),
  reason: z.string().min(1).max(2000),
  evidenceRefs: z.array(z.string().min(1).max(1000)).max(100).default([]),
  approvedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  approvalDigest: artifactDigestSchema,
  consumedAt: isoDateTimeSchema.optional(),
  consumedBy: z.string().min(1).max(300).optional()
}).strict().superRefine((receipt, ctx) => {
  if (Date.parse(receipt.expiresAt) <= Date.parse(receipt.approvedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Activation approval expiry must follow approval" });
  }
  if (receipt.approvalDigest !== canonicalAppDigest({
    schemaVersion: receipt.schemaVersion,
    id: receipt.id,
    workspaceId: receipt.workspaceId,
    installationId: receipt.installationId,
    appId: receipt.appId,
    artifactDigest: receipt.artifactDigest,
    fromState: receipt.fromState,
    requestedMode: receipt.requestedMode,
    approvedBy: receipt.approvedBy,
    reason: receipt.reason,
    evidenceRefs: receipt.evidenceRefs,
    approvedAt: receipt.approvedAt,
    expiresAt: receipt.expiresAt
  })) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalDigest"], message: "Activation approval digest does not match the approved content" });
  }
  if (Boolean(receipt.consumedAt) !== Boolean(receipt.consumedBy)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consumedAt"], message: "Consumed activation approvals require both timestamp and actor" });
  }
});

export type LoopPackManifest = z.infer<typeof loopPackManifestSchema>;
export type LoopPackArtifact = z.infer<typeof loopPackArtifactSchema>;
export type LoopPackSignature = z.infer<typeof loopPackSignatureSchema>;
export type PublisherTrustKey = z.infer<typeof publisherTrustKeySchema>;
export type MarketplaceApp = z.infer<typeof marketplaceAppSchema>;
export type MarketplaceAppVersion = z.infer<typeof marketplaceAppVersionSchema>;
export type AppMaturityEvidence = z.infer<typeof appMaturityEvidenceSchema>;
export type AppIndependentVerificationReceipt = z.infer<typeof appIndependentVerificationReceiptSchema>;
export type AppVerifierTrustKey = z.infer<typeof appVerifierTrustKeySchema>;
export type AppOperationalMaturityAssessment = z.infer<typeof appOperationalMaturityAssessmentSchema>;
export type MarketplaceArtifactSource = z.infer<typeof marketplaceArtifactSourceSchema>;
export type MarketplaceCatalogSource = z.infer<typeof marketplaceCatalogSourceSchema>;
export type AppInstallPlan = z.infer<typeof appInstallPlanSchema>;
export type WorkspaceAppInstallation = z.infer<typeof workspaceAppInstallationSchema>;
export type AppInstallationLock = z.infer<typeof appInstallationLockSchema>;
export type CompanyContext = z.infer<typeof companyContextSchema>;
export type CompanyContextValue = z.infer<typeof companyContextValueSchema>;
export type ConnectorRecipe = z.infer<typeof connectorRecipeSchema>;
export type ConnectorFieldMapping = z.infer<typeof connectorFieldMappingSchema>;
export type ProviderSchemaField = z.infer<typeof providerSchemaFieldSchema>;
export type ProviderSchemaSnapshot = z.infer<typeof providerSchemaSnapshotSchema>;
export type FieldMappingSuggestion = z.infer<typeof fieldMappingSuggestionSchema>;
export type AppFieldMappingPlan = z.infer<typeof appFieldMappingPlanSchema>;
export type AppConfiguration = z.infer<typeof appConfigurationSchema>;
export type AppConfigField = z.infer<typeof appConfigFieldSchema>;
export type AppOverlay = z.infer<typeof appOverlaySchema>;
export type AppEvalRun = z.infer<typeof appEvalRunSchema>;
export type AppHistoricalReplayRequest = z.infer<typeof appHistoricalReplayRequestSchema>;
export type AppEvalJudgment = z.infer<typeof appEvalJudgmentSchema>;
export type AppPromotionRecommendation = z.infer<typeof appPromotionRecommendationSchema>;
export type AppReadiness = z.infer<typeof appReadinessSchema>;
export type AppOnboardingStage = z.infer<typeof appOnboardingStageSchema>;
export type AppOnboardingJourney = z.infer<typeof appOnboardingJourneySchema>;
export type AppUpdatePlan = z.infer<typeof appUpdatePlanSchema>;
export type AppLifecycleReceipt = z.infer<typeof appLifecycleReceiptSchema>;
export type AppActivationApprovalReceipt = z.infer<typeof appActivationApprovalReceiptSchema>;
export type AppInstallationState = z.infer<typeof appInstallationStateSchema>;
export type AppRolloutMode = z.infer<typeof appRolloutModeSchema>;

export function canonicalAppDigest(value: unknown): string {
  return `sha256:${contentDigest(value)}`;
}

export function appPlatformJsonSchemas(): Record<string, Record<string, unknown>> {
  return {
    LoopPackManifest: zodToJsonSchema(loopPackManifestSchema, "LoopPackManifest") as Record<string, unknown>,
    LoopPackArtifact: zodToJsonSchema(loopPackArtifactSchema, "LoopPackArtifact") as Record<string, unknown>,
    LoopPackSignature: zodToJsonSchema(loopPackSignatureSchema, "LoopPackSignature") as Record<string, unknown>,
    PublisherTrustKey: zodToJsonSchema(publisherTrustKeySchema, "PublisherTrustKey") as Record<string, unknown>,
    MarketplaceArtifactSource: zodToJsonSchema(marketplaceArtifactSourceSchema, "MarketplaceArtifactSource") as Record<string, unknown>,
    AppMaturityEvidence: zodToJsonSchema(appMaturityEvidenceSchema, "AppMaturityEvidence") as Record<string, unknown>,
    AppIndependentVerificationReceipt: zodToJsonSchema(appIndependentVerificationReceiptSchema, "AppIndependentVerificationReceipt") as Record<string, unknown>,
    AppVerifierTrustKey: zodToJsonSchema(appVerifierTrustKeySchema, "AppVerifierTrustKey") as Record<string, unknown>,
    AppOperationalMaturityAssessment: zodToJsonSchema(appOperationalMaturityAssessmentSchema, "AppOperationalMaturityAssessment") as Record<string, unknown>,
    MarketplaceApp: zodToJsonSchema(marketplaceAppSchema, "MarketplaceApp") as Record<string, unknown>,
    AppInstallPlan: zodToJsonSchema(appInstallPlanSchema, "AppInstallPlan") as Record<string, unknown>,
    WorkspaceAppInstallation: zodToJsonSchema(workspaceAppInstallationSchema, "WorkspaceAppInstallation") as Record<string, unknown>,
    AppInstallationLock: zodToJsonSchema(appInstallationLockSchema, "AppInstallationLock") as Record<string, unknown>,
    CompanyContext: zodToJsonSchema(companyContextSchema, "CompanyContext") as Record<string, unknown>,
    ConnectorRecipe: zodToJsonSchema(connectorRecipeSchema, "ConnectorRecipe") as Record<string, unknown>,
    ConnectorFieldMapping: zodToJsonSchema(connectorFieldMappingSchema, "ConnectorFieldMapping") as Record<string, unknown>,
    ProviderSchemaSnapshot: zodToJsonSchema(providerSchemaSnapshotSchema, "ProviderSchemaSnapshot") as Record<string, unknown>,
    AppFieldMappingPlan: zodToJsonSchema(appFieldMappingPlanSchema, "AppFieldMappingPlan") as Record<string, unknown>,
    AppConfiguration: zodToJsonSchema(appConfigurationSchema, "AppConfiguration") as Record<string, unknown>,
    AppOverlay: zodToJsonSchema(appOverlaySchema, "AppOverlay") as Record<string, unknown>,
    AppEvalRun: zodToJsonSchema(appEvalRunSchema, "AppEvalRun") as Record<string, unknown>,
    AppHistoricalReplayRequest: zodToJsonSchema(appHistoricalReplayRequestSchema, "AppHistoricalReplayRequest") as Record<string, unknown>,
    AppEvalJudgment: zodToJsonSchema(appEvalJudgmentSchema, "AppEvalJudgment") as Record<string, unknown>,
    AppPromotionRecommendation: zodToJsonSchema(appPromotionRecommendationSchema, "AppPromotionRecommendation") as Record<string, unknown>,
    AppReadiness: zodToJsonSchema(appReadinessSchema, "AppReadiness") as Record<string, unknown>,
    AppOnboardingJourney: zodToJsonSchema(appOnboardingJourneySchema, "AppOnboardingJourney") as Record<string, unknown>,
    AppUpdatePlan: zodToJsonSchema(appUpdatePlanSchema, "AppUpdatePlan") as Record<string, unknown>,
    AppLifecycleReceipt: zodToJsonSchema(appLifecycleReceiptSchema, "AppLifecycleReceipt") as Record<string, unknown>,
    AppActivationApprovalReceipt: zodToJsonSchema(appActivationApprovalReceiptSchema, "AppActivationApprovalReceipt") as Record<string, unknown>
  };
}

export function assertSafeInitialRollout(mode: z.infer<typeof appRolloutModeSchema>): void {
  if (mode !== "simulation" && mode !== "shadow") {
    throw new Error(`New app installations must begin in simulation or shadow mode, received ${mode}`);
  }
}
