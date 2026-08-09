import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  APP_EVAL_SCHEMA_VERSION,
  APP_INSTALL_SCHEMA_VERSION,
  appEvalRunSchema,
  appInstallPlanSchema,
  appInstallationLockSchema,
  appReadinessSchema,
  canonicalAppDigest,
  contentHash,
  type AppConfigField,
  type AppEvalRun,
  type AppInstallPlan,
  type AppInstallationLock,
  type AppReadiness,
  type AppRolloutMode,
  type ConnectionInstance,
  type WorkspaceAppInstallation
} from "../core";
import { appSetupDefinitionSchema, appEvalSuiteSchema } from "../core/app-pack-content";
import { compileLoopPack } from "./app-pack-compiler";
import {
  loadConnectorRecipes,
  resolveConnectorCapabilities,
  validateFieldMappingCoverage,
  type CapabilityResolution,
  FileConnectorFieldMappingStore
} from "./app-connector-service";
import { LocalAppMarketplace } from "./app-marketplace";
import { FileCompanyContextStore, resolveAppConfiguration } from "./company-context-service";
import {
  FileLoopSpecRegistryStore,
  createStoredLoopSpecArtifact
} from "./loop-spec-store";
import {
  initLoopgraphWorkspace,
  readLoopgraphWorkspace,
  writeLoopgraphWorkspace,
  type LoopgraphWorkspaceRegistry
} from "./workspace";
import { FileAppInstallationStore, type AppInstallationRegistry } from "./app-installation-store";

export type PlanAppInstallationInput = {
  projectRoot: string;
  workspaceId: string;
  companyId: string;
  appId: string;
  versionRange?: string;
  presetId: string;
  selectedModules?: string[];
  connections: ConnectionInstance[];
  installValues?: Record<string, unknown>;
  fieldMappingIds?: string[];
  actor: string;
  now?: Date;
};

export type ApplyAppInstallationResult = {
  installation: WorkspaceAppInstallation;
  lock: AppInstallationLock;
  loopIds: string[];
  created: boolean;
};

export class AppInstallationService {
  private readonly installationStore: FileAppInstallationStore;
  private readonly contextStore: FileCompanyContextStore;
  private readonly mappingStore: FileConnectorFieldMappingStore;
  private readonly loopSpecStore: FileLoopSpecRegistryStore;

  constructor(
    private readonly marketplace: LocalAppMarketplace,
    private readonly projectRoot: string,
    private readonly workspaceId: string,
    private readonly companyId: string,
    dependencies: {
      installationStore?: FileAppInstallationStore;
      contextStore?: FileCompanyContextStore;
      mappingStore?: FileConnectorFieldMappingStore;
      loopSpecStore?: FileLoopSpecRegistryStore;
    } = {}
  ) {
    const appsRoot = path.join(path.resolve(projectRoot), ".loopgraph", "apps");
    this.installationStore = dependencies.installationStore ?? new FileAppInstallationStore(appsRoot, workspaceId);
    this.contextStore = dependencies.contextStore ?? new FileCompanyContextStore(path.join(appsRoot, "company-context.json"));
    this.mappingStore = dependencies.mappingStore ?? new FileConnectorFieldMappingStore(path.join(appsRoot, "field-mappings.json"), workspaceId);
    this.loopSpecStore = dependencies.loopSpecStore ?? new FileLoopSpecRegistryStore(projectRoot);
  }

  async plan(input: PlanAppInstallationInput): Promise<AppInstallPlan> {
    this.assertTenant(input);
    const now = input.now ?? new Date();
    const version = await this.marketplace.resolveAppVersion(input.appId, input.versionRange ?? "latest");
    const loaded = await this.marketplace.getAppArtifact(input.appId, version.version, version.digest);
    const compiled = await compileLoopPack(loaded);
    const preset = loaded.manifest.presets.find((candidate) => candidate.id === input.presetId);
    if (!preset) throw new Error(`Preset ${input.presetId} does not exist in ${input.appId}@${version.version}`);
    const selectedModules = resolveSelectedModules(loaded.manifest.modules, input.selectedModules);
    const recipes = await loadConnectorRecipes(loaded);
    const presetDocument = await readPackYaml(loaded.root, preset.path);
    const selectedRecipeId = isRecord(presetDocument) && typeof presetDocument.recipe === "string"
      ? presetDocument.recipe
      : preset.id;
    const capabilityResolutions = resolveConnectorCapabilities({
      requiredCapabilities: loaded.manifest.requiredCapabilities,
      optionalCapabilities: loaded.manifest.optionalCapabilities,
      recipes,
      connections: input.connections,
      selectedRecipeId
    });
    const fields = await loadSetupFields(loaded.root, loaded.manifest.entrypoints.setup);
    const context = await this.contextStore.get(input.workspaceId, input.companyId);
    const presetValues = isRecord(presetDocument) && isRecord(presetDocument.defaults) ? presetDocument.defaults : {};
    const configurationResolution = resolveAppConfiguration({
      appId: input.appId,
      version: version.version,
      fields,
      presetValues,
      companyContext: context,
      installValues: input.installValues,
      now
    });

    const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId);
    const mappings = await this.mappingStore.list();
    const selectedMappingIds = new Set(input.fieldMappingIds ?? mappings.flatMap((mapping) =>
      mapping.dependentInstallationIds.length === 0 ? [mapping.id] : []));
    const selectedMappings = mappings.filter((mapping) => selectedMappingIds.has(mapping.id));
    const mappingGaps: string[] = [];
    if (selectedRecipe) {
      for (const fieldRequirement of selectedRecipe.fieldMappings) {
        const connectionId = findConnectionForRecipe(capabilityResolutions, selectedRecipe.id);
        if (!connectionId) continue;
        const coverage = validateFieldMappingCoverage({
          requiredLogicalFields: fieldRequirement.requiredLogicalFields,
          mappings: selectedMappings,
          connectionId,
          objectType: fieldRequirement.objectType
        });
        mappingGaps.push(...coverage.missing.map((field) => `mapping:${fieldRequirement.objectType}:${field}`));
        mappingGaps.push(...coverage.unverified.map((field) => `mapping_confirmation:${fieldRequirement.objectType}:${field}`));
      }
    }

    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
    const installationId = installationIdFor(input.workspaceId, input.appId);
    const assets = compilePlannedAssets(compiled, installationId);
    const permissions = loaded.manifest.permissions.map((permission) => ({
      capability: permission.capability,
      authority: permission.authority,
      decision: permission.defaultPolicy === "allowed"
        ? "allow" as const
        : permission.defaultPolicy === "approval_required"
          ? "approval_required" as const
          : "forbid" as const,
      reason: permission.purpose,
      changedFromInstalled: false
    }));
    const planWithoutDigest = {
      schemaVersion: APP_INSTALL_SCHEMA_VERSION,
      id: `plan.${contentHash({ workspaceId: input.workspaceId, appId: input.appId, version: version.version, createdAt })}`,
      workspaceId: input.workspaceId,
      appId: input.appId,
      version: version.version,
      artifactDigest: version.digest,
      selectedModules,
      presetId: input.presetId,
      dependencyResolutions: loaded.manifest.dependencies.map((dependency) => ({
        appId: dependency.appId,
        version: "0.0.0",
        digest: canonicalAppDigest(`unresolved:${dependency.appId}`),
        reused: false
      })),
      capabilityResolutions: capabilityResolutions.map(({ capability, required, connectionId, recipeId, status }) => ({ capability, required, connectionId, recipeId, status })),
      missingConfigurationKeys: [
        ...configurationResolution.missing.map((field) => field.key),
        ...configurationResolution.needsConfirmation.map(({ field }) => `confirmation:${field.key}`),
        ...mappingGaps
      ].sort(),
      configuration: configurationResolution.configuration,
      fieldMappingIds: selectedMappings.map((mapping) => mapping.id).sort(),
      permissions,
      assets,
      graphDiff: {
        nodesAdded: compiled.graph.nodes.filter((node) => node.installationScoped).map((node) => node.id),
        nodesReused: compiled.graph.nodes.filter((node) => !node.installationScoped).map((node) => node.id),
        edgesAdded: compiled.graph.edges.map((edge) => edge.id),
        edgesRemoved: []
      },
      requiredTests: ["schema", "policy", "routing", "duplicate", "ambiguous", "connector_unavailable", "approval", "replay", "rollback"],
      initialMode: loaded.manifest.defaultRolloutMode,
      rollback: { removeStagedAssets: true, preserveSharedAssets: true },
      createdAt,
      expiresAt
    };
    const planDigest = canonicalAppDigest({ ...planWithoutDigest, planDigest: undefined });
    return appInstallPlanSchema.parse({ ...planWithoutDigest, planDigest });
  }

  async apply(planInput: AppInstallPlan, actor: string, now = new Date()): Promise<ApplyAppInstallationResult> {
    const plan = appInstallPlanSchema.parse(planInput);
    if (plan.workspaceId !== this.workspaceId) throw new Error("Install plan belongs to another workspace");
    if (Date.parse(plan.expiresAt) <= now.getTime()) throw new Error("Install plan expired; create a fresh content-bound plan");
    const blockers = installPlanBlockers(plan);
    if (blockers.length > 0) throw new Error(`Install plan is not ready:\n- ${blockers.join("\n- ")}`);
    const loaded = await this.marketplace.getAppArtifact(plan.appId, plan.version, plan.artifactDigest);
    const compiled = await compileLoopPack(loaded);
    const installationId = installationIdFor(this.workspaceId, plan.appId);
    return this.installationStore.withExclusiveUpdate<ApplyAppInstallationResult>(async (registry) => {
      const existing = registry.installations.find((installation) => installation.id === installationId);
      if (existing) {
        if (existing.artifactDigest !== plan.artifactDigest) throw new Error("App is already installed at a different immutable version; use upgrade");
        return { registry, value: { installation: existing, lock: createInstallationLock(registry), loopIds: compiled.loopSpecs.map((spec) => spec.metadata.id), created: false } };
      }

      await initLoopgraphWorkspace({ projectRoot: this.projectRoot });
      const workspaceBefore = await readLoopgraphWorkspace(this.projectRoot);
      const snapshot = registry;
      const timestamp = now.toISOString();
      const ownedAssets = plan.assets.filter((asset) => asset.action !== "reuse").map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        ownerInstallationIds: [installationId],
        refCount: 1,
        shared: asset.shared,
        digest: asset.digest ?? canonicalAppDigest(asset)
      }));
      const installation: WorkspaceAppInstallation = {
        schemaVersion: APP_INSTALL_SCHEMA_VERSION,
        id: installationId,
        workspaceId: this.workspaceId,
        appId: plan.appId,
        version: plan.version,
        artifactDigest: plan.artifactDigest,
        state: "ready_to_test",
        mode: plan.initialMode,
        selectedModules: plan.selectedModules,
        presetId: plan.presetId,
        configuration: plan.configuration,
        connectionBindings: Object.fromEntries(plan.capabilityResolutions.flatMap((resolution) => resolution.connectionId ? [[resolution.capability, resolution.connectionId]] : [])),
        fieldMappingIds: plan.fieldMappingIds,
        permissions: plan.permissions,
        ownedAssets,
        installedAt: timestamp,
        updatedAt: timestamp,
        installedBy: actor
      };
      const nextRegistry: AppInstallationRegistry = {
        ...registry,
        revision: registry.revision + 1,
        installations: [...registry.installations, installation].sort((left, right) => left.id.localeCompare(right.id)),
        assets: mergeAssetOwnership(registry.assets, ownedAssets),
        evaluations: registry.evaluations,
        updatedAt: timestamp
      };
      try {
        const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
        const artifacts = await Promise.all(compiled.loopSpecs.map(async (rawSpec) => {
          const { spec, fixtures } = await prepareInstalledSpec(rawSpec, loaded.root, installationId);
          return createStoredLoopSpecArtifact({
            spec,
            entry: {
              id: spec.metadata.id,
              name: spec.metadata.name,
              path: path.join(".loopgraph", "apps", "installations", installationId, "generated", "loops", `${spec.metadata.id}.yaml`),
              templateId: plan.appId,
              department: loaded.manifest.metadata.department,
              addedAt: timestamp
            },
            fixtures,
            source: "import",
            sourceRef: `${plan.appId}@${plan.version}#${plan.artifactDigest}`,
            createdAt: timestamp
          });
        }));
        await this.loopSpecStore.commitMaterializationAtomically({
          commitId: `app-install-${plan.id}`,
          idempotencyKey: plan.planDigest,
          expectedRevision: workspaceSnapshot.revision,
          projectRoot: this.projectRoot,
          committedAt: timestamp,
          artifacts
        });
        const lock = createInstallationLock(nextRegistry);
        return { registry: nextRegistry, lock, value: { installation, lock, loopIds: compiled.loopSpecs.map((spec) => spec.metadata.id), created: true } };
      } catch (error) {
        await rollbackGeneratedInstallation(this.projectRoot, installationId, workspaceBefore, snapshot);
        throw error;
      }
    });
  }

  async test(installationId: string, actor: string, now = new Date()): Promise<AppEvalRun> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, installationId);
      if (!["ready_to_test", "simulation_passed", "shadow"].includes(installation.state)) {
        throw new Error(`App cannot run synthetic conformance tests from ${installation.state}`);
      }
      const loaded = await this.marketplace.getAppArtifact(installation.appId, installation.version, installation.artifactDigest);
      const compiled = await compileLoopPack(loaded);
      const suites = await Promise.all(loaded.manifest.entrypoints.evals.map(async (evalPath) =>
        appEvalSuiteSchema.parse(await readPackYaml(loaded.root, evalPath))));
      const knownLoopIds = new Set(compiled.loopSpecs.map((spec) => spec.metadata.id));
      const startedAt = now.toISOString();
      const scenarios = suites.flatMap((suite) => suite.scenarios.map((scenario) => {
        const passed = (!scenario.expectedLoopId || knownLoopIds.has(scenario.expectedLoopId)) && loaded.artifact.files.some((file) => file.path === scenario.fixture);
        return {
          id: scenario.id,
          status: passed ? "passed" as const : "failed" as const,
          expectedRoute: scenario.expectedLoopId,
          actualRoute: passed ? scenario.expectedLoopId : undefined,
          evidenceRefs: [`fixture:${scenario.fixture}`]
        };
      }));
      const passed = scenarios.every((scenario) => scenario.status === "passed") && installation.permissions.every((permission) => !(permission.authority === "execute" && permission.decision === "allow"));
      const run = appEvalRunSchema.parse({
        schemaVersion: APP_EVAL_SCHEMA_VERSION,
        id: `eval.${contentHash({ installationId, startedAt, actor })}`,
        installationId,
        appId: installation.appId,
        appVersion: installation.version,
        artifactDigest: installation.artifactDigest,
        level: "synthetic",
        status: passed ? "passed" : "failed",
        replay: false,
        writeBlocked: true,
        startedAt,
        completedAt: startedAt,
        scenarios,
        metrics: { passed: scenarios.filter((scenario) => scenario.status === "passed").length, total: scenarios.length },
        evidenceRefs: suites.map((suite) => `eval-suite:${suite.id}`)
      });
      const updated = { ...installation, state: passed ? "simulation_passed" as const : "broken" as const, updatedAt: startedAt, ...(passed ? {} : { failureReason: "Synthetic conformance suite failed" }) };
      return {
        registry: {
          ...registry,
          revision: registry.revision + 1,
          installations: replaceInstallation(registry.installations, updated),
          evaluations: [...registry.evaluations, run],
          updatedAt: startedAt
        },
        value: run
      };
    });
  }

  async activate(installationId: string, mode: Extract<AppRolloutMode, "shadow" | "recommend" | "execute_with_approval" | "live">, actor: string): Promise<WorkspaceAppInstallation> {
    return this.transition(installationId, mode, actor, (installation, registry) => {
      const latestPassed = [...registry.evaluations].reverse().find((run) => run.installationId === installationId && run.status === "passed");
      if (!latestPassed) throw new Error("App must pass conformance before activation");
      if (mode === "execute_with_approval" && installation.permissions.some((permission) => permission.authority === "execute" && permission.decision === "allow")) {
        throw new Error("Execute-with-approval mode cannot contain an unapproved execute permission");
      }
      if (mode === "live") throw new Error("Live activation requires a separate production promotion receipt and is not granted by installation");
      return mode;
    });
  }

  async pause(installationId: string, actor: string): Promise<WorkspaceAppInstallation> {
    return this.transition(installationId, "paused", actor, () => "paused");
  }

  async resume(installationId: string, actor: string): Promise<WorkspaceAppInstallation> {
    return this.transition(installationId, "shadow", actor, (installation) => {
      if (installation.mode !== "shadow" && installation.mode !== "recommend" && installation.mode !== "execute_with_approval") {
        throw new Error("Paused installation has no safe resumable rollout mode");
      }
      return installation.mode;
    });
  }

  async readiness(installationId: string, now = new Date()): Promise<AppReadiness> {
    const registry = await this.installationStore.read();
    const installation = requireInstallation(registry, installationId);
    const latestEval = [...registry.evaluations].reverse().find((run) => run.installationId === installationId);
    const checks: AppReadiness["checks"] = [
      { id: "artifact", category: "artifact", status: "pass", summary: "Pinned artifact version and digest are recorded.", evidenceRefs: [installation.artifactDigest] },
      { id: "connections", category: "connection", status: Object.keys(installation.connectionBindings).length > 0 ? "pass" : "fail", summary: Object.keys(installation.connectionBindings).length > 0 ? "Required connections are bound." : "No provider connections are bound.", evidenceRefs: Object.values(installation.connectionBindings) },
      { id: "configuration", category: "configuration", status: installation.configuration.completedAt ? "pass" : "fail", summary: installation.configuration.completedAt ? "Required configuration is complete." : "Configuration is incomplete.", evidenceRefs: [] },
      { id: "simulation", category: "simulation", status: latestEval?.status === "passed" ? "pass" : latestEval ? "fail" : "warn", summary: latestEval?.status === "passed" ? "Latest conformance run passed." : "A passing conformance run is required.", evidenceRefs: latestEval ? [latestEval.id] : [] },
      { id: "permissions", category: "permission", status: installation.permissions.some((permission) => permission.decision === "unresolved") ? "fail" : "pass", summary: "Permission decisions are explicit and provider execution was not enabled by install.", evidenceRefs: [] }
    ];
    const failureCount = checks.filter((check) => check.status === "fail").length;
    const passCount = checks.filter((check) => check.status === "pass").length;
    const state = failureCount > 0 ? "blocked" : installation.state === "shadow" ? "ready_for_recommend" : "ready_for_shadow";
    return appReadinessSchema.parse({
      schemaVersion: APP_EVAL_SCHEMA_VERSION,
      installationId,
      state,
      score: Math.round((passCount / checks.length) * 100),
      maturity: latestEval?.status === "passed" ? "tested" : "concept",
      checks,
      evaluatedAt: now.toISOString(),
      evidenceDerived: true
    });
  }

  private async transition(
    installationId: string,
    requestedState: WorkspaceAppInstallation["state"],
    actor: string,
    validate: (installation: WorkspaceAppInstallation, registry: AppInstallationRegistry) => WorkspaceAppInstallation["state"]
  ): Promise<WorkspaceAppInstallation> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, installationId);
      const state = validate(installation, registry);
      assertLifecycleTransition(installation.state, requestedState, state);
      const timestamp = new Date().toISOString();
      const mode = ["shadow", "recommend", "execute_with_approval", "live"].includes(state) ? state as AppRolloutMode : installation.mode;
      const updated = { ...installation, state, mode, updatedAt: timestamp, failureReason: undefined };
      return {
        registry: { ...registry, revision: registry.revision + 1, installations: replaceInstallation(registry.installations, updated), updatedAt: timestamp },
        value: updated
      };
    });
  }

  private assertTenant(input: Pick<PlanAppInstallationInput, "projectRoot" | "workspaceId" | "companyId">): void {
    if (path.resolve(input.projectRoot) !== path.resolve(this.projectRoot) || input.workspaceId !== this.workspaceId || input.companyId !== this.companyId) {
      throw new Error("App installation request crossed a project or tenant boundary");
    }
  }
}

export function installPlanBlockers(plan: AppInstallPlan): string[] {
  const blockers = [...plan.missingConfigurationKeys.map((key) => `Missing configuration or mapping: ${key}`)];
  blockers.push(...plan.capabilityResolutions.filter((resolution) => resolution.required && resolution.status !== "connected" && resolution.status !== "reusable").map((resolution) => `Required capability ${resolution.capability} is ${resolution.status}`));
  blockers.push(...plan.permissions.filter((permission) => permission.decision === "unresolved").map((permission) => `Permission ${permission.capability} is unresolved`));
  return blockers;
}

function compilePlannedAssets(compiled: Awaited<ReturnType<typeof compileLoopPack>>, installationId: string): AppInstallPlan["assets"] {
  return [
    ...compiled.loopSpecs.map((spec) => ({ id: `loop.${spec.metadata.id}`, kind: "loop_spec" as const, action: "create" as const, digest: canonicalAppDigest(spec), shared: false, sourcePath: `loops/${spec.metadata.id}.yaml`, dependencies: [] })),
    ...compiled.skills.map((skill) => ({ id: `skill.${skill.id}`, kind: "hermes_skill" as const, action: "create" as const, digest: canonicalAppDigest(skill), shared: false, dependencies: [] })),
    ...compiled.routingCards.map((card) => ({ id: `routing.${card.loopId}`, kind: "routing_card" as const, action: "create" as const, digest: canonicalAppDigest(card), shared: false, dependencies: [`loop.${card.loopId}`] })),
    ...compiled.graph.nodes.filter((node) => node.installationScoped).map((node) => ({ id: `graph-node.${node.id}`, kind: "graph_node" as const, action: "create" as const, digest: canonicalAppDigest(node), shared: false, dependencies: node.parentId ? [`graph-node.${node.parentId}`] : [] })),
    ...compiled.graph.edges.map((edge) => ({ id: `graph-edge.${edge.id}`, kind: "graph_edge" as const, action: "create" as const, digest: canonicalAppDigest(edge), shared: false, dependencies: [`graph-node.${edge.source}`, `graph-node.${edge.target}`] })),
    { id: `receipt.${installationId}`, kind: "event_contract" as const, action: "create" as const, digest: canonicalAppDigest({ installationId, compiled: compiled.artifactDigest }), shared: false, dependencies: [] }
  ];
}

async function prepareInstalledSpec(specInput: Awaited<ReturnType<typeof compileLoopPack>>["loopSpecs"][number], packRoot: string, installationId: string) {
  const fixtureEntries = await Promise.all((specInput.input.fixtures ?? []).map(async (fixture) => {
    const sourcePath = resolvePackFile(packRoot, fixture.path);
    return { fixture, value: JSON.parse(await readFile(sourcePath, "utf8")) as unknown };
  }));
  const fixtures = Object.fromEntries(fixtureEntries.map(({ fixture, value }) => [`fixtures/${path.basename(fixture.path)}`, value]));
  const spec = {
    ...specInput,
    metadata: {
      ...specInput.metadata,
      labels: { ...specInput.metadata.labels, installationId, lifecycleStatus: "draft" }
    },
    input: {
      ...specInput.input,
      fixtures: fixtureEntries.map(({ fixture }) => ({ id: fixture.id, path: `fixtures/${path.basename(fixture.path)}` }))
    },
    routing: specInput.routing ? { ...specInput.routing, activationMode: "shadow" as const } : undefined
  };
  return { spec, fixtures };
}

async function loadSetupFields(root: string, paths: string[]): Promise<AppConfigField[]> {
  const fields: AppConfigField[] = [];
  for (const setupPath of paths) {
    const setup = appSetupDefinitionSchema.parse(await readPackYaml(root, setupPath));
    fields.push(...setup.questions.map((question) => ({
      key: question.key,
      label: question.prompt,
      description: question.why,
      valueType: question.valueType,
      requirement: question.requirement,
      infer: Boolean(question.inferFromContext),
      ask: true,
      sensitive: false,
      defaultValue: question.defaultValue,
      contextRef: question.inferFromContext,
      condition: question.condition
    })));
  }
  return fields;
}

async function readPackYaml(root: string, relativePath: string): Promise<unknown> {
  return YAML.parse(await readFile(resolvePackFile(root, relativePath), "utf8"));
}

function resolvePackFile(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Pack path escapes root: ${relativePath}`);
  return absolute;
}

function resolveSelectedModules(modules: Array<{ id: string; defaultEnabled: boolean; dependsOn: string[] }>, requested?: string[]): string[] {
  const selected = new Set(requested ?? modules.filter((module) => module.defaultEnabled).map((module) => module.id));
  const known = new Set(modules.map((module) => module.id));
  for (const id of selected) if (!known.has(id)) throw new Error(`Unknown app module: ${id}`);
  for (const module of modules.filter((candidate) => selected.has(candidate.id))) {
    for (const dependency of module.dependsOn) if (!selected.has(dependency)) throw new Error(`Module ${module.id} requires ${dependency}`);
  }
  return [...selected].sort();
}

function findConnectionForRecipe(resolutions: CapabilityResolution[], recipeId: string): string | undefined {
  return resolutions.find((resolution) => resolution.recipeId === recipeId && resolution.connectionId)?.connectionId;
}

function installationIdFor(workspaceId: string, appId: string): string {
  return `install.${contentHash({ workspaceId, appId })}`;
}

function createInstallationLock(registry: AppInstallationRegistry): AppInstallationLock {
  const base = {
    schemaVersion: APP_INSTALL_SCHEMA_VERSION,
    workspaceId: registry.workspaceId,
    revision: registry.revision,
    installations: registry.installations.map((installation) => ({
      installationId: installation.id,
      appId: installation.appId,
      version: installation.version,
      artifactDigest: installation.artifactDigest,
      configurationDigest: canonicalAppDigest(installation.configuration),
      overlayDigest: installation.overlay ? canonicalAppDigest(installation.overlay) : undefined,
      selectedModules: installation.selectedModules
    })),
    generatedAt: registry.updatedAt
  };
  return appInstallationLockSchema.parse({ ...base, lockDigest: canonicalAppDigest({ ...base, lockDigest: undefined }) });
}

function mergeAssetOwnership(existing: AppInstallationRegistry["assets"], added: WorkspaceAppInstallation["ownedAssets"]): AppInstallationRegistry["assets"] {
  const map = new Map(existing.map((asset) => [asset.assetId, asset]));
  for (const asset of added) {
    const current = map.get(asset.assetId);
    if (!current) map.set(asset.assetId, asset);
    else {
      if (current.digest !== asset.digest || current.kind !== asset.kind) throw new Error(`Shared asset conflict: ${asset.assetId}`);
      const owners = Array.from(new Set([...current.ownerInstallationIds, ...asset.ownerInstallationIds])).sort();
      map.set(asset.assetId, { ...current, ownerInstallationIds: owners, refCount: owners.length, shared: owners.length > 1 || current.shared });
    }
  }
  return [...map.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function requireInstallation(registry: AppInstallationRegistry, id: string): WorkspaceAppInstallation {
  const installation = registry.installations.find((candidate) => candidate.id === id);
  if (!installation) throw new Error(`App installation not found: ${id}`);
  return installation;
}

function replaceInstallation(installations: WorkspaceAppInstallation[], replacement: WorkspaceAppInstallation): WorkspaceAppInstallation[] {
  return installations.map((installation) => installation.id === replacement.id ? replacement : installation);
}

function assertLifecycleTransition(from: WorkspaceAppInstallation["state"], requested: WorkspaceAppInstallation["state"], resolved: WorkspaceAppInstallation["state"]): void {
  if (requested !== resolved) throw new Error("Lifecycle transition validator returned an unexpected state");
  const allowed: Partial<Record<WorkspaceAppInstallation["state"], WorkspaceAppInstallation["state"][]>> = {
    simulation_passed: ["shadow", "paused"],
    shadow: ["recommend", "paused"],
    recommend: ["execute_with_approval", "paused"],
    execute_with_approval: ["paused"],
    paused: ["shadow", "recommend", "execute_with_approval"]
  };
  if (!(allowed[from] ?? []).includes(resolved)) throw new Error(`Invalid app lifecycle transition: ${from} -> ${resolved}`);
}

async function rollbackGeneratedInstallation(projectRoot: string, installationId: string, workspace: LoopgraphWorkspaceRegistry, _registry: AppInstallationRegistry): Promise<void> {
  await writeLoopgraphWorkspace(workspace, projectRoot);
  const installationRoot = path.join(path.resolve(projectRoot), ".loopgraph", "apps", "installations", installationId);
  await rm(installationRoot, { recursive: true, force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
