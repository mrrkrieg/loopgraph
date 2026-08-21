import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONNECTOR_RECIPE_SCHEMA_VERSION,
  PROVIDER_SCHEMA_SNAPSHOT_VERSION,
  appIdSchema,
  connectorFieldMappingSchema,
  contentHash,
  providerSchemaSnapshotSchema,
  type ConnectorFieldMapping,
  type ProviderSchemaSnapshot
} from "loopgraph/core";
import type {
  ConnectorFieldMappingStore,
  ProviderSchemaSnapshotStore
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scope = { organizationId: string; projectKey: string; workspaceId: string };

export class SupabaseProviderSchemaSnapshotStore implements ProviderSchemaSnapshotStore {
  readonly persistence = "distributed" as const;

  constructor(private readonly supabase: SupabaseClient, private readonly scope: Scope) {
    assertScope(scope);
  }

  async list(): Promise<ProviderSchemaSnapshot[]> {
    return this.listPayloads("loopgraph_provider_schema_snapshots", providerSchemaSnapshotSchema);
  }

  async get(connectionId: string, now = new Date()): Promise<ProviderSchemaSnapshot | undefined> {
    const snapshot = (await this.list()).find((candidate) => candidate.connectionId === connectionId);
    if (!snapshot?.expiresAt || Date.parse(snapshot.expiresAt) > now.getTime()) return snapshot;
    return undefined;
  }

  async save(input: {
    connectionId: string;
    providerId: string;
    source: ProviderSchemaSnapshot["source"];
    samplePolicy: "redacted_only";
    objects: ProviderSchemaSnapshot["objects"];
    inspectedBy: string;
    inspectedAt?: string;
    expiresAt?: string;
  }): Promise<ProviderSchemaSnapshot> {
    const snapshot = providerSchemaSnapshotSchema.parse({
      schemaVersion: PROVIDER_SCHEMA_SNAPSHOT_VERSION,
      workspaceId: this.scope.workspaceId,
      ...input,
      objects: input.objects.map((object) => ({
        ...object,
        fields: object.fields.map((field) => ({ ...field, sampleValues: [] }))
      })),
      inspectedAt: input.inspectedAt ?? new Date().toISOString()
    });
    const { error } = await this.supabase.rpc("upsert_loopgraph_provider_schema_snapshot", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_snapshot: snapshot
    });
    if (error) throw new Error(`Failed to store provider schema snapshot: ${error.message}`);
    return snapshot;
  }

  private listPayloads<T>(table: string, schema: { parse(input: unknown): T }): Promise<T[]> {
    return listScopedPayloads(this.supabase, this.scope, table, schema);
  }
}

export class SupabaseConnectorFieldMappingStore implements ConnectorFieldMappingStore {
  readonly persistence = "distributed" as const;

  constructor(private readonly supabase: SupabaseClient, private readonly scope: Scope) {
    assertScope(scope);
  }

  async list(): Promise<ConnectorFieldMapping[]> {
    return listScopedPayloads(this.supabase, this.scope, "loopgraph_connector_field_mappings", connectorFieldMappingSchema);
  }

  async saveConfirmed(input: {
    connectionId: string;
    objectType: string;
    logicalField: string;
    providerField: string;
    direction: "read" | "write" | "bidirectional";
    transform?: ConnectorFieldMapping["transform"];
    confidence: number;
    confirmedBy: string;
    installationId?: string;
    now?: Date;
  }): Promise<ConnectorFieldMapping> {
    const mappings = await this.list();
    const id = `mapping.${contentHash({
      workspaceId: this.scope.workspaceId,
      connectionId: input.connectionId,
      objectType: input.objectType,
      logicalField: input.logicalField
    })}`;
    const existing = mappings.find((mapping) => mapping.id === id);
    const timestamp = (input.now ?? new Date()).toISOString();
    const mapping = connectorFieldMappingSchema.parse({
      schemaVersion: CONNECTOR_RECIPE_SCHEMA_VERSION,
      id,
      workspaceId: this.scope.workspaceId,
      connectionId: input.connectionId,
      objectType: input.objectType,
      logicalField: input.logicalField,
      providerField: input.providerField,
      direction: input.direction,
      transform: input.transform ?? { kind: "identity", config: {} },
      confidence: input.confidence,
      verified: true,
      confirmedBy: input.confirmedBy,
      dependentInstallationIds: Array.from(new Set([
        ...(existing?.dependentInstallationIds ?? []),
        ...(input.installationId ? [input.installationId] : [])
      ])).sort(),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    const { error } = await this.supabase.rpc("upsert_loopgraph_connector_field_mapping", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_mapping: mapping
    });
    if (error) throw new Error(`Failed to store connector field mapping: ${error.message}`);
    return mapping;
  }

  async attachInstallation(mappingIdsInput: string[], installationIdInput: string): Promise<ConnectorFieldMapping[]> {
    const mappingIds = [...new Set(mappingIdsInput.map((id) => appIdSchema.parse(id)))].sort();
    const installationId = appIdSchema.parse(installationIdInput);
    if (mappingIds.length === 0) return this.list();
    const { error } = await this.supabase.rpc("attach_loopgraph_connector_field_mappings", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_mapping_ids: mappingIds,
      p_installation_id: installationId
    });
    if (error) throw new Error(`Failed to attach connector field mappings: ${error.message}`);
    return this.list();
  }

  async detachInstallation(installationIdInput: string, now = new Date()): Promise<ConnectorFieldMapping[]> {
    const installationId = appIdSchema.parse(installationIdInput);
    const { error } = await this.supabase.rpc("detach_loopgraph_connector_field_mappings", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_installation_id: installationId,
      p_detached_at: now.toISOString()
    });
    if (error) throw new Error(`Failed to detach connector field mappings: ${error.message}`);
    return this.list();
  }
}

async function listScopedPayloads<T>(
  supabase: SupabaseClient,
  scope: Scope,
  table: string,
  schema: { parse(input: unknown): T }
): Promise<T[]> {
  const values: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("payload")
      .eq("organization_id", scope.organizationId)
      .eq("project_key", scope.projectKey)
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to list hosted App connector metadata: ${error.message}`);
    const page = (data ?? []) as Array<{ payload: unknown }>;
    values.push(...page.map((row) => schema.parse(row.payload)));
    if (page.length < PAGE_SIZE) return values;
  }
}

function assertScope(scope: Scope): void {
  if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("App connector metadata organization ID must be a UUID");
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("App connector metadata project key is invalid");
  appIdSchema.parse(scope.workspaceId);
}

export function isSupabaseAppConnectorMetadataStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID);
}

export function createSupabaseProviderSchemaSnapshotStore(workspaceId: string): SupabaseProviderSchemaSnapshotStore {
  return new SupabaseProviderSchemaSnapshotStore(requiredClient(), hostedScope(workspaceId));
}

export function createSupabaseConnectorFieldMappingStore(workspaceId: string): SupabaseConnectorFieldMappingStore {
  return new SupabaseConnectorFieldMappingStore(requiredClient(), hostedScope(workspaceId));
}

function requiredClient(): NonNullable<ReturnType<typeof createSupabaseAdminClient>> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase App connector metadata storage requires a hosted database");
  return supabase;
}

function hostedScope(workspaceId: string): Scope {
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  if (!organizationId) throw new Error("Supabase App connector metadata storage requires a hosted organization");
  return {
    organizationId,
    projectKey: process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default",
    workspaceId
  };
}
