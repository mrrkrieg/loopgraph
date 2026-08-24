import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalAppDigest } from "loopgraph/core";
import {
  appInstallationRegistrySchema,
  detachedAppSnapshotDescriptor,
  reconcileAppSnapshots,
  type AppInstallationRegistry,
  type AppSnapshotReconciliationResult,
  type AppSnapshotStore
} from "loopgraph/runtime";
import {
  SupabaseAppSnapshotStore,
  hostedAppSnapshotObjectKey,
  inventoryHostedAppSnapshotObjects
} from "../lib/db/adapters/supabase-app-snapshot-store";
import { readProjectedSecretFile } from "./projected-secret-file";
import { HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS } from "./hosted-app-snapshot-inventory-fence";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WORKSPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,159}$/;
const REGISTRY_PAGE_SIZE = 100;
const MAX_REGISTRIES = 10_000;
const MAX_INVENTORY_STABILITY_PASSES = 4;

type RegistryRow = { workspace_id: unknown; registry_payload: unknown };

export type HostedAppSnapshotReconciliationReceipt = AppSnapshotReconciliationResult & {
  schemaVersion: "hosted-app-snapshot-reconciliation/v3";
  checkedAt: string;
  durationMs: number;
  scopeDigest: string;
  inventoryFenceDigest: string;
  inventoryPasses: number;
  inventoryGeneration: number;
  inventoryGenerationDigest: string;
  registriesScanned: number;
  storageObjects: number;
  referencedStorageObjects: number;
  unreferencedSnapshots: number;
  malformedStorageObjects: number;
  unreferencedInventoryDigest: string;
  checks: Array<{
    name:
      | "tenant_registry_scan"
      | "pinned_scope_identity"
      | "live_mutation_fence"
      | "non_empty_inventory_policy"
      | "durable_descriptor_authority"
      | "exact_archive_verification"
      | "stable_cross_store_inventory"
      | "exact_storage_inventory"
      | "pinned_unreferenced_retention"
      | "aggregate_only_receipt";
    ok: boolean;
  }>;
};

export type HostedAppSnapshotRetentionInventory = {
  storageObjects: number;
  referencedStorageObjects: number;
  unreferencedSnapshots: number;
  malformedStorageObjects: number;
  unreferencedInventoryDigest: string;
};

type HostedAppSnapshotReconciliationPass = {
  aggregate: AppSnapshotReconciliationResult & { registriesScanned: number };
  retentionInventory: HostedAppSnapshotRetentionInventory;
  generationBefore: number;
  generationAfter: number;
  stabilityDigest: string;
};

export async function reconcileHostedAppSnapshotRegistries(
  registries: AppInstallationRegistry[],
  storeForWorkspace: (workspaceId: string) => AppSnapshotStore
): Promise<AppSnapshotReconciliationResult & { registriesScanned: number }> {
  const workspaceIds = new Set<string>();
  const aggregate: AppSnapshotReconciliationResult & { registriesScanned: number } = {
    registriesScanned: registries.length,
    detachedInstallations: 0,
    verifiedSnapshots: 0,
    missingSnapshots: 0,
    corruptSnapshots: 0,
    untrackedSnapshots: 0,
    unavailableSnapshots: 0,
    healthy: false
  };

  for (const registry of registries) {
    if (workspaceIds.has(registry.workspaceId)) {
      throw new Error("Hosted App snapshot reconciliation received a duplicate workspace registry");
    }
    workspaceIds.add(registry.workspaceId);
    const result = await reconcileAppSnapshots(registry, storeForWorkspace(registry.workspaceId));
    aggregate.detachedInstallations += result.detachedInstallations;
    aggregate.verifiedSnapshots += result.verifiedSnapshots;
    aggregate.missingSnapshots += result.missingSnapshots;
    aggregate.corruptSnapshots += result.corruptSnapshots;
    aggregate.untrackedSnapshots += result.untrackedSnapshots;
    aggregate.unavailableSnapshots += result.unavailableSnapshots;
  }

  aggregate.healthy =
    aggregate.verifiedSnapshots === aggregate.detachedInstallations &&
    aggregate.missingSnapshots === 0 &&
    aggregate.corruptSnapshots === 0 &&
    aggregate.untrackedSnapshots === 0 &&
    aggregate.unavailableSnapshots === 0;
  return aggregate;
}

export async function reconcileHostedAppSnapshots(
  config: {
    supabaseUrl: string;
    organizationId: string;
    projectKey: string;
    expectedScopeDigest: string;
    expectedUnreferencedInventoryDigest: string;
    allowEmptyInventory: boolean;
  },
  dependencies: {
    client: SupabaseClient;
    now?: () => Date;
    nowMs?: () => number;
    projectRoot?: string;
  }
): Promise<HostedAppSnapshotReconciliationReceipt> {
  const scopeDigest = assertHostedAppSnapshotReconciliationScope(config);
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  const inventoryFenceDigest = await attestHostedAppSnapshotInventoryFence(
    dependencies.client,
    scopeDigest
  );
  const { pass: stable, inventoryPasses } = await collectStableHostedAppSnapshotReconciliation(
    config,
    dependencies
  );
  const { aggregate, retentionInventory } = stable;
  if (!/^sha256:[0-9a-f]{64}$/.test(config.expectedUnreferencedInventoryDigest)) {
    throw new Error("App snapshot reconciliation expected retention inventory digest is invalid");
  }
  const checks: HostedAppSnapshotReconciliationReceipt["checks"] = [
    { name: "tenant_registry_scan", ok: true },
    { name: "pinned_scope_identity", ok: true },
    { name: "live_mutation_fence", ok: true },
    {
      name: "non_empty_inventory_policy",
      ok: aggregate.detachedInstallations > 0 || config.allowEmptyInventory
    },
    { name: "durable_descriptor_authority", ok: aggregate.untrackedSnapshots === 0 },
    {
      name: "exact_archive_verification",
      ok:
        aggregate.missingSnapshots === 0 &&
        aggregate.corruptSnapshots === 0 &&
        aggregate.unavailableSnapshots === 0
    },
    { name: "stable_cross_store_inventory", ok: inventoryPasses >= 2 },
    {
      name: "exact_storage_inventory",
      ok: retentionInventory.malformedStorageObjects === 0
    },
    {
      name: "pinned_unreferenced_retention",
      ok:
        retentionInventory.unreferencedInventoryDigest ===
        config.expectedUnreferencedInventoryDigest
    },
    { name: "aggregate_only_receipt", ok: true }
  ];
  return {
    schemaVersion: "hosted-app-snapshot-reconciliation/v3",
    checkedAt: now().toISOString(),
    durationMs: Math.max(0, nowMs() - startedAtMs),
    scopeDigest,
    inventoryFenceDigest,
    inventoryPasses,
    inventoryGeneration: stable.generationAfter,
    inventoryGenerationDigest: hostedAppSnapshotInventoryGenerationDigest(
      scopeDigest,
      stable.generationAfter
    ),
    ...aggregate,
    ...retentionInventory,
    healthy:
      aggregate.healthy &&
      (aggregate.detachedInstallations > 0 || config.allowEmptyInventory) &&
      retentionInventory.malformedStorageObjects === 0 &&
      retentionInventory.unreferencedInventoryDigest ===
        config.expectedUnreferencedInventoryDigest,
    checks
  };
}

export async function attestHostedAppSnapshotInventoryFence(
  client: SupabaseClient,
  scopeDigest: string
): Promise<string> {
  if (!/^sha256:[0-9a-f]{64}$/.test(scopeDigest)) {
    throw new Error("Hosted App snapshot mutation fence scope is invalid");
  }
  const { data, error } = await client.rpc(
    "loopgraph_app_snapshot_inventory_fence_status_get"
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Hosted App snapshot mutation fence attestation is unavailable");
  }
  const status = data as Record<string, unknown>;
  const keys = Object.keys(status).sort();
  const expectedKeys = [
    "functionAclsPinned",
    "functionDefinitionDigests",
    "functionOwnersPinned",
    "generationReaderServiceOnly",
    "mutationFunctionsHardened",
    "mutationFunctionsTriggerOnly",
    "registryTriggerEnabled",
    "schemaVersion",
    "storageTriggerEnabled"
  ];
  const definitionDigests = status.functionDefinitionDigests;
  const expectedDefinitionDigests =
    HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS.functionDefinitionDigests;
  const definitionKeys = definitionDigests && typeof definitionDigests === "object"
    && !Array.isArray(definitionDigests)
    ? Object.keys(definitionDigests).sort()
    : [];
  const expectedDefinitionKeys = Object.keys(expectedDefinitionDigests).sort();
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => keys[index] !== key) ||
    status.schemaVersion !== HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS.schemaVersion ||
    status.storageTriggerEnabled !== true ||
    status.registryTriggerEnabled !== true ||
    status.generationReaderServiceOnly !== true ||
    status.mutationFunctionsTriggerOnly !== true ||
    status.mutationFunctionsHardened !== true ||
    status.functionOwnersPinned !== true ||
    status.functionAclsPinned !== true ||
    definitionKeys.length !== expectedDefinitionKeys.length ||
    expectedDefinitionKeys.some((key, index) => definitionKeys[index] !== key) ||
    expectedDefinitionKeys.some(
      (key) => (definitionDigests as Record<string, unknown>)[key]
        !== expectedDefinitionDigests[key as keyof typeof expectedDefinitionDigests]
    )
  ) {
    throw new Error("Hosted App snapshot mutation fence is not fully enabled");
  }
  return canonicalAppDigest({ scopeDigest, status });
}

async function collectStableHostedAppSnapshotReconciliation(
  config: { organizationId: string; projectKey: string },
  dependencies: { client: SupabaseClient; projectRoot?: string }
): Promise<{ pass: HostedAppSnapshotReconciliationPass; inventoryPasses: number }> {
  let previous: HostedAppSnapshotReconciliationPass | undefined;
  let inventoryPasses = 0;
  for (inventoryPasses = 1; inventoryPasses <= MAX_INVENTORY_STABILITY_PASSES; inventoryPasses += 1) {
    const current = await collectHostedAppSnapshotReconciliationPass(config, dependencies);
    if (
      current.generationBefore === current.generationAfter &&
      previous !== undefined &&
      previous.generationBefore === previous.generationAfter &&
      previous.generationAfter === current.generationAfter &&
      previous.stabilityDigest === current.stabilityDigest
    ) {
      return { pass: current, inventoryPasses };
    }
    previous = current;
  }
  throw new Error("Hosted App snapshot inventory changed throughout the bounded stability window");
}

async function collectHostedAppSnapshotReconciliationPass(
  config: { organizationId: string; projectKey: string },
  dependencies: { client: SupabaseClient; projectRoot?: string }
): Promise<HostedAppSnapshotReconciliationPass> {
  const generationBefore = await readHostedAppSnapshotInventoryGeneration(
    dependencies.client,
    config
  );
  const registries = await readTenantRegistries(
    dependencies.client,
    config.organizationId,
    config.projectKey
  );
  const aggregate = await reconcileHostedAppSnapshotRegistries(
    registries,
    (workspaceId) => new SupabaseAppSnapshotStore(
      dependencies.client,
      { organizationId: config.organizationId, projectKey: config.projectKey, workspaceId },
      dependencies.projectRoot ?? process.cwd()
    )
  );
  const retentionInventory = await inspectHostedAppSnapshotRetentionInventory(
    registries,
    dependencies.client,
    config
  );
  const generationAfter = await readHostedAppSnapshotInventoryGeneration(
    dependencies.client,
    config
  );
  return {
    aggregate,
    retentionInventory,
    generationBefore,
    generationAfter,
    stabilityDigest: canonicalAppDigest({
      generation: generationAfter,
      registries,
      aggregate,
      retentionInventory
    })
  };
}

async function readHostedAppSnapshotInventoryGeneration(
  client: SupabaseClient,
  scope: { organizationId: string; projectKey: string }
): Promise<number> {
  const { data, error } = await client.rpc(
    "loopgraph_app_snapshot_inventory_generation_get",
    {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey
    }
  );
  if (error) throw new Error("Hosted App snapshot inventory generation is unavailable");
  const generation = typeof data === "string" && /^\d+$/.test(data) ? Number(data) : data;
  if (!Number.isSafeInteger(generation) || Number(generation) < 0) {
    throw new Error("Hosted App snapshot inventory generation is invalid");
  }
  return Number(generation);
}

export async function inspectHostedAppSnapshotRetentionInventory(
  registries: AppInstallationRegistry[],
  client: SupabaseClient,
  scope: { organizationId: string; projectKey: string }
): Promise<HostedAppSnapshotRetentionInventory> {
  const expectedObjectKeyDigests = new Set<string>();
  for (const registry of registries) {
    for (const installation of registry.installations) {
      if (!installation.derivation?.detachedAt) continue;
      const descriptor = detachedAppSnapshotDescriptor(registry, installation);
      if (!descriptor) continue;
      expectedObjectKeyDigests.add(canonicalAppDigest({
        objectKey: hostedAppSnapshotObjectKey({
          ...scope,
          workspaceId: registry.workspaceId
        }, descriptor)
      }));
    }
  }
  const inventory = await inventoryHostedAppSnapshotObjects(client, scope);
  const unreferenced = inventory.objectKeyDigests
    .filter((digest) => !expectedObjectKeyDigests.has(digest))
    .sort();
  return {
    storageObjects: inventory.objectKeyDigests.length,
    referencedStorageObjects: inventory.objectKeyDigests.length - unreferenced.length,
    unreferencedSnapshots: unreferenced.length,
    malformedStorageObjects: inventory.malformedObjects,
    unreferencedInventoryDigest: canonicalAppDigest({ objectKeyDigests: unreferenced })
  };
}

export function hostedAppSnapshotReconciliationScopeDigest(config: {
  supabaseUrl: string;
  organizationId: string;
  projectKey: string;
}): string {
  const origin = trustedSupabaseOrigin(config.supabaseUrl);
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("App snapshot reconciliation organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(config.projectKey)) {
    throw new Error("App snapshot reconciliation project key is invalid");
  }
  return canonicalAppDigest({
    origin,
    organizationId: config.organizationId,
    projectKey: config.projectKey
  });
}

export function assertHostedAppSnapshotReconciliationScope(config: {
  supabaseUrl: string;
  organizationId: string;
  projectKey: string;
  expectedScopeDigest: string;
}): string {
  const scopeDigest = hostedAppSnapshotReconciliationScopeDigest(config);
  if (!/^sha256:[0-9a-f]{64}$/.test(config.expectedScopeDigest)) {
    throw new Error("App snapshot reconciliation expected scope digest is invalid");
  }
  if (scopeDigest !== config.expectedScopeDigest) {
    throw new Error("App snapshot reconciliation scope does not match the independently pinned identity");
  }
  return scopeDigest;
}

export function hostedAppSnapshotInventoryGenerationDigest(
  scopeDigest: string,
  generation: number
): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(scopeDigest) || !Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("App snapshot inventory generation identity is invalid");
  }
  return canonicalAppDigest({ scopeDigest, generation });
}

async function readTenantRegistries(
  client: SupabaseClient,
  organizationId: string,
  projectKey: string
): Promise<AppInstallationRegistry[]> {
  const registries: AppInstallationRegistry[] = [];
  for (let from = 0; from < MAX_REGISTRIES; from += REGISTRY_PAGE_SIZE) {
    const { data, error } = await client
      .from("loopgraph_app_installation_registries")
      .select("workspace_id,registry_payload")
      .eq("organization_id", organizationId)
      .eq("project_key", projectKey)
      .order("workspace_id", { ascending: true })
      .range(from, from + REGISTRY_PAGE_SIZE - 1);
    if (error) throw new Error("Hosted App snapshot reconciliation could not read tenant registries");
    const rows = (data ?? []) as RegistryRow[];
    for (const row of rows) {
      if (typeof row.workspace_id !== "string" || !WORKSPACE_PATTERN.test(row.workspace_id)) {
        throw new Error("Hosted App snapshot reconciliation received an invalid workspace scope");
      }
      const registry = appInstallationRegistrySchema.parse(row.registry_payload);
      if (registry.workspaceId !== row.workspace_id) {
        throw new Error("Hosted App snapshot reconciliation registry crossed its workspace scope");
      }
      registries.push(registry);
    }
    if (rows.length < REGISTRY_PAGE_SIZE) return registries;
  }
  throw new Error("Hosted App snapshot reconciliation exceeded its bounded registry inventory");
}

function trustedSupabaseOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash
  ) {
    throw new Error("App snapshot reconciliation Supabase URL must be one HTTPS origin");
  }
  return url.origin;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for App snapshot reconciliation`);
  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = required("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SUPABASE_URL");
  const organizationId = required("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ORGANIZATION_ID");
  const projectKey = required("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_PROJECT_KEY");
  if (process.argv.includes("--print-scope-digest")) {
    process.stdout.write(`${hostedAppSnapshotReconciliationScopeDigest({
      supabaseUrl,
      organizationId,
      projectKey
    })}\n`);
    return;
  }
  const expectedScopeDigest = required("LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RECONCILIATION_SCOPE_DIGEST");
  const scopeDigest = assertHostedAppSnapshotReconciliationScope({
    supabaseUrl,
    organizationId,
    projectKey,
    expectedScopeDigest
  });
  const serviceRole = await readProjectedSecretFile(
    required("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SERVICE_ROLE_KEY_FILE"),
    "LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SERVICE_ROLE_KEY_FILE"
  );
  const client = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  if (process.argv.includes("--print-unreferenced-inventory-digest")) {
    const inventoryFenceDigest = await attestHostedAppSnapshotInventoryFence(client, scopeDigest);
    const { pass, inventoryPasses } = await collectStableHostedAppSnapshotReconciliation(
      { organizationId, projectKey },
      { client }
    );
    const inventory = pass.retentionInventory;
    process.stdout.write(`${JSON.stringify({
      inventoryPasses,
      inventoryFenceDigest,
      inventoryGeneration: pass.generationAfter,
      inventoryGenerationDigest: hostedAppSnapshotInventoryGenerationDigest(
        scopeDigest,
        pass.generationAfter
      ),
      unreferencedSnapshots: inventory.unreferencedSnapshots,
      malformedStorageObjects: inventory.malformedStorageObjects,
      unreferencedInventoryDigest: inventory.unreferencedInventoryDigest
    })}\n`);
    return;
  }
  const receipt = await reconcileHostedAppSnapshots({
    supabaseUrl,
    organizationId,
    projectKey,
    expectedScopeDigest,
    expectedUnreferencedInventoryDigest: required(
      "LOOPGRAPH_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST"
    ),
    allowEmptyInventory: exactBoolean(
      required("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ALLOW_EMPTY"),
      "LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ALLOW_EMPTY"
    )
  }, { client });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.healthy) process.exitCode = 1;
}

function exactBoolean(value: string, label: string): boolean {
  if (value === "yes") return true;
  if (value === "no") return false;
  throw new Error(`${label} must be exactly yes or no`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "App snapshot reconciliation failed"}\n`);
    process.exitCode = 1;
  });
}
