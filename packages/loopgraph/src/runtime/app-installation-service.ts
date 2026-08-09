import { cp, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  APP_EVAL_SCHEMA_VERSION,
  APP_INSTALL_SCHEMA_VERSION,
  appIdSchema,
  appEvalJudgmentSchema,
  appEvalRunSchema,
  appHistoricalReplayRequestSchema,
  appInstallPlanSchema,
  appInstallationLockSchema,
  appLifecycleReceiptSchema,
  appOverlaySchema,
  appReadinessSchema,
  appUpdatePlanSchema,
  canonicalAppDigest,
  contentHash,
  type AppConfigField,
  type AppEvalRun,
  type AppEvalJudgment,
  type AppHistoricalReplayRequest,
  type AppInstallPlan,
  type AppInstallationLock,
  type AppLifecycleReceipt,
  type AppOverlay,
  type AppReadiness,
  type AppPromotionRecommendation,
  type AppRolloutMode,
  type AppUpdatePlan,
  type ConnectionInstance,
  type WorkspaceAppInstallation
} from "../core";
import { appSetupDefinitionSchema } from "../core/app-pack-content";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory, type LoopPackLoadResult } from "./app-pack-loader";
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
import {
  createPromotionRecommendation,
  runAppHistoricalReplay,
  runAppSyntheticConformance
} from "./app-quality-engine";

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

export type ConfigureAppInstallationInput = {
  installationId: string;
  values: Record<string, unknown>;
  expectedConfigurationDigest: string;
  actor: string;
  now?: Date;
};

export type ApplyAppOverlayInput = {
  installationId: string;
  operations: AppOverlay["operations"];
  expectedArtifactDigest: string;
  expectedOverlayRevision?: number;
  actor: string;
  now?: Date;
};

export type PlanAppUpdateInput = {
  installationId: string;
  versionRange?: string;
  connections: ConnectionInstance[];
  actor: string;
  now?: Date;
};

export type ApplyAppUpdateInput = {
  plan: AppUpdatePlan;
  approvedPermissionCapabilities?: string[];
  actor: string;
  now?: Date;
};

export type AppLifecycleMutationResult = {
  installation?: WorkspaceAppInstallation;
  receipt: AppLifecycleReceipt;
  lock: AppInstallationLock;
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
        history: [],
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

  async configure(input: ConfigureAppInstallationInput): Promise<AppLifecycleMutationResult> {
    const now = input.now ?? new Date();
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, input.installationId);
      if (canonicalAppDigest(installation.configuration) !== input.expectedConfigurationDigest) {
        throw new Error("Installed app configuration changed; create a fresh configure request");
      }
      const resolution = resolveAppConfiguration({
        appId: installation.appId,
        version: installation.version,
        fields: installation.configuration.fields,
        installValues: { ...installation.configuration.values, ...input.values },
        overlay: installation.overlay,
        now
      });
      if (resolution.missing.length > 0 || resolution.needsConfirmation.length > 0) {
        throw new Error(`Configuration remains incomplete: ${[
          ...resolution.missing.map((field) => field.key),
          ...resolution.needsConfirmation.map(({ field }) => `confirmation:${field.key}`)
        ].join(", ")}`);
      }
      const timestamp = now.toISOString();
      const updated: WorkspaceAppInstallation = {
        ...installation,
        configuration: resolution.configuration,
        state: "ready_to_test",
        mode: "simulation",
        history: appendHistory(installation, input.actor, "configure", timestamp),
        updatedAt: timestamp,
        failureReason: undefined
      };
      return lifecycleMutation(registry, updated, {
        action: "configure",
        actor: input.actor,
        reason: "Applied confirmed company configuration and reset the app to write-blocked testing.",
        evidenceRetained: true,
        reversible: true,
        createdAt: timestamp
      });
    });
  }

  async applyOverlay(input: ApplyAppOverlayInput): Promise<AppLifecycleMutationResult> {
    const now = input.now ?? new Date();
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, input.installationId);
      if (installation.artifactDigest !== input.expectedArtifactDigest) {
        throw new Error("Installed artifact changed; create a fresh overlay request");
      }
      if ((installation.overlay?.revision ?? 0) !== (input.expectedOverlayRevision ?? 0)) {
        throw new Error("Installed app overlay revision changed; reload before editing");
      }
      const loaded = await this.loadInstallationArtifact(installation);
      validateOverlayOperations(input.operations, loaded, installation.configuration.fields.map((field) => field.key));
      const timestamp = now.toISOString();
      const overlay = appOverlaySchema.parse({
        schemaVersion: "loopgraph-app-configuration/v1alpha1",
        id: `overlay.${contentHash({ installationId: installation.id, revision: (installation.overlay?.revision ?? 0) + 1, operations: input.operations })}`,
        installationId: installation.id,
        basedOnVersion: installation.version,
        basedOnDigest: installation.artifactDigest,
        revision: (installation.overlay?.revision ?? 0) + 1,
        operations: input.operations,
        createdAt: timestamp,
        createdBy: input.actor
      });
      const selectedModules = applyModuleOverlay(loaded.manifest.modules, installation.selectedModules, overlay.operations);
      const configuration = resolveAppConfiguration({
        appId: installation.appId,
        version: installation.version,
        fields: installation.configuration.fields,
        installValues: installation.configuration.values,
        overlay,
        now
      }).configuration;
      const updated: WorkspaceAppInstallation = {
        ...installation,
        overlay,
        selectedModules,
        configuration,
        state: "ready_to_test",
        mode: "simulation",
        history: appendHistory(installation, input.actor, "overlay", timestamp),
        updatedAt: timestamp,
        failureReason: undefined
      };
      return lifecycleMutation(registry, updated, {
        action: "overlay",
        actor: input.actor,
        reason: "Stored workspace customization as a version-bound overlay without mutating the pinned LoopPack.",
        evidenceRetained: true,
        reversible: true,
        createdAt: timestamp
      });
    });
  }

  async repair(installationId: string, actor: string, now = new Date()): Promise<AppLifecycleMutationResult> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, installationId);
      const loaded = await this.loadInstallationArtifact(installation);
      const compiled = await compileLoopPack(loaded);
      const timestamp = now.toISOString();
      const namespace = installationNamespace(installation);
      const artifacts = await createInstallationArtifacts(compiled, loaded.root, installation.id, loaded.manifest.metadata.department, timestamp, namespace);
      const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
      const existingLoopIds = installationLoopIds(workspaceSnapshot.workspace, installation.id);
      const nextLoopIds = new Set(artifacts.map((artifact) => artifact.loopId));
      await this.loopSpecStore.commitMaterializationAtomically({
        commitId: `app-repair-${contentHash({ installationId, digest: installation.artifactDigest, timestamp })}`,
        idempotencyKey: canonicalAppDigest({ action: "repair", installationId, digest: installation.artifactDigest, timestamp }),
        expectedRevision: workspaceSnapshot.revision,
        projectRoot: this.projectRoot,
        committedAt: timestamp,
        artifacts,
        removeLoopIds: existingLoopIds.filter((loopId) => !nextLoopIds.has(loopId))
      });
      const ownedAssets = ownershipFromCompiled(compiled, installation.id, namespace);
      const updated: WorkspaceAppInstallation = {
        ...installation,
        state: "ready_to_test",
        mode: "simulation",
        ownedAssets,
        history: appendHistory(installation, actor, "repair", timestamp),
        updatedAt: timestamp,
        failureReason: undefined
      };
      return lifecycleMutation(registry, updated, {
        action: "repair",
        actor,
        reason: "Recompiled the pinned immutable artifact and restored generated assets in write-blocked test mode.",
        evidenceRetained: true,
        reversible: true,
        removedAssetIds: installation.ownedAssets.filter((asset) => !ownedAssets.some((next) => next.assetId === asset.assetId)).map((asset) => asset.assetId),
        createdAt: timestamp
      }, replaceOwnedAssets(registry.assets, installation.id, ownedAssets));
    });
  }

  async duplicate(input: {
    installationId: string;
    derivedAppId: string;
    overlayOperations?: AppOverlay["operations"];
    actor: string;
    now?: Date;
  }): Promise<AppLifecycleMutationResult> {
    const now = input.now ?? new Date();
    const derivedAppId = appIdSchema.parse(input.derivedAppId);
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const source = requireInstallation(registry, input.installationId);
      if (registry.installations.some((installation) => installation.derivation?.derivedAppId === derivedAppId)) {
        throw new Error(`Private derived app already exists: ${derivedAppId}`);
      }
      const timestamp = now.toISOString();
      const installationId = installationIdFor(this.workspaceId, `${source.appId}:${derivedAppId}`);
      const loaded = await this.loadInstallationArtifact(source);
      const compiled = await compileLoopPack(loaded);
      const namespace = contentHash({ installationId }).slice(0, 10);
      const overlay = appOverlaySchema.parse({
        schemaVersion: "loopgraph-app-configuration/v1alpha1",
        id: `overlay.${contentHash({ installationId, operations: input.overlayOperations ?? [] })}`,
        installationId,
        basedOnVersion: source.version,
        basedOnDigest: source.artifactDigest,
        revision: 1,
        operations: input.overlayOperations ?? [],
        createdAt: timestamp,
        createdBy: input.actor
      });
      validateOverlayOperations(overlay.operations, loaded, source.configuration.fields.map((field) => field.key));
      const selectedModules = applyModuleOverlay(loaded.manifest.modules, source.selectedModules, overlay.operations);
      const configuration = resolveAppConfiguration({
        appId: source.appId,
        version: source.version,
        fields: source.configuration.fields,
        installValues: source.configuration.values,
        overlay,
        now
      }).configuration;
      const artifacts = await createInstallationArtifacts(compiled, loaded.root, installationId, loaded.manifest.metadata.department, timestamp, namespace);
      const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
      await this.loopSpecStore.commitMaterializationAtomically({
        commitId: `app-duplicate-${contentHash({ installationId, timestamp })}`,
        idempotencyKey: canonicalAppDigest({ action: "duplicate", installationId, digest: source.artifactDigest, timestamp }),
        expectedRevision: workspaceSnapshot.revision,
        projectRoot: this.projectRoot,
        committedAt: timestamp,
        artifacts
      });
      const ownedAssets = ownershipFromCompiled(compiled, installationId, namespace);
      const duplicate: WorkspaceAppInstallation = {
        ...source,
        id: installationId,
        state: "ready_to_test",
        mode: "simulation",
        selectedModules,
        configuration,
        overlay,
        ownedAssets,
        derivation: {
          derivedAppId,
          upstreamAppId: source.appId,
          upstreamVersion: source.version,
          upstreamDigest: source.artifactDigest,
          parentInstallationId: source.id,
          createdAt: timestamp,
          createdBy: input.actor
        },
        history: [],
        installedAt: timestamp,
        updatedAt: timestamp,
        installedBy: input.actor,
        lastHealthyAt: undefined,
        failureReason: undefined
      };
      const nextRevision = registry.revision + 1;
      const receipt = createLifecycleReceipt(registry, {
        installationId,
        action: "duplicate",
        actor: input.actor,
        reason: "Created an independently configurable private derived installation with namespaced LoopSpecs.",
        previousArtifactDigest: source.artifactDigest,
        resultingArtifactDigest: duplicate.artifactDigest,
        evidenceRetained: true,
        reversible: true,
        createdAt: timestamp,
        resultingRevision: nextRevision
      });
      const nextRegistry: AppInstallationRegistry = {
        ...registry,
        revision: nextRevision,
        installations: [...registry.installations, duplicate].sort((left, right) => left.id.localeCompare(right.id)),
        assets: mergeAssetOwnership(registry.assets, ownedAssets),
        lifecycleReceipts: [...registry.lifecycleReceipts, receipt],
        updatedAt: timestamp
      };
      const lock = createInstallationLock(nextRegistry);
      return { registry: nextRegistry, lock, value: { installation: duplicate, receipt, lock } };
    });
  }

  async planUpdate(input: PlanAppUpdateInput): Promise<AppUpdatePlan> {
    const registry = await this.installationStore.read();
    const installation = requireInstallation(registry, input.installationId);
    if (installation.derivation?.detachedAt) throw new Error("Detached private apps do not receive upstream updates");
    const now = input.now ?? new Date();
    const baseInstallPlan = await this.plan({
      projectRoot: this.projectRoot,
      workspaceId: this.workspaceId,
      companyId: this.companyId,
      appId: installation.appId,
      versionRange: input.versionRange ?? "latest",
      presetId: installation.presetId,
      selectedModules: installation.selectedModules,
      connections: input.connections,
      installValues: installation.configuration.values,
      fieldMappingIds: installation.fieldMappingIds,
      actor: input.actor,
      now
    });
    if (baseInstallPlan.artifactDigest === installation.artifactDigest) {
      throw new Error(`${installation.appId} is already pinned to the selected immutable version`);
    }
    const [currentLoaded, nextLoaded] = await Promise.all([
      this.loadInstallationArtifact(installation),
      this.marketplace.getAppArtifact(baseInstallPlan.appId, baseInstallPlan.version, baseInstallPlan.artifactDigest)
    ]);
    const [currentCompiled, nextCompiled] = await Promise.all([
      compileLoopPack(currentLoaded),
      compileLoopPack(nextLoaded)
    ]);
    const permissionChanges = comparePermissions(currentLoaded, nextLoaded);
    const conflicts = detectOverlayConflicts(installation.overlay, nextLoaded, baseInstallPlan.configuration.values);
    const createdAt = now.toISOString();
    const planWithoutDigest = {
      schemaVersion: APP_INSTALL_SCHEMA_VERSION,
      id: `update.${contentHash({ installationId: installation.id, from: installation.artifactDigest, to: baseInstallPlan.artifactDigest, createdAt })}`,
      installationId: installation.id,
      fromVersion: installation.version,
      fromDigest: installation.artifactDigest,
      toVersion: baseInstallPlan.version,
      toDigest: baseInstallPlan.artifactDigest,
      baseInstallPlan,
      permissionChanges,
      graphDiff: {
        nodesAdded: difference(nextCompiled.graph.nodes.map((node) => node.id), currentCompiled.graph.nodes.map((node) => node.id)),
        nodesRemoved: difference(currentCompiled.graph.nodes.map((node) => node.id), nextCompiled.graph.nodes.map((node) => node.id)),
        edgesAdded: difference(nextCompiled.graph.edges.map((edge) => edge.id), currentCompiled.graph.edges.map((edge) => edge.id)),
        edgesRemoved: difference(currentCompiled.graph.edges.map((edge) => edge.id), nextCompiled.graph.edges.map((edge) => edge.id))
      },
      merge: {
        originalBaseDigest: installation.artifactDigest,
        overlayDigest: installation.overlay ? canonicalAppDigest(installation.overlay) : undefined,
        newBaseDigest: baseInstallPlan.artifactDigest,
        conflicts
      },
      rollbackVersion: installation.version,
      rollbackDigest: installation.artifactDigest,
      permissionReviewRequired: permissionChanges.some((change) => change.requiresReview),
      createdAt,
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString()
    };
    return appUpdatePlanSchema.parse({
      ...planWithoutDigest,
      planDigest: canonicalAppDigest({ ...planWithoutDigest, planDigest: undefined })
    });
  }

  async applyUpdate(input: ApplyAppUpdateInput): Promise<AppLifecycleMutationResult> {
    const plan = appUpdatePlanSchema.parse(input.plan);
    const now = input.now ?? new Date();
    if (Date.parse(plan.expiresAt) <= now.getTime()) throw new Error("Update plan expired; create a fresh content-bound plan");
    if (installPlanBlockers(plan.baseInstallPlan).length > 0) throw new Error("Update plan contains unresolved installation blockers");
    const unresolvedConflicts = plan.merge.conflicts.filter((conflict) => conflict.resolution === "unresolved");
    if (unresolvedConflicts.length > 0) throw new Error(`Update has unresolved overlay conflicts: ${unresolvedConflicts.map((conflict) => conflict.path).join(", ")}`);
    const approved = new Set(input.approvedPermissionCapabilities ?? []);
    const unapproved = plan.permissionChanges.filter((change) => change.requiresReview && !approved.has(change.capability));
    if (unapproved.length > 0) throw new Error(`Permission changes require explicit review: ${unapproved.map((change) => change.capability).join(", ")}`);

    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, plan.installationId);
      if (installation.version !== plan.fromVersion || installation.artifactDigest !== plan.fromDigest) {
        throw new Error("Installed app changed after the update plan was created");
      }
      const loaded = await this.marketplace.getAppArtifact(installation.appId, plan.toVersion, plan.toDigest);
      const compiled = await compileLoopPack(loaded);
      const timestamp = now.toISOString();
      const namespace = installationNamespace(installation);
      const overlay = installation.overlay ? appOverlaySchema.parse({
        ...installation.overlay,
        basedOnVersion: plan.toVersion,
        basedOnDigest: plan.toDigest,
        revision: installation.overlay.revision + 1,
        createdAt: timestamp,
        createdBy: input.actor
      }) : undefined;
      const configuration = resolveAppConfiguration({
        appId: installation.appId,
        version: plan.toVersion,
        fields: plan.baseInstallPlan.configuration.fields,
        installValues: plan.baseInstallPlan.configuration.values,
        overlay,
        now
      }).configuration;
      const artifacts = await createInstallationArtifacts(compiled, loaded.root, installation.id, loaded.manifest.metadata.department, timestamp, namespace);
      const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
      const existingLoopIds = installationLoopIds(workspaceSnapshot.workspace, installation.id);
      const nextLoopIds = new Set(artifacts.map((artifact) => artifact.loopId));
      await this.loopSpecStore.commitMaterializationAtomically({
        commitId: `app-update-${plan.id}`,
        idempotencyKey: plan.planDigest,
        expectedRevision: workspaceSnapshot.revision,
        projectRoot: this.projectRoot,
        committedAt: timestamp,
        artifacts,
        removeLoopIds: existingLoopIds.filter((loopId) => !nextLoopIds.has(loopId))
      });
      const ownedAssets = ownershipFromCompiled(compiled, installation.id, namespace);
      const updated: WorkspaceAppInstallation = {
        ...installation,
        version: plan.toVersion,
        artifactDigest: plan.toDigest,
        state: "ready_to_test",
        mode: "simulation",
        configuration,
        overlay,
        connectionBindings: Object.fromEntries(plan.baseInstallPlan.capabilityResolutions.flatMap((resolution) => resolution.connectionId ? [[resolution.capability, resolution.connectionId]] : [])),
        fieldMappingIds: plan.baseInstallPlan.fieldMappingIds,
        permissions: plan.baseInstallPlan.permissions,
        ownedAssets,
        history: appendHistory(installation, input.actor, "update", timestamp),
        updatedAt: timestamp,
        failureReason: undefined,
        derivation: installation.derivation ? {
          ...installation.derivation,
          upstreamVersion: plan.toVersion,
          upstreamDigest: plan.toDigest
        } : undefined
      };
      return lifecycleMutation(registry, updated, {
        action: "update",
        actor: input.actor,
        reason: `Updated the pinned base from ${plan.fromVersion} to ${plan.toVersion}; activation requires fresh evidence.`,
        evidenceRetained: true,
        reversible: true,
        removedAssetIds: installation.ownedAssets.filter((asset) => !ownedAssets.some((next) => next.assetId === asset.assetId)).map((asset) => asset.assetId),
        createdAt: timestamp
      }, replaceOwnedAssets(registry.assets, installation.id, ownedAssets));
    });
  }

  async rollback(installationId: string, expectedArtifactDigest: string, actor: string, now = new Date()): Promise<AppLifecycleMutationResult> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, installationId);
      if (installation.artifactDigest !== expectedArtifactDigest) throw new Error("Installed app changed; create a fresh rollback request");
      const revision = installation.history.at(-1);
      if (!revision) throw new Error("No reversible installed-app revision is available");
      const loaded = await this.loadArtifactRevision(installation, revision.version, revision.artifactDigest);
      const compiled = await compileLoopPack(loaded);
      const timestamp = now.toISOString();
      const namespace = installationNamespace(installation);
      const artifacts = await createInstallationArtifacts(compiled, loaded.root, installation.id, loaded.manifest.metadata.department, timestamp, namespace);
      const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
      const existingLoopIds = installationLoopIds(workspaceSnapshot.workspace, installation.id);
      const nextLoopIds = new Set(artifacts.map((artifact) => artifact.loopId));
      await this.loopSpecStore.commitMaterializationAtomically({
        commitId: `app-rollback-${contentHash({ installationId, from: installation.artifactDigest, to: revision.artifactDigest, timestamp })}`,
        idempotencyKey: canonicalAppDigest({ action: "rollback", installationId, from: installation.artifactDigest, to: revision.artifactDigest, timestamp }),
        expectedRevision: workspaceSnapshot.revision,
        projectRoot: this.projectRoot,
        committedAt: timestamp,
        artifacts,
        removeLoopIds: existingLoopIds.filter((loopId) => !nextLoopIds.has(loopId))
      });
      const restored: WorkspaceAppInstallation = {
        ...installation,
        version: revision.version,
        artifactDigest: revision.artifactDigest,
        state: "rolled_back",
        mode: "simulation",
        selectedModules: revision.selectedModules,
        presetId: revision.presetId,
        configuration: revision.configuration,
        overlay: revision.overlay,
        connectionBindings: revision.connectionBindings,
        fieldMappingIds: revision.fieldMappingIds,
        permissions: revision.permissions,
        ownedAssets: revision.ownedAssets,
        history: installation.history.slice(0, -1),
        updatedAt: timestamp,
        failureReason: undefined
      };
      return lifecycleMutation(registry, restored, {
        action: "rollback",
        actor,
        reason: `Restored the exact ${revision.version} installation snapshot; fresh conformance is required before activation.`,
        evidenceRetained: true,
        reversible: installation.history.length > 1,
        removedAssetIds: installation.ownedAssets.filter((asset) => !revision.ownedAssets.some((restoredAsset) => restoredAsset.assetId === asset.assetId)).map((asset) => asset.assetId),
        createdAt: timestamp
      }, replaceOwnedAssets(registry.assets, installation.id, revision.ownedAssets));
    });
  }

  async detach(installationId: string, expectedArtifactDigest: string, actor: string, now = new Date()): Promise<AppLifecycleMutationResult> {
    const registry = await this.installationStore.read();
    const installation = requireInstallation(registry, installationId);
    if (!installation.derivation) throw new Error("Only a private derived app can detach from upstream");
    if (installation.derivation.detachedAt) throw new Error("Private app is already detached from upstream");
    if (installation.artifactDigest !== expectedArtifactDigest) throw new Error("Installed app changed; create a fresh detach request");
    const loaded = await this.loadInstallationArtifact(installation);
    const timestamp = now.toISOString();
    const snapshotPath = path.join(".loopgraph", "apps", "private-snapshots", installation.derivation.derivedAppId, installation.version);
    await cp(loaded.root, path.join(this.projectRoot, snapshotPath), { recursive: true, force: true });
    return this.installationStore.withExclusiveUpdate(async (current) => {
      const fresh = requireInstallation(current, installationId);
      if (fresh.artifactDigest !== expectedArtifactDigest || fresh.derivation?.detachedAt) throw new Error("Installed app changed while detaching");
      const updated: WorkspaceAppInstallation = {
        ...fresh,
        derivation: {
          ...fresh.derivation!,
          detachedAt: timestamp,
          detachedBy: actor,
          snapshotPath
        },
        history: appendHistory(fresh, actor, "detach", timestamp),
        updatedAt: timestamp
      };
      return lifecycleMutation(current, updated, {
        action: "detach",
        actor,
        reason: "Pinned a workspace-local immutable snapshot and disabled future upstream updates for this private app.",
        evidenceRetained: true,
        reversible: false,
        createdAt: timestamp
      });
    });
  }

  async uninstall(input: {
    installationId: string;
    expectedArtifactDigest: string;
    actor: string;
    reason: string;
    confirmed: boolean;
    now?: Date;
  }): Promise<AppLifecycleMutationResult> {
    if (!input.confirmed) throw new Error("Uninstall requires an explicit confirmation");
    const now = input.now ?? new Date();
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, input.installationId);
      if (installation.artifactDigest !== input.expectedArtifactDigest) throw new Error("Installed app changed; create a fresh uninstall request");
      const timestamp = now.toISOString();
      const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
      const loopIds = installationLoopIds(workspaceSnapshot.workspace, installation.id);
      const sharedLoopIds = new Set(installation.ownedAssets.flatMap((asset) => {
        const registryAsset = registry.assets.find((candidate) => candidate.assetId === asset.assetId);
        return asset.kind === "loop_spec" && (registryAsset?.ownerInstallationIds.length ?? 0) > 1 && asset.assetId.startsWith("loop.")
          ? [asset.assetId.slice("loop.".length)]
          : [];
      }));
      const removableLoopIds = loopIds.filter((loopId) => !sharedLoopIds.has(loopId));
      if (removableLoopIds.length > 0) {
        await this.loopSpecStore.commitMaterializationAtomically({
          commitId: `app-uninstall-${contentHash({ installationId: installation.id, digest: installation.artifactDigest, timestamp })}`,
          idempotencyKey: canonicalAppDigest({ action: "uninstall", installationId: installation.id, digest: installation.artifactDigest, timestamp }),
          expectedRevision: workspaceSnapshot.revision,
          projectRoot: this.projectRoot,
          committedAt: timestamp,
          artifacts: [],
          removeLoopIds: removableLoopIds
        });
      }
      const { assets, removedAssetIds, preservedSharedAssetIds } = releaseOwnedAssets(registry.assets, installation.id);
      await this.mappingStore.detachInstallation(installation.id, now);
      await this.contextStore.detachConsumer({
        workspaceId: this.workspaceId,
        companyId: this.companyId,
        installationId: installation.id,
        actor: input.actor,
        now
      });
      if (sharedLoopIds.size === 0) {
        await rm(path.join(this.projectRoot, ".loopgraph", "apps", "installations", installation.id), { recursive: true, force: true });
      }
      const nextRevision = registry.revision + 1;
      const receipt = createLifecycleReceipt(registry, {
        installationId: installation.id,
        action: "uninstall",
        actor: input.actor,
        reason: input.reason,
        previousArtifactDigest: installation.artifactDigest,
        removedAssetIds,
        preservedSharedAssetIds,
        evidenceRetained: true,
        reversible: false,
        createdAt: timestamp,
        resultingRevision: nextRevision
      });
      const nextRegistry: AppInstallationRegistry = {
        ...registry,
        revision: nextRevision,
        installations: registry.installations.filter((candidate) => candidate.id !== installation.id),
        assets,
        lifecycleReceipts: [...registry.lifecycleReceipts, receipt],
        updatedAt: timestamp
      };
      const lock = createInstallationLock(nextRegistry);
      return { registry: nextRegistry, lock, value: { receipt, lock } };
    });
  }

  async test(installationId: string, actor: string, now = new Date()): Promise<AppEvalRun> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, installationId);
      if (!["ready_to_test", "simulation_passed", "shadow", "rolled_back"].includes(installation.state)) {
        throw new Error(`App cannot run synthetic conformance tests from ${installation.state}`);
      }
      const loaded = await this.loadInstallationArtifact(installation);
      const compiled = await compileLoopPack(loaded);
      const run = await runAppSyntheticConformance({ loaded, compiled, installation, actor, now });
      const passed = run.status === "passed";
      const updated = { ...installation, state: passed ? "simulation_passed" as const : "broken" as const, updatedAt: run.completedAt!, ...(passed ? {} : { failureReason: "Synthetic conformance suite failed" }) };
      return {
        registry: {
          ...registry,
          revision: registry.revision + 1,
          installations: replaceInstallation(registry.installations, updated),
          evaluations: [...registry.evaluations, run],
          updatedAt: run.completedAt!
        },
        value: run
      };
    });
  }

  async historicalReplay(requestInput: AppHistoricalReplayRequest, now = new Date()): Promise<AppEvalRun> {
    const request = appHistoricalReplayRequestSchema.parse(requestInput);
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireInstallation(registry, request.installationId);
      const passedSynthetic = [...registry.evaluations].reverse().find((run) =>
        run.installationId === installation.id && run.level === "synthetic" && run.status === "passed");
      if (!passedSynthetic) throw new Error("Historical replay requires a passing synthetic conformance run");
      if (["revoked", "uninstalling", "rolled_back", "broken"].includes(installation.state)) {
        throw new Error(`Historical replay is unavailable while the app is ${installation.state}`);
      }
      const loaded = await this.loadInstallationArtifact(installation);
      const compiled = await compileLoopPack(loaded);
      const run = runAppHistoricalReplay({ request, compiled, installation, now });
      return {
        registry: {
          ...registry,
          revision: registry.revision + 1,
          evaluations: [...registry.evaluations, run],
          updatedAt: run.completedAt!
        },
        value: run
      };
    });
  }

  async labelEvaluation(judgmentInput: AppEvalJudgment): Promise<AppEvalRun> {
    const judgment = appEvalJudgmentSchema.parse(judgmentInput);
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const run = registry.evaluations.find((candidate) => candidate.id === judgment.runId);
      if (!run) throw new Error(`App evaluation not found: ${judgment.runId}`);
      requireInstallation(registry, run.installationId);
      const scenario = run.scenarios.find((candidate) => candidate.id === judgment.scenarioId);
      if (!scenario) throw new Error(`Evaluation scenario not found: ${judgment.scenarioId}`);
      const scenarios = run.scenarios.map((candidate) => candidate.id === judgment.scenarioId
        ? {
            ...candidate,
            humanLabel: judgment.label,
            reviewMinutes: judgment.reviewMinutes,
            evidenceRefs: Array.from(new Set([...candidate.evidenceRefs, `human-judgment:${judgment.reviewedBy}:${judgment.reviewedAt}`]))
          }
        : candidate);
      const labeled = scenarios.filter((candidate) => candidate.humanLabel);
      const updated = appEvalRunSchema.parse({
        ...run,
        scenarios,
        metrics: {
          ...run.metrics,
          labeled: labeled.length,
          correct: labeled.filter((candidate) => candidate.humanLabel === "correct").length,
          incomplete: labeled.filter((candidate) => candidate.humanLabel === "incomplete").length,
          falsePositive: labeled.filter((candidate) => candidate.humanLabel === "false_positive").length,
          estimatedReviewMinutes: scenarios.reduce((total, candidate) => total + (candidate.reviewMinutes ?? 0), 0)
        }
      });
      return {
        registry: {
          ...registry,
          revision: registry.revision + 1,
          evaluations: registry.evaluations.map((candidate) => candidate.id === updated.id ? updated : candidate),
          updatedAt: judgment.reviewedAt
        },
        value: updated
      };
    });
  }

  async promotionRecommendation(installationId: string, now = new Date()): Promise<AppPromotionRecommendation> {
    const registry = await this.installationStore.read();
    requireInstallation(registry, installationId);
    return createPromotionRecommendation({ installationId, evaluations: registry.evaluations, now });
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

  private async loadInstallationArtifact(installation: WorkspaceAppInstallation): Promise<LoopPackLoadResult> {
    if (installation.derivation?.detachedAt && installation.derivation.snapshotPath) {
      const snapshotRoot = resolvePackFile(this.projectRoot, installation.derivation.snapshotPath);
      const loaded = await loadLoopPackDirectory(snapshotRoot);
      if (loaded.artifact.digest !== installation.artifactDigest) throw new Error("Detached app snapshot no longer matches its pinned digest");
      return loaded;
    }
    return this.marketplace.getAppArtifact(installation.appId, installation.version, installation.artifactDigest);
  }

  private async loadArtifactRevision(installation: WorkspaceAppInstallation, version: string, digest: string): Promise<LoopPackLoadResult> {
    if (installation.derivation?.detachedAt && installation.derivation.snapshotPath && version === installation.version && digest === installation.artifactDigest) {
      return this.loadInstallationArtifact(installation);
    }
    return this.marketplace.getAppArtifact(installation.appId, version, digest);
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

function appendHistory(
  installation: WorkspaceAppInstallation,
  actor: string,
  reason: WorkspaceAppInstallation["history"][number]["reason"],
  capturedAt: string
): WorkspaceAppInstallation["history"] {
  const snapshot: WorkspaceAppInstallation["history"][number] = {
    version: installation.version,
    artifactDigest: installation.artifactDigest,
    state: installation.state,
    mode: installation.mode,
    selectedModules: installation.selectedModules,
    presetId: installation.presetId,
    configuration: installation.configuration,
    overlay: installation.overlay,
    connectionBindings: installation.connectionBindings,
    fieldMappingIds: installation.fieldMappingIds,
    permissions: installation.permissions,
    ownedAssets: installation.ownedAssets,
    capturedAt,
    capturedBy: actor,
    reason
  };
  return [...installation.history.slice(-19), snapshot];
}

function lifecycleMutation(
  registry: AppInstallationRegistry,
  installation: WorkspaceAppInstallation,
  input: {
    action: AppLifecycleReceipt["action"];
    actor: string;
    reason: string;
    evidenceRetained: boolean;
    reversible: boolean;
    removedAssetIds?: string[];
    preservedSharedAssetIds?: string[];
    createdAt: string;
  },
  assets = registry.assets
) {
  const previous = requireInstallation(registry, installation.id);
  const resultingRevision = registry.revision + 1;
  const receipt = createLifecycleReceipt(registry, {
    installationId: installation.id,
    action: input.action,
    actor: input.actor,
    reason: input.reason,
    previousArtifactDigest: previous.artifactDigest,
    resultingArtifactDigest: installation.artifactDigest,
    removedAssetIds: input.removedAssetIds,
    preservedSharedAssetIds: input.preservedSharedAssetIds,
    evidenceRetained: input.evidenceRetained,
    reversible: input.reversible,
    createdAt: input.createdAt,
    resultingRevision
  });
  const nextRegistry: AppInstallationRegistry = {
    ...registry,
    revision: resultingRevision,
    installations: replaceInstallation(registry.installations, installation),
    assets,
    lifecycleReceipts: [...registry.lifecycleReceipts, receipt],
    updatedAt: input.createdAt
  };
  const lock = createInstallationLock(nextRegistry);
  return { registry: nextRegistry, lock, value: { installation, receipt, lock } };
}

function createLifecycleReceipt(registry: AppInstallationRegistry, input: {
  installationId: string;
  action: AppLifecycleReceipt["action"];
  actor: string;
  reason: string;
  previousArtifactDigest?: string;
  resultingArtifactDigest?: string;
  removedAssetIds?: string[];
  preservedSharedAssetIds?: string[];
  evidenceRetained: boolean;
  reversible: boolean;
  createdAt: string;
  resultingRevision: number;
}): AppLifecycleReceipt {
  return appLifecycleReceiptSchema.parse({
    schemaVersion: APP_INSTALL_SCHEMA_VERSION,
    id: `operation.${contentHash({
      workspaceId: registry.workspaceId,
      installationId: input.installationId,
      action: input.action,
      previousRevision: registry.revision,
      resultingRevision: input.resultingRevision,
      createdAt: input.createdAt
    })}`,
    workspaceId: registry.workspaceId,
    installationId: input.installationId,
    action: input.action,
    actor: input.actor,
    previousRevision: registry.revision,
    resultingRevision: input.resultingRevision,
    previousArtifactDigest: input.previousArtifactDigest,
    resultingArtifactDigest: input.resultingArtifactDigest,
    removedAssetIds: input.removedAssetIds ?? [],
    preservedSharedAssetIds: input.preservedSharedAssetIds ?? [],
    evidenceRetained: input.evidenceRetained,
    reversible: input.reversible,
    reason: input.reason,
    createdAt: input.createdAt
  });
}

function validateOverlayOperations(operations: AppOverlay["operations"], loaded: LoopPackLoadResult, fieldKeys: string[]): void {
  const fields = new Set(fieldKeys);
  const modules = new Set(loaded.manifest.modules.map((module) => module.id));
  for (const operation of operations) {
    if (operation.op === "set" || operation.op === "remove") {
      if (!operation.path.startsWith("/values/")) throw new Error(`Overlay path is not editable: ${operation.path}`);
      const key = decodePointerToken(operation.path.slice("/values/".length));
      if (!fields.has(key)) throw new Error(`Overlay configuration field does not exist: ${key}`);
    } else if (!modules.has(operation.moduleId)) {
      throw new Error(`Overlay module does not exist: ${operation.moduleId}`);
    }
  }
}

function applyModuleOverlay(
  modules: LoopPackLoadResult["manifest"]["modules"],
  selectedModules: string[],
  operations: AppOverlay["operations"]
): string[] {
  const selected = new Set(selectedModules);
  for (const operation of operations) {
    if (operation.op === "enable_module") selected.add(operation.moduleId);
    if (operation.op === "disable_module") selected.delete(operation.moduleId);
  }
  return resolveSelectedModules(modules, [...selected]);
}

function detectOverlayConflicts(
  overlay: AppOverlay | undefined,
  loaded: LoopPackLoadResult,
  nextValues: Record<string, unknown>
): AppUpdatePlan["merge"]["conflicts"] {
  if (!overlay) return [];
  const fields = new Set(Object.keys(nextValues));
  const modules = new Set(loaded.manifest.modules.map((module) => module.id));
  return overlay.operations.flatMap((operation) => {
    if (operation.op === "set" || operation.op === "remove") {
      const key = operation.path.startsWith("/values/") ? decodePointerToken(operation.path.slice("/values/".length)) : "";
      if (key && fields.has(key)) return [];
      return [{
        path: operation.path,
        ...(operation.op === "set" ? { overlayValue: operation.value } : {}),
        resolution: "unresolved" as const
      }];
    }
    if (modules.has(operation.moduleId)) return [];
    return [{ path: `/modules/${encodePointerToken(operation.moduleId)}`, overlayValue: operation.op === "enable_module", resolution: "unresolved" as const }];
  });
}

function comparePermissions(current: LoopPackLoadResult, next: LoopPackLoadResult): AppUpdatePlan["permissionChanges"] {
  const key = (permission: LoopPackLoadResult["manifest"]["permissions"][number]) => `${permission.capability}:${permission.authority}`;
  const currentByKey = new Map(current.manifest.permissions.map((permission) => [key(permission), permission]));
  const nextByKey = new Map(next.manifest.permissions.map((permission) => [key(permission), permission]));
  const riskRank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
  return Array.from(new Set([...currentByKey.keys(), ...nextByKey.keys()])).sort().map((permissionKey) => {
    const before = currentByKey.get(permissionKey);
    const after = nextByKey.get(permissionKey);
    const permission = after ?? before!;
    const change = !before
      ? "added" as const
      : !after
        ? "removed" as const
        : riskRank[after.risk] > riskRank[before.risk]
          ? "risk_increased" as const
          : riskRank[after.risk] < riskRank[before.risk]
            ? "risk_decreased" as const
            : "unchanged" as const;
    return {
      capability: permission.capability,
      authority: permission.authority,
      change,
      requiresReview: change === "added" || change === "risk_increased"
    };
  });
}

function difference(left: string[], right: string[]): string[] {
  const other = new Set(right);
  return Array.from(new Set(left.filter((value) => !other.has(value)))).sort();
}

function decodePointerToken(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function installationNamespace(installation: WorkspaceAppInstallation): string | undefined {
  return installation.derivation ? contentHash({ installationId: installation.id }).slice(0, 10) : undefined;
}

async function createInstallationArtifacts(
  compiled: Awaited<ReturnType<typeof compileLoopPack>>,
  packRoot: string,
  installationId: string,
  department: LoopPackLoadResult["manifest"]["metadata"]["department"],
  timestamp: string,
  namespace?: string
) {
  return Promise.all(compiled.loopSpecs.map(async (rawSpec) => {
    const { spec, fixtures } = await prepareInstalledSpec(rawSpec, packRoot, installationId, namespace);
    return createStoredLoopSpecArtifact({
      spec,
      entry: {
        id: spec.metadata.id,
        name: spec.metadata.name,
        path: path.join(".loopgraph", "apps", "installations", installationId, "generated", "loops", `${spec.metadata.id}.yaml`),
        templateId: compiled.appId,
        department,
        addedAt: timestamp
      },
      fixtures,
      source: "import",
      sourceRef: `${compiled.appId}@${compiled.version}#${compiled.artifactDigest}`,
      createdAt: timestamp
    });
  }));
}

function installationLoopIds(workspace: LoopgraphWorkspaceRegistry, installationId: string): string[] {
  const segment = `${path.sep}installations${path.sep}${installationId}${path.sep}`;
  return workspace.registeredSpecs.filter((entry) => {
    const normalized = path.resolve(workspace.projectRoot, entry.path);
    return normalized.includes(segment);
  }).map((entry) => entry.id).sort();
}

function ownershipFromCompiled(
  compiled: Awaited<ReturnType<typeof compileLoopPack>>,
  installationId: string,
  namespace?: string
): WorkspaceAppInstallation["ownedAssets"] {
  return compilePlannedAssets(compiled, installationId, namespace).filter((asset) => asset.action !== "reuse").map((asset) => ({
    assetId: asset.id,
    kind: asset.kind,
    ownerInstallationIds: [installationId],
    refCount: 1,
    shared: asset.shared,
    digest: asset.digest ?? canonicalAppDigest(asset)
  }));
}

function replaceOwnedAssets(
  assets: AppInstallationRegistry["assets"],
  installationId: string,
  replacement: WorkspaceAppInstallation["ownedAssets"]
): AppInstallationRegistry["assets"] {
  return mergeAssetOwnership(releaseOwnedAssets(assets, installationId).assets, replacement);
}

function releaseOwnedAssets(assets: AppInstallationRegistry["assets"], installationId: string): {
  assets: AppInstallationRegistry["assets"];
  removedAssetIds: string[];
  preservedSharedAssetIds: string[];
} {
  const removedAssetIds: string[] = [];
  const preservedSharedAssetIds: string[] = [];
  const next = assets.flatMap((asset) => {
    if (!asset.ownerInstallationIds.includes(installationId)) return [asset];
    const owners = asset.ownerInstallationIds.filter((owner) => owner !== installationId);
    if (owners.length === 0) {
      removedAssetIds.push(asset.assetId);
      return [];
    }
    preservedSharedAssetIds.push(asset.assetId);
    return [{ ...asset, ownerInstallationIds: owners, refCount: owners.length, shared: owners.length > 1 }];
  });
  return {
    assets: next.sort((left, right) => left.assetId.localeCompare(right.assetId)),
    removedAssetIds: removedAssetIds.sort(),
    preservedSharedAssetIds: preservedSharedAssetIds.sort()
  };
}

function compilePlannedAssets(compiled: Awaited<ReturnType<typeof compileLoopPack>>, installationId: string, namespace?: string): AppInstallPlan["assets"] {
  const assets: AppInstallPlan["assets"] = [
    ...compiled.loopSpecs.map((spec) => ({ id: `loop.${spec.metadata.id}`, kind: "loop_spec" as const, action: "create" as const, digest: canonicalAppDigest(spec), shared: false, sourcePath: `loops/${spec.metadata.id}.yaml`, dependencies: [] })),
    ...compiled.skills.map((skill) => ({ id: `skill.${skill.id}`, kind: "hermes_skill" as const, action: "create" as const, digest: canonicalAppDigest(skill), shared: false, dependencies: [] })),
    ...compiled.routingCards.map((card) => ({ id: `routing.${card.loopId}`, kind: "routing_card" as const, action: "create" as const, digest: canonicalAppDigest(card), shared: false, dependencies: [`loop.${card.loopId}`] })),
    ...compiled.graph.nodes.filter((node) => node.installationScoped).map((node) => ({ id: `graph-node.${node.id}`, kind: "graph_node" as const, action: "create" as const, digest: canonicalAppDigest(node), shared: false, dependencies: node.parentId ? [`graph-node.${node.parentId}`] : [] })),
    ...compiled.graph.edges.map((edge) => ({ id: `graph-edge.${edge.id}`, kind: "graph_edge" as const, action: "create" as const, digest: canonicalAppDigest(edge), shared: false, dependencies: [`graph-node.${edge.source}`, `graph-node.${edge.target}`] })),
    { id: `receipt.${installationId}`, kind: "event_contract" as const, action: "create" as const, digest: canonicalAppDigest({ installationId, compiled: compiled.artifactDigest }), shared: false, dependencies: [] }
  ];
  if (!namespace) return assets;
  const scopedIds = new Map(assets.map((asset) => [asset.id, `asset.${contentHash({ namespace, assetId: asset.id }).slice(0, 32)}`]));
  return assets.map((asset) => ({
    ...asset,
    id: scopedIds.get(asset.id)!,
    dependencies: asset.dependencies.map((dependency) => scopedIds.get(dependency) ?? dependency)
  }));
}

async function prepareInstalledSpec(specInput: Awaited<ReturnType<typeof compileLoopPack>>["loopSpecs"][number], packRoot: string, installationId: string, namespace?: string) {
  const fixtureEntries = await Promise.all((specInput.input.fixtures ?? []).map(async (fixture) => {
    const sourcePath = resolvePackFile(packRoot, fixture.path);
    return { fixture, value: JSON.parse(await readFile(sourcePath, "utf8")) as unknown };
  }));
  const fixtures = Object.fromEntries(fixtureEntries.map(({ fixture, value }) => [`fixtures/${path.basename(fixture.path)}`, value]));
  const spec = {
    ...specInput,
    metadata: {
      ...specInput.metadata,
      id: namespace ? `${specInput.metadata.id}.${namespace}` : specInput.metadata.id,
      labels: { ...specInput.metadata.labels, installationId, upstreamLoopId: specInput.metadata.id, lifecycleStatus: "draft" }
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
