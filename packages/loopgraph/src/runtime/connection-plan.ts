import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONNECTION_PLAN_SCHEMA_VERSION,
  MANUAL_CONNECTION_FALLBACKS_SCHEMA_VERSION,
  connectionPlanSchema,
  manualConnectionFallbackSchema,
  manualConnectionFallbacksFileSchema,
  normalizeDepartmentType,
  type ConnectionPlan,
  type ConnectionPlanItem,
  type ConnectionRequiredFor,
  type ConnectionInstance,
  type DepartmentType,
  type LoopSpec,
  type ManualConnectionFallback
} from "../core";
import {
  capabilityForManifest,
  defaultConnectorManifests,
  manifestsForCapability,
  readConnectionInstances
} from "./connector-registry";
import { loadLoopSpecFromPath } from "./loader";
import { getLoopgraphRoot } from "./storage-resolver";
import { initLoopgraphWorkspace, readLoopgraphWorkspace, workspaceProjectRootId } from "./workspace";

export type BuildConnectionPlanInput = {
  projectRoot?: string;
  now?: Date;
};

export type SetManualConnectionFallbackInput = {
  projectRoot?: string;
  capability: string;
  label: string;
  instructions?: string;
  updatedBy?: string;
  now?: Date;
};

type MutableConnectionItem = {
  capability: string;
  requiredFor: Set<ConnectionRequiredFor>;
  loops: ConnectionPlanItem["loops"];
  manualFallbacks: Set<string>;
  requiredFromUser: ConnectionPlanItem["requiredFromUser"];
  sourceRefs: Set<string>;
};

type HermesDesignExtension = {
  designRunId?: string;
  proposalId?: string;
  connectorRequirements?: Array<{
    capability?: unknown;
    reason?: unknown;
    requiredFor?: unknown;
  }>;
  manualFallbacks?: unknown[];
  requiredFromUser?: Array<{
    type?: unknown;
    label?: unknown;
    reason?: unknown;
  }>;
};

export async function buildConnectionPlan(input: BuildConnectionPlanInput = {}): Promise<ConnectionPlan> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const nowIso = (input.now ?? new Date()).toISOString();
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const manualFallbacks = await readManualConnectionFallbacks(projectRoot);
  const connectionInstances = await readConnectionInstances(projectRoot);
  const manualByCapability = new Map(manualFallbacks.map((fallback) => [fallback.capability, fallback]));
  const itemsByCapability = new Map<string, MutableConnectionItem>();
  const warnings: string[] = [];

  for (const entry of workspace.registeredSpecs) {
    const specPath = path.isAbsolute(entry.path) ? entry.path : path.resolve(projectRoot, entry.path);
    const loaded = await loadLoopSpecFromPath(specPath);
    if (!loaded.ok) {
      warnings.push(`Could not read registered LoopSpec ${entry.id}: ${loaded.errors.join("; ")}`);
      continue;
    }
    collectSpecConnectionRequirements(loaded.spec, itemsByCapability);
  }

  for (const fallback of manualFallbacks) {
    const item = ensureItem(itemsByCapability, fallback.capability);
    item.manualFallbacks.add(fallback.label);
    if (fallback.instructions) item.manualFallbacks.add(fallback.instructions);
    item.sourceRefs.add("manual-fallbacks");
  }

  const items = Array.from(itemsByCapability.values())
    .map((item) => finalizeConnectionItem(item, manualByCapability, connectionInstances))
    .sort((left, right) => left.capability.localeCompare(right.capability));

  return connectionPlanSchema.parse({
    schemaVersion: CONNECTION_PLAN_SCHEMA_VERSION,
    projectRootId: workspace.projectRootId || workspaceProjectRootId(projectRoot),
    generatedAt: nowIso,
    summary: summarizeConnectionItems(items),
    items,
    warnings
  });
}

export async function setManualConnectionFallback(
  input: SetManualConnectionFallbackInput
): Promise<{ fallback: ManualConnectionFallback; plan: ConnectionPlan; path: string }> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  await initLoopgraphWorkspace({ projectRoot, now: input.now, createdBy: "hermes" });
  const nowIso = (input.now ?? new Date()).toISOString();
  const fallback = manualConnectionFallbackSchema.parse({
    capability: input.capability.trim(),
    label: input.label.trim(),
    instructions: input.instructions?.trim() || undefined,
    updatedBy: input.updatedBy?.trim() || undefined,
    updatedAt: nowIso
  });
  const current = await readManualConnectionFallbacks(projectRoot);
  const next = [
    ...current.filter((item) => item.capability !== fallback.capability),
    fallback
  ].sort((left, right) => left.capability.localeCompare(right.capability));
  const filePath = manualFallbacksFilePath(projectRoot);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    schemaVersion: MANUAL_CONNECTION_FALLBACKS_SCHEMA_VERSION,
    fallbacks: next
  }, null, 2)}\n`);

  return {
    fallback,
    plan: await buildConnectionPlan({ projectRoot, now: input.now }),
    path: filePath
  };
}

export async function getConnectionReadinessByCapability(projectRoot: string): Promise<Map<string, ConnectionPlanItem>> {
  const plan = await buildConnectionPlan({ projectRoot });
  return new Map(plan.items.map((item) => [item.capability, item]));
}

function collectSpecConnectionRequirements(
  spec: LoopSpec,
  itemsByCapability: Map<string, MutableConnectionItem>
): void {
  const extension = hermesDesignExtension(spec);
  const genericManualFallbacks = (extension?.manualFallbacks ?? [])
    .map((item) => typeof item === "string" ? item : undefined)
    .filter((item): item is string => Boolean(item?.trim()));
  const userConnectionActions = (extension?.requiredFromUser ?? [])
    .filter((item) => item?.type === "connection" && typeof item.label === "string" && typeof item.reason === "string")
    .map((item) => ({ label: String(item.label), reason: String(item.reason) }));
  const sourceRef = extension?.proposalId
    ? `proposal:${extension.proposalId}`
    : `loop:${spec.metadata.id}`;

  for (const requirement of extension?.connectorRequirements ?? []) {
    if (typeof requirement.capability !== "string" || !requirement.capability.trim()) continue;
    const requiredFor = parseRequiredFor(requirement.requiredFor) ?? "execution";
    const item = ensureItem(itemsByCapability, requirement.capability);
    item.requiredFor.add(requiredFor);
    item.loops.push({
      loopId: spec.metadata.id,
      loopName: spec.metadata.name,
      ...departmentForSpec(spec),
      requiredFor,
      reason: typeof requirement.reason === "string" ? requirement.reason : `Required by ${spec.metadata.name}.`
    });
    for (const fallback of genericManualFallbacks) item.manualFallbacks.add(fallback);
    item.requiredFromUser.push(...userConnectionActions);
    item.sourceRefs.add(sourceRef);
  }

  for (const capability of spec.routing?.requiredConnections ?? []) {
    const item = ensureItem(itemsByCapability, capability);
    item.requiredFor.add("routing");
    if (!item.loops.some((loop) => loop.loopId === spec.metadata.id && loop.requiredFor === "routing")) {
      item.loops.push({
        loopId: spec.metadata.id,
        loopName: spec.metadata.name,
        ...departmentForSpec(spec),
        requiredFor: "routing",
        reason: `Required by ${spec.metadata.name} routing contract.`
      });
    }
    for (const fallback of genericManualFallbacks) item.manualFallbacks.add(fallback);
    item.sourceRefs.add(`routing:${spec.metadata.id}`);
  }
}

function hermesDesignExtension(spec: LoopSpec): HermesDesignExtension | undefined {
  const extension = spec.studioExtension;
  if (!extension || typeof extension !== "object") return undefined;
  const value = (extension as Record<string, unknown>).hermesDesign;
  return value && typeof value === "object" ? value as HermesDesignExtension : undefined;
}

function ensureItem(itemsByCapability: Map<string, MutableConnectionItem>, capability: string): MutableConnectionItem {
  const key = capability.trim();
  const existing = itemsByCapability.get(key);
  if (existing) return existing;
  const item: MutableConnectionItem = {
    capability: key,
    requiredFor: new Set(),
    loops: [],
    manualFallbacks: new Set(),
    requiredFromUser: [],
    sourceRefs: new Set()
  };
  itemsByCapability.set(key, item);
  return item;
}

function finalizeConnectionItem(
  item: MutableConnectionItem,
  manualByCapability: Map<string, ManualConnectionFallback>,
  connectionInstances: ConnectionInstance[]
): ConnectionPlanItem {
  const manualFallback = manualByCapability.get(item.capability);
  if (manualFallback) {
    item.manualFallbacks.add(manualFallback.label);
    if (manualFallback.instructions) item.manualFallbacks.add(manualFallback.instructions);
  }
  const requiredFor = Array.from(item.requiredFor).sort(byRequiredFor);
  const manualFallbacks = Array.from(item.manualFallbacks).sort();
  const compatibleConnections = compatibleInstancesForCapability(item.capability, connectionInstances);
  const status = statusForCapability(compatibleConnections, manualFallbacks);
  const connectorSuggestions = connectorSuggestionsForCapability(item.capability);
  const webhookRouteHints = webhookRouteHintsForCapability(item.capability);
  const authority = authorityForCapability(item.capability);
  return {
    capability: item.capability,
    status,
    requiredFor,
    loops: uniqueLoops(item.loops),
    manualFallbacks,
    requiredFromUser: uniqueUserActions(item.requiredFromUser),
    suggestedConnectors: connectorSuggestions,
    compatibleConnections,
    webhookRouteHints,
    authority,
    blockingFor: status === "missing" ? requiredFor : [],
    sourceRefs: Array.from(item.sourceRefs).sort()
  };
}

function compatibleInstancesForCapability(
  capability: string,
  instances: ConnectionInstance[]
): ConnectionPlanItem["compatibleConnections"] {
  return instances
    .filter((instance) => instance.capabilityKeys.includes(capability))
    .map((instance) => ({
      instanceId: instance.id,
      manifestId: instance.manifestId,
      ...(instance.accountLabel ? { label: instance.accountLabel } : {}),
      status: instance.status,
      environment: instance.environment
    }))
    .sort((left, right) => `${left.manifestId}:${left.instanceId}`.localeCompare(`${right.manifestId}:${right.instanceId}`));
}

function statusForCapability(
  compatibleConnections: ConnectionPlanItem["compatibleConnections"],
  manualFallbacks: string[]
): ConnectionPlanItem["status"] {
  if (compatibleConnections.some((instance) => instance.status === "connected")) return "connected";
  if (compatibleConnections.some((instance) => instance.status === "degraded")) return "degraded";
  if (manualFallbacks.length > 0) return "manual_fallback";
  return "missing";
}

function connectorSuggestionsForCapability(capability: string): ConnectionPlanItem["suggestedConnectors"] {
  return manifestsForCapability(capability, defaultConnectorManifests())
    .map((manifest) => {
      const candidate = capabilityForManifest(manifest, capability);
      return {
        manifestId: manifest.id,
        label: manifest.label,
        category: manifest.category,
        transport: manifest.transport,
        authType: manifest.authType,
        capabilities: [capability],
        minimumScopes: candidate?.minimumScopes ?? [],
        riskLevel: candidate?.riskLevel ?? "low",
        ...(candidate?.manualFallback ? { manualFallback: candidate.manualFallback } : {})
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function webhookRouteHintsForCapability(capability: string): ConnectionPlanItem["webhookRouteHints"] {
  return manifestsForCapability(capability, defaultConnectorManifests())
    .filter((manifest) => Boolean(manifest.webhook))
    .map((manifest) => ({
      manifestId: manifest.id,
      routeNameTemplate: manifest.webhook!.routeNameTemplate,
      sourcePatterns: manifest.webhook!.sourcePatterns,
      eventTypePatterns: manifest.webhook!.eventTypePatterns,
      signature: manifest.webhook!.signature,
      transformVersion: manifest.webhook!.transformVersion,
      stableDeliveryId: manifest.webhook!.stableDeliveryId,
      subjectIdPath: manifest.webhook!.subjectIdPath,
      filterHints: manifest.webhook!.filterHints
    }))
    .sort((left, right) => left.manifestId.localeCompare(right.manifestId));
}

function authorityForCapability(capability: string): ConnectionPlanItem["authority"] {
  const manifests = manifestsForCapability(capability, defaultConnectorManifests());
  const capabilities = manifests
    .map((manifest) => capabilityForManifest(manifest, capability))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const hermesReceivesEvents = manifests.some((manifest) => Boolean(manifest.webhook));
  const loopgraphCanRead = capabilities.some((candidate) => candidate.direction === "read");
  const loopgraphCanWrite = capabilities.some((candidate) =>
    candidate.direction === "draft_write" || candidate.direction === "approved_write"
  );
  const notes = [
    ...(hermesReceivesEvents
      ? ["Provider webhooks for this capability should terminate at Hermes and be normalized before Loopgraph sees an event."]
      : []),
    ...(loopgraphCanRead
      ? ["Loopgraph can read this source only through a connected read instance or an explicit manual fallback."]
      : []),
    ...(loopgraphCanWrite
      ? ["Loopgraph write access remains draft/approval-gated and is separate from Hermes event ingress."]
      : []),
    ...(!hermesReceivesEvents && !loopgraphCanRead && !loopgraphCanWrite
      ? ["No connector manifest currently describes this capability; treat it as a manual/custom integration."]
      : [])
  ];

  return {
    hermesReceivesEvents,
    loopgraphCanRead,
    loopgraphCanWrite,
    notes
  };
}

function summarizeConnectionItems(items: ConnectionPlanItem[]): ConnectionPlan["summary"] {
  return {
    totalCapabilities: items.length,
    missingCapabilities: items.filter((item) => item.status === "missing").length,
    manualFallbackCapabilities: items.filter((item) => item.status === "manual_fallback").length,
    connectedCapabilities: items.filter((item) => item.status === "connected").length,
    readyForRouting: items.every((item) => !item.blockingFor.includes("routing")),
    readyForSimulation: items.every((item) => !item.blockingFor.includes("simulation")),
    readyForExecution: items.every((item) => item.requiredFor.includes("execution") ? item.status === "connected" : true)
  };
}

async function readManualConnectionFallbacks(projectRoot: string): Promise<ManualConnectionFallback[]> {
  const filePath = manualFallbacksFilePath(projectRoot);
  try {
    const parsed = manualConnectionFallbacksFileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    return parsed.fallbacks;
  } catch {
    return [];
  }
}

function manualFallbacksFilePath(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "connections", "manual-fallbacks.json");
}

function parseRequiredFor(value: unknown): ConnectionRequiredFor | undefined {
  if (value === "design" || value === "simulation" || value === "execution" || value === "routing") return value;
  return undefined;
}

function departmentForSpec(spec: LoopSpec): { department?: DepartmentType } {
  const department = spec.topology?.department ? normalizeDepartmentType(spec.topology.department) : undefined;
  return department ? { department } : {};
}

function byRequiredFor(left: ConnectionRequiredFor, right: ConnectionRequiredFor): number {
  const order: ConnectionRequiredFor[] = ["routing", "simulation", "execution", "design"];
  return order.indexOf(left) - order.indexOf(right);
}

function uniqueLoops(loops: ConnectionPlanItem["loops"]): ConnectionPlanItem["loops"] {
  return Array.from(new Map(loops.map((loop) => [
    `${loop.loopId}:${loop.requiredFor}:${loop.reason}`,
    loop
  ])).values()).sort((left, right) =>
    `${left.loopName}:${left.requiredFor}`.localeCompare(`${right.loopName}:${right.requiredFor}`)
  );
}

function uniqueUserActions(actions: ConnectionPlanItem["requiredFromUser"]): ConnectionPlanItem["requiredFromUser"] {
  return Array.from(new Map(actions.map((action) => [
    `${action.label}:${action.reason}`,
    action
  ])).values()).sort((left, right) => left.label.localeCompare(right.label));
}
