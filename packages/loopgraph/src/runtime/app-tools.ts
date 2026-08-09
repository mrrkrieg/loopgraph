import path from "node:path";
import { z } from "zod";
import { appInstallPlanSchema, appRolloutModeSchema } from "../core";
import { AppInstallationService } from "./app-installation-service";
import { FileAppInstallationStore } from "./app-installation-store";
import { LocalAppMarketplace } from "./app-marketplace";
import { readConnectionInstances } from "./connector-registry";
import { inspectLoopgraphWorkspace } from "./workspace";

export const LOOPGRAPH_APP_TOOL_NAMES = [
  "loopgraph_marketplace_search",
  "loopgraph_app_get",
  "loopgraph_app_install_plan",
  "loopgraph_app_install_apply",
  "loopgraph_app_install_status",
  "loopgraph_app_test",
  "loopgraph_app_activate",
  "loopgraph_app_pause",
  "loopgraph_app_resume"
] as const;

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
  fieldMappingIds: z.array(z.string().min(1)).default([]),
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
export const appPauseInputSchema = appInstallationActionInputSchema;
export const appResumeInputSchema = appInstallationActionInputSchema;
export const appActivateInputSchema = appInstallationActionInputSchema.extend({
  mode: appRolloutModeSchema.refine((mode) => mode === "shadow" || mode === "recommend" || mode === "execute_with_approval", {
    message: "MCP activation supports shadow, recommend, or execute_with_approval; live requires a separate promotion receipt"
  })
}).strict();

export const loopgraphAppToolDefinitions = [
  { name: "loopgraph_marketplace_search", description: "Search available Loopgraph Apps by business outcome, department, capability, or maturity.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_get", description: "Inspect one app, immutable versions, modules, presets, permissions, capabilities, provenance, and graph intent.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_plan", description: "Create a read-only content-bound installation plan using current connections, mappings, company context, and supplied answers.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_apply", description: "Atomically apply an unexpired exact installation plan without enabling provider writes.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_install_status", description: "Read installed app state, configuration provenance, bindings, permissions, owned assets, evaluations, lockfile, and readiness.", readOnly: true, idempotent: true, destructive: false },
  { name: "loopgraph_app_test", description: "Run the installed app synthetic conformance suite with all provider writes blocked.", readOnly: false, idempotent: false, destructive: false },
  { name: "loopgraph_app_activate", description: "Promote a tested app to shadow, recommend, or execute-with-approval; live remains separately governed.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_pause", description: "Pause an installed app without deleting shared connectors, mappings, context, entities, or evidence.", readOnly: false, idempotent: true, destructive: false },
  { name: "loopgraph_app_resume", description: "Resume a paused app at its last safe non-live rollout mode.", readOnly: false, idempotent: true, destructive: false }
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
  await marketplace.refreshAllCatalogSources();

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
    return { schemaVersion: "loopgraph-app-detail/v1alpha1", app, selectedVersion: version, manifest: loaded.manifest, provenance };
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
    return { schemaVersion: "loopgraph-installed-apps/v1alpha1", revision: registry.revision, installations, readiness, evaluations: registry.evaluations, lock: await store.readLockfile() };
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
  const workspaceId = typeof workspaceInput === "string" && workspaceInput ? workspaceInput : workspace.registry.projectRootId;
  const companyId = typeof companyInput === "string" && companyInput ? companyInput : workspaceId;
  return { workspaceId, companyId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
