import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalAppDigest } from "loopgraph/core";
import {
  appInstallationRegistrySchema,
  reconcileAppSnapshots,
  type AppInstallationRegistry,
  type AppSnapshotReconciliationResult,
  type AppSnapshotStore
} from "loopgraph/runtime";
import { SupabaseAppSnapshotStore } from "../lib/db/adapters/supabase-app-snapshot-store";
import { readProjectedSecretFile } from "./projected-secret-file";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WORKSPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,159}$/;
const REGISTRY_PAGE_SIZE = 100;
const MAX_REGISTRIES = 10_000;

type RegistryRow = { workspace_id: unknown; registry_payload: unknown };

export type HostedAppSnapshotReconciliationReceipt = AppSnapshotReconciliationResult & {
  schemaVersion: "hosted-app-snapshot-reconciliation/v1";
  checkedAt: string;
  durationMs: number;
  scopeDigest: string;
  registriesScanned: number;
  checks: Array<{
    name:
      | "tenant_registry_scan"
      | "pinned_scope_identity"
      | "non_empty_inventory_policy"
      | "durable_descriptor_authority"
      | "exact_archive_verification"
      | "aggregate_only_receipt";
    ok: boolean;
  }>;
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
    allowEmptyInventory: boolean;
  },
  dependencies: {
    client: SupabaseClient;
    now?: () => Date;
    nowMs?: () => number;
    projectRoot?: string;
  }
): Promise<HostedAppSnapshotReconciliationReceipt> {
  const scopeDigest = hostedAppSnapshotReconciliationScopeDigest(config);
  if (!/^sha256:[0-9a-f]{64}$/.test(config.expectedScopeDigest)) {
    throw new Error("App snapshot reconciliation expected scope digest is invalid");
  }
  if (scopeDigest !== config.expectedScopeDigest) {
    throw new Error("App snapshot reconciliation scope does not match the independently pinned identity");
  }
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAtMs = nowMs();
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
  const checks: HostedAppSnapshotReconciliationReceipt["checks"] = [
    { name: "tenant_registry_scan", ok: true },
    { name: "pinned_scope_identity", ok: true },
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
    { name: "aggregate_only_receipt", ok: true }
  ];
  return {
    schemaVersion: "hosted-app-snapshot-reconciliation/v1",
    checkedAt: now().toISOString(),
    durationMs: Math.max(0, nowMs() - startedAtMs),
    scopeDigest,
    ...aggregate,
    healthy:
      aggregate.healthy &&
      (aggregate.detachedInstallations > 0 || config.allowEmptyInventory),
    checks
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
  const serviceRole = await readProjectedSecretFile(
    required("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SERVICE_ROLE_KEY_FILE"),
    "LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SERVICE_ROLE_KEY_FILE"
  );
  const receipt = await reconcileHostedAppSnapshots({
    supabaseUrl,
    organizationId,
    projectKey,
    expectedScopeDigest: required("LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RECONCILIATION_SCOPE_DIGEST"),
    allowEmptyInventory: exactBoolean(
      required("LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ALLOW_EMPTY"),
      "LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ALLOW_EMPTY"
    )
  }, {
    client: createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  });
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
