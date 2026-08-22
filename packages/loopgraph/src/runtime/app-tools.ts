import { open, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import {
  APP_EVAL_SCHEMA_VERSION,
  appOverlayOperationSchema,
  appEvalSuiteSchema,
  appHistoricalReplayRequestSchema,
  historicalReplayEventSchema,
  appInstallPlanSchema,
  appIndependentVerificationReceiptSchema,
  appIdSchema,
  appFieldMappingPlanSchema,
  appRolloutModeSchema,
  appUpdatePlanSchema,
  artifactDigestSchema,
  appSetupDefinitionSchema,
  appVerifierTrustKeySchema,
  DepartmentTypeSchema,
  marketplaceCatalogSourceSchema,
  marketplaceAppSchema,
  logicalCapabilitySchema,
  providerSchemaFieldSchema,
  type AppFieldMappingPlan,
  type ConnectionInstance,
  type ConnectorTenant,
  type MarketplaceApp
} from "../core";
import { assessAppOperationalMaturity } from "./app-operational-maturity";
import { AppInstallationService } from "./app-installation-service";
import { AppOperationExecutionService, type AppOperationTransport } from "./app-operation-execution";
import {
  APP_OPERATION_ACTION_LEDGER_SCHEMA_VERSION,
  FileAppOperationActionStore,
  type AppOperationActionStore
} from "./app-operation-action-store";
import {
  LoopgraphAppRuntimeOperationRegistry,
  type AppRuntimeOperationTransport
} from "./app-runtime-operations";
import { FileAppInstallationStore, type AppInstallationStore } from "./app-installation-store";
import {
  FileAppVerificationStore,
  type AppVerificationRegistry,
  type AppVerificationStore
} from "./app-verification-store";
import { LocalAppMarketplace } from "./app-marketplace";
import { satisfiesVersionRange } from "./app-pack-loader";
import { compileLoopPack } from "./app-pack-compiler";
import { LoopgraphAppPublisher } from "./app-publisher";
import { readConnectionInstances } from "./connector-registry";
import {
  FileConnectorFieldMappingStore,
  FileProviderSchemaSnapshotStore,
  type ConnectorFieldMappingStore,
  type ProviderSchemaSnapshotStore,
  loadConnectorRecipes,
  normalizeConnectorProviderId,
  providerIdForCapability,
  resolveConnectorCapabilities,
  suggestFieldMappings,
  validateFieldMappingCoverage
} from "./app-connector-service";
import { inspectLoopgraphWorkspace } from "./workspace";
import { PROVIDER_ONBOARDING_CATALOG } from "./provider-onboarding";
import { HostedMarketplaceClient } from "./hosted-marketplace-client";
import { FileOutcomeStore, type OutcomeStore } from "./outcome-store";
import { FileHermesOperationsStore, type HermesOperationsStore } from "./hermes-operations-store";
import { FileRoutingStore, type RoutingStore } from "./routing-store";
import { getLoopgraphRoot } from "./storage-resolver";
import { FileLoopSpecRegistryStore, type LoopSpecRegistryStore } from "./loop-spec-store";
import { FileCompanyContextStore, type CompanyContextStore } from "./company-context-service";
import { ensureRemoteHostedMarketplaceArtifact } from "./hosted-marketplace-cache";
import { deriveAppOnboardingJourney } from "./app-onboarding-journey";
import {
  getOfficialDepartmentPack,
  searchOfficialDepartmentPacks
} from "./department-pack-catalog";
import {
  getOfficialCompanyBlueprint,
  searchOfficialCompanyBlueprints
} from "./company-blueprint-catalog";

const REMOTE_HOSTED_ARTIFACT_TOOLS = new Set<LoopgraphAppToolName>([
  "loopgraph_app_get",
  "loopgraph_app_onboarding_get",
  "loopgraph_app_install_plan",
  "loopgraph_app_install_apply",
  "loopgraph_app_field_mappings_get"
]);

const MAX_MARKETPLACE_CHANGELOG_BYTES = 64 * 1024;

export const LOOPGRAPH_APP_TOOL_NAMES = [
  "loopgraph_company_blueprints_search",
  "loopgraph_company_blueprint_get",
  "loopgraph_company_context_get",
  "loopgraph_company_context_approve",
  "loopgraph_department_packs_search",
  "loopgraph_department_pack_get",
  "loopgraph_marketplace_search",
  "loopgraph_app_get",
  "loopgraph_app_onboarding_get",
  "loopgraph_app_install_plan",
  "loopgraph_app_install_apply",
  "loopgraph_app_install_status",
  "loopgraph_app_operation_resolve",
  "loopgraph_app_operation_invoke",
  "loopgraph_app_operation_actions_get",
  "loopgraph_app_operation_action_commit",
  "loopgraph_app_maturity_get",
  "loopgraph_app_verification_registry_get",
  "loopgraph_app_verifier_trust_add",
  "loopgraph_app_verifier_trust_revoke",
  "loopgraph_app_verification_import",
  "loopgraph_connector_schema_record",
  "loopgraph_app_field_mappings_get",
  "loopgraph_app_field_mapping_confirm",
  "loopgraph_app_test",
  "loopgraph_app_historical_replay",
  "loopgraph_app_evaluation_label",
  "loopgraph_app_promotion_recommendation",
  "loopgraph_app_configure",
  "loopgraph_app_overlay_apply",
  "loopgraph_app_repair",
  "loopgraph_app_duplicate",
  "loopgraph_app_diff",
  "loopgraph_app_update_plan",
  "loopgraph_app_update_apply",
  "loopgraph_app_rollback",
  "loopgraph_app_detach",
  "loopgraph_app_uninstall",
  "loopgraph_app_activation_approve",
  "loopgraph_app_activate",
  "loopgraph_app_pause",
  "loopgraph_app_resume",
  "loopgraph_app_publisher_key_generate",
  "loopgraph_app_publisher_keys_get",
  "loopgraph_app_init",
  "loopgraph_app_capture",
  "loopgraph_app_dev",
  "loopgraph_app_preview",
  "loopgraph_app_validate",
  "loopgraph_app_pack",
  "loopgraph_app_sign",
  "loopgraph_app_publish",
  "loopgraph_app_release_status",
  "loopgraph_marketplace_sources_get",
  "loopgraph_marketplace_source_add",
  "loopgraph_marketplace_source_refresh"
] as const;

const APP_PUBLISHER_TOOL_NAMES = new Set<LoopgraphAppToolName>([
  "loopgraph_app_publisher_key_generate",
  "loopgraph_app_publisher_keys_get",
  "loopgraph_app_init",
  "loopgraph_app_capture",
  "loopgraph_app_dev",
  "loopgraph_app_preview",
  "loopgraph_app_validate",
  "loopgraph_app_pack",
  "loopgraph_app_sign",
  "loopgraph_app_publish",
  "loopgraph_app_release_status",
  "loopgraph_marketplace_sources_get",
  "loopgraph_marketplace_source_add",
  "loopgraph_marketplace_source_refresh"
]);

export type LoopgraphAppToolName = (typeof LOOPGRAPH_APP_TOOL_NAMES)[number];

const projectSchema = z.object({ projectRoot: z.string().optional() }).strict();

export const companyBlueprintsSearchInputSchema = projectSchema.extend({
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(20).default(20)
}).strict();

export const companyBlueprintGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  blueprintId: z.string().min(1)
}).strict();

export const companyContextGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional()
}).strict();

export const companyContextApproveInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  expectedRevision: z.number().int().nonnegative(),
  approvedBy: z.string().min(1).max(300),
  proposal: z.object({
    key: z.string().min(1).max(500),
    type: z.enum(["string", "number", "boolean", "string_list", "object", "reference"]),
    value: z.unknown(),
    provenance: z.object({
      source: z.enum(["user", "hermes_inference", "provider", "import", "policy"]),
      sourceRef: z.string().min(1).max(1000).optional(),
      observedAt: z.string().datetime().optional()
    }).strict(),
    confidence: z.number().min(0).max(1),
    owner: z.string().min(1).max(300),
    visibility: z.enum(["workspace", "department", "installation", "private"]).default("workspace"),
    explanation: z.string().min(1).max(4000)
  }).strict()
}).strict();

export const departmentPacksSearchInputSchema = projectSchema.extend({
  query: z.string().max(500).optional(),
  department: DepartmentTypeSchema.exclude(["custom"]).optional(),
  limit: z.number().int().min(1).max(50).default(20)
}).strict();

export const departmentPackGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  packId: z.string().min(1)
}).strict();

export const marketplaceSearchInputSchema = projectSchema.extend({
  query: z.string().max(500).optional(),
  department: z.string().min(1).optional(),
  capability: z.string().min(1).optional(),
  maturity: z.enum(["concept", "tested", "connected", "production_proven", "loopgraph_verified"]).optional(),
  includeDeprecated: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20)
}).strict();

export const appGetInputSchema = projectSchema.extend({
  appId: z.string().min(1),
  version: z.string().min(1).optional()
}).strict();

export const appOnboardingGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  appId: z.string().min(1),
  versionRange: z.string().min(1).default("latest"),
  presetId: z.string().min(1).optional(),
  selectedModules: z.array(z.string().min(1)).optional(),
  configuration: z.record(z.unknown()).default({}),
  fieldMappingIds: z.array(z.string().min(1)).optional(),
  installationId: z.string().min(1).optional(),
  actor: z.string().min(1).default("hermes")
}).strict();

export const appInstallPlanInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  appId: z.string().min(1),
  versionRange: z.string().min(1).default("latest"),
  presetId: z.string().min(1),
  selectedModules: z.array(z.string().min(1)).optional(),
  configuration: z.record(z.unknown()).default({}),
  fieldMappingIds: z.array(z.string().min(1)).optional(),
  actor: z.string().min(1).default("hermes")
}).strict();

export const appInstallApplyInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  plan: appInstallPlanSchema,
  actor: z.string().min(1).default("hermes")
}).strict();

export const appInstallStatusInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: z.string().min(1).optional()
}).strict();

export const appOperationResolveInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: appIdSchema,
  loopId: appIdSchema,
  capability: logicalCapabilitySchema
}).strict();

export const appOperationInvokeInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: appIdSchema,
  loopId: appIdSchema,
  capability: logicalCapabilitySchema,
  routeJobId: z.string().min(1).max(256),
  agentInstanceId: z.string().min(1).max(256),
  callId: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  input: z.record(z.string(), z.unknown()).default({})
}).strict();

export const appOperationActionsGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: appIdSchema.optional(),
  loopId: appIdSchema.optional(),
  routeJobId: z.string().min(1).max(256).optional(),
  status: z.literal("prepared").optional(),
  limit: z.number().int().min(1).max(1_000).default(100)
}).strict();

export const appOperationActionCommitInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: appIdSchema,
  actionId: appIdSchema,
  routeJobId: z.string().min(1).max(256),
  agentInstanceId: z.string().min(1).max(256),
  callId: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
}).strict();

export const appMaturityGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: z.string().min(1)
}).strict();

export const appVerificationRegistryGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional()
}).strict();

export const appVerifierTrustAddInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  key: appVerifierTrustKeySchema
}).strict();

export const appVerifierTrustRevokeInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  verifierId: z.string().min(1).max(300),
  keyId: z.string().min(1).max(160),
  revokedBy: z.string().min(1).max(300),
  revocationRef: z.string().min(1).max(1000),
  revokedAt: z.string().datetime().optional()
}).strict();

export const appVerificationImportInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  receipt: appIndependentVerificationReceiptSchema,
  importedBy: z.string().min(1).max(300),
  importRef: z.string().min(1).max(1000)
}).strict();

export const connectorSchemaRecordInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  connectionId: z.string().min(1),
  providerId: z.string().min(1),
  source: z.enum(["provider_api", "connector_metadata", "manual"]),
  samplePolicy: z.literal("redacted_only"),
  objects: z.array(z.object({
    objectType: z.string().min(1),
    fields: z.array(providerSchemaFieldSchema).min(1)
  }).strict()).min(1),
  inspectedAt: z.string().datetime().optional(),
  ttlSeconds: z.number().int().min(300).max(604_800).default(86_400),
  actor: z.string().min(1).default("hermes")
}).strict();

export const appFieldMappingsGetInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  appId: z.string().min(1),
  version: z.string().min(1).optional(),
  presetId: z.string().min(1)
}).strict();

export const appFieldMappingConfirmInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  connectionId: z.string().min(1),
  objectType: z.string().min(1),
  mappings: z.array(z.object({
    logicalField: z.string().min(1),
    providerField: z.string().min(1),
    direction: z.enum(["read", "write", "bidirectional"]).default("read"),
    confidence: z.number().min(0).max(1)
  }).strict()).min(1).max(100),
  actor: z.string().min(1).default("hermes")
}).strict();

const appInstallationActionInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: z.string().min(1),
  actor: z.string().min(1).default("hermes")
}).strict();

export const appTestInputSchema = appInstallationActionInputSchema;
export const appHistoricalReplayInputSchema = appInstallationActionInputSchema.extend({
  from: z.string().datetime(),
  to: z.string().datetime(),
  maxEvents: z.number().int().min(1).max(500).default(100),
  events: z.array(historicalReplayEventSchema).min(1).max(500)
}).strict();
export const appEvaluationLabelInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  runId: z.string().min(1),
  scenarioId: z.string().min(1),
  label: z.enum(["correct", "incomplete", "false_positive"]),
  reviewMinutes: z.number().nonnegative().max(480).default(0),
  notes: z.string().max(2000).optional(),
  actor: z.string().min(1).default("hermes")
}).strict();
export const appPromotionRecommendationInputSchema = appInstallationActionInputSchema.omit({ actor: true }).strict();
export const appConfigureInputSchema = appInstallationActionInputSchema.extend({
  values: z.record(z.unknown()),
  expectedConfigurationDigest: artifactDigestSchema
}).strict();
export const appOverlayApplyInputSchema = appInstallationActionInputSchema.extend({
  operations: z.array(appOverlayOperationSchema).max(100),
  expectedArtifactDigest: artifactDigestSchema,
  expectedOverlayRevision: z.number().int().nonnegative().default(0)
}).strict();
export const appRepairInputSchema = appInstallationActionInputSchema;
export const appDuplicateInputSchema = appInstallationActionInputSchema.extend({
  derivedAppId: z.string().min(3).max(160),
  overlayOperations: z.array(appOverlayOperationSchema).max(100).default([])
}).strict();
export const appDiffInputSchema = appInstallationActionInputSchema.omit({ actor: true }).strict();
export const appUpdatePlanInputSchema = appInstallationActionInputSchema.extend({
  versionRange: z.string().min(1).max(100).default("latest")
}).strict();
export const appUpdateApplyInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  plan: appUpdatePlanSchema,
  approvedPermissionCapabilities: z.array(z.string().min(1)).default([]),
  actor: z.string().min(1).default("hermes")
}).strict();
export const appRollbackInputSchema = appInstallationActionInputSchema.extend({ expectedArtifactDigest: artifactDigestSchema }).strict();
export const appDetachInputSchema = appRollbackInputSchema;
export const appUninstallInputSchema = appInstallationActionInputSchema.extend({
  expectedArtifactDigest: artifactDigestSchema,
  reason: z.string().min(1).max(2000),
  confirmed: z.literal(true)
}).strict();
export const appPauseInputSchema = appInstallationActionInputSchema;
export const appResumeInputSchema = appInstallationActionInputSchema;
export const appActivationApproveInputSchema = projectSchema.extend({
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  installationId: z.string().min(1),
  mode: z.enum(["shadow", "recommend", "execute_with_approval"]),
  approvedBy: z.string().min(1).max(300),
  reason: z.string().min(1).max(2000),
  evidenceRefs: z.array(z.string().min(1).max(1000)).max(100).default([]),
  expiresInSeconds: z.number().int().min(60).max(3600).default(900)
}).strict();
export const appActivateInputSchema = appInstallationActionInputSchema.extend({
  approvalReceiptId: z.string().min(1),
  mode: appRolloutModeSchema.refine((mode) => mode === "shadow" || mode === "recommend" || mode === "execute_with_approval", {
    message: "MCP activation supports shadow, recommend, or execute_with_approval; live requires a separate promotion receipt"
  })
}).strict();
export const appPublisherKeyGenerateInputSchema = projectSchema.extend({
  publisherId: z.string().min(3).max(160),
  keyId: z.string().min(3).max(160).optional()
}).strict();
export const appPublisherKeysGetInputSchema = projectSchema;
export const appInitInputSchema = projectSchema.extend({
  destination: z.string().min(1),
  appId: z.string().min(3).max(160),
  name: z.string().min(1).max(120),
  department: z.enum(["management", "marketing", "sales", "product", "customer_success", "engineering", "ops_finance", "hr_talent", "legal_compliance", "custom"]),
  publisherId: z.string().min(3).max(160),
  publisherName: z.string().min(1).max(120).optional(),
  summary: z.string().min(1).max(180).optional()
}).strict();
export const appCaptureInputSchema = projectSchema.extend({
  installationId: z.string().min(1),
  derivedAppId: z.string().min(3).max(160),
  name: z.string().min(1).max(120),
  publisherId: z.string().min(3).max(160),
  publisherName: z.string().min(1).max(120).optional(),
  destination: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  version: z.string().min(1).optional()
}).strict();
export const appDevInputSchema = projectSchema.extend({ packRoot: z.string().min(1) }).strict();
export const appPreviewInputSchema = projectSchema.extend({ packRoot: z.string().min(1) }).strict();
export const appValidateInputSchema = projectSchema.extend({ packRoot: z.string().min(1) }).strict();
export const appPackInputSchema = appValidateInputSchema.extend({ destination: z.string().min(1) }).strict();
export const appSignInputSchema = appValidateInputSchema.extend({ keyId: z.string().min(3).max(160) }).strict();
export const appPublishInputSchema = appValidateInputSchema.extend({ catalogId: z.string().min(3).max(160) }).strict();
export const appReleaseStatusInputSchema = projectSchema.extend({
  catalogId: z.string().min(3).max(160),
  appId: z.string().min(3).max(160),
  version: z.string().min(1),
  status: z.enum(["deprecated", "revoked"]),
  message: z.string().min(1).max(2000)
}).strict();
export const marketplaceSourcesGetInputSchema = projectSchema;
export const marketplaceSourceAddInputSchema = projectSchema.extend({ source: marketplaceCatalogSourceSchema }).strict();
export const marketplaceSourceRefreshInputSchema = projectSchema.extend({ sourceId: z.string().min(3).max(160) }).strict();

export const loopgraphAppToolDefinitions = [
  { name: "loopgraph_company_blueprints_search", description: "Search read-only company-wide Hermes Brain blueprints that compose Department Packs, canonical company objects, and cross-department evidence contracts.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_company_blueprint_get", description: "Inspect one company-wide Blueprint, Department Pack progress, canonical object contracts, cross-department topology, and the exact dependency-safe next Pack without installing anything.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_company_context_get", description: "Read the approved, provenance-bearing company context Hermes may reuse when deciding which App setup questions are still missing.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_company_context_approve", description: "Persist one explicitly reviewed business-context value with provenance and optimistic concurrency; rejects credentials and unreviewed inference.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_department_packs_search", description: "Search curated, read-only Department Pack topologies that group official Apps, shared context, and permitted cross-App handoffs for Hermes.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_department_pack_get", description: "Inspect one curated Department Pack, current per-App readiness, declared topology, and the exact next App onboarding action without bulk-installing or activating anything.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_marketplace_search", description: "Search available Loopgraph Apps by business outcome, department, capability, or maturity.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_get", description: "Inspect one app, immutable versions, modules, presets, permissions, capabilities, provenance, and graph intent.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_onboarding_get", description: "Return one state-derived, resumable App journey with only the unresolved questions, blockers, evidence, and exact safe next action for Hermes, CLI, or browser.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_plan", description: "Create a read-only content-bound installation plan using current connections, mappings, company context, and supplied answers.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_apply", description: "Atomically apply an unexpired exact installation plan without enabling provider writes.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_status", description: "Read installed app state, configuration provenance, bindings, permissions, owned assets, recoverable lifecycle operations, evaluations, lockfile, and readiness.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_operation_resolve", description: "Resolve one App-owned loop capability to its exact installation-scoped broker or Loopgraph runtime operation without accepting provider, operation, connection, URL, or credential choices from the caller.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_operation_invoke", description: "Invoke one resolved App capability for an active durable route job through its exact trusted Connector Broker binding; reads execute and writes only create fingerprint-bound prepared actions.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_operation_actions_get", description: "List secret-free App ownership records and append-only approval/commit evidence for provider actions, scoped to the trusted workspace and optional installation, loop, route, or status filters.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_operation_action_commit", description: "Ask the exact assigned Hermes route to commit one App-owned prepared action after Loopgraph revalidates its pinned artifact, LoopSpec, company object, connection, agent assignment, fingerprint, and approval receipt. Provider parameters are never caller-selectable.", readOnly: false, idempotent: true, destructive: true },
  { name: "loopgraph_app_maturity_get", description: "Derive installed App maturity from exact-digest tests, current connection readiness, reviewed history, observed outcomes and value, and trusted independent verification.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_verification_registry_get", description: "Inspect workspace verifier public-key trust, revocation state, and imported independent App verification receipts without exposing private key material.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_verifier_trust_add", description: "Trust an independently approved Ed25519 verifier public key in the workspace registry; private verifier keys are never accepted.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_verifier_trust_revoke", description: "Immediately revoke one trusted verifier public key with an accountable actor and revocation reference.", readOnly: false, idempotent: true, destructive: true },
  { name: "loopgraph_app_verification_import", description: "Verify and import a signed independent App verification receipt for the exact installed artifact digest.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_connector_schema_record", description: "Record a connection-bound provider field schema returned by an authenticated connector without storing credentials or unrestricted provider payloads.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_field_mappings_get", description: "Build an explainable field-mapping plan from an app recipe, reusable connection, live provider schema snapshot, and confirmed workspace mappings.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_field_mapping_confirm", description: "Confirm exact logical-to-provider field mappings for one connection; never silently confirms inferred mappings.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_test", description: "Run the installed app synthetic conformance suite with all provider writes blocked.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_historical_replay", description: "Evaluate a bounded historical event set through installed routing contracts with provider writes blocked and replay evidence recorded.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_evaluation_label", description: "Record an accountable correct, incomplete, or false-positive judgment and review burden for one replay decision.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_promotion_recommendation", description: "Derive a non-activating promotion recommendation from conformance, historical replay, human labels, and review burden.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_configure", description: "Apply confirmed company configuration against an exact prior configuration digest and reset the app to write-blocked testing.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_overlay_apply", description: "Store version-bound workspace customization without mutating the immutable base artifact.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_repair", description: "Recompile the exact pinned artifact, restore owned generated assets, and require fresh conformance.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_duplicate", description: "Create a private derived installation with namespaced loops and an independent workspace overlay.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_diff", description: "Inspect immutable base, effective configuration, overlay, derivation, history, and update availability.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_update_plan", description: "Create a content-bound three-way update plan with graph, overlay-conflict, and permission diffs.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_update_apply", description: "Apply an unexpired reviewed update plan, preserving overlays and requiring fresh evidence.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_rollback", description: "Restore the exact prior installed revision and return to write-blocked conformance.", readOnly: false, idempotent: false, destructive: true },
  { name: "loopgraph_app_detach", description: "Pin a workspace-local immutable snapshot and permanently stop upstream updates for a private derived app.", readOnly: false, idempotent: false, destructive: true },
  { name: "loopgraph_app_uninstall", description: "Remove only installation-owned runtime assets while retaining shared company resources and evidence.", readOnly: false, idempotent: false, destructive: true },
  { name: "loopgraph_app_activation_approve", description: "Record an accountable, short-lived, content-bound approval for one exact non-live App mode transition.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_activate", description: "Consume a matching one-time approval receipt to promote a tested app to shadow, recommend, or execute-with-approval; live remains separately governed.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_pause", description: "Pause an installed app without deleting shared connectors, mappings, context, entities, or evidence.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_resume", description: "Resume a paused app at its last safe non-live rollout mode.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_publisher_key_generate", description: "Generate a project-confined Ed25519 publisher key; return only the public trust material and keep the private key mode-0600.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_publisher_keys_get", description: "List public publisher trust material and private-key availability without returning private keys.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_init", description: "Scaffold a complete private Loopgraph App with routing, setup, connector, policy, outcome, and 13-case conformance contracts.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_capture", description: "Capture an installed app as a private parameterized pack without copying credential or configuration values.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_dev", description: "Inspect one declarative LoopPack as a developer: inventory graph, loops, skills, setup, connectors, permissions, and exact validation blockers without installing it.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_preview", description: "Run every declared synthetic scenario through the compiled Hermes routing contracts and return a write-blocked graph and decision preview without installation or provider calls.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_validate", description: "Validate, compile, secret-scan, and run deterministic write-blocked conformance for a LoopPack.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_pack", description: "Create a content-addressed verified LoopPack archive after publisher validation passes.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_sign", description: "Create and verify a detached Ed25519 signature over the exact immutable pack digest.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_publish", description: "Publish a signed immutable version into a trusted project-local private catalog and refresh marketplace metadata.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_release_status", description: "Deprecate or revoke an exact published app version and propagate that status into marketplace resolution.", readOnly: false, idempotent: true, destructive: true },
  { name: "loopgraph_marketplace_sources_get", description: "List configured official, local, signed GitHub, and private marketplace sources with their trust policy.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_marketplace_source_add", description: "Register an explicit catalog source; GitHub sources must pin a commit, snapshot digest, and exact publisher public keys.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_marketplace_source_refresh", description: "Synchronize, revalidate, and refresh one configured catalog source into the local marketplace index without installing it.", readOnly: false, idempotent: true, destructive: false }
] as const satisfies ReadonlyArray<{
  name: LoopgraphAppToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
  destructive: boolean;
}>;

export async function callLoopgraphAppTool(
  name: LoopgraphAppToolName,
  input: unknown,
  options: {
    projectRoot?: string;
    now?: Date;
    connections?: ConnectionInstance[];
    hostedMarketplaceClient?: HostedMarketplaceClient | null;
    outcomeStore?: OutcomeStore;
    hermesOperationsStore?: HermesOperationsStore;
    loopSpecStore?: LoopSpecRegistryStore;
    appInstallationStoreFactory?: (workspaceId: string) => AppInstallationStore;
    companyContextStoreFactory?: (workspaceId: string, companyId: string) => CompanyContextStore;
    connectorFieldMappingStoreFactory?: (workspaceId: string) => ConnectorFieldMappingStore;
    providerSchemaSnapshotStoreFactory?: (workspaceId: string) => ProviderSchemaSnapshotStore;
    appVerificationStoreFactory?: (workspaceId: string) => AppVerificationStore;
    connectorBroker?: AppOperationTransport;
    connectorTenant?: ConnectorTenant;
    routingStore?: RoutingStore;
    appRuntimeOperations?: AppRuntimeOperationTransport;
    appOperationActionStore?: AppOperationActionStore;
  } = {}
): Promise<unknown> {
  const raw = isRecord(input) ? input : {};
  const projectRoot = path.resolve(typeof raw.projectRoot === "string" ? raw.projectRoot : options.projectRoot ?? process.cwd());
  const marketplace = new LocalAppMarketplace(
    path.join(projectRoot, ".loopgraph", "apps", "marketplace"),
    undefined,
    { trustedGitHosts: trustedGitHostsFromEnvironment() }
  );
  if (!APP_PUBLISHER_TOOL_NAMES.has(name)) await marketplace.refreshAllCatalogSources();
  const hostedClient = APP_PUBLISHER_TOOL_NAMES.has(name)
    ? undefined
    : options.hostedMarketplaceClient === null
      ? undefined
      : options.hostedMarketplaceClient ?? HostedMarketplaceClient.fromEnvironment();

  if (name === "loopgraph_company_blueprints_search") {
    const parsed = companyBlueprintsSearchInputSchema.parse({ ...raw, projectRoot });
    const results = searchOfficialCompanyBlueprints(parsed);
    return {
      schemaVersion: "loopgraph-company-blueprint-search/v1alpha1",
      query: parsed.query,
      count: results.length,
      results
    };
  }

  if (name === "loopgraph_company_blueprint_get") {
    const parsed = companyBlueprintGetInputSchema.parse({ ...raw, projectRoot });
    const blueprint = getOfficialCompanyBlueprint(parsed.blueprintId);
    if (!blueprint) throw new Error(`Company Blueprint not found: ${parsed.blueprintId}`);
    const identity = await resolveIdentity(projectRoot, parsed.workspaceId, parsed.companyId);
    const registry = await appInstallationStore(
      options,
      path.join(projectRoot, ".loopgraph", "apps"),
      identity.workspaceId
    ).read();
    const orderedDefinitions = [...blueprint.packs].sort((left, right) => left.installOrder - right.installOrder);
    const departmentPacks = orderedDefinitions.map((definition) => {
      const pack = getOfficialDepartmentPack(definition.packId);
      if (!pack) throw new Error(`Official Company Blueprint Department Pack not found: ${definition.packId}`);
      const installed = pack.apps.filter((app) => registry.installations.some((installation) => installation.appId === app.appId)).length;
      return {
        definition,
        pack,
        progress: { installed, total: pack.apps.length, complete: installed === pack.apps.length }
      };
    });
    const completedPackIds = new Set(departmentPacks.filter((entry) => entry.progress.complete).map((entry) => entry.pack.id));
    const next = departmentPacks.find((entry) =>
      !entry.progress.complete && entry.definition.dependsOn.every((dependency) => completedPackIds.has(dependency))
    );
    return {
      schemaVersion: "loopgraph-company-blueprint-detail/v1alpha1",
      blueprint,
      departmentPacks,
      progress: {
        completedPacks: completedPackIds.size,
        totalPacks: departmentPacks.length,
        installedApps: registry.installations.filter((installation) => departmentPacks.some((entry) => entry.pack.apps.some((app) => app.appId === installation.appId))).length,
        totalApps: departmentPacks.reduce((count, entry) => count + entry.pack.apps.length, 0),
        complete: completedPackIds.size === departmentPacks.length
      },
      nextAction: next
        ? {
            action: "open_department_pack",
            tool: "loopgraph_department_pack_get",
            input: { packId: next.pack.id },
            packId: next.pack.id,
            reason: completedPackIds.size === 0 && next.pack.id === blueprint.defaultPackId
              ? `Start with the Company Blueprint default Department Pack: ${next.pack.name}.`
              : `Continue with the next dependency-safe Department Pack: ${next.pack.name}.`
          }
        : {
            action: "operate_company",
            tool: null,
            input: null,
            reason: "Every Department Pack is complete. Operate each App only at its independently approved rollout mode and use the declared object and evidence contracts for cross-department routing."
          }
    };
  }

  if (name === "loopgraph_department_packs_search") {
    const parsed = departmentPacksSearchInputSchema.parse({ ...raw, projectRoot });
    const results = searchOfficialDepartmentPacks(parsed);
    return {
      schemaVersion: "loopgraph-department-pack-search/v1alpha1",
      query: parsed.query,
      department: parsed.department,
      count: results.length,
      results
    };
  }

  if (name === "loopgraph_department_pack_get") {
    const parsed = departmentPackGetInputSchema.parse({ ...raw, projectRoot });
    const pack = getOfficialDepartmentPack(parsed.packId);
    if (!pack) throw new Error(`Department Pack not found: ${parsed.packId}`);
    const identity = await resolveIdentity(projectRoot, parsed.workspaceId, parsed.companyId);
    const installationStore = appInstallationStore(
      options,
      path.join(projectRoot, ".loopgraph", "apps"),
      identity.workspaceId
    );
    const mappingStore = connectorFieldMappingStore(
      options,
      path.join(projectRoot, ".loopgraph", "apps"),
      identity.workspaceId
    );
    const contextStore = companyContextStore(options, path.join(projectRoot, ".loopgraph", "apps"), identity.workspaceId, identity.companyId);
    const registry = await installationStore.read();
    const service = new AppInstallationService(
      marketplace,
      projectRoot,
      identity.workspaceId,
      identity.companyId,
      { installationStore, contextStore, mappingStore, loopSpecStore: options.loopSpecStore }
    );
    const orderedDefinitions = [...pack.apps].sort((left, right) => left.installOrder - right.installOrder);
    const applications = await Promise.all(orderedDefinitions.map(async (definition) => {
      const app = await marketplace.getApp(definition.appId);
      if (!app) throw new Error(`Official Department Pack App not found: ${definition.appId}`);
      const installation = registry.installations.find((candidate) => candidate.appId === definition.appId);
      return {
        definition,
        app,
        installation,
        readiness: installation ? await service.readiness(installation.id, options.now) : undefined
      };
    }));
    const installedAppIds = new Set(applications.filter((entry) => entry.installation).map((entry) => entry.app.id));
    const next = applications.find((entry) =>
      !entry.installation && entry.definition.dependsOn.every((dependency) => installedAppIds.has(dependency))
    );
    return {
      schemaVersion: "loopgraph-department-pack-detail/v1alpha1",
      pack,
      applications,
      progress: {
        installed: installedAppIds.size,
        total: applications.length,
        complete: installedAppIds.size === applications.length
      },
      nextAction: next
        ? {
            action: "onboard_app",
            tool: "loopgraph_app_onboarding_get",
            input: { appId: next.app.id, versionRange: "latest" },
            appId: next.app.id,
            reason: installedAppIds.size === 0
              ? next.app.id === pack.defaultAppId
                ? `Start with the Department Pack default App: ${next.app.name}.`
                : `Start with the required foundation App ${next.app.name} before onboarding the default App.`
              : `Continue with the next dependency-safe App: ${next.app.name}.`
          }
        : {
            action: "operate",
            tool: null,
            input: null,
            reason: "Every App in this Department Pack is installed. Continue each App's governed onboarding journey and operate only at its approved rollout mode."
          }
    };
  }

  if (name === "loopgraph_marketplace_search") {
    const parsed = marketplaceSearchInputSchema.parse({ ...raw, projectRoot });
    const localResults = (await marketplace.searchApps(parsed))
      .flatMap(withoutCachedHostedVersions);
    if (!hostedClient) {
      return { schemaVersion: "loopgraph-marketplace-search/v1alpha1", query: parsed.query, count: localResults.length, results: localResults };
    }
    const remoteResults = await hostedClient.search({
      query: parsed.query,
      department: parsed.department,
      capability: parsed.capability,
      limit: parsed.limit
    });
    const results = mergeMarketplaceSearchResults([
      ...localResults,
      ...remoteResults
        .filter((entry) => parsed.includeDeprecated || !entry.app.versions[0]?.deprecated)
        .filter((entry) => !parsed.maturity || entry.app.versions[0]?.maturity === parsed.maturity)
        .map((entry) => ({
          ...entry,
          score: parsed.query ? entry.score / 100 : 1
        }))
    ]).slice(0, parsed.limit);
    return {
      schemaVersion: "loopgraph-marketplace-search/v1alpha1",
      query: parsed.query,
      count: results.length,
      results,
      sources: { local: localResults.length, hosted: remoteResults.length }
    };
  }
  const remoteRequest = remoteHostedArtifactRequest(name, raw);
  if (hostedClient && remoteRequest) {
    const localVersions = await marketplace.listAppVersions(remoteRequest.appId);
    const candidates = localVersions.filter((candidate) =>
      (!remoteRequest.version || candidate.version === remoteRequest.version) &&
      (!remoteRequest.versionRange || satisfiesVersionRange(candidate.version, remoteRequest.versionRange)) &&
      (!remoteRequest.artifactDigest || candidate.digest === remoteRequest.artifactDigest)
    );
    if (
      candidates.length === 0 ||
      candidates.some((candidate) => candidate.source.sourceType === "hosted")
    ) {
      await ensureRemoteHostedMarketplaceArtifact({
        client: hostedClient,
        projectRoot,
        ...remoteRequest,
        includeDeprecated: remoteHostedReadMayUseDeprecated(name)
      });
    }
  }
  if (name === "loopgraph_app_get") {
    const parsed = appGetInputSchema.parse({ ...raw, projectRoot });
    const app = await marketplace.getApp(parsed.appId);
    if (!app) throw new Error(`Marketplace app not found: ${parsed.appId}`);
    const version = parsed.version
      ? app.versions.find((candidate) => candidate.version === parsed.version)
      : app.versions.find((candidate) => candidate.version === app.latestVersion);
    if (!version) throw new Error(`Marketplace app version not found: ${parsed.appId}@${parsed.version}`);
    const provenance = await marketplace.verifyAppProvenance(app.id, version.version);
    const loaded = await marketplace.getAppArtifact(app.id, version.version, version.digest);
    const compiled = await compileLoopPack(loaded);
    const [setup, evaluations] = await Promise.all([
      Promise.all(loaded.manifest.entrypoints.setup.map(async (entry) =>
        appSetupDefinitionSchema.parse(await readPackDocument(loaded.root, entry))
      )),
      Promise.all(loaded.manifest.entrypoints.evals.map(async (entry) =>
        appEvalSuiteSchema.parse(await readPackDocument(loaded.root, entry))
      ))
    ]);
    const loops = compiled.loopSpecs.map((spec) => ({
      id: spec.metadata.id,
      name: spec.metadata.name,
      description: spec.metadata.description,
      owner: spec.metadata.owner?.role,
      trigger: `${spec.trigger.source}:${spec.trigger.event}`,
      outcomes: Array.isArray(spec.studioExtension?.outcomes) ? spec.studioExtension.outcomes : []
    }));
    const approvalGatedPermissions = loaded.manifest.permissions.filter((permission) => permission.defaultPolicy !== "allowed");
    return {
      schemaVersion: "loopgraph-app-detail/v1alpha1",
      app,
      selectedVersion: version,
      manifest: loaded.manifest,
      provenance,
      graphPreview: compiled.graph,
      audience: {
        department: loaded.manifest.metadata.department,
        ownerRole: loaded.manifest.ownership.defaultOwnerRole,
        reviewRoles: loaded.manifest.ownership.reviewRoles
      },
      problemSolved: loaded.manifest.metadata.description,
      loops,
      skills: compiled.skills,
      setupQuestions: setup.flatMap((definition) => definition.questions),
      sampleOutputs: loops.flatMap((loop) => loop.outcomes.map((outcome, index) => ({
        id: `${loop.id}.outcome.${index + 1}`,
        loopId: loop.id,
        loopName: loop.name,
        metric: outcome.metric,
        description: outcome.description,
        direction: outcome.direction
      }))),
      limitations: [
        "Synthetic and sample previews demonstrate declared behavior; they do not prove production business value.",
        "Historical preview requires an installed App, healthy read connections, an explicitly bounded dataset, and no provider writes.",
        approvalGatedPermissions.length > 0
          ? `${approvalGatedPermissions.length} permission${approvalGatedPermissions.length === 1 ? " is" : "s are"} forbidden or approval-gated by default; installation never grants provider execution.`
          : "Installation never grants provider execution; any future provider write requires separate promotion and policy approval.",
        `The declared connector support is limited to ${loaded.manifest.presets.length} reviewed stack preset${loaded.manifest.presets.length === 1 ? "" : "s"}; other stacks require an explicit connector recipe and field review.`
      ],
      previewAvailability: {
        synthetic: loaded.manifest.entrypoints.evals.length > 0,
        sampleDataset: loaded.manifest.entrypoints.fixtures.length > 0,
        historicalReadOnlyRequiresInstallation: true
      },
      versionHistory: app.versions.map((candidate) => ({
        version: candidate.version,
        digest: candidate.digest,
        publishedAt: candidate.publishedAt,
        maturity: candidate.maturity,
        deprecated: candidate.deprecated,
        deprecationMessage: candidate.deprecationMessage,
        sourceId: candidate.source.sourceId
      })),
      changelog: await readOptionalBoundedText(path.join(loaded.root, "CHANGELOG.md")),
      evaluationSummary: {
        suites: evaluations.length,
        scenarios: evaluations.reduce((count, suite) => count + suite.scenarios.length, 0),
        scenarioIds: evaluations.flatMap((suite) => suite.scenarios.map((scenario) => scenario.id))
      }
    };
  }

  const publisher = new LoopgraphAppPublisher(projectRoot);
  if (name === "loopgraph_app_publisher_key_generate") {
    const parsed = appPublisherKeyGenerateInputSchema.parse({ ...raw, projectRoot });
    return publisher.generatePublisherKey({ ...parsed, now: options.now });
  }
  if (name === "loopgraph_app_publisher_keys_get") {
    appPublisherKeysGetInputSchema.parse({ ...raw, projectRoot });
    return { schemaVersion: "loopgraph-publisher-keys/v1alpha1", keys: await publisher.listPublisherKeys() };
  }
  if (name === "loopgraph_app_init") {
    const parsed = appInitInputSchema.parse({ ...raw, projectRoot });
    return publisher.initializeApp(parsed);
  }
  if (name === "loopgraph_app_capture") {
    const parsed = appCaptureInputSchema.parse({ ...raw, projectRoot });
    return publisher.captureInstallation(parsed);
  }
  if (name === "loopgraph_app_dev") {
    const parsed = appDevInputSchema.parse({ ...raw, projectRoot });
    return publisher.inspectDeveloperApp(parsed.packRoot);
  }
  if (name === "loopgraph_app_preview") {
    const parsed = appPreviewInputSchema.parse({ ...raw, projectRoot });
    return publisher.previewApp(parsed.packRoot, options.now);
  }
  if (name === "loopgraph_app_validate") {
    const parsed = appValidateInputSchema.parse({ ...raw, projectRoot });
    return publisher.validateApp(parsed.packRoot);
  }
  if (name === "loopgraph_app_pack") {
    const parsed = appPackInputSchema.parse({ ...raw, projectRoot });
    return publisher.packApp(parsed);
  }
  if (name === "loopgraph_app_sign") {
    const parsed = appSignInputSchema.parse({ ...raw, projectRoot });
    return publisher.signApp({ ...parsed, now: options.now });
  }
  if (name === "loopgraph_app_publish") {
    const parsed = appPublishInputSchema.parse({ ...raw, projectRoot });
    return publisher.publishApp({ ...parsed, now: options.now });
  }
  if (name === "loopgraph_app_release_status") {
    const parsed = appReleaseStatusInputSchema.parse({ ...raw, projectRoot });
    return publisher.setReleaseStatus({ ...parsed, now: options.now });
  }
  if (name === "loopgraph_marketplace_sources_get") {
    marketplaceSourcesGetInputSchema.parse({ ...raw, projectRoot });
    await marketplace.initialize();
    return { schemaVersion: "loopgraph-marketplace-sources/v1alpha1", sources: await marketplace.listCatalogSources() };
  }
  if (name === "loopgraph_marketplace_source_add") {
    const parsed = marketplaceSourceAddInputSchema.parse({ ...raw, projectRoot });
    return marketplace.addCatalogSource(parsed.source);
  }
  if (name === "loopgraph_marketplace_source_refresh") {
    const parsed = marketplaceSourceRefreshInputSchema.parse({ ...raw, projectRoot });
    return { schemaVersion: "loopgraph-marketplace-refresh/v1alpha1", apps: await marketplace.refreshCatalogSource(parsed.sourceId) };
  }

  const planWorkspaceId = name === "loopgraph_app_install_apply" && isRecord(raw.plan)
    ? raw.plan.workspaceId
    : undefined;
  const identity = await resolveIdentity(projectRoot, raw.workspaceId ?? planWorkspaceId, raw.companyId);
  const appsRoot = path.join(projectRoot, ".loopgraph", "apps");
  const mappingStore = connectorFieldMappingStore(options, appsRoot, identity.workspaceId);
  const snapshotStore = providerSchemaSnapshotStore(options, appsRoot, identity.workspaceId);
  const contextStore = companyContextStore(options, appsRoot, identity.workspaceId, identity.companyId);
  if (name === "loopgraph_company_context_get") {
    companyContextGetInputSchema.parse({ ...raw, projectRoot, ...identity });
    return contextStore.get(identity.workspaceId, identity.companyId);
  }
  if (name === "loopgraph_company_context_approve") {
    const parsed = companyContextApproveInputSchema.parse({ ...raw, projectRoot, ...identity });
    return contextStore.approveValue({
      workspaceId: identity.workspaceId,
      companyId: identity.companyId,
      expectedRevision: parsed.expectedRevision,
      approvedBy: parsed.approvedBy,
      proposal: {
        ...parsed.proposal,
        provenance: {
          ...parsed.proposal.provenance,
          observedAt: parsed.proposal.provenance.observedAt ?? (options.now ?? new Date()).toISOString()
        }
      },
      now: options.now
    });
  }
  if (name === "loopgraph_connector_schema_record") {
    const parsed = connectorSchemaRecordInputSchema.parse({ ...raw, projectRoot, ...identity });
    const connections = await appConnections(projectRoot, options.connections);
    const connection = connections.find((candidate) => candidate.id === parsed.connectionId);
    if (!connection) throw new Error(`Connection not found: ${parsed.connectionId}`);
    if (!providerMatchesConnection(parsed.providerId, connection.manifestId)) {
      throw new Error(`Provider ${parsed.providerId} does not match connection ${connection.id} (${connection.manifestId})`);
    }
    const observedNow = options.now ?? new Date();
    const inspectedAt = parsed.inspectedAt ?? observedNow.toISOString();
    if (Date.parse(inspectedAt) > observedNow.getTime() + 5 * 60_000) {
      throw new Error("Provider schema inspection time is too far in the future");
    }
    if (Date.parse(inspectedAt) < observedNow.getTime() - 7 * 24 * 60 * 60_000) {
      throw new Error("Provider schema snapshot is too old; inspect the connection again");
    }
    const expiresAt = new Date(Date.parse(inspectedAt) + parsed.ttlSeconds * 1000).toISOString();
    return snapshotStore.save({
      connectionId: parsed.connectionId,
      providerId: parsed.providerId,
      source: parsed.source,
      samplePolicy: parsed.samplePolicy,
      objects: parsed.objects,
      inspectedAt,
      expiresAt,
      inspectedBy: parsed.actor
    });
  }
  if (name === "loopgraph_app_field_mappings_get") {
    const parsed = appFieldMappingsGetInputSchema.parse({ ...raw, projectRoot, ...identity });
    return buildAppFieldMappingPlan({
      marketplace,
      projectRoot,
      workspaceId: identity.workspaceId,
      mappingStore,
      snapshotStore,
      connections: await appConnections(projectRoot, options.connections),
      ...parsed,
      now: options.now
    });
  }
  if (name === "loopgraph_app_field_mapping_confirm") {
    const parsed = appFieldMappingConfirmInputSchema.parse({ ...raw, projectRoot, ...identity });
    const connections = await appConnections(projectRoot, options.connections);
    if (!connections.some((connection) => connection.id === parsed.connectionId)) {
      throw new Error(`Connection not found: ${parsed.connectionId}`);
    }
    const snapshot = await snapshotStore.get(parsed.connectionId, options.now);
    const providerFields = snapshot?.objects.find((object) => object.objectType === parsed.objectType)?.fields;
    if (providerFields) {
      const unknown = parsed.mappings.filter((mapping) => !providerFields.some((field) => field.name === mapping.providerField));
      if (unknown.length > 0) {
        throw new Error(`Provider fields are not present in the current schema snapshot: ${unknown.map((mapping) => mapping.providerField).join(", ")}`);
      }
    }
    const mappings = [];
    for (const mapping of parsed.mappings) {
      mappings.push(await mappingStore.saveConfirmed({
        connectionId: parsed.connectionId,
        objectType: parsed.objectType,
        logicalField: mapping.logicalField,
        providerField: mapping.providerField,
        direction: mapping.direction,
        confidence: mapping.confidence,
        confirmedBy: parsed.actor,
        now: options.now
      }));
    }
    return { schemaVersion: "loopgraph-field-mapping-confirmation/v1alpha1", connectionId: parsed.connectionId, objectType: parsed.objectType, mappings };
  }
  const installationStore = appInstallationStore(options, appsRoot, identity.workspaceId);
  const service = new AppInstallationService(
    marketplace,
    projectRoot,
    identity.workspaceId,
    identity.companyId,
    { installationStore, contextStore, mappingStore, loopSpecStore: options.loopSpecStore }
  );
  if (name === "loopgraph_app_onboarding_get") {
    const parsed = appOnboardingGetInputSchema.parse({ ...raw, projectRoot, ...identity });
    const registry = await installationStore.read();
    const installation = parsed.installationId
      ? registry.installations.find((candidate) => candidate.id === parsed.installationId)
      : registry.installations.find((candidate) => candidate.appId === parsed.appId);
    const lifecycleOperation = [...registry.lifecycleOperations].reverse().find((operation) =>
      operation.status !== "completed"
      && (parsed.installationId ? operation.installationId === parsed.installationId : operation.appId === parsed.appId));
    if (parsed.installationId && !installation && !lifecycleOperation) throw new Error(`App installation not found: ${parsed.installationId}`);
    if (installation && installation.appId !== parsed.appId) {
      throw new Error(`Installation ${installation.id} does not belong to ${parsed.appId}`);
    }
    const app = await marketplace.getApp(parsed.appId);
    if (!app) throw new Error(`Marketplace app not found: ${parsed.appId}`);
    const recoveryVersion = lifecycleOperation
      ? app.versions.find((candidate) => candidate.digest === lifecycleOperation.targetArtifactDigest)
      : undefined;
    const version = await marketplace.resolveAppVersion(
      parsed.appId,
      installation?.version ?? recoveryVersion?.version ?? parsed.versionRange
    );
    const loaded = await marketplace.getAppArtifact(parsed.appId, version.version, version.digest);
    const setup = await Promise.all(loaded.manifest.entrypoints.setup.map(async (entry) =>
      appSetupDefinitionSchema.parse(await readPackDocument(loaded.root, entry))
    ));
    if (installation) {
      return deriveAppOnboardingJourney({
        workspaceId: parsed.workspaceId!,
        app,
        selectedVersion: version,
        manifest: loaded.manifest,
        setupQuestions: setup.flatMap((definition) => definition.questions),
        presetId: installation.presetId,
        installation,
        readiness: await service.readiness(installation.id, options.now),
        evaluations: registry.evaluations,
        activationApprovals: registry.activationApprovals,
        lifecycleOperation,
        now: options.now
      });
    }
    const plan = parsed.presetId
      ? await service.plan({
          projectRoot,
          workspaceId: parsed.workspaceId!,
          companyId: parsed.companyId!,
          appId: parsed.appId,
          versionRange: parsed.versionRange,
          presetId: parsed.presetId,
          selectedModules: parsed.selectedModules,
          connections: await appConnections(projectRoot, options.connections),
          installValues: parsed.configuration,
          fieldMappingIds: parsed.fieldMappingIds,
          actor: parsed.actor,
          now: options.now
        })
      : undefined;
    const mappingPlan = parsed.presetId
      ? await buildAppFieldMappingPlan({
          marketplace,
          projectRoot,
          workspaceId: parsed.workspaceId!,
          appId: parsed.appId,
          version: version.version,
          presetId: parsed.presetId,
          mappingStore,
          snapshotStore,
          connections: await appConnections(projectRoot, options.connections),
          now: options.now
        })
      : undefined;
    return deriveAppOnboardingJourney({
      workspaceId: parsed.workspaceId!,
      app,
      selectedVersion: version,
      manifest: loaded.manifest,
      setupQuestions: setup.flatMap((definition) => definition.questions),
      presetId: parsed.presetId,
      plan,
      mappingPlan,
      lifecycleOperation,
      now: options.now
    });
  }
  if (name === "loopgraph_app_install_plan") {
    const parsed = appInstallPlanInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.plan({
      projectRoot,
      workspaceId: parsed.workspaceId!,
      companyId: parsed.companyId!,
      appId: parsed.appId,
      versionRange: parsed.versionRange,
      presetId: parsed.presetId,
      selectedModules: parsed.selectedModules,
      connections: await appConnections(projectRoot, options.connections),
      installValues: parsed.configuration,
      fieldMappingIds: parsed.fieldMappingIds,
      actor: parsed.actor,
      now: options.now
    });
  }
  if (name === "loopgraph_app_install_apply") {
    const parsed = appInstallApplyInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.apply(parsed.plan, parsed.actor, options.now);
  }
  if (name === "loopgraph_app_install_status") {
    const parsed = appInstallStatusInputSchema.parse({ ...raw, projectRoot, ...identity });
    const registry = await installationStore.read();
    const installations = parsed.installationId
      ? registry.installations.filter((installation) => installation.id === parsed.installationId)
      : registry.installations;
    if (parsed.installationId && installations.length === 0) throw new Error(`App installation not found: ${parsed.installationId}`);
    const readiness = await Promise.all(installations.map((installation) => service.readiness(installation.id, options.now)));
    const applications = (await Promise.all(installations.map(async (installation) => ({
      installation,
      app: await marketplace.getApp(installation.appId)
    })))).filter((entry) => Boolean(entry.app));
    const workspace = await appWorkspaceRegistry(projectRoot, options.loopSpecStore);
    const installedLoops = installations.map((installation) => ({
      installationId: installation.id,
      loops: workspace.registeredSpecs.filter((entry) => entry.path.split(/[\\/]/).includes(installation.id)).map((entry) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path
      }))
    }));
    return {
      schemaVersion: "loopgraph-installed-apps/v1alpha1",
      revision: registry.revision,
      installations,
      applications,
      installedLoops,
      readiness,
      evaluations: registry.evaluations,
      lifecycleReceipts: registry.lifecycleReceipts,
      lifecycleOperations: registry.lifecycleOperations,
      lock: await installationStore.readLockfile()
    };
  }
  if (name === "loopgraph_app_operation_resolve") {
    const parsed = appOperationResolveInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.resolveOperation({
      installationId: parsed.installationId,
      loopId: parsed.loopId,
      capability: parsed.capability,
      now: options.now
    });
  }
  if (name === "loopgraph_app_operation_invoke") {
    const parsed = appOperationInvokeInputSchema.parse({ ...raw, projectRoot, ...identity });
    const routingStore = options.routingStore ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
    const outcomeStore = options.outcomeStore ?? new FileOutcomeStore(getLoopgraphRoot(projectRoot));
    const loopSpecStore = options.loopSpecStore ?? new FileLoopSpecRegistryStore(projectRoot);
    const execution = new AppOperationExecutionService({
      appService: service,
      actionStore: options.appOperationActionStore ?? new FileAppOperationActionStore(
        path.join(getLoopgraphRoot(projectRoot), "apps"),
        identity.workspaceId
      ),
      routingStore,
      operationsStore: options.hermesOperationsStore ?? new FileHermesOperationsStore(getLoopgraphRoot(projectRoot)),
      broker: options.connectorBroker,
      runtime: options.appRuntimeOperations ?? new LoopgraphAppRuntimeOperationRegistry({
        projectRoot,
        loopSpecStore,
        routingStore,
        outcomeStore
      }),
      tenant: options.connectorTenant,
      workspaceId: identity.workspaceId,
      companyId: identity.companyId,
      connections: await appConnections(projectRoot, options.connections)
    });
    return execution.invoke({
      installationId: parsed.installationId,
      loopId: parsed.loopId,
      capability: parsed.capability,
      routeJobId: parsed.routeJobId,
      agentInstanceId: parsed.agentInstanceId,
      callId: parsed.callId,
      input: parsed.input,
      now: options.now
    });
  }
  if (name === "loopgraph_app_operation_actions_get") {
    const parsed = appOperationActionsGetInputSchema.parse({ ...raw, projectRoot, ...identity });
    const actionStore = options.appOperationActionStore ?? new FileAppOperationActionStore(
      path.join(getLoopgraphRoot(projectRoot), "apps"),
      identity.workspaceId
    );
    const actions = await actionStore.list({
      workspaceId: identity.workspaceId,
      installationId: parsed.installationId,
      loopId: parsed.loopId,
      routeJobId: parsed.routeJobId,
      status: parsed.status,
      limit: parsed.limit
    });
    const actionIds = new Set(actions.map((action) => action.id));
    const events = (await actionStore.listEvents({
      workspaceId: identity.workspaceId,
      installationId: parsed.installationId,
      limit: Math.min(1_000, parsed.limit * 5)
    })).filter((event) => actionIds.has(event.actionId));
    return {
      schemaVersion: APP_OPERATION_ACTION_LEDGER_SCHEMA_VERSION,
      workspaceId: identity.workspaceId,
      actions,
      events
    };
  }
  if (name === "loopgraph_app_operation_action_commit") {
    const parsed = appOperationActionCommitInputSchema.parse({ ...raw, projectRoot, ...identity });
    const actionStore = options.appOperationActionStore ?? new FileAppOperationActionStore(
      path.join(getLoopgraphRoot(projectRoot), "apps"),
      identity.workspaceId
    );
    const execution = new AppOperationExecutionService({
      appService: service,
      actionStore,
      routingStore: options.routingStore ?? new FileRoutingStore(getLoopgraphRoot(projectRoot)),
      operationsStore: options.hermesOperationsStore ?? new FileHermesOperationsStore(getLoopgraphRoot(projectRoot)),
      broker: options.connectorBroker,
      runtime: options.appRuntimeOperations,
      tenant: options.connectorTenant,
      workspaceId: identity.workspaceId,
      companyId: identity.companyId,
      connections: await appConnections(projectRoot, options.connections)
    });
    return execution.commitAction({
      installationId: parsed.installationId,
      actionId: parsed.actionId,
      routeJobId: parsed.routeJobId,
      agentInstanceId: parsed.agentInstanceId,
      callId: parsed.callId,
      now: options.now
    });
  }
  if (name === "loopgraph_app_maturity_get") {
    const parsed = appMaturityGetInputSchema.parse({ ...raw, projectRoot, ...identity });
    const appsRoot = path.join(projectRoot, ".loopgraph", "apps");
    const registry = await installationStore.read();
    const installation = registry.installations.find((candidate) => candidate.id === parsed.installationId);
    if (!installation) throw new Error(`App installation not found: ${parsed.installationId}`);
    const workspace = await appWorkspaceRegistry(projectRoot, options.loopSpecStore);
    const loopIds = new Set(workspace.registeredSpecs
      .filter((entry) => entry.path.split(/[\\/]/).includes(installation.id))
      .map((entry) => entry.id));
    const outcomeStore = options.outcomeStore ?? new FileOutcomeStore(getLoopgraphRoot(projectRoot));
    const operationsStore = options.hermesOperationsStore ?? new FileHermesOperationsStore(getLoopgraphRoot(projectRoot));
    const [outcomes, valueEntries, completedEvents, verificationRegistry] = await Promise.all([
      outcomeStore.listObservedOutcomes({ workspaceId: parsed.workspaceId!, companyId: parsed.companyId! }),
      outcomeStore.listValueLedgerEntries({ workspaceId: parsed.workspaceId!, companyId: parsed.companyId! }),
      operationsStore.listExecutionEvents({
        workspaceId: parsed.workspaceId!,
        companyId: parsed.companyId!,
        eventType: "run.completed"
      }),
      appVerificationStore(options, appsRoot, parsed.workspaceId!).read()
    ]);
    const relevantOutcomes = outcomes.filter((outcome) => loopIds.has(outcome.loopId) && outcome.truthStatus === "observed");
    const relevantValue = valueEntries.filter((entry) => loopIds.has(entry.loopId) && entry.truthStatus === "observed");
    const completedRunRefs = uniqueStrings(completedEvents
      .filter((event) => loopIds.has(event.loopId))
      .map((event) => `run:${event.runId}`));
    return assessAppOperationalMaturity({
      installation,
      readiness: await service.readiness(installation.id, options.now),
      evaluations: registry.evaluations,
      operatingEvidence: {
        completedRunRefs,
        observedOutcomeRefs: relevantOutcomes.map((outcome) => `outcome:${outcome.id}`),
        observedValueRefs: relevantValue.map((entry) => `value:${entry.id}`)
      },
      verificationReceipts: verificationRegistry.receipts,
      trustedVerifierKeys: verificationRegistry.trustedVerifierKeys,
      now: options.now
    });
  }
  if (name === "loopgraph_app_verification_registry_get") {
    const parsed = appVerificationRegistryGetInputSchema.parse({ ...raw, projectRoot, ...identity });
    return publicVerificationRegistry(await appVerificationStore(
      options,
      path.join(projectRoot, ".loopgraph", "apps"),
      parsed.workspaceId!
    ).read());
  }
  if (name === "loopgraph_app_verifier_trust_add") {
    const parsed = appVerifierTrustAddInputSchema.parse({ ...raw, projectRoot, ...identity });
    const registry = await appVerificationStore(
      options,
      path.join(projectRoot, ".loopgraph", "apps"),
      parsed.workspaceId!
    ).trustVerifierKey(parsed.key);
    return publicVerificationRegistry(registry);
  }
  if (name === "loopgraph_app_verifier_trust_revoke") {
    const parsed = appVerifierTrustRevokeInputSchema.parse({ ...raw, projectRoot, ...identity });
    const registry = await appVerificationStore(
      options,
      path.join(projectRoot, ".loopgraph", "apps"),
      parsed.workspaceId!
    ).revokeVerifierKey({
      verifierId: parsed.verifierId,
      keyId: parsed.keyId,
      revokedBy: parsed.revokedBy,
      revocationRef: parsed.revocationRef,
      revokedAt: parsed.revokedAt ?? (options.now ?? new Date()).toISOString()
    });
    return publicVerificationRegistry(registry);
  }
  if (name === "loopgraph_app_verification_import") {
    const parsed = appVerificationImportInputSchema.parse({ ...raw, projectRoot, ...identity });
    const appsRoot = path.join(projectRoot, ".loopgraph", "apps");
    const installationRegistry = await installationStore.read();
    const installation = installationRegistry.installations.find((candidate) => candidate.id === parsed.receipt.installationId);
    if (!installation) throw new Error(`App installation not found: ${parsed.receipt.installationId}`);
    if (installation.appId !== parsed.receipt.appId || installation.artifactDigest !== parsed.receipt.artifactDigest) {
      throw new Error("Independent verification receipt does not match the exact installed App artifact");
    }
    const registry = await appVerificationStore(options, appsRoot, parsed.workspaceId!).importReceipt(parsed.receipt, {
      importedBy: parsed.importedBy,
      importRef: parsed.importRef,
      importedAt: (options.now ?? new Date()).toISOString()
    });
    return publicVerificationRegistry(registry);
  }
  if (name === "loopgraph_app_historical_replay") {
    const parsed = appHistoricalReplayInputSchema.parse({ ...raw, projectRoot, ...identity });
    const timestamp = (options.now ?? new Date()).toISOString();
    return service.historicalReplay(appHistoricalReplayRequestSchema.parse({
      schemaVersion: APP_EVAL_SCHEMA_VERSION,
      installationId: parsed.installationId,
      from: parsed.from,
      to: parsed.to,
      maxEvents: parsed.maxEvents,
      events: parsed.events,
      requestedAt: timestamp,
      requestedBy: parsed.actor
    }), options.now);
  }
  if (name === "loopgraph_app_evaluation_label") {
    const parsed = appEvaluationLabelInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.labelEvaluation({
      schemaVersion: APP_EVAL_SCHEMA_VERSION,
      runId: parsed.runId,
      scenarioId: parsed.scenarioId,
      label: parsed.label,
      reviewMinutes: parsed.reviewMinutes,
      notes: parsed.notes,
      reviewedBy: parsed.actor,
      reviewedAt: (options.now ?? new Date()).toISOString()
    });
  }
  if (name === "loopgraph_app_promotion_recommendation") {
    const parsed = appPromotionRecommendationInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.promotionRecommendation(parsed.installationId, options.now);
  }
  if (name === "loopgraph_app_configure") {
    const parsed = appConfigureInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.configure({
      installationId: parsed.installationId,
      values: parsed.values,
      expectedConfigurationDigest: parsed.expectedConfigurationDigest,
      actor: parsed.actor,
      now: options.now
    });
  }
  if (name === "loopgraph_app_overlay_apply") {
    const parsed = appOverlayApplyInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.applyOverlay({
      installationId: parsed.installationId,
      operations: parsed.operations,
      expectedArtifactDigest: parsed.expectedArtifactDigest,
      expectedOverlayRevision: parsed.expectedOverlayRevision,
      actor: parsed.actor,
      now: options.now
    });
  }
  if (name === "loopgraph_app_repair") {
    const parsed = appRepairInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.repair(parsed.installationId, parsed.actor, options.now);
  }
  if (name === "loopgraph_app_duplicate") {
    const parsed = appDuplicateInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.duplicate({
      installationId: parsed.installationId,
      derivedAppId: parsed.derivedAppId,
      overlayOperations: parsed.overlayOperations,
      actor: parsed.actor,
      now: options.now
    });
  }
  if (name === "loopgraph_app_diff") {
    const parsed = appDiffInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.diff(parsed.installationId);
  }
  if (name === "loopgraph_app_update_plan") {
    const parsed = appUpdatePlanInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.planUpdate({
      installationId: parsed.installationId,
      versionRange: parsed.versionRange,
      connections: await appConnections(projectRoot, options.connections),
      actor: parsed.actor,
      now: options.now
    });
  }
  if (name === "loopgraph_app_update_apply") {
    const parsed = appUpdateApplyInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.applyUpdate({
      plan: parsed.plan,
      approvedPermissionCapabilities: parsed.approvedPermissionCapabilities,
      actor: parsed.actor,
      now: options.now
    });
  }
  if (name === "loopgraph_app_rollback") {
    const parsed = appRollbackInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.rollback(parsed.installationId, parsed.expectedArtifactDigest, parsed.actor, options.now);
  }
  if (name === "loopgraph_app_detach") {
    const parsed = appDetachInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.detach(parsed.installationId, parsed.expectedArtifactDigest, parsed.actor, options.now);
  }
  if (name === "loopgraph_app_uninstall") {
    const parsed = appUninstallInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.uninstall({
      installationId: parsed.installationId,
      expectedArtifactDigest: parsed.expectedArtifactDigest,
      actor: parsed.actor,
      reason: parsed.reason,
      confirmed: parsed.confirmed,
      now: options.now
    });
  }
  if (name === "loopgraph_app_activation_approve") {
    const approval = appActivationApproveInputSchema.parse({ ...raw, projectRoot, ...identity });
    const receipt = await service.approveActivation({
      installationId: approval.installationId,
      mode: approval.mode,
      approvedBy: approval.approvedBy,
      reason: approval.reason,
      evidenceRefs: approval.evidenceRefs,
      expiresInSeconds: approval.expiresInSeconds,
      now: options.now
    });
    return {
      receipt,
      nextAction: {
        toolName: "loopgraph_app_activate",
        input: {
          installationId: approval.installationId,
          mode: approval.mode,
          approvalReceiptId: receipt.id
        }
      }
    };
  }
  if (name === "loopgraph_app_activate") {
    const activation = appActivateInputSchema.parse({ ...raw, projectRoot, ...identity });
    return service.activate(
      activation.installationId,
      activation.mode as "shadow" | "recommend" | "execute_with_approval",
      activation.approvalReceiptId,
      activation.actor,
      options.now
    );
  }
  const parsed = appInstallationActionInputSchema.parse({ ...raw, projectRoot, ...identity });
  if (name === "loopgraph_app_test") return service.test(parsed.installationId, parsed.actor, options.now);
  if (name === "loopgraph_app_pause") return service.pause(parsed.installationId, parsed.actor);
  return service.resume(parsed.installationId, parsed.actor);
}

async function readOptionalBoundedText(filePath: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(MAX_MARKETPLACE_CHANGELOG_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    const text = buffer.subarray(0, Math.min(bytesRead, MAX_MARKETPLACE_CHANGELOG_BYTES)).toString("utf8");
    return bytesRead > MAX_MARKETPLACE_CHANGELOG_BYTES
      ? `${text}\n\n[Changelog truncated to 64 KiB for safe Marketplace display.]`
      : text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}

function remoteHostedArtifactRequest(
  name: LoopgraphAppToolName,
  input: Record<string, unknown>
): {
  appId: string;
  version?: string;
  versionRange?: string;
  artifactDigest?: string;
} | undefined {
  if (!REMOTE_HOSTED_ARTIFACT_TOOLS.has(name)) return undefined;
  const plan = isRecord(input.plan) ? input.plan : {};
  const appId = stringValue(input.appId) ?? stringValue(plan.appId);
  if (!appId) return undefined;
  const requestedVersion = stringValue(input.version);
  const versionRange = stringValue(input.versionRange);
  const exactVersion = requestedVersion ??
    (versionRange && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(versionRange)
      ? versionRange
      : undefined) ??
    stringValue(plan.version);
  return {
    appId,
    version: exactVersion,
    ...(!exactVersion && versionRange ? { versionRange } : {}),
    artifactDigest: stringValue(plan.artifactDigest)
  };
}

function remoteHostedReadMayUseDeprecated(name: LoopgraphAppToolName) {
  return name === "loopgraph_app_get" || name === "loopgraph_app_onboarding_get" || name === "loopgraph_app_field_mappings_get";
}

function withoutCachedHostedVersions(entry: {
  app: MarketplaceApp;
  score: number;
  matchedTerms: string[];
}) {
  const versions = entry.app.versions.filter((version) =>
    version.source.sourceType !== "hosted"
  );
  if (versions.length === 0) return [];
  const sorted = versions.sort((left, right) =>
    compareSemanticVersions(right.version, left.version) ||
    left.source.sourceId.localeCompare(right.source.sourceId)
  );
  return [{
    ...entry,
    app: marketplaceAppSchema.parse({
      ...entry.app,
      latestVersion: sorted[0]!.version,
      versions: sorted,
      readmeUri: `${sorted[0]!.artifactUri}/README.md`
    })
  }];
}

function mergeMarketplaceSearchResults(
  entries: Array<{ app: MarketplaceApp; score: number; matchedTerms: string[] }>
) {
  const byId = new Map<string, { app: MarketplaceApp; score: number; matchedTerms: string[] }>();
  for (const entry of entries) {
    const current = byId.get(entry.app.id);
    if (!current) {
      byId.set(entry.app.id, entry);
      continue;
    }
    if (current.app.publisher.id !== entry.app.publisher.id) {
      throw new Error(`Marketplace publisher conflict for ${entry.app.id}`);
    }
    const versions = new Map<string, MarketplaceApp["versions"][number]>();
    const digestByVersion = new Map<string, string>();
    for (const version of [...current.app.versions, ...entry.app.versions]) {
      const existingDigest = digestByVersion.get(version.version);
      if (existingDigest && existingDigest !== version.digest) {
        throw new Error(
          `Immutable marketplace version conflict for ${entry.app.id}@${version.version}`
        );
      }
      digestByVersion.set(version.version, version.digest);
      versions.set(
        `${version.version}#${version.digest}#${version.source.sourceId}`,
        version
      );
    }
    const mergedVersions = [...versions.values()].sort((left, right) =>
      compareSemanticVersions(right.version, left.version) ||
      left.source.sourceId.localeCompare(right.source.sourceId)
    );
    const latestVersion = mergedVersions[0]!.version;
    const metadata = entry.app.latestVersion === latestVersion ? entry.app : current.app;
    byId.set(entry.app.id, {
      app: marketplaceAppSchema.parse({
        ...metadata,
        latestVersion,
        versions: mergedVersions
      }),
      score: Math.max(current.score, entry.score),
      matchedTerms: [...new Set([...current.matchedTerms, ...entry.matchedTerms])]
    });
  }
  return [...byId.values()].sort((left, right) =>
    right.score - left.score || left.app.name.localeCompare(right.app.name)
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compareSemanticVersions(left: string, right: string) {
  const leftParts = left.split(/[.+-]/).slice(0, 3).map(Number);
  const rightParts = right.split(/[.+-]/).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

async function resolveIdentity(projectRoot: string, workspaceInput: unknown, companyInput: unknown): Promise<{ workspaceId: string; companyId: string }> {
  const workspace = await inspectLoopgraphWorkspace({ projectRoot, createIfMissing: true });
  const persistedWorkspaceId = await FileAppInstallationStore.discoverWorkspaceId(path.join(projectRoot, ".loopgraph", "apps"));
  const workspaceId = typeof workspaceInput === "string" && workspaceInput
    ? workspaceInput
    : persistedWorkspaceId ?? workspace.registry.projectRootId;
  const companyId = typeof companyInput === "string" && companyInput ? companyInput : workspaceId;
  return { workspaceId, companyId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trustedGitHostsFromEnvironment(): string[] | undefined {
  const value = process.env.LOOPGRAPH_TRUSTED_GIT_HOSTS;
  if (!value) return undefined;
  const hosts = Array.from(new Set(value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)));
  for (const host of hosts) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host)) {
      throw new Error(`Invalid LOOPGRAPH_TRUSTED_GIT_HOSTS entry: ${host}`);
    }
  }
  return hosts.length > 0 ? hosts : undefined;
}

async function readPackDocument(root: string, relativePath: string): Promise<unknown> {
  const text = await readFile(path.join(root, relativePath), "utf8");
  return relativePath.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
}

async function buildAppFieldMappingPlan(input: {
  marketplace: LocalAppMarketplace;
  projectRoot: string;
  workspaceId: string;
  appId: string;
  version?: string;
  presetId: string;
  mappingStore: ConnectorFieldMappingStore;
  snapshotStore: ProviderSchemaSnapshotStore;
  connections: ConnectionInstance[];
  now?: Date;
}): Promise<AppFieldMappingPlan> {
  const version = input.version
    ? await input.marketplace.resolveAppVersion(input.appId, input.version)
    : await input.marketplace.resolveAppVersion(input.appId, "latest");
  const loaded = await input.marketplace.getAppArtifact(input.appId, version.version, version.digest);
  const preset = loaded.manifest.presets.find((candidate) => candidate.id === input.presetId);
  if (!preset) throw new Error(`Preset ${input.presetId} does not exist in ${input.appId}@${version.version}`);
  const presetDocument = await readPackDocument(loaded.root, preset.path);
  const selectedRecipeId = isRecord(presetDocument) && typeof presetDocument.recipe === "string"
    ? presetDocument.recipe
    : preset.id;
  const recipes = await loadConnectorRecipes(loaded);
  const recipe = recipes.find((candidate) => candidate.id === selectedRecipeId);
  if (!recipe) throw new Error(`Connector recipe not found: ${selectedRecipeId}`);
  const capabilityResolutions = resolveConnectorCapabilities({
    requiredCapabilities: loaded.manifest.requiredCapabilities,
    optionalCapabilities: loaded.manifest.optionalCapabilities,
    recipes,
    connections: input.connections,
    selectedRecipeId
  });
  const confirmedMappings = await input.mappingStore.list();
  const requirements = [];
  for (const requirement of recipe.fieldMappings) {
    const providerId = normalizeConnectorProviderId(requirement.providerId ?? recipe.providerId);
    const providerCapabilities = new Set(recipe.capabilities
      .filter((binding) => providerIdForCapability(recipe, binding) === providerId)
      .map((binding) => binding.logicalCapability));
    const connectionId = capabilityResolutions.find((resolution) =>
      Boolean(resolution.connectionId) && providerCapabilities.has(resolution.capability)
    )?.connectionId;
    const existingMappings = connectionId
      ? confirmedMappings.filter((mapping) => mapping.connectionId === connectionId && mapping.objectType === requirement.objectType)
      : [];
    const coverage = connectionId
      ? validateFieldMappingCoverage({
        requiredLogicalFields: requirement.requiredLogicalFields,
        mappings: existingMappings,
        connectionId,
        objectType: requirement.objectType
      })
      : { complete: false, missing: [...requirement.requiredLogicalFields], unverified: [] as string[] };
    const snapshot = connectionId ? await input.snapshotStore.get(connectionId, input.now) : undefined;
    const snapshotFields = snapshot?.objects.find((object) => object.objectType === requirement.objectType)?.fields;
    const providerFields = connectionId
      ? snapshotFields ?? connectorMetadataFields(providerId, [...requirement.requiredLogicalFields, ...requirement.optionalLogicalFields])
      : [];
    const suggestions = connectionId
      ? suggestFieldMappings({
        requiredLogicalFields: requirement.requiredLogicalFields,
        optionalLogicalFields: requirement.optionalLogicalFields,
        providerFields
      }).map((suggestion) => snapshotFields ? suggestion : {
        ...suggestion,
        requiresConfirmation: true,
        reason: `${suggestion.reason} This is a connector-metadata estimate and must be confirmed against the company schema.`
      })
      : [];
    requirements.push({
      recipeId: recipe.id,
      providerId,
      connectorOnboarding: PROVIDER_ONBOARDING_CATALOG.some((provider) => provider.providerId === providerId) ? "available" : "custom_required",
      connectionId,
      objectType: requirement.objectType,
      requiredLogicalFields: requirement.requiredLogicalFields,
      optionalLogicalFields: requirement.optionalLogicalFields,
      schemaStatus: !connectionId ? "connection_required" : snapshotFields ? "connected_snapshot" : "connector_metadata",
      snapshotInspectedAt: snapshotFields ? snapshot?.inspectedAt : undefined,
      providerFields,
      existingMappings,
      suggestions,
      missingRequiredFields: coverage.missing,
      unverifiedRequiredFields: coverage.unverified
    });
  }
  return appFieldMappingPlanSchema.parse({
    schemaVersion: "loopgraph-field-mapping-plan/v1alpha1",
    workspaceId: input.workspaceId,
    appId: input.appId,
    version: version.version,
    presetId: input.presetId,
    complete: requirements.every((requirement) => Boolean(requirement.connectionId) && requirement.missingRequiredFields.length === 0 && requirement.unverifiedRequiredFields.length === 0),
    requirements
  });
}

async function appConnections(projectRoot: string, trustedConnections: ConnectionInstance[] | undefined): Promise<ConnectionInstance[]> {
  const local = await readConnectionInstances(projectRoot);
  if (!trustedConnections || trustedConnections.length === 0) return local;
  const byId = new Map(local.map((connection) => [connection.id, connection]));
  for (const connection of trustedConnections) byId.set(connection.id, connection);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function connectorMetadataFields(providerId: string, logicalFields: string[]) {
  return Array.from(new Set(logicalFields)).map((logicalField) => ({
    name: providerFieldHint(providerId, logicalField),
    label: logicalField.split(".").at(-1)?.replace(/([a-z])([A-Z])/g, "$1 $2"),
    type: "string" as const,
    writable: false,
    sampleValues: []
  }));
}

function providerFieldHint(providerId: string, logicalField: string): string {
  const field = logicalField.split(".").at(-1) ?? logicalField;
  const normalizedProvider = providerId.toLowerCase();
  const common: Record<string, Record<string, string>> = {
    hubspot: {
      id: "hs_object_id",
      lifecycleStage: "lifecyclestage",
      employeeCount: "numberofemployees",
      revenue: "annualrevenue",
      customerStatus: "lifecyclestage",
      domain: "domain"
    },
    salesforce: {
      id: "Id",
      email: "Email",
      company: "Company",
      lifecycleStage: "Status",
      employeeCount: "NumberOfEmployees",
      revenue: "AnnualRevenue",
      customerStatus: "Type",
      domain: "Website"
    }
  };
  return common[normalizedProvider]?.[field] ?? field;
}

function providerMatchesConnection(providerId: string, manifestId: string): boolean {
  const expected = normalizeConnectorProviderId(providerId);
  const actual = normalizeConnectorProviderId(manifestId);
  return actual === expected || actual.startsWith(`${expected}.`) || actual.startsWith(`${expected}-`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function publicVerificationRegistry(registry: AppVerificationRegistry) {
  return {
    schemaVersion: registry.schemaVersion,
    workspaceId: registry.workspaceId,
    revision: registry.revision,
    trustedVerifierKeys: registry.trustedVerifierKeys,
    receipts: registry.receipts,
    updatedAt: registry.updatedAt,
    privateKeyMaterialAccepted: false
  };
}

function appVerificationStore(
  options: { appVerificationStoreFactory?: (workspaceId: string) => AppVerificationStore },
  appsRoot: string,
  workspaceId: string
): AppVerificationStore {
  return options.appVerificationStoreFactory?.(workspaceId) ?? new FileAppVerificationStore(appsRoot, workspaceId);
}

function appInstallationStore(
  options: { appInstallationStoreFactory?: (workspaceId: string) => AppInstallationStore },
  appsRoot: string,
  workspaceId: string
): AppInstallationStore {
  return options.appInstallationStoreFactory?.(workspaceId) ?? new FileAppInstallationStore(appsRoot, workspaceId);
}

function connectorFieldMappingStore(
  options: { connectorFieldMappingStoreFactory?: (workspaceId: string) => ConnectorFieldMappingStore },
  appsRoot: string,
  workspaceId: string
): ConnectorFieldMappingStore {
  return options.connectorFieldMappingStoreFactory?.(workspaceId) ??
    new FileConnectorFieldMappingStore(path.join(appsRoot, "field-mappings.json"), workspaceId);
}

function companyContextStore(
  options: { companyContextStoreFactory?: (workspaceId: string, companyId: string) => CompanyContextStore },
  appsRoot: string,
  workspaceId: string,
  companyId: string
): CompanyContextStore {
  return options.companyContextStoreFactory?.(workspaceId, companyId) ??
    new FileCompanyContextStore(path.join(appsRoot, "company-context.json"));
}

function providerSchemaSnapshotStore(
  options: { providerSchemaSnapshotStoreFactory?: (workspaceId: string) => ProviderSchemaSnapshotStore },
  appsRoot: string,
  workspaceId: string
): ProviderSchemaSnapshotStore {
  return options.providerSchemaSnapshotStoreFactory?.(workspaceId) ??
    new FileProviderSchemaSnapshotStore(path.join(appsRoot, "provider-schemas.json"), workspaceId);
}

async function appWorkspaceRegistry(projectRoot: string, store?: LoopSpecRegistryStore) {
  if (store) return (await store.getWorkspace(projectRoot)).workspace;
  return (await inspectLoopgraphWorkspace({ projectRoot, createIfMissing: true })).registry;
}
