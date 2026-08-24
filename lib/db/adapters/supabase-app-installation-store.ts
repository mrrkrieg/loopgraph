import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appInstallationLockSchema, type AppInstallationLock } from "loopgraph/core";
import {
  appInstallationMutationAuditContextSchema,
  appInstallationRegistrySchema,
  assertAppInstallationRegistryRevision,
  emptyAppInstallationRegistry,
  type AppInstallationRegistry,
  type AppInstallationStore,
  type AppInstallationUpdate
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_SECONDS = 300;

type Scope = { organizationId: string; projectKey: string; workspaceId: string };
type RegistryRow = { registry_payload: unknown; lock_payload: unknown | null };

/**
 * Tenant-scoped hosted App installation registry.
 *
 * Mutations acquire a short database lease before running the shared App
 * lifecycle operation and commit through a revision-bound RPC. This prevents
 * two serverless instances from independently advancing the same registry.
 */
export class SupabaseAppInstallationStore implements AppInstallationStore {
  readonly persistence = "distributed" as const;

  constructor(private readonly supabase: SupabaseClient, private readonly scope: Scope) {
    if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("App installation store organization ID must be a UUID");
    if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("App installation store project key is invalid");
    if (scope.workspaceId.length < 1 || scope.workspaceId.length > 160) throw new Error("App installation store workspace ID is invalid");
  }

  async read(): Promise<AppInstallationRegistry> {
    const row = await this.readRow();
    if (!row) return emptyAppInstallationRegistry(this.scope.workspaceId);
    return this.parseRegistry(row.registry_payload);
  }

  async readLockfile(): Promise<AppInstallationLock | undefined> {
    const row = await this.readRow();
    return row?.lock_payload ? appInstallationLockSchema.parse(row.lock_payload) : undefined;
  }

  async withExclusiveUpdate<T>(
    operation: (registry: AppInstallationRegistry) => Promise<AppInstallationUpdate<T>>
  ): Promise<T> {
    const observed = await this.read();
    const leaseToken = randomUUID();
    const { data, error } = await this.supabase.rpc("acquire_loopgraph_app_installation_lease", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_expected_revision: observed.revision,
      p_lease_token: leaseToken,
      p_lease_seconds: LEASE_SECONDS
    });
    if (error) throw new Error(`Failed to acquire App installation mutation lease: ${error.message}`);
    const acquired = asRegistryRow(data);
    const current = this.parseRegistry(acquired.registry_payload);
    const currentLock = acquired.lock_payload ? appInstallationLockSchema.parse(acquired.lock_payload) : undefined;
    let committed = false;
    try {
      const result = await operation(current);
      const next = this.parseRegistry(result.registry);
      assertAppInstallationRegistryRevision(current, next);
      const lock = result.lock ? appInstallationLockSchema.parse(result.lock) : currentLock;
      const audit = result.audit ? appInstallationMutationAuditContextSchema.parse(result.audit) : undefined;
      const commit = await this.supabase.rpc(
        audit
          ? "commit_loopgraph_app_installation_registry_with_audit"
          : "commit_loopgraph_app_installation_registry",
        {
          p_organization_id: this.scope.organizationId,
          p_project_key: this.scope.projectKey,
          p_workspace_id: this.scope.workspaceId,
          p_expected_revision: current.revision,
          p_lease_token: leaseToken,
          p_registry: next,
          p_lock: lock ?? null,
          ...(audit ? { p_audit_context: audit } : {})
        }
      );
      if (commit.error) throw new Error(`Failed to commit App installation registry: ${commit.error.message}`);
      committed = true;
      return result.value;
    } finally {
      if (!committed) {
        await this.supabase.rpc("release_loopgraph_app_installation_lease", {
          p_organization_id: this.scope.organizationId,
          p_project_key: this.scope.projectKey,
          p_workspace_id: this.scope.workspaceId,
          p_lease_token: leaseToken
        });
      }
    }
  }

  private parseRegistry(input: unknown): AppInstallationRegistry {
    const registry = appInstallationRegistrySchema.parse(input);
    if (registry.workspaceId !== this.scope.workspaceId) {
      throw new Error("Installation registry belongs to another workspace");
    }
    return registry;
  }

  private async readRow(): Promise<RegistryRow | undefined> {
    const { data, error } = await this.supabase
      .from("loopgraph_app_installation_registries")
      .select("registry_payload,lock_payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("workspace_id", this.scope.workspaceId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read App installation registry: ${error.message}`);
    return data ? asRegistryRow(data) : undefined;
  }
}

function asRegistryRow(value: unknown): RegistryRow {
  if (!value || typeof value !== "object" || !("registry_payload" in value)) {
    throw new Error("Hosted App installation registry returned an invalid payload");
  }
  const row = value as Record<string, unknown>;
  return {
    registry_payload: row.registry_payload,
    lock_payload: row.lock_payload ?? null
  };
}

export function isSupabaseAppInstallationStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID);
}

export function createSupabaseAppInstallationStore(workspaceId: string): SupabaseAppInstallationStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) throw new Error("Supabase App installation storage requires a hosted organization");
  return new SupabaseAppInstallationStore(supabase, { organizationId, projectKey, workspaceId });
}
