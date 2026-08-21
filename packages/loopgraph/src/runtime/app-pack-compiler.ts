import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  APP_LOOP_SCHEMA_VERSION,
  APP_SKILL_SCHEMA_VERSION,
  appLoopDefinitionSchema,
  appSkillDefinitionSchema,
  canonicalAppDigest,
  compileRoutingCardFromLoopSpec,
  contentHash,
  validateLoopSpec,
  type AppLoopDefinition,
  type AppSkillDefinition,
  type LoopPackManifest,
  type LoopSpec,
  type RoutingCard
} from "../core";
import type { LoopPackLoadResult } from "./app-pack-loader";

export type CompiledAppGraphNode = {
  id: string;
  type: "hermes_brain" | "department" | "app" | "loop" | "company_object";
  label: string;
  parentId?: string;
  installationScoped: boolean;
  shared?: boolean;
  description?: string;
  objectType?: string;
  identityKeys?: string[];
};

export type CompiledAppGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: "routes" | "owns" | "contains" | "evidence_in" | "supports" | "produces" | "learning_return";
  reason?: string;
  condition?: string;
};

export type CompiledLoopPack = {
  appId: string;
  version: string;
  artifactDigest: string;
  loopSpecs: LoopSpec[];
  loopSourcePaths: Record<string, string>;
  skills: AppSkillDefinition[];
  skillSourcePaths: Record<string, string>;
  routingCards: RoutingCard[];
  activeEntrypoints: LoopPackManifest["entrypoints"];
  installationAssets: Array<{
    id: string;
    kind: "schedule" | "metric" | "fixture" | "evaluation" | "dashboard";
    digest: string;
    sourcePath?: string;
    dependencies: string[];
  }>;
  graph: {
    nodes: CompiledAppGraphNode[];
    edges: CompiledAppGraphEdge[];
  };
};

export async function compileLoopPack(
  loaded: LoopPackLoadResult,
  options: { selectedModules?: string[] } = {}
): Promise<CompiledLoopPack> {
  let activeEntrypoints = selectPackEntrypoints(loaded.manifest, options.selectedModules);
  const loopSpecs: LoopSpec[] = [];
  const loopSourcePaths: Record<string, string> = {};
  for (const loopPath of activeEntrypoints.loops) {
    const raw = await readPackDocument(loaded.root, loopPath);
    const spec = isRecord(raw) && raw.schemaVersion === APP_LOOP_SCHEMA_VERSION
      ? compileAppLoopDefinition(appLoopDefinitionSchema.parse(raw), loaded)
      : validateLoopSpec(raw);
    loopSpecs.push(spec);
    loopSourcePaths[spec.metadata.id] = loopPath;
  }

  const skills: AppSkillDefinition[] = [];
  const skillSourcePaths: Record<string, string> = {};
  const selectedSkillPaths = new Set(activeEntrypoints.skills);
  const requiredSkillIds = new Set(loopSpecs.flatMap((spec) =>
    isRecord(spec.studioExtension) && Array.isArray(spec.studioExtension.skills)
      ? spec.studioExtension.skills.filter((skill): skill is string => typeof skill === "string")
      : []));
  const activeSkillPaths: string[] = [];
  for (const skillPath of loaded.manifest.entrypoints.skills) {
    const raw = await readPackDocument(loaded.root, skillPath);
    if (!isRecord(raw) || raw.schemaVersion !== APP_SKILL_SCHEMA_VERSION) {
      throw new Error(`Pack skill ${skillPath} must use ${APP_SKILL_SCHEMA_VERSION}`);
    }
    const skill = appSkillDefinitionSchema.parse(raw);
    if (!selectedSkillPaths.has(skillPath) && !requiredSkillIds.has(skill.id)) continue;
    skills.push(skill);
    activeSkillPaths.push(skillPath);
    skillSourcePaths[skill.id] = skillPath;
  }
  activeEntrypoints = { ...activeEntrypoints, skills: activeSkillPaths };

  const loopIds = loopSpecs.map((spec) => spec.metadata.id);
  if (loopIds.length === 0) throw new Error("Selected module composition must include at least one LoopSpec");
  if (new Set(loopIds).size !== loopIds.length) {
    throw new Error("LoopPack contains duplicate loop IDs");
  }
  const activeLoopIds = new Set(loopIds);
  const activeFlows = loaded.manifest.topology.flows.filter((flow) =>
    (flow.source.kind !== "loop" || activeLoopIds.has(flow.source.id)) &&
    (flow.target.kind !== "loop" || activeLoopIds.has(flow.target.id)));
  const activeObjectIds = new Set(activeFlows.flatMap((flow) => [flow.source, flow.target])
    .filter((endpoint) => endpoint.kind === "object")
    .map((endpoint) => endpoint.id));
  const activeObjects = loaded.manifest.topology.objects.filter((object) => activeObjectIds.has(object.id));
  const selectedLoopSpecs = loopSpecs.map((spec) => validateLoopSpec({
    ...spec,
    routing: spec.routing ? {
      ...spec.routing,
      permittedSupportingLoopIds: spec.routing.permittedSupportingLoopIds.filter((loopId) => activeLoopIds.has(loopId))
    } : spec.routing,
    studioExtension: isRecord(spec.studioExtension) ? {
      ...spec.studioExtension,
      appTopology: { objects: activeObjects, flows: activeFlows }
    } : spec.studioExtension
  }));
  const activeSkillIds = new Set(skills.map((skill) => skill.id));
  for (const spec of selectedLoopSpecs) {
    const missingSkills = (isRecord(spec.studioExtension) && Array.isArray(spec.studioExtension.skills)
      ? spec.studioExtension.skills.filter((skill): skill is string => typeof skill === "string")
      : []).filter((skill) => !activeSkillIds.has(skill));
    if (missingSkills.length > 0) {
      throw new Error(`Selected module composition omits skills required by ${spec.metadata.id}: ${missingSkills.join(", ")}`);
    }
  }
  if (options.selectedModules === undefined) validateAppTopologyLoopReferences(loaded, loopIds);

  const catalogVersion = `app_${contentHash({ appId: loaded.manifest.metadata.id, digest: loaded.artifact.digest })}`;
  const routingCards = selectedLoopSpecs.map((spec) => compileRoutingCardFromLoopSpec(spec, {
    catalogVersion,
    currentReadiness: "blocked",
    loopStatus: "draft"
  })).filter((card): card is RoutingCard => Boolean(card));
  if (routingCards.length !== selectedLoopSpecs.length) {
    throw new Error("Every LoopPack loop must define a Hermes routing contract");
  }

  const installationAssets = compileAdditionalInstallationAssets(loaded, selectedLoopSpecs, activeEntrypoints);
  if (new Set(installationAssets.map((asset) => asset.id)).size !== installationAssets.length) {
    throw new Error("Compiled App installation asset IDs must be unique");
  }
  return {
    appId: loaded.manifest.metadata.id,
    version: loaded.manifest.metadata.version,
    artifactDigest: loaded.artifact.digest,
    loopSpecs: selectedLoopSpecs,
    loopSourcePaths,
    skills,
    skillSourcePaths,
    routingCards,
    activeEntrypoints,
    installationAssets,
    graph: compileAppGraph(loaded, selectedLoopSpecs, activeFlows, activeObjects)
  };
}

function compileAdditionalInstallationAssets(
  loaded: LoopPackLoadResult,
  specs: LoopSpec[],
  entrypoints: LoopPackManifest["entrypoints"]
): CompiledLoopPack["installationAssets"] {
  const assets: CompiledLoopPack["installationAssets"] = [];
  for (const spec of specs) {
    if (spec.trigger.type === "schedule") {
      assets.push({
        id: `schedule.${spec.metadata.id}`,
        kind: "schedule",
        digest: canonicalAppDigest({ loopId: spec.metadata.id, trigger: spec.trigger }),
        dependencies: [`loop.${spec.metadata.id}`]
      });
    }
    const outcomes = isRecord(spec.studioExtension) && Array.isArray(spec.studioExtension.outcomes)
      ? spec.studioExtension.outcomes
      : [];
    for (const [index, outcome] of outcomes.entries()) {
      if (!isRecord(outcome) || typeof outcome.metric !== "string" || !outcome.metric.trim()) continue;
      const metricId = normalizeAssetId(outcome.metric);
      assets.push({
        id: `metric.${spec.metadata.id}.${metricId || index + 1}`,
        kind: "metric",
        digest: canonicalAppDigest({ loopId: spec.metadata.id, outcome }),
        dependencies: [`loop.${spec.metadata.id}`]
      });
    }
  }
  for (const sourcePath of entrypoints.fixtures) {
    assets.push(packFileAsset(loaded, "fixture", sourcePath, specs
      .filter((spec) => (spec.input.fixtures ?? []).some((fixture) => fixture.path === sourcePath))
      .map((spec) => `loop.${spec.metadata.id}`)));
  }
  for (const sourcePath of entrypoints.evals) {
    assets.push(packFileAsset(loaded, "evaluation", sourcePath, entrypoints.fixtures.map((fixturePath) => assetIdForPackFile(loaded, "fixture", fixturePath))));
  }
  for (const sourcePath of entrypoints.dashboards) {
    assets.push(packFileAsset(loaded, "dashboard", sourcePath, assets.filter((asset) => asset.kind === "metric").map((asset) => asset.id)));
  }
  return assets.sort((left, right) => left.id.localeCompare(right.id));
}

function selectPackEntrypoints(manifest: LoopPackManifest, selectedModules?: string[]): LoopPackManifest["entrypoints"] {
  const selected = selectedModules === undefined
    ? new Set(manifest.modules.map((moduleDefinition) => moduleDefinition.id))
    : new Set(selectedModules);
  const known = new Set(manifest.modules.map((moduleDefinition) => moduleDefinition.id));
  for (const moduleId of selected) {
    if (!known.has(moduleId)) throw new Error(`Unknown app module: ${moduleId}`);
  }
  for (const moduleDefinition of manifest.modules.filter((candidate) => selected.has(candidate.id))) {
    for (const dependency of moduleDefinition.dependsOn) {
      if (!selected.has(dependency)) throw new Error(`Module ${moduleDefinition.id} requires ${dependency}`);
    }
  }
  const ownersByPath = new Map<string, Set<string>>();
  for (const moduleDefinition of manifest.modules) {
    for (const assetPath of moduleDefinition.assets) {
      const owners = ownersByPath.get(assetPath) ?? new Set<string>();
      owners.add(moduleDefinition.id);
      ownersByPath.set(assetPath, owners);
    }
  }
  const isActive = (assetPath: string) => {
    const owners = ownersByPath.get(assetPath);
    return !owners || [...owners].some((moduleId) => selected.has(moduleId));
  };
  return Object.fromEntries(Object.entries(manifest.entrypoints).map(([kind, paths]) => [kind, paths.filter(isActive)])) as LoopPackManifest["entrypoints"];
}

function packFileAsset(
  loaded: LoopPackLoadResult,
  kind: "fixture" | "evaluation" | "dashboard",
  sourcePath: string,
  dependencies: string[]
): CompiledLoopPack["installationAssets"][number] {
  const file = loaded.artifact.files.find((candidate) => candidate.path === sourcePath);
  if (!file) throw new Error(`Compiled App asset is missing from the immutable artifact: ${sourcePath}`);
  return {
    id: assetIdForPackFile(loaded, kind, sourcePath),
    kind,
    digest: file.digest,
    sourcePath,
    dependencies
  };
}

function assetIdForPackFile(loaded: LoopPackLoadResult, kind: "fixture" | "evaluation" | "dashboard", sourcePath: string): string {
  return `${kind}.${contentHash({ appId: loaded.manifest.metadata.id, sourcePath }).slice(0, 32)}`;
}

function normalizeAssetId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function compileAppLoopDefinition(definition: AppLoopDefinition, loaded: LoopPackLoadResult): LoopSpec {
  const capabilityByTool = new Map(definition.capabilities.map((capability) => [toolKey(capability.key), capability]));
  const tools = definition.capabilities.map((capability) => ({
    key: toolKey(capability.key),
    adapterId: `capability:${capability.key}`,
    label: capability.purpose,
    writeCapable: capability.authority === "approve" || capability.authority === "execute",
    riskLevel: capability.risk
  }));
  const allowedActions = definition.capabilities.map((capability) => ({
    toolKey: toolKey(capability.key),
    allowed: capability.authority !== "execute",
    requiresApproval: capability.authority === "approve" || capability.authority === "execute",
    customerFacing: capability.customerFacing,
    riskLevel: capability.risk
  }));
  const forbiddenActions = definition.policy.forbiddenActions.map((rule) => ({
    toolKey: toolKey(rule.capability),
    reason: rule.reason
  }));
  for (const capability of definition.capabilities.filter((candidate) => candidate.authority === "execute")) {
    if (!forbiddenActions.some((action) => action.toolKey === toolKey(capability.key))) {
      forbiddenActions.push({ toolKey: toolKey(capability.key), reason: "Provider execution is forbidden until a separate promotion explicitly grants it." });
    }
  }

  const spec = {
    apiVersion: "loopgraph/v1alpha1",
    kind: "Loop",
    metadata: {
      id: definition.metadata.id,
      name: definition.metadata.name,
      version: definition.metadata.version,
      description: definition.metadata.description,
      labels: {
        appId: loaded.manifest.metadata.id,
        appName: loaded.manifest.metadata.name,
        appVersion: loaded.manifest.metadata.version,
        appDigest: loaded.artifact.digest,
        lifecycleStatus: "draft"
      },
      owner: { role: definition.metadata.ownerRole }
    },
    trigger: definition.trigger,
    input: {
      schema: {
        type: "object",
        required: definition.input.requiredFields,
        properties: Object.fromEntries(definition.input.requiredFields.map((field) => [field, {}]))
      },
      fixtures: definition.input.fixtures
    },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "outcomes", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          outcomes: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: {
      sources: [
        { id: "app_policy", type: "policy", title: "Installed app policy", sensitivity: "internal", trusted: true, precedence: 0 },
        { id: "company_context", type: "memory", title: "Approved company context", sensitivity: "confidential", trusted: true, precedence: 1 },
        { id: "incoming_event", type: "event", title: "Hermes normalized event", sensitivity: "internal", trusted: false, precedence: 2 }
      ],
      precedence: [
        { sourceType: "policy", rank: 0 },
        { sourceType: "memory", rank: 1 },
        { sourceType: "event", rank: 2 }
      ],
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: definition.routine.map((step) => ({
        id: step.id,
        name: step.name,
        stepType: step.type,
        actor: step.actor,
        description: step.description
      }))
    },
    tools,
    policy: {
      allowedActions,
      forbiddenActions,
      escalationRules: [{
        id: "missing-context-or-risk",
        when: { any: ["required context missing", "confidence below threshold", "policy conflict"] },
        createEscalationCase: { category: "app_routing_review", severity: "P2" },
        routeTo: {
          primaryOwner: definition.policy.escalationOwner,
          reviewers: [definition.metadata.ownerRole],
          responseSla: definition.policy.escalationSla
        },
        requiresApproval: ["provider_write", "customer_facing_action"],
        decisionsRequired: ["Supply missing context or approve the bounded action"]
      }]
    },
    verification: [
      { id: "schema", type: "schema" },
      { id: "policy", type: "policy" },
      { id: "evidence", type: "evidence" },
      ...(Array.from(capabilityByTool.values()).some((capability) => capability.authority === "approve" || capability.authority === "execute")
        ? [{ id: "approval_required", type: "approval_required" as const }]
        : [])
    ],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: definition.policy.separateCustomerFacingApproval,
      allowedRoles: ["approver", "reviewer", "owner"]
    },
    persistence: {
      idempotency: { enabled: true },
      retry: { maxAttempts: 3 }
    },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true,
      exportOpenTelemetry: true
    },
    topology: {
      department: definition.metadata.department,
      tags: ["loopgraph-app", loaded.manifest.metadata.id, ...definition.metadata.tags]
    },
    routing: {
      ...definition.routing,
      permittedSupportingLoopIds: supportingLoopIdsFor(loaded, definition.metadata.id),
      activationMode: "shadow"
    },
    studioExtension: {
      appId: loaded.manifest.metadata.id,
      appVersion: loaded.manifest.metadata.version,
      artifactDigest: loaded.artifact.digest,
      skills: definition.skills,
      outcomes: definition.outcomes,
      appTopology: loaded.manifest.topology
    }
  };
  return validateLoopSpec(spec);
}

function compileAppGraph(
  loaded: LoopPackLoadResult,
  specs: LoopSpec[],
  flows = loaded.manifest.topology.flows,
  objects = loaded.manifest.topology.objects
): CompiledLoopPack["graph"] {
  const department = loaded.manifest.metadata.department;
  const brainId = "hermes-brain";
  const departmentId = `department.${department}`;
  const appNodeId = `app.${loaded.manifest.metadata.id}`;
  const nodes: CompiledAppGraphNode[] = [
    { id: brainId, type: "hermes_brain", label: "Hermes Brain", installationScoped: false },
    { id: departmentId, type: "department", label: departmentLabel(department), parentId: brainId, installationScoped: false },
    { id: appNodeId, type: "app", label: loaded.manifest.metadata.name, parentId: departmentId, installationScoped: true },
    ...specs.map((spec) => ({ id: `loop.${spec.metadata.id}`, type: "loop" as const, label: spec.metadata.name, parentId: appNodeId, installationScoped: true })),
    ...objects.map((object) => ({
      id: graphObjectId(loaded.manifest.metadata.id, object.id, object.shared),
      type: "company_object" as const,
      label: object.label,
      installationScoped: true,
      shared: object.shared,
      description: object.description,
      objectType: object.objectType,
      identityKeys: object.identityKeys
    }))
  ];
  const edges: CompiledAppGraphEdge[] = [
    { id: `edge.${brainId}.${departmentId}`, source: brainId, target: departmentId, type: "routes" },
    { id: `edge.${departmentId}.${appNodeId}`, source: departmentId, target: appNodeId, type: "owns" },
    ...specs.map((spec) => ({
      id: `edge.${appNodeId}.loop.${spec.metadata.id}`,
      source: appNodeId,
      target: `loop.${spec.metadata.id}`,
      type: "contains" as const
    })),
    ...flows.map((flow) => ({
      id: `edge.${loaded.manifest.metadata.id}.${flow.id}`,
      source: graphEndpointId(loaded, flow.source),
      target: graphEndpointId(loaded, flow.target),
      type: flow.type,
      reason: flow.reason,
      condition: flow.condition
    }))
  ];
  return { nodes, edges };
}

function supportingLoopIdsFor(loaded: LoopPackLoadResult, loopId: string): string[] {
  return loaded.manifest.topology.flows
    .filter((flow) => flow.type === "supports" && flow.source.kind === "loop" && flow.source.id === loopId)
    .map((flow) => flow.target.id)
    .sort();
}

function validateAppTopologyLoopReferences(loaded: LoopPackLoadResult, loopIds: string[]): void {
  const knownLoopIds = new Set(loopIds);
  const unknown = loaded.manifest.topology.flows.flatMap((flow) => [flow.source, flow.target])
    .filter((endpoint) => endpoint.kind === "loop" && !knownLoopIds.has(endpoint.id))
    .map((endpoint) => endpoint.id);
  if (unknown.length > 0) {
    throw new Error(`LoopPack topology references unknown loop IDs: ${Array.from(new Set(unknown)).sort().join(", ")}`);
  }
}

function graphEndpointId(loaded: LoopPackLoadResult, endpoint: { kind: "loop" | "object"; id: string }): string {
  if (endpoint.kind === "loop") return `loop.${endpoint.id}`;
  const object = loaded.manifest.topology.objects.find((candidate) => candidate.id === endpoint.id);
  if (!object) throw new Error(`LoopPack topology references unknown object ${endpoint.id}`);
  return graphObjectId(loaded.manifest.metadata.id, object.id, object.shared);
}

function graphObjectId(appId: string, objectId: string, shared: boolean): string {
  return shared ? `object.${objectId}` : `object.${appId}.${objectId}`;
}

async function readPackDocument(root: string, relativePath: string): Promise<unknown> {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Pack document escapes pack root: ${relativePath}`);
  }
  const raw = await readFile(absolute, "utf8");
  return relativePath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
}

function toolKey(capability: string): string {
  return capability.replace(/[^a-zA-Z0-9]+/g, "_");
}

function departmentLabel(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
