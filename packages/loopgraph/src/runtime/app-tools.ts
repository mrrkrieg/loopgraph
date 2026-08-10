import { readFile } from "node:fs/promises";
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
  appRolloutModeSchema,
  appUpdatePlanSchema,
  artifactDigestSchema,
  appSetupDefinitionSchema,
  marketplaceCatalogSourceSchema
} from "../core";
import { AppInstallationService } from "./app-installation-service";
import { FileAppInstallationStore } from "./app-installation-store";
import { LocalAppMarketplace } from "./app-marketplace";
import { compileLoopPack } from "./app-pack-compiler";
import { LoopgraphAppPublisher } from "./app-publisher";
import { readConnectionInstances } from "./connector-registry";
import { inspectLoopgraphWorkspace } from "./workspace";

export const LOOPGRAPH_APP_TOOL_NAMES = [
  "loopgraph_marketplace_search",
  "loopgraph_app_get",
  "loopgraph_app_install_plan",
  "loopgraph_app_install_apply",
  "loopgraph_app_install_status",
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
  "loopgraph_app_activate",
  "loopgraph_app_pause",
  "loopgraph_app_resume",
  "loopgraph_app_publisher_key_generate",
  "loopgraph_app_publisher_keys_get",
  "loopgraph_app_init",
  "loopgraph_app_capture",
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
export const appActivateInputSchema = appInstallationActionInputSchema.extend({
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
  { name: "loopgraph_marketplace_search", description: "Search available Loopgraph Apps by business outcome, department, capability, or maturity.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_get", description: "Inspect one app, immutable versions, modules, presets, permissions, capabilities, provenance, and graph intent.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_plan", description: "Create a read-only content-bound installation plan using current connections, mappings, company context, and supplied answers.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_apply", description: "Atomically apply an unexpired exact installation plan without enabling provider writes.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_status", description: "Read installed app state, configuration provenance, bindings, permissions, owned assets, evaluations, lockfile, and readiness.", readOnly: true, idempotent: true, destructive: false },
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
  { name: "loopgraph_app_activate", description: "Promote a tested app to shadow, recommend, or execute-with-approval; live remains separately governed.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_pause", description: "Pause an installed app without deleting shared connectors, mappings, context, entities, or evidence.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_resume", description: "Resume a paused app at its last safe non-live rollout mode.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_publisher_key_generate", description: "Generate a project-confined Ed25519 publisher key; return only the public trust material and keep the private key mode-0600.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_publisher_keys_get", description: "List public publisher trust material and private-key availability without returning private keys.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_init", description: "Scaffold a complete private Loopgraph App with routing, setup, connector, policy, outcome, and 13-case conformance contracts.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_capture", description: "Capture an installed app as a private parameterized pack without copying credential or configuration values.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_validate", description: "Validate, compile, secret-scan, and run deterministic write-blocked conformance for a LoopPack.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_pack", description: "Create a content-addressed verified LoopPack archive after publisher validation passes.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_sign", description: "Create and verify a detached Ed25519 signature over the exact immutable pack digest.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_publish", description: "Publish a signed immutable version into a trusted project-local private catalog and refresh marketplace metadata.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_release_status", description: "Deprecate or revoke an exact published app version and propagate that status into marketplace resolution.", readOnly: false, idempotent: true, destructive: true },
  { name: "loopgraph_marketplace_sources_get", description: "List configured official, local, and private signed marketplace sources and their trust policy.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_marketplace_source_add", description: "Register an explicit catalog source; signed sources must pin exact publisher public keys.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_marketplace_source_refresh", description: "Revalidate and refresh one configured catalog source into the local marketplace index.", readOnly: false, idempotent: true, destructive: false }
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
  options: { projectRoot?: string; now?: Date } = {}
): Promise<unknown> {
  const raw = isRecord(input) ? input : {};
  const projectRoot = path.resolve(typeof raw.projectRoot === "string" ? raw.projectRoot : options.projectRoot ?? process.cwd());
  const marketplace = new LocalAppMarketplace(path.join(projectRoot, ".loopgraph", "apps", "marketplace"));
  if (!APP_PUBLISHER_TOOL_NAMES.has(name)) await marketplace.refreshAllCatalogSources();

  if (name === "loopgraph_marketplace_search") {
    const parsed = marketplaceSearchInputSchema.parse({ ...raw, projectRoot });
    const results = await marketplace.searchApps(parsed);
    return { schemaVersion: "loopgraph-marketplace-search/v1alpha1", query: parsed.query, count: results.length, results };
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
    return {
      schemaVersion: "loopgraph-app-detail/v1alpha1",
      app,
      selectedVersion: version,
      manifest: loaded.manifest,
      provenance,
      graphPreview: compiled.graph,
      loops: compiled.loopSpecs.map((spec) => ({
        id: spec.metadata.id,
        name: spec.metadata.name,
        description: spec.metadata.description,
        owner: spec.metadata.owner?.role,
        trigger: `${spec.trigger.source}:${spec.trigger.event}`,
        outcomes: Array.isArray(spec.studioExtension?.outcomes) ? spec.studioExtension.outcomes : []
      })),
      skills: compiled.skills,
      setupQuestions: setup.flatMap((definition) => definition.questions),
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
  const service = new AppInstallationService(marketplace, projectRoot, identity.workspaceId, identity.companyId);
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
      connections: await readConnectionInstances(projectRoot),
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
    const store = new FileAppInstallationStore(path.join(projectRoot, ".loopgraph", "apps"), parsed.workspaceId!);
    const registry = await store.read();
    const installations = parsed.installationId
      ? registry.installations.filter((installation) => installation.id === parsed.installationId)
      : registry.installations;
    if (parsed.installationId && installations.length === 0) throw new Error(`App installation not found: ${parsed.installationId}`);
    const readiness = await Promise.all(installations.map((installation) => service.readiness(installation.id, options.now)));
    const applications = (await Promise.all(installations.map(async (installation) => ({
      installation,
      app: await marketplace.getApp(installation.appId)
    })))).filter((entry) => Boolean(entry.app));
    const workspace = await inspectLoopgraphWorkspace({ projectRoot, createIfMissing: true });
    const installedLoops = installations.map((installation) => ({
      installationId: installation.id,
      loops: workspace.registry.registeredSpecs.filter((entry) => entry.path.split(/[\\/]/).includes(installation.id)).map((entry) => ({
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
      lock: await store.readLockfile()
    };
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
      connections: await readConnectionInstances(projectRoot),
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
  const parsed = appInstallationActionInputSchema.parse({ ...raw, projectRoot, ...identity });
  if (name === "loopgraph_app_test") return service.test(parsed.installationId, parsed.actor, options.now);
  if (name === "loopgraph_app_pause") return service.pause(parsed.installationId, parsed.actor);
  if (name === "loopgraph_app_resume") return service.resume(parsed.installationId, parsed.actor);
  const activation = appActivateInputSchema.parse({ ...raw, projectRoot, ...identity });
  return service.activate(activation.installationId, activation.mode as "shadow" | "recommend" | "execute_with_approval", activation.actor);
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

async function readPackDocument(root: string, relativePath: string): Promise<unknown> {
  const text = await readFile(path.join(root, relativePath), "utf8");
  return relativePath.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
}
