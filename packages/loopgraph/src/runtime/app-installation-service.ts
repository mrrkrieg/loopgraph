import { cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  APP_ACTIVATION_APPROVAL_SCHEMA_VERSION,
  APP_EVAL_SCHEMA_VERSION,
  APP_INSTALL_SCHEMA_VERSION,
  APP_OPERATION_RESOLUTION_SCHEMA_VERSION,
  appActivationApprovalReceiptSchema,
  appIdSchema,
  appEvalJudgmentSchema,
  appEvalRunSchema,
  appHistoricalReplayRequestSchema,
  appInstallPlanSchema,
  appInstallationLockSchema,
  appLifecycleReceiptSchema,
  appOverlaySchema,
  appOperationResolutionSchema,
  appReadinessSchema,
  appUpdatePlanSchema,
  canonicalAppDigest,
  contentHash,
  loopSpecVersionHash,
  type AppConfigField,
  type AppConnectorOperationBinding,
  type AppConfiguration,
  type AppActivationApprovalReceipt,
  type AppEvalRun,
  type AppEvalJudgment,
  type AppHistoricalReplayRequest,
  type AppInstallPlan,
  type AppInstallationLock,
  type AppLifecycleReceipt,
  type AppOverlay,
  type AppOperationResolution,
  type AppReadiness,
  type AppPromotionRecommendation,
  type AppRolloutMode,
  type AppUpdatePlan,
  type ConnectionInstance,
  type ConnectorFieldMapping,
  type CompanyContext,
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
  type ConnectorFieldMappingStore,
  FileConnectorFieldMappingStore
} from "./app-connector-service";
import { LocalAppMarketplace } from "./app-marketplace";
import {
  FileCompanyContextStore,
  resolveAppConfiguration,
  type CompanyContextStore
} from "./company-context-service";
import {
  FileLoopSpecRegistryStore,
  createStoredLoopSpecArtifact,
  type LoopSpecRegistryStore
} from "./loop-spec-store";
import {
  type LoopgraphWorkspaceRegistry
} from "./workspace";
import {
  APP_LIFECYCLE_OPERATION_LIMIT,
  FileAppInstallationStore,
  appLifecycleOperationSchema,
  type AppInstallationRegistry,
  type AppInstallationStore,
  type AppLifecycleOperation
} from "./app-installation-store";
import {
  createPromotionRecommendation,
  runAppHistoricalReplay,
  runAppSyntheticConformance
} from "./app-quality-engine";
import { assertSecretFree } from "./secret-redaction";

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

export type ApproveAppActivationInput = {
  installationId: string;
  mode: Extract<AppRolloutMode, "shadow" | "recommend" | "execute_with_approval">;
  approvedBy: string;
  reason: string;
  evidenceRefs?: string[];
  expiresInSeconds?: number;
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

export type ResolveAppOperationInput = {
  installationId: string;
  loopId: string;
  capability: string;
  now?: Date;
};

export type AppLifecycleMutationResult = {
  installation?: WorkspaceAppInstallation;
  receipt: AppLifecycleReceipt;
  lock: AppInstallationLock;
};

type PrepareLifecycleOperationInput = Omit<AppLifecycleOperation, "status" | "startedAt" | "updatedAt" | "completedAt" | "resultReceiptId" | "failureCode"> & {
  now: Date;
};

export class AppInstallationService {
  private readonly installationStore: AppInstallationStore;
  private readonly contextStore: CompanyContextStore;
  private readonly mappingStore: ConnectorFieldMappingStore;
  private readonly loopSpecStore: LoopSpecRegistryStore;

  constructor(
    private readonly marketplace: LocalAppMarketplace,
    private readonly projectRoot: string,
    private readonly workspaceId: string,
    private readonly companyId: string,
    dependencies: {
      installationStore?: AppInstallationStore;
      contextStore?: CompanyContextStore;
      mappingStore?: ConnectorFieldMappingStore;
      loopSpecStore?: LoopSpecRegistryStore;
    } = {}
  ) {
    const appsRoot = path.join(path.resolve(projectRoot), ".loopgraph", "apps");
    this.installationStore = dependencies.installationStore ?? new FileAppInstallationStore(appsRoot, workspaceId);
    this.contextStore = dependencies.contextStore ?? new FileCompanyContextStore(path.join(appsRoot, "company-context.json"));
    this.mappingStore = dependencies.mappingStore ?? new FileConnectorFieldMappingStore(path.join(appsRoot, "field-mappings.json"), workspaceId);
    this.loopSpecStore = dependencies.loopSpecStore ?? new FileLoopSpecRegistryStore(projectRoot);
  }

  private async prepareLifecycleOperation(input: PrepareLifecycleOperationInput): Promise<AppLifecycleOperation> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const existing = registry.lifecycleOperations.find((operation) => operation.id === input.id);
      if (existing) {
        assertSameLifecycleOperation(existing, input);
        if (existing.status !== "requires_reconciliation") return { registry, value: existing };
        const resumed = appLifecycleOperationSchema.parse({
          ...existing,
          status: "prepared",
          failureCode: undefined,
          updatedAt: input.now.toISOString()
        });
        const nextRegistry: AppInstallationRegistry = {
          ...registry,
          revision: registry.revision + 1,
          lifecycleOperations: replaceLifecycleOperation(registry.lifecycleOperations, resumed),
          updatedAt: resumed.updatedAt
        };
        return {
          registry: nextRegistry,
          lock: createInstallationLock(nextRegistry),
          value: resumed
        };
      }
      const conflicting = registry.lifecycleOperations.find((operation) =>
        operation.installationId === input.installationId && operation.status !== "completed");
      if (conflicting) {
        throw new Error(`App lifecycle operation ${conflicting.id} requires reconciliation before another operation can start`);
      }
      const timestamp = input.now.toISOString();
      const { now: _now, ...operationInput } = input;
      void _now;
      assertSecretFree(operationInput, "app_lifecycle_operation");
      const operation = appLifecycleOperationSchema.parse({
        ...operationInput,
        status: "prepared",
        startedAt: timestamp,
        updatedAt: timestamp
      });
      const nextRegistry: AppInstallationRegistry = {
        ...registry,
        revision: registry.revision + 1,
        lifecycleOperations: retainLifecycleOperations([...registry.lifecycleOperations, operation]),
        updatedAt: timestamp
      };
      return {
        registry: nextRegistry,
        lock: createInstallationLock(nextRegistry),
        value: operation
      };
    });
  }

  private async markLifecycleOperationInterrupted(operationId: string, now: Date): Promise<void> {
    try {
      await this.installationStore.withExclusiveUpdate(async (registry) => {
        const operation = registry.lifecycleOperations.find((candidate) => candidate.id === operationId);
        if (!operation || operation.status === "completed") return { registry, value: undefined };
        const interrupted = appLifecycleOperationSchema.parse({
          ...operation,
          status: "requires_reconciliation",
          failureCode: "operation_interrupted",
          updatedAt: now.toISOString()
        });
        const nextRegistry: AppInstallationRegistry = {
          ...registry,
          revision: registry.revision + 1,
          lifecycleOperations: replaceLifecycleOperation(registry.lifecycleOperations, interrupted),
          updatedAt: interrupted.updatedAt
        };
        return {
          registry: nextRegistry,
          lock: createInstallationLock(nextRegistry),
          value: undefined
        };
      });
    } catch {
      // A process or database failure can also prevent this best-effort marker.
      // The durable prepared record remains the recovery signal in that case.
    }
  }

  async plan(input: PlanAppInstallationInput, options: { replacingInstallationId?: string } = {}): Promise<AppInstallPlan> {
    this.assertTenant(input);
    const now = input.now ?? new Date();
    const version = await this.marketplace.resolveAppVersion(input.appId, input.versionRange ?? "latest");
    const loaded = await this.marketplace.getAppArtifact(input.appId, version.version, version.digest);
    const selectedModules = resolveSelectedModules(loaded.manifest.modules, input.selectedModules);
    const compiled = await compileLoopPack(loaded, { selectedModules });
    const activeCapabilities = compiledCapabilityKeys(compiled);
    const preset = loaded.manifest.presets.find((candidate) => candidate.id === input.presetId);
    if (!preset) throw new Error(`Preset ${input.presetId} does not exist in ${input.appId}@${version.version}`);
    const recipes = await loadConnectorRecipes(loaded);
    const presetDocument = await readPackYaml(loaded.root, preset.path);
    const selectedRecipeId = isRecord(presetDocument) && typeof presetDocument.recipe === "string"
      ? presetDocument.recipe
      : preset.id;
    const capabilityResolutions = resolveConnectorCapabilities({
      requiredCapabilities: loaded.manifest.requiredCapabilities.filter((capability) => activeCapabilities.has(capability)),
      optionalCapabilities: loaded.manifest.optionalCapabilities.filter((capability) => activeCapabilities.has(capability)),
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
    const candidateAssets: AppInstallPlan["assets"] = [
      ...compilePlannedAssets(compiled, installationId),
      ...capabilityResolutions.flatMap((resolution) => resolution.connectionId && isExecutableCapabilityResolution(resolution) ? [{
        id: `connection-binding.${contentHash({ capability: resolution.capability, connectionId: resolution.connectionId }).slice(0, 32)}`,
        kind: "connection_binding" as const,
        action: "reuse" as const,
        digest: canonicalAppDigest({
          capability: resolution.capability,
          connectionId: resolution.connectionId,
          recipeId: resolution.recipeId,
          providerId: resolution.providerId,
          providerOperation: resolution.providerOperation,
          operation: resolution.operation,
          executor: resolution.executor,
          brokerCapability: resolution.brokerCapability,
          minimumScopes: resolution.minimumScopes
        }),
        shared: true,
        dependencies: []
      }] : []),
      ...selectedMappings.map((mapping) => ({
        id: `field-mapping.${mapping.id}`,
        kind: "field_mapping" as const,
        action: "reuse" as const,
        digest: fieldMappingAssetDigest(mapping),
        shared: true,
        dependencies: []
      }))
    ];
    const existingRegistry = await this.installationStore.read();
    const existingAssetById = new Map(existingRegistry.assets.map((asset) => [asset.assetId, asset]));
    const conflicts: AppInstallPlan["conflicts"] = [];
    const assets = candidateAssets.map((asset): AppInstallPlan["assets"][number] => {
      const existing = existingAssetById.get(asset.id);
      if (!existing) return asset;
      if (existing.digest === asset.digest) return { ...asset, action: "reuse", shared: true };
      if (options.replacingInstallationId && existing.ownerInstallationIds.every((ownerId) => ownerId === options.replacingInstallationId)) {
        return { ...asset, action: "update" };
      }
      const kind = asset.kind === "loop_spec"
        ? "duplicate_loop" as const
        : asset.kind === "graph_node" && asset.shared
          ? "shared_company_object" as const
          : asset.kind === "graph_node" || asset.kind === "graph_edge"
            ? "graph" as const
            : "asset_contract" as const;
      conflicts.push({
        kind,
        resourceId: asset.id,
        reason: installAssetConflictReason(kind),
        currentDigest: existing.digest,
        proposedDigest: asset.digest,
        blocking: true
      });
      return { ...asset, action: "update" };
    });
    const installationScopedGraphNodes = compiled.graph.nodes.filter((node) => node.installationScoped);
    const plannedAssetById = new Map(assets.map((asset) => [asset.id, asset]));
    const permissions = loaded.manifest.permissions.filter((permission) => activeCapabilities.has(permission.capability)).map((permission) => ({
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
      capabilityResolutions: capabilityResolutions.map((resolution) => ({
        capability: resolution.capability,
        required: resolution.required,
        connectionId: resolution.connectionId,
        recipeId: resolution.recipeId,
        providerId: resolution.providerId,
        providerOperation: resolution.providerOperation,
        operation: resolution.operation,
        executor: resolution.executor,
        brokerCapability: resolution.brokerCapability,
        minimumScopes: resolution.minimumScopes,
        status: resolution.status,
        reason: resolution.reason
      })),
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
        nodesAdded: installationScopedGraphNodes
          .filter((node) => plannedAssetById.get(`graph-node.${node.id}`)?.action === "create")
          .map((node) => node.id),
        nodesReused: [
          ...compiled.graph.nodes.filter((node) => !node.installationScoped),
          ...installationScopedGraphNodes.filter((node) => plannedAssetById.get(`graph-node.${node.id}`)?.action === "reuse")
        ].map((node) => node.id),
        edgesAdded: compiled.graph.edges
          .filter((edge) => plannedAssetById.get(`graph-edge.${edge.id}`)?.action === "create")
          .map((edge) => edge.id),
        edgesRemoved: []
      },
      conflicts,
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
    const installationId = installationIdFor(this.workspaceId, plan.appId);
    const operationId = lifecycleOperationId("install", installationId, plan.artifactDigest, plan.planDigest);
    if (Date.parse(plan.expiresAt) <= now.getTime()) {
      const registry = await this.installationStore.read();
      const recovery = registry.lifecycleOperations.find((operation) => operation.id === operationId);
      if (!recovery || recovery.status === "completed") throw new Error("Install plan expired; create a fresh content-bound plan");
    }
    const blockers = installPlanBlockers(plan);
    if (blockers.length > 0) throw new Error(`Install plan is not ready:\n- ${blockers.join("\n- ")}`);
    const loaded = await this.marketplace.getAppArtifact(plan.appId, plan.version, plan.artifactDigest);
    const compiled = await compileLoopPack(loaded, { selectedModules: plan.selectedModules });
    assertPlanMatchesCompiledComposition(plan, compiled, installationId);
    const loopIds = compiled.loopSpecs.map((spec) => spec.metadata.id);
    const contextKeys = companyContextKeys(plan.configuration);
    if (contextKeys.length > 0) {
      const plannedContext = await this.contextStore.get(this.workspaceId, this.companyId);
      assertCompanyContextStillMatches(plan.configuration, plannedContext);
    }
    const operation = await this.prepareLifecycleOperation({
      id: operationId,
      idempotencyKey: plan.planDigest,
      installationId,
      appId: plan.appId,
      action: "install",
      targetArtifactDigest: plan.artifactDigest,
      desired: {
        loopIds,
        fieldMappingIds: plan.fieldMappingIds,
        companyContextKeys: contextKeys
      },
      actor,
      now
    });
    if (operation.status === "completed") {
      const registry = await this.installationStore.read();
      const existing = requireInstallation(registry, installationId);
      return { installation: existing, lock: createInstallationLock(registry), loopIds, created: false };
    }
    try {
      return await this.installationStore.withExclusiveUpdate<ApplyAppInstallationResult>(async (registry) => {
        const existing = registry.installations.find((installation) => installation.id === installationId);
        if (existing) {
          if (existing.artifactDigest !== plan.artifactDigest) throw new Error("App is already installed at a different immutable version; use upgrade");
          if (canonicalAppDigest(existing.selectedModules) !== canonicalAppDigest(plan.selectedModules)) {
            throw new Error("App is already installed with a different module composition; use a reviewed module overlay");
          }
          const completedRegistry = completeLifecycleOperation({
            ...registry,
            revision: registry.revision + 1,
            onboardingDrafts: registry.onboardingDrafts.filter((draft) => draft.appId !== plan.appId),
            updatedAt: now.toISOString()
          }, operation.id, now);
          const lock = createInstallationLock(completedRegistry);
          return { registry: completedRegistry, lock, value: { installation: existing, lock, loopIds, created: false } };
        }

        const context = contextKeys.length > 0
          ? await this.contextStore.get(this.workspaceId, this.companyId)
          : undefined;
        if (context) assertCompanyContextStillMatches(plan.configuration, context);
        const timestamp = now.toISOString();
        const ownedAssets = plan.assets.filter((asset) => !["retain", "remove"].includes(asset.action)).map((asset) => ({
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
          connectionBindings: connectionBindingsFromPlan(plan.capabilityResolutions),
          operationBindings: operationBindingsFromPlan(plan.capabilityResolutions),
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
          onboardingDrafts: registry.onboardingDrafts.filter((draft) => draft.appId !== plan.appId),
          updatedAt: timestamp
        };
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
        if (plan.fieldMappingIds.length > 0) {
          await this.mappingStore.attachInstallation(plan.fieldMappingIds, installationId);
        }
        if (context && contextKeys.length > 0) {
          await this.contextStore.attachConsumer({
            workspaceId: this.workspaceId,
            companyId: this.companyId,
            contextKeys,
            installationId,
            expectedRevision: context.revision,
            actor,
            now
          });
        }
        const completedRegistry = completeLifecycleOperation(nextRegistry, operation.id, now);
        const lock = createInstallationLock(completedRegistry);
        return { registry: completedRegistry, lock, value: { installation, lock, loopIds, created: true } };
      });
    } catch (error) {
      await this.markLifecycleOperationInterrupted(operation.id, now);
      throw error;
    }
  }

  async configure(input: ConfigureAppInstallationInput): Promise<AppLifecycleMutationResult> {
    const now = input.now ?? new Date();
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireOperableInstallation(registry, input.installationId);
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
      const installation = requireOperableInstallation(registry, input.installationId);
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
      const compiled = await compileLoopPack(loaded, { selectedModules });
      const activeCapabilities = assertInstalledCompositionAuthority(compiled, installation);
      const configuration = resolveAppConfiguration({
        appId: installation.appId,
        version: installation.version,
        fields: installation.configuration.fields,
        installValues: installation.configuration.values,
        overlay,
        now
      }).configuration;
      const namespace = installationNamespace(installation);
      const artifacts = await createInstallationArtifacts(compiled, loaded.root, installation.id, loaded.manifest.metadata.department, timestamp, namespace);
      const ownedAssets = ownershipFromCompiled(compiled, installation.id, namespace, installation.ownedAssets);
      for (const asset of ownedAssets) {
        const existing = registry.assets.find((candidate) => candidate.assetId === asset.assetId);
        if (existing && existing.digest !== asset.digest && existing.ownerInstallationIds.some((ownerId) => ownerId !== installation.id)) {
          throw new Error(`Module composition conflicts with shared asset ${asset.assetId}; create a fresh install plan`);
        }
      }
      const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
      const existingLoopIds = installationLoopIds(workspaceSnapshot.workspace, installation.id);
      const nextLoopIds = new Set(artifacts.map((artifact) => artifact.loopId));
      await this.loopSpecStore.commitMaterializationAtomically({
        commitId: `app-overlay-${overlay.id}`,
        idempotencyKey: canonicalAppDigest({ action: "overlay", installationId: installation.id, overlay }),
        expectedRevision: workspaceSnapshot.revision,
        projectRoot: this.projectRoot,
        committedAt: timestamp,
        artifacts,
        removeLoopIds: existingLoopIds.filter((loopId) => !nextLoopIds.has(loopId))
      });
      const updated: WorkspaceAppInstallation = {
        ...installation,
        overlay,
        selectedModules,
        configuration,
        permissions: installation.permissions.filter((permission) => activeCapabilities.has(permission.capability)),
        ownedAssets,
        state: "ready_to_test",
        mode: "simulation",
        history: appendHistory(installation, input.actor, "overlay", timestamp),
        updatedAt: timestamp,
        failureReason: undefined
      };
      return lifecycleMutation(registry, updated, {
        action: "overlay",
        actor: input.actor,
        reason: "Applied the version-bound overlay and atomically rematerialized the selected module composition without mutating the pinned LoopPack.",
        evidenceRetained: true,
        reversible: true,
        removedAssetIds: installation.ownedAssets.filter((asset) => !ownedAssets.some((next) => next.assetId === asset.assetId)).map((asset) => asset.assetId),
        createdAt: timestamp
      }, replaceOwnedAssets(registry.assets, installation.id, ownedAssets));
    });
  }

  async repair(installationId: string, actor: string, now = new Date()): Promise<AppLifecycleMutationResult> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireOperableInstallation(registry, installationId);
      const loaded = await this.loadInstallationArtifact(installation);
      const compiled = await compileLoopPack(loaded, { selectedModules: installation.selectedModules });
      const activeCapabilities = assertInstalledCompositionAuthority(compiled, installation);
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
      const ownedAssets = ownershipFromCompiled(compiled, installation.id, namespace, installation.ownedAssets);
      const updated: WorkspaceAppInstallation = {
        ...installation,
        state: "ready_to_test",
        mode: "simulation",
        permissions: installation.permissions.filter((permission) => activeCapabilities.has(permission.capability)),
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
      const source = requireOperableInstallation(registry, input.installationId);
      if (registry.installations.some((installation) => installation.derivation?.derivedAppId === derivedAppId)) {
        throw new Error(`Private derived app already exists: ${derivedAppId}`);
      }
      const timestamp = now.toISOString();
      const installationId = installationIdFor(this.workspaceId, `${source.appId}:${derivedAppId}`);
      const loaded = await this.loadInstallationArtifact(source);
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
      const compiled = await compileLoopPack(loaded, { selectedModules });
      const activeCapabilities = assertInstalledCompositionAuthority(compiled, source);
      const configuration = resolveAppConfiguration({
        appId: source.appId,
        version: source.version,
        fields: source.configuration.fields,
        installValues: source.configuration.values,
        overlay,
        now
      }).configuration;
      const artifacts = await createInstallationArtifacts(compiled, loaded.root, installationId, loaded.manifest.metadata.department, timestamp, namespace);
      const contextKeys = companyContextKeys(source.configuration);
      const context = contextKeys.length > 0
        ? await this.contextStore.get(this.workspaceId, this.companyId)
        : undefined;
      if (context) assertCompanyContextStillMatches(source.configuration, context);
      const workspaceSnapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
      await this.loopSpecStore.commitMaterializationAtomically({
        commitId: `app-duplicate-${contentHash({ installationId, timestamp })}`,
        idempotencyKey: canonicalAppDigest({ action: "duplicate", installationId, digest: source.artifactDigest, timestamp }),
        expectedRevision: workspaceSnapshot.revision,
        projectRoot: this.projectRoot,
        committedAt: timestamp,
        artifacts
      });
      const ownedAssets = ownershipFromCompiled(compiled, installationId, namespace, source.ownedAssets);
      const duplicate: WorkspaceAppInstallation = {
        ...source,
        id: installationId,
        state: "ready_to_test",
        mode: "simulation",
        selectedModules,
        configuration,
        permissions: source.permissions.filter((permission) => activeCapabilities.has(permission.capability)),
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
      if (duplicate.fieldMappingIds.length > 0) {
        await this.mappingStore.attachInstallation(duplicate.fieldMappingIds, installationId);
      }
      if (context && contextKeys.length > 0) {
        await this.contextStore.attachConsumer({
          workspaceId: this.workspaceId,
          companyId: this.companyId,
          contextKeys,
          installationId,
          expectedRevision: context.revision,
          actor: input.actor,
          now
        });
      }
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
    }, { replacingInstallationId: installation.id });
    if (baseInstallPlan.artifactDigest === installation.artifactDigest) {
      throw new Error(`${installation.appId} is already pinned to the selected immutable version`);
    }
    const [currentLoaded, nextLoaded] = await Promise.all([
      this.loadInstallationArtifact(installation),
      this.marketplace.getAppArtifact(baseInstallPlan.appId, baseInstallPlan.version, baseInstallPlan.artifactDigest)
    ]);
    const [currentCompiled, nextCompiled] = await Promise.all([
      compileLoopPack(currentLoaded, { selectedModules: installation.selectedModules }),
      compileLoopPack(nextLoaded, { selectedModules: baseInstallPlan.selectedModules })
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
      const installation = requireOperableInstallation(registry, plan.installationId);
      if (installation.version !== plan.fromVersion || installation.artifactDigest !== plan.fromDigest) {
        throw new Error("Installed app changed after the update plan was created");
      }
      const loaded = await this.marketplace.getAppArtifact(installation.appId, plan.toVersion, plan.toDigest);
      const compiled = await compileLoopPack(loaded, { selectedModules: plan.baseInstallPlan.selectedModules });
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
      const reusableOwnership = plan.baseInstallPlan.assets
        .filter((asset) => asset.action === "reuse" && ["connection_binding", "field_mapping"].includes(asset.kind))
        .map((asset) => ({
          assetId: asset.id,
          kind: asset.kind,
          ownerInstallationIds: [installation.id],
          refCount: 1,
          shared: true,
          digest: asset.digest ?? canonicalAppDigest(asset)
        }));
      const ownedAssets = ownershipFromCompiled(compiled, installation.id, namespace, reusableOwnership);
      const updated: WorkspaceAppInstallation = {
        ...installation,
        version: plan.toVersion,
        artifactDigest: plan.toDigest,
        state: "ready_to_test",
        mode: "simulation",
        configuration,
        overlay,
        connectionBindings: connectionBindingsFromPlan(plan.baseInstallPlan.capabilityResolutions),
        operationBindings: operationBindingsFromPlan(plan.baseInstallPlan.capabilityResolutions),
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
      const installation = requireOperableInstallation(registry, installationId);
      if (installation.artifactDigest !== expectedArtifactDigest) throw new Error("Installed app changed; create a fresh rollback request");
      const revision = installation.history.at(-1);
      if (!revision) throw new Error("No reversible installed-app revision is available");
      const loaded = await this.loadArtifactRevision(installation, revision.version, revision.artifactDigest);
      const compiled = await compileLoopPack(loaded, { selectedModules: revision.selectedModules });
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
        operationBindings: revision.operationBindings,
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
    const installation = requireOperableInstallation(registry, installationId);
    if (!installation.derivation) throw new Error("Only a private derived app can detach from upstream");
    if (installation.derivation.detachedAt) throw new Error("Private app is already detached from upstream");
    if (installation.artifactDigest !== expectedArtifactDigest) throw new Error("Installed app changed; create a fresh detach request");
    const loaded = await this.loadInstallationArtifact(installation);
    const timestamp = now.toISOString();
    const snapshotPath = path.join(".loopgraph", "apps", "private-snapshots", installation.derivation.derivedAppId, installation.version);
    await cp(loaded.root, path.join(this.projectRoot, snapshotPath), { recursive: true, force: true });
    return this.installationStore.withExclusiveUpdate(async (current) => {
      const fresh = requireOperableInstallation(current, installationId);
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
    const observedRegistry = await this.installationStore.read();
    const observedInstallation = observedRegistry.installations.find((candidate) => candidate.id === input.installationId);
    if (!observedInstallation) {
      const completed = [...observedRegistry.lifecycleOperations]
        .reverse()
        .find((candidate) =>
          candidate.action === "uninstall"
          && candidate.installationId === input.installationId
          && candidate.targetArtifactDigest === input.expectedArtifactDigest
          && candidate.status === "completed");
      const receipt = completed?.resultReceiptId
        ? observedRegistry.lifecycleReceipts.find((candidate) => candidate.id === completed.resultReceiptId)
        : undefined;
      if (!receipt) throw new Error(`App installation not found: ${input.installationId}`);
      return { receipt, lock: createInstallationLock(observedRegistry) };
    }
    if (observedInstallation.artifactDigest !== input.expectedArtifactDigest) throw new Error("Installed app changed; create a fresh uninstall request");
    const idempotencyKey = canonicalAppDigest({
      action: "uninstall",
      workspaceId: this.workspaceId,
      installationId: input.installationId,
      artifactDigest: input.expectedArtifactDigest,
      installedAt: observedInstallation.installedAt
    });
    const operationId = lifecycleOperationId("uninstall", input.installationId, input.expectedArtifactDigest, idempotencyKey);
    const existingOperation = observedRegistry.lifecycleOperations.find((candidate) => candidate.id === operationId);
    if (existingOperation?.status === "completed") {
      const receipt = existingOperation.resultReceiptId
        ? observedRegistry.lifecycleReceipts.find((candidate) => candidate.id === existingOperation.resultReceiptId)
        : undefined;
      if (!receipt) throw new Error("Completed uninstall operation is missing its durable lifecycle receipt");
      return { receipt, lock: createInstallationLock(observedRegistry) };
    }
    const observedWorkspace = await this.loopSpecStore.getWorkspace(this.projectRoot);
    const operation = await this.prepareLifecycleOperation({
      id: operationId,
      idempotencyKey,
      installationId: observedInstallation.id,
      appId: observedInstallation.appId,
      action: "uninstall",
      targetArtifactDigest: observedInstallation.artifactDigest,
      desired: existingOperation?.desired ?? {
        loopIds: installationLoopIds(observedWorkspace.workspace, observedInstallation.id),
        fieldMappingIds: observedInstallation.fieldMappingIds,
        companyContextKeys: companyContextKeys(observedInstallation.configuration)
      },
      actor: input.actor,
      now
    });
    try {
      return await this.installationStore.withExclusiveUpdate(async (registry) => {
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
            commitId: operation.id,
            idempotencyKey: operation.idempotencyKey,
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
        const nextRegistry = completeLifecycleOperation({
          ...registry,
          revision: nextRevision,
          installations: registry.installations.filter((candidate) => candidate.id !== installation.id),
          assets,
          lifecycleReceipts: [...registry.lifecycleReceipts, receipt],
          updatedAt: timestamp
        }, operation.id, now, receipt.id);
        const lock = createInstallationLock(nextRegistry);
        return { registry: nextRegistry, lock, value: { receipt, lock } };
      });
    } catch (error) {
      await this.markLifecycleOperationInterrupted(operation.id, now);
      throw error;
    }
  }

  async test(installationId: string, actor: string, now = new Date()): Promise<AppEvalRun> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireOperableInstallation(registry, installationId);
      if (!["ready_to_test", "simulation_passed", "shadow", "rolled_back"].includes(installation.state)) {
        throw new Error(`App cannot run synthetic conformance tests from ${installation.state}`);
      }
      const loaded = await this.loadInstallationArtifact(installation);
      const compiled = await compileLoopPack(loaded, { selectedModules: installation.selectedModules });
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
      const installation = requireOperableInstallation(registry, request.installationId);
      const passedSynthetic = [...registry.evaluations].reverse().find((run) =>
        run.installationId === installation.id && run.level === "synthetic" && run.status === "passed");
      if (!passedSynthetic) throw new Error("Historical replay requires a passing synthetic conformance run");
      if (["revoked", "uninstalling", "rolled_back", "broken"].includes(installation.state)) {
        throw new Error(`Historical replay is unavailable while the app is ${installation.state}`);
      }
      const loaded = await this.loadInstallationArtifact(installation);
      const compiled = await compileLoopPack(loaded, { selectedModules: installation.selectedModules });
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

  async diff(installationId: string): Promise<{
    installationId: string;
    base: { appId: string; version: string; artifactDigest: string };
    derivation?: WorkspaceAppInstallation["derivation"];
    overlay?: AppOverlay;
    effectiveConfigurationDigest: string;
    selectedModules: string[];
    history: WorkspaceAppInstallation["history"];
    updateAvailable?: { version: string; artifactDigest: string };
  }> {
    const registry = await this.installationStore.read();
    const installation = requireInstallation(registry, installationId);
    let updateAvailable: { version: string; artifactDigest: string } | undefined;
    if (!installation.derivation?.detachedAt) {
      const latest = await this.marketplace.resolveAppVersion(installation.appId, "latest");
      if (latest.digest !== installation.artifactDigest) updateAvailable = { version: latest.version, artifactDigest: latest.digest };
    }
    return {
      installationId,
      base: { appId: installation.appId, version: installation.version, artifactDigest: installation.artifactDigest },
      derivation: installation.derivation,
      overlay: installation.overlay,
      effectiveConfigurationDigest: canonicalAppDigest(installation.configuration),
      selectedModules: installation.selectedModules,
      history: installation.history,
      updateAvailable
    };
  }

  async approveActivation(input: ApproveAppActivationInput): Promise<AppActivationApprovalReceipt> {
    const now = input.now ?? new Date();
    const expiresInSeconds = input.expiresInSeconds ?? 900;
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) {
      throw new Error("Activation approval expiry must be between 60 and 3600 seconds");
    }
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireOperableInstallation(registry, input.installationId);
      assertLifecycleTransition(installation.state, input.mode, input.mode);
      const latestPassed = [...registry.evaluations].reverse().find((run) => run.installationId === installation.id && run.status === "passed");
      if (!latestPassed) throw new Error("App must pass conformance before activation");
      if (input.mode === "execute_with_approval" && installation.permissions.some((permission) => permission.authority === "execute" && permission.decision === "allow")) {
        throw new Error("Execute-with-approval mode cannot contain an unapproved execute permission");
      }
      const approvedAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
      const approvalContent = {
        workspaceId: registry.workspaceId,
        installationId: installation.id,
        appId: installation.appId,
        artifactDigest: installation.artifactDigest,
        fromState: installation.state,
        requestedMode: input.mode,
        approvedBy: input.approvedBy,
        reason: input.reason,
        evidenceRefs: input.evidenceRefs ?? [],
        approvedAt,
        expiresAt
      } as const;
      const immutable = {
        schemaVersion: APP_ACTIVATION_APPROVAL_SCHEMA_VERSION,
        id: `activation-approval.${contentHash(approvalContent)}`,
        ...approvalContent
      } as const;
      const receipt = appActivationApprovalReceiptSchema.parse({
        ...immutable,
        approvalDigest: canonicalAppDigest(immutable)
      });
      const nextRegistry: AppInstallationRegistry = {
        ...registry,
        revision: registry.revision + 1,
        activationApprovals: [...registry.activationApprovals, receipt],
        updatedAt: approvedAt
      };
      return {
        registry: nextRegistry,
        lock: createInstallationLock(nextRegistry),
        audit: {
          actor: input.approvedBy,
          action: "app.activation.approved" as const,
          targetType: "app_activation_approval" as const,
          targetId: receipt.id,
          metadata: {
            installationIdDigest: canonicalAppDigest(installation.id),
            appIdDigest: canonicalAppDigest(installation.appId),
            artifactDigest: receipt.artifactDigest,
            approvalDigest: receipt.approvalDigest,
            fromState: receipt.fromState,
            requestedMode: receipt.requestedMode,
            evidenceRefCount: receipt.evidenceRefs.length,
            expiresAt: receipt.expiresAt
          }
        },
        value: receipt
      };
    });
  }

  async activate(
    installationId: string,
    mode: Extract<AppRolloutMode, "shadow" | "recommend" | "execute_with_approval">,
    approvalReceiptId: string,
    actor: string,
    now = new Date()
  ): Promise<WorkspaceAppInstallation> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireOperableInstallation(registry, installationId);
      const approval = registry.activationApprovals.find((candidate) => candidate.id === approvalReceiptId);
      if (!approval) throw new Error(`App activation approval receipt not found: ${approvalReceiptId}`);
      if (approval.consumedAt) throw new Error("App activation approval receipt has already been consumed");
      if (Date.parse(approval.expiresAt) <= now.getTime()) throw new Error("App activation approval receipt has expired");
      if (approval.workspaceId !== registry.workspaceId || approval.installationId !== installation.id || approval.appId !== installation.appId) {
        throw new Error("App activation approval receipt belongs to another workspace, installation, or app");
      }
      if (approval.artifactDigest !== installation.artifactDigest || approval.fromState !== installation.state || approval.requestedMode !== mode) {
        throw new Error("App activation approval receipt does not match the current artifact, state, and requested mode");
      }
      const latestPassed = [...registry.evaluations].reverse().find((run) => run.installationId === installationId && run.status === "passed");
      if (!latestPassed) throw new Error("App must pass conformance before activation");
      if (mode === "execute_with_approval" && installation.permissions.some((permission) => permission.authority === "execute" && permission.decision === "allow")) {
        throw new Error("Execute-with-approval mode cannot contain an unapproved execute permission");
      }
      assertLifecycleTransition(installation.state, mode, mode);
      const timestamp = now.toISOString();
      await this.synchronizeOwnedLoopActivation(installation.id, mode, timestamp);
      const updated: WorkspaceAppInstallation = { ...installation, state: mode, mode, updatedAt: timestamp, failureReason: undefined };
      const consumedApproval = appActivationApprovalReceiptSchema.parse({ ...approval, consumedAt: timestamp, consumedBy: actor });
      const nextRegistry: AppInstallationRegistry = {
        ...registry,
        revision: registry.revision + 1,
        installations: replaceInstallation(registry.installations, updated),
        activationApprovals: registry.activationApprovals.map((candidate) => candidate.id === approval.id ? consumedApproval : candidate),
        updatedAt: timestamp
      };
      return {
        registry: nextRegistry,
        lock: createInstallationLock(nextRegistry),
        audit: {
          actor,
          action: "app.activation.consumed" as const,
          targetType: "app_activation_approval" as const,
          targetId: approval.id,
          metadata: {
            installationIdDigest: canonicalAppDigest(installation.id),
            appIdDigest: canonicalAppDigest(installation.appId),
            artifactDigest: approval.artifactDigest,
            approvalDigest: approval.approvalDigest,
            fromState: approval.fromState,
            requestedMode: approval.requestedMode,
            evidenceRefCount: approval.evidenceRefs.length,
            expiresAt: approval.expiresAt
          }
        },
        value: updated
      };
    });
  }

  async pause(installationId: string, actor: string): Promise<WorkspaceAppInstallation> {
    return this.transition(installationId, actor, () => "paused");
  }

  async resume(installationId: string, actor: string): Promise<WorkspaceAppInstallation> {
    return this.transition(installationId, actor, (installation) => {
      if (installation.mode !== "shadow" && installation.mode !== "recommend" && installation.mode !== "execute_with_approval") {
        throw new Error("Paused installation has no safe resumable rollout mode");
      }
      return installation.mode;
    });
  }

  async readiness(installationId: string, now = new Date()): Promise<AppReadiness> {
    const registry = await this.installationStore.read();
    const installation = requireInstallation(registry, installationId);
    const loaded = await this.loadInstallationArtifact(installation);
    const compiled = await compileLoopPack(loaded, { selectedModules: installation.selectedModules });
    const activeCapabilities = compiledCapabilityKeys(compiled);
    const requiredCapabilities = new Set([
      ...loaded.manifest.requiredCapabilities.filter((capability) => activeCapabilities.has(capability)),
      ...compiled.loopSpecs.flatMap((spec) => spec.routing?.requiredConnections ?? [])
    ]);
    const missingCapabilities = [...requiredCapabilities].filter((capability) => {
      const operationBinding = installation.operationBindings[capability];
      if (!operationBinding) return true;
      if (operationBinding.executor === "loopgraph_runtime") return false;
      return Boolean(
        operationBinding.connectionId &&
        installation.connectionBindings[capability] === operationBinding.connectionId
      ) === false;
    }).sort();
    const preset = loaded.manifest.presets.find((candidate) => candidate.id === installation.presetId);
    const presetDocument = preset ? await readPackYaml(loaded.root, preset.path) : undefined;
    const recipeId = isRecord(presetDocument) && typeof presetDocument.recipe === "string" ? presetDocument.recipe : installation.presetId;
    const recipe = (await loadConnectorRecipes(loaded)).find((candidate) => candidate.id === recipeId);
    const mappingsRequired = Boolean(recipe?.fieldMappings.some((mapping) => mapping.requiredLogicalFields.length > 0));
    const exactEvaluations = registry.evaluations.filter((run) =>
      run.installationId === installationId && run.artifactDigest === installation.artifactDigest);
    const latestSynthetic = [...exactEvaluations].reverse().find((run) => run.level === "synthetic");
    const syntheticPassed = latestSynthetic?.status === "passed" &&
      latestSynthetic.writeBlocked &&
      latestSynthetic.metrics.providerWrites === 0;
    const connectionsPassed = requiredCapabilities.size > 0 && missingCapabilities.length === 0;
    const mappingsPassed = !mappingsRequired || installation.fieldMappingIds.length > 0;
    const checks: AppReadiness["checks"] = [
      { id: "artifact", category: "artifact", status: "pass", summary: "Pinned artifact version and digest are recorded.", evidenceRefs: [installation.artifactDigest] },
      {
        id: "connections",
        category: "connection",
        status: requiredCapabilities.size === 0 ? "not_applicable" : connectionsPassed ? "pass" : "fail",
        summary: requiredCapabilities.size === 0
          ? "This selected composition declares no required provider capability."
          : connectionsPassed
            ? `All ${requiredCapabilities.size} required logical capabilities resolve to exact executable operations.`
            : `Missing executable operation bindings for required capabilities: ${missingCapabilities.join(", ")}.`,
        evidenceRefs: [...new Set([
          ...Object.values(installation.connectionBindings),
          ...Object.values(installation.operationBindings).map((binding) => `${binding.providerId}:${binding.operation}`)
        ])],
        ...(!connectionsPassed && requiredCapabilities.size > 0 ? { remediation: "Reconnect or re-plan the App so every required logical capability resolves to an allowlisted Connector Broker or Loopgraph runtime operation." } : {})
      },
      {
        id: "mappings",
        category: "mapping",
        status: mappingsRequired ? mappingsPassed ? "pass" : "fail" : "not_applicable",
        summary: mappingsRequired
          ? mappingsPassed
            ? `${installation.fieldMappingIds.length} confirmed field mapping record(s) are bound.`
            : "The selected connector recipe requires confirmed field mappings."
          : "The selected connector recipe declares no required field mappings.",
        evidenceRefs: installation.fieldMappingIds,
        ...(!mappingsPassed ? { remediation: "Inspect the provider schema and explicitly confirm every required logical field mapping." } : {})
      },
      { id: "configuration", category: "configuration", status: installation.configuration.completedAt ? "pass" : "fail", summary: installation.configuration.completedAt ? "Required configuration is complete." : "Configuration is incomplete.", evidenceRefs: [] },
      { id: "simulation", category: "simulation", status: syntheticPassed ? "pass" : latestSynthetic ? "fail" : "warn", summary: syntheticPassed ? "Latest exact-digest synthetic conformance run passed with writes blocked." : "A passing exact-digest synthetic conformance run is required.", evidenceRefs: latestSynthetic ? [latestSynthetic.id] : [] },
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
      maturity: syntheticPassed && connectionsPassed && mappingsPassed ? "connected" : syntheticPassed ? "tested" : "concept",
      checks,
      evaluatedAt: now.toISOString(),
      evidenceDerived: true
    });
  }

  async resolveOperation(input: ResolveAppOperationInput): Promise<AppOperationResolution> {
    const now = input.now ?? new Date();
    const registry = await this.installationStore.read();
    const installation = requireInstallation(registry, input.installationId);
    const artifact = await this.loopSpecStore.getActiveLoopSpec(this.projectRoot, input.loopId);
    if (!artifact) throw new Error(`Active LoopSpec not found: ${input.loopId}`);
    if (artifact.spec.metadata.labels?.installationId !== installation.id) {
      throw new Error(`Loop ${input.loopId} is not owned by App installation ${installation.id}`);
    }

    const binding = installation.operationBindings[input.capability];
    const permission = installation.permissions.find((candidate) => candidate.capability === input.capability);
    const blockers: string[] = [];
    const unfinished = registry.lifecycleOperations.find((operation) =>
      operation.installationId === installation.id && operation.status !== "completed");
    if (unfinished) blockers.push(`App lifecycle operation ${unfinished.id} requires reconciliation.`);
    const toolClaimsCapability = artifact.spec.tools.some((tool) => tool.adapterId === `capability:${input.capability}`);
    if (!toolClaimsCapability) blockers.push(`Loop ${input.loopId} does not declare capability ${input.capability}.`);
    if (!binding) blockers.push(`Installed App has no executable binding for ${input.capability}.`);
    if (!permission) blockers.push(`Installed App has no permission decision for ${input.capability}.`);
    if (permission?.decision === "forbid") blockers.push(`Permission ${input.capability} is forbidden.`);
    if (permission?.decision === "unresolved") blockers.push(`Permission ${input.capability} is unresolved.`);
    if (!["shadow", "recommend", "execute_with_approval", "live"].includes(installation.state)) {
      blockers.push(`App state ${installation.state} does not permit provider or governed runtime invocation.`);
    }
    if (binding?.executor === "connector_broker" && (
      !binding.connectionId || installation.connectionBindings[input.capability] !== binding.connectionId
    )) {
      blockers.push(`The exact connection binding for ${input.capability} changed or is missing.`);
    }

    const readOnly = binding ? operationBindingIsReadOnly(binding, permission?.authority) : false;
    if (permission && readOnly && permission.decision !== "allow") {
      blockers.push(`Read capability ${input.capability} is not explicitly allowed.`);
    }
    if (binding && !readOnly && !["execute_with_approval", "live"].includes(installation.mode)) {
      blockers.push(`App mode ${installation.mode} cannot prepare provider or governed runtime actions.`);
    }

    const disposition = blockers.length > 0
      ? "blocked" as const
      : binding!.executor === "loopgraph_runtime" && readOnly
        ? "invoke_loopgraph_runtime" as const
        : readOnly
          ? "invoke_read" as const
          : "prepare_action" as const;
    const resolvedAt = now.toISOString();
    const base = {
      schemaVersion: APP_OPERATION_RESOLUTION_SCHEMA_VERSION,
      workspaceId: this.workspaceId,
      installationId: installation.id,
      appId: installation.appId,
      artifactDigest: installation.artifactDigest,
      loopId: artifact.loopId,
      loopVersionHash: `sha256:${loopSpecVersionHash(artifact.spec)}`,
      capability: input.capability,
      state: installation.state,
      mode: installation.mode,
      binding,
      permission,
      disposition,
      blockers,
      resolvedAt,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString()
    };
    return appOperationResolutionSchema.parse({
      ...base,
      resolutionDigest: canonicalAppDigest({ ...base, resolutionDigest: undefined })
    });
  }

  private async transition(
    installationId: string,
    actor: string,
    validate: (installation: WorkspaceAppInstallation, registry: AppInstallationRegistry) => WorkspaceAppInstallation["state"]
  ): Promise<WorkspaceAppInstallation> {
    return this.installationStore.withExclusiveUpdate(async (registry) => {
      const installation = requireOperableInstallation(registry, installationId);
      const state = validate(installation, registry);
      assertLifecycleTransition(installation.state, state, state);
      const timestamp = new Date().toISOString();
      const mode = ["shadow", "recommend", "execute_with_approval", "live"].includes(state) ? state as AppRolloutMode : installation.mode;
      const routingMode = state === "paused"
        ? "shadow"
        : state === "shadow" || state === "recommend" || state === "execute_with_approval"
          ? state
          : undefined;
      if (!routingMode) throw new Error(`App state ${state} has no safe LoopSpec routing mode`);
      await this.synchronizeOwnedLoopActivation(
        installation.id,
        routingMode,
        timestamp
      );
      const updated = { ...installation, state, mode, updatedAt: timestamp, failureReason: undefined };
      return {
        registry: { ...registry, revision: registry.revision + 1, installations: replaceInstallation(registry.installations, updated), updatedAt: timestamp },
        value: updated
      };
    });
  }

  private async synchronizeOwnedLoopActivation(
    installationId: string,
    activationMode: "shadow" | "recommend" | "execute_with_approval",
    timestamp: string
  ): Promise<void> {
    const snapshot = await this.loopSpecStore.getWorkspace(this.projectRoot);
    const loopIds = installationLoopIds(snapshot.workspace, installationId);
    if (loopIds.length === 0) {
      throw new Error(`App installation ${installationId} owns no active LoopSpecs`);
    }
    const loopIdSet = new Set(loopIds);
    const active = (await this.loopSpecStore.listActiveLoopSpecs(this.projectRoot))
      .filter((artifact) => loopIdSet.has(artifact.loopId));
    const missing = loopIds.filter((loopId) => !active.some((artifact) => artifact.loopId === loopId));
    if (missing.length > 0) {
      throw new Error(`App installation ${installationId} is missing active LoopSpecs: ${missing.join(", ")}`);
    }
    const changed = active.filter((artifact) => artifact.spec.routing?.activationMode !== activationMode);
    if (changed.length === 0) return;
    const artifacts = active.map((artifact) => {
      if (!artifact.spec.routing) {
        throw new Error(`Installed App LoopSpec ${artifact.loopId} has no Hermes routing contract`);
      }
      const spec = {
        ...artifact.spec,
        routing: { ...artifact.spec.routing, activationMode }
      };
      return {
        ...artifact,
        spec,
        versionHash: loopSpecVersionHash(spec)
      };
    });
    const identity = contentHash({
      installationId,
      activationMode,
      expectedRevision: snapshot.revision,
      versions: artifacts.map((artifact) => ({ loopId: artifact.loopId, versionHash: artifact.versionHash }))
    });
    await this.loopSpecStore.commitMaterializationAtomically({
      commitId: `app-rollout-${installationId}-${identity}`,
      idempotencyKey: `app-rollout-${identity}`,
      expectedRevision: snapshot.revision,
      projectRoot: this.projectRoot,
      committedAt: timestamp,
      artifacts
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
  blockers.push(...plan.capabilityResolutions.filter((resolution) => resolution.required && resolution.status !== "connected" && resolution.status !== "reusable").map((resolution) => `Required capability ${resolution.capability} is ${resolution.status}: ${resolution.reason ?? "no executable operation binding is available"}`));
  blockers.push(...plan.capabilityResolutions.filter((resolution) =>
    resolution.required &&
    ["connected", "reusable"].includes(resolution.status) &&
    !isExecutableCapabilityResolution(resolution)
  ).map((resolution) => `Required capability ${resolution.capability} has no exact executable operation binding`));
  blockers.push(...plan.permissions.filter((permission) => permission.decision === "unresolved").map((permission) => `Permission ${permission.capability} is unresolved`));
  blockers.push(...plan.conflicts.filter((conflict) => conflict.blocking).map((conflict) => `Blocking ${conflict.kind.replace(/_/g, " ")} conflict for ${conflict.resourceId}: ${conflict.reason}`));
  return blockers;
}

function installAssetConflictReason(kind: AppInstallPlan["conflicts"][number]["kind"]): string {
  if (kind === "duplicate_loop") {
    return "A runtime LoopSpec with this ID already has a different immutable contract. Rename or namespace the App loop before installation.";
  }
  if (kind === "shared_company_object") {
    return "The installed shared company object has a different immutable contract. Resolve the object identity or schema before installation.";
  }
  if (kind === "graph") {
    return "The installed graph resource has a different immutable contract. Review the competing topology before installation.";
  }
  if (kind === "dependency") {
    return "The installed dependency does not satisfy the App contract.";
  }
  return "An installed App asset with this identity has a different immutable contract. Rename, reuse, or explicitly migrate the asset before installation.";
}

function assertPlanMatchesCompiledComposition(
  plan: AppInstallPlan,
  compiled: Awaited<ReturnType<typeof compileLoopPack>>,
  installationId: string
): void {
  const expected = compilePlannedAssets(compiled, installationId);
  const plannedById = new Map(plan.assets.map((asset) => [asset.id, asset]));
  const expectedById = new Map(expected.map((asset) => [asset.id, asset]));
  for (const asset of expected) {
    const planned = plannedById.get(asset.id);
    if (!planned || planned.kind !== asset.kind || planned.digest !== asset.digest) {
      throw new Error(`Install plan does not match the selected module composition: ${asset.id}`);
    }
  }
  const unexpected = plan.assets.find((asset) =>
    !expectedById.has(asset.id) && !["connection_binding", "field_mapping"].includes(asset.kind));
  if (unexpected) throw new Error(`Install plan contains an asset outside the selected module composition: ${unexpected.id}`);
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
    operationBindings: installation.operationBindings,
    fieldMappingIds: installation.fieldMappingIds,
    permissions: installation.permissions,
    ownedAssets: installation.ownedAssets,
    capturedAt,
    capturedBy: actor,
    reason
  };
  return [...installation.history.slice(-19), snapshot];
}

function operationBindingsFromPlan(
  resolutions: AppInstallPlan["capabilityResolutions"]
): WorkspaceAppInstallation["operationBindings"] {
  return Object.fromEntries(resolutions.flatMap((resolution) => {
    if (!isExecutableCapabilityResolution(resolution)) return [];
    return [[resolution.capability, {
      providerId: resolution.providerId,
      providerOperation: resolution.providerOperation,
      operation: resolution.operation,
      executor: resolution.executor,
      connectionId: resolution.connectionId,
      brokerCapability: resolution.brokerCapability,
      minimumScopes: resolution.minimumScopes ?? []
    }]];
  }));
}

function operationBindingIsReadOnly(
  binding: AppConnectorOperationBinding,
  authority: "read" | "draft" | "approve" | "execute" | undefined
): boolean {
  if (authority !== "read") return false;
  if (binding.executor === "loopgraph_runtime") return true;
  return binding.brokerCapability === "provider.data.read" || binding.brokerCapability === "provider.health.read";
}

function connectionBindingsFromPlan(
  resolutions: AppInstallPlan["capabilityResolutions"]
): WorkspaceAppInstallation["connectionBindings"] {
  return Object.fromEntries(resolutions.flatMap((resolution) =>
    isExecutableCapabilityResolution(resolution) && resolution.connectionId
      ? [[resolution.capability, resolution.connectionId]]
      : []
  ));
}

function isExecutableCapabilityResolution(
  resolution: AppInstallPlan["capabilityResolutions"][number]
): resolution is AppInstallPlan["capabilityResolutions"][number] & {
  providerId: string;
  providerOperation: string;
  operation: string;
  executor: "connector_broker" | "loopgraph_runtime";
} {
  if (!["connected", "reusable"].includes(resolution.status)) return false;
  if (!resolution.providerId || !resolution.providerOperation || !resolution.operation) return false;
  if (resolution.executor === "loopgraph_runtime") return !resolution.connectionId;
  return resolution.executor === "connector_broker" && Boolean(resolution.connectionId && resolution.brokerCapability);
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
  namespace?: string,
  reusableAssets: WorkspaceAppInstallation["ownedAssets"] = []
): WorkspaceAppInstallation["ownedAssets"] {
  const compiledOwnership = compilePlannedAssets(compiled, installationId, namespace).filter((asset) => !["retain", "remove"].includes(asset.action)).map((asset) => ({
    assetId: asset.id,
    kind: asset.kind,
    ownerInstallationIds: [installationId],
    refCount: 1,
    shared: asset.shared,
    digest: asset.digest ?? canonicalAppDigest(asset)
  }));
  const compiledIds = new Set(compiledOwnership.map((asset) => asset.assetId));
  const retainedReusableOwnership = reusableAssets
    .filter((asset) => ["connection_binding", "field_mapping"].includes(asset.kind) && !compiledIds.has(asset.assetId))
    .map((asset) => ({ ...asset, ownerInstallationIds: [installationId], refCount: 1, shared: true }));
  return [...compiledOwnership, ...retainedReusableOwnership].sort((left, right) => left.assetId.localeCompare(right.assetId));
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
    ...compiled.loopSpecs.map((spec) => ({ id: `loop.${spec.metadata.id}`, kind: "loop_spec" as const, action: "create" as const, digest: canonicalAppDigest(spec), shared: false, sourcePath: compiled.loopSourcePaths[spec.metadata.id], dependencies: [] })),
    ...compiled.skills.map((skill) => ({ id: `skill.${skill.id}`, kind: "hermes_skill" as const, action: "create" as const, digest: canonicalAppDigest(skill), shared: false, sourcePath: compiled.skillSourcePaths[skill.id], dependencies: [] })),
    ...compiled.routingCards.map((card) => ({ id: `routing.${card.loopId}`, kind: "routing_card" as const, action: "create" as const, digest: canonicalAppDigest(card), shared: false, dependencies: [`loop.${card.loopId}`] })),
    ...compiled.installationAssets.map((asset) => ({ ...asset, action: "create" as const, shared: false })),
    ...compiled.graph.nodes.filter((node) => node.installationScoped).map((node) => ({ id: `graph-node.${node.id}`, kind: "graph_node" as const, action: "create" as const, digest: canonicalAppDigest(node), shared: node.shared ?? false, dependencies: node.parentId ? [`graph-node.${node.parentId}`] : [] })),
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
  const selected = new Set(requested ?? modules.filter((moduleDefinition) => moduleDefinition.defaultEnabled).map((moduleDefinition) => moduleDefinition.id));
  const known = new Set(modules.map((moduleDefinition) => moduleDefinition.id));
  for (const id of selected) if (!known.has(id)) throw new Error(`Unknown app module: ${id}`);
  for (const moduleDefinition of modules.filter((candidate) => selected.has(candidate.id))) {
    for (const dependency of moduleDefinition.dependsOn) if (!selected.has(dependency)) throw new Error(`Module ${moduleDefinition.id} requires ${dependency}`);
  }
  return [...selected].sort();
}

function compiledCapabilityKeys(compiled: Awaited<ReturnType<typeof compileLoopPack>>): Set<string> {
  return new Set(compiled.loopSpecs.flatMap((spec) => spec.tools.flatMap((tool) =>
    tool.adapterId.startsWith("capability:") ? [tool.adapterId.slice("capability:".length)] : [])));
}

function assertInstalledCompositionAuthority(
  compiled: Awaited<ReturnType<typeof compileLoopPack>>,
  installation: WorkspaceAppInstallation
): Set<string> {
  const activeCapabilities = compiledCapabilityKeys(compiled);
  const introducedCapabilities = [...activeCapabilities].filter((capability) =>
    !installation.permissions.some((permission) => permission.capability === capability));
  if (introducedCapabilities.length > 0) {
    throw new Error(`Module enablement introduces permissions that require a fresh install plan: ${introducedCapabilities.sort().join(", ")}`);
  }
  const requiredConnections = new Set(compiled.loopSpecs.flatMap((spec) => spec.routing?.requiredConnections ?? []));
  const missingOperations = [...requiredConnections].filter((capability) => !installation.operationBindings[capability]);
  if (missingOperations.length > 0) {
    throw new Error(`Module enablement requires executable operation bindings that need a fresh install plan: ${missingOperations.sort().join(", ")}`);
  }
  return activeCapabilities;
}

function findConnectionForRecipe(resolutions: CapabilityResolution[], recipeId: string): string | undefined {
  return resolutions.find((resolution) => resolution.recipeId === recipeId && resolution.connectionId)?.connectionId;
}

function installationIdFor(workspaceId: string, appId: string): string {
  return `install.${contentHash({ workspaceId, appId })}`;
}

function fieldMappingAssetDigest(mapping: ConnectorFieldMapping): string {
  return canonicalAppDigest({
    id: mapping.id,
    connectionId: mapping.connectionId,
    objectType: mapping.objectType,
    logicalField: mapping.logicalField,
    providerField: mapping.providerField,
    direction: mapping.direction,
    transform: mapping.transform,
    confidence: mapping.confidence,
    verified: mapping.verified,
    confirmedBy: mapping.confirmedBy
  });
}

function companyContextKeys(configuration: AppConfiguration): string[] {
  return [...new Set(Object.values(configuration.provenance).flatMap((provenance) =>
    provenance.layer === "company_context" && provenance.sourceRef ? [provenance.sourceRef] : []
  ))].sort();
}

function assertCompanyContextStillMatches(configuration: AppConfiguration, context: CompanyContext): void {
  for (const [fieldKey, provenance] of Object.entries(configuration.provenance)) {
    if (provenance.layer !== "company_context" || !provenance.sourceRef) continue;
    const current = context.values.find((value) => value.key === provenance.sourceRef && value.verified);
    if (!current || canonicalAppDigest(current.value) !== canonicalAppDigest(configuration.values[fieldKey])) {
      throw new Error(`Approved company context changed for ${provenance.sourceRef}; create a fresh installation plan`);
    }
  }
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

function requireOperableInstallation(registry: AppInstallationRegistry, id: string): WorkspaceAppInstallation {
  const installation = requireInstallation(registry, id);
  const unfinished = registry.lifecycleOperations.find((operation) =>
    operation.installationId === id && operation.status !== "completed");
  if (unfinished) {
    throw new Error(`App lifecycle operation ${unfinished.id} must be reconciled before another operation can run`);
  }
  return installation;
}

function lifecycleOperationId(
  action: AppLifecycleOperation["action"],
  installationId: string,
  targetArtifactDigest: string,
  idempotencyKey: string
): string {
  return `lifecycle.${contentHash({ action, installationId, targetArtifactDigest, idempotencyKey })}`;
}

function assertSameLifecycleOperation(existing: AppLifecycleOperation, input: PrepareLifecycleOperationInput): void {
  const { now: _now, ...intent } = input;
  void _now;
  const existingIntent = {
    id: existing.id,
    idempotencyKey: existing.idempotencyKey,
    installationId: existing.installationId,
    appId: existing.appId,
    action: existing.action,
    targetArtifactDigest: existing.targetArtifactDigest,
    desired: existing.desired,
    actor: existing.actor
  };
  if (canonicalAppDigest(existingIntent) !== canonicalAppDigest(intent)) {
    throw new Error(`App lifecycle idempotency conflict for ${existing.id}`);
  }
}

function replaceLifecycleOperation(
  operations: AppLifecycleOperation[],
  replacement: AppLifecycleOperation
): AppLifecycleOperation[] {
  return operations
    .map((operation) => operation.id === replacement.id ? replacement : operation)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

function retainLifecycleOperations(operations: AppLifecycleOperation[]): AppLifecycleOperation[] {
  const pending = operations.filter((operation) => operation.status !== "completed");
  if (pending.length > APP_LIFECYCLE_OPERATION_LIMIT) {
    throw new Error("Too many App lifecycle operations require reconciliation");
  }
  const completed = operations
    .filter((operation) => operation.status === "completed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return [...pending, ...completed.slice(0, APP_LIFECYCLE_OPERATION_LIMIT - pending.length)]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

function completeLifecycleOperation(
  registry: AppInstallationRegistry,
  operationId: string,
  now: Date,
  resultReceiptId?: string
): AppInstallationRegistry {
  const operation = registry.lifecycleOperations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`App lifecycle recovery record not found: ${operationId}`);
  if (operation.status === "completed") return registry;
  const timestamp = now.toISOString();
  const completed = appLifecycleOperationSchema.parse({
    ...operation,
    status: "completed",
    failureCode: undefined,
    completedAt: timestamp,
    updatedAt: timestamp,
    resultReceiptId
  });
  return {
    ...registry,
    lifecycleOperations: retainLifecycleOperations(replaceLifecycleOperation(registry.lifecycleOperations, completed))
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
