import "server-only";

import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BusinessDiscoverySessionSchema,
  contentHash,
  loopSpecVersionHash,
  normalizeDepartmentType,
  validateLoopSpec
} from "loopgraph/core";
import type {
  LoopSpecMaterializationCommitInput,
  LoopSpecMaterializationCommitResult,
  LoopSpecRegistryStore,
  LoopSpecWorkspaceSnapshot,
  StoredLoopSpecArtifact
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WorkspaceRow = {
  payload: unknown;
  revision: number | string;
};

type RegistryRow = {
  loop_id: string;
  active_version_hash: string;
  spec: unknown;
  entry: unknown;
  fixtures: unknown;
  source: string;
  source_ref: string;
  activated_at: string;
};

type CommitResult = {
  workspace: unknown;
  workspace_revision: number | string;
  artifacts: unknown;
  discovery_session?: unknown | null;
  created: boolean;
};

export type SupabaseLoopSpecRegistryScope = {
  organizationId: string;
  projectKey: string;
};

export class SupabaseLoopSpecRegistryStore
implements LoopSpecRegistryStore {
  readonly persistence = "distributed" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseLoopSpecRegistryScope
  ) {
    assertScope(scope);
  }

  async getWorkspace(projectRoot: string): Promise<LoopSpecWorkspaceSnapshot> {
    const { data, error } = await this.supabase
      .from("loop_spec_workspaces")
      .select("payload, revision")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read LoopSpec workspace: ${error.message}`);
    }
    if (!data) {
      return {
        workspace: defaultWorkspace(projectRoot),
        revision: 0
      };
    }
    const row = data as WorkspaceRow;
    return {
      workspace: parseWorkspace(row.payload, projectRoot),
      revision: numericRevision(row.revision)
    };
  }

  async listActiveLoopSpecs(
    projectRoot: string
  ): Promise<StoredLoopSpecArtifact[]> {
    void projectRoot;
    const artifacts: StoredLoopSpecArtifact[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from("loop_spec_registry")
        .select(
          "loop_id, active_version_hash, spec, entry, fixtures, source, source_ref, activated_at"
        )
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey)
        .order("loop_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list active LoopSpecs: ${error.message}`);
      }
      const page = (data ?? []) as RegistryRow[];
      artifacts.push(...page.map((row) => parseRegistryRow(row)));
      if (page.length < PAGE_SIZE) return artifacts;
    }
  }

  async getActiveLoopSpec(
    projectRoot: string,
    loopId: string
  ): Promise<StoredLoopSpecArtifact | undefined> {
    void projectRoot;
    const { data, error } = await this.supabase
      .from("loop_spec_registry")
      .select(
        "loop_id, active_version_hash, spec, entry, fixtures, source, source_ref, activated_at"
      )
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("loop_id", loopId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read active LoopSpec: ${error.message}`);
    }
    return data
      ? parseRegistryRow(data as RegistryRow)
      : undefined;
  }

  async commitMaterializationAtomically(
    input: LoopSpecMaterializationCommitInput
  ): Promise<LoopSpecMaterializationCommitResult> {
    const artifacts = input.artifacts.map((artifact) => {
      const sourceRef = this.artifactRef(
        artifact.loopId,
        artifact.versionHash
      );
      return {
        ...artifact,
        entry: {
          ...artifact.entry,
          path: sourceRef
        },
        sourceRef
      };
    });
    const workspaceSeed = defaultWorkspace(input.projectRoot);
    const transition = input.discoverySessionTransition;
    const { data, error } = await this.supabase.rpc(
      "commit_loop_spec_registry",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_project_root: path.resolve(input.projectRoot),
        p_commit_id: input.commitId,
        p_idempotency_key: input.idempotencyKey,
        p_expected_workspace_revision: input.expectedRevision,
        p_committed_at: input.committedAt,
        p_workspace_seed: workspaceSeed,
        p_artifacts: artifacts,
        p_discovery_session_id: transition?.session.id ?? null,
        p_expected_discovery_revision:
          transition?.expectedRevision ?? null,
        p_discovery_session: transition?.session ?? null
      }
    );
    if (error) {
      throw new Error(`Failed to commit LoopSpec registry: ${error.message}`);
    }
    const result = firstRow<CommitResult>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error("LoopSpec registry commit did not return an atomic result");
    }
    const workspaceRevision = numericRevision(result.workspace_revision);
    if (result.created && workspaceRevision !== input.expectedRevision + 1) {
      throw new Error(
        `LoopSpec workspace revision is inconsistent: ${workspaceRevision}`
      );
    }
    const savedArtifacts = parseArtifactArray(result.artifacts);
    assertSameArtifacts(artifacts, savedArtifacts);
    const discoverySession = result.discovery_session
      ? BusinessDiscoverySessionSchema.parse(result.discovery_session)
      : undefined;
    if (transition) {
      if (
        !discoverySession ||
        contentHash(discoverySession) !== contentHash(transition.session)
      ) {
        throw new Error(
          "LoopSpec registry commit returned an inconsistent discovery transition"
        );
      }
    }
    return {
      workspace: parseWorkspace(result.workspace, input.projectRoot),
      workspaceRevision,
      artifacts: savedArtifacts,
      ...(discoverySession ? { discoverySession } : {}),
      created: result.created,
      commitRef: this.commitRef(input.commitId)
    };
  }

  private artifactRef(loopId: string, versionHash: string): string {
    return `supabase://${this.scope.organizationId}/${this.scope.projectKey}/loop-specs/${encodeURIComponent(loopId)}/versions/${versionHash}`;
  }

  private commitRef(commitId: string): string {
    return `supabase://${this.scope.organizationId}/${this.scope.projectKey}/loop-spec-commits/${encodeURIComponent(commitId)}`;
  }
}

export function isSupabaseLoopSpecRegistryStoreEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseLoopSpecRegistryStore(): LoopSpecRegistryStore {
  const supabase = createSupabaseAdminClient();
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase LoopSpec registry storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  return new SupabaseLoopSpecRegistryStore(supabase, {
    organizationId,
    projectKey
  });
}

function parseRegistryRow(row: RegistryRow): StoredLoopSpecArtifact {
  const spec = validateLoopSpec(row.spec);
  if (
    spec.metadata.id !== row.loop_id ||
    loopSpecVersionHash(spec) !== row.active_version_hash
  ) {
    throw new Error(`Stored LoopSpec integrity check failed: ${row.loop_id}`);
  }
  const entry = parseEntry(row.entry);
  if (entry.id !== row.loop_id || entry.path !== row.source_ref) {
    throw new Error(`Stored LoopSpec registry entry is inconsistent: ${row.loop_id}`);
  }
  return {
    loopId: row.loop_id,
    versionHash: row.active_version_hash,
    spec,
    entry,
    fixtures: parseObject(row.fixtures, "LoopSpec fixtures"),
    source: parseSource(row.source),
    sourceRef: row.source_ref,
    createdAt: row.activated_at
  };
}

function parseArtifactArray(value: unknown): StoredLoopSpecArtifact[] {
  if (!Array.isArray(value)) {
    throw new Error("LoopSpec registry commit returned invalid artifacts");
  }
  return value.map((item) => {
    const record = parseObject(item, "LoopSpec artifact");
    return parseRegistryRow({
      loop_id: stringValue(record.loopId, "loopId"),
      active_version_hash: stringValue(record.versionHash, "versionHash"),
      spec: record.spec,
      entry: record.entry,
      fixtures: record.fixtures ?? {},
      source: stringValue(record.source, "source"),
      source_ref: stringValue(record.sourceRef, "sourceRef"),
      activated_at: stringValue(record.createdAt, "createdAt")
    });
  });
}

function parseWorkspace(value: unknown, projectRoot: string) {
  const record = parseObject(value, "LoopSpec workspace");
  const registeredSpecs = Array.isArray(record.registeredSpecs)
    ? record.registeredSpecs.map((entry) => parseEntry(entry))
    : [];
  return {
    version: 1 as const,
    schemaVersion: "workspace/v1alpha1" as const,
    projectRoot: path.resolve(projectRoot),
    projectRootId:
      typeof record.projectRootId === "string"
        ? record.projectRootId
        : `project_${contentHash(path.resolve(projectRoot))}`,
    displayName:
      typeof record.displayName === "string"
        ? record.displayName
        : path.basename(path.resolve(projectRoot)),
    demoCatalogEnabled: record.demoCatalogEnabled === true,
    registeredSpecs,
    initializedAt:
      typeof record.initializedAt === "string"
        ? record.initializedAt
        : new Date(0).toISOString(),
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date(0).toISOString()
  };
}

function defaultWorkspace(projectRoot: string) {
  const resolved = path.resolve(projectRoot);
  const epoch = new Date(0).toISOString();
  return {
    version: 1 as const,
    schemaVersion: "workspace/v1alpha1" as const,
    projectRoot: resolved,
    projectRootId: `project_${contentHash(resolved)}`,
    displayName: path.basename(resolved),
    demoCatalogEnabled: false,
    registeredSpecs: [],
    initializedAt: epoch,
    updatedAt: epoch
  };
}

function parseEntry(value: unknown) {
  const record = parseObject(value, "LoopSpec registry entry");
  const department =
    normalizeDepartmentType(stringValue(record.department, "department")) ??
    "custom";
  return {
    id: stringValue(record.id, "id"),
    name: stringValue(record.name, "name"),
    path: stringValue(record.path, "path"),
    ...(typeof record.templateId === "string"
      ? { templateId: record.templateId }
      : {}),
    department,
    addedAt:
      typeof record.addedAt === "string"
        ? record.addedAt
        : new Date(0).toISOString()
  };
}

function assertSameArtifacts(
  expected: StoredLoopSpecArtifact[],
  actual: StoredLoopSpecArtifact[]
): void {
  const bindings = (items: StoredLoopSpecArtifact[]) =>
    items.map((item) => ({
      loopId: item.loopId,
      versionHash: item.versionHash,
      sourceRef: item.sourceRef
    })).sort((left, right) => left.loopId.localeCompare(right.loopId));
  if (contentHash(bindings(expected)) !== contentHash(bindings(actual))) {
    throw new Error(
      "Idempotent LoopSpec registry commit resolved to conflicting artifacts"
    );
  }
}

function assertScope(scope: SupabaseLoopSpecRegistryScope): void {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("LoopSpec registry organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("LoopSpec registry project key is invalid");
  }
}

function parseSource(value: string): StoredLoopSpecArtifact["source"] {
  if (
    value === "hermes_design" ||
    value === "semantic_graph" ||
    value === "design_studio" ||
    value === "import"
  ) {
    return value;
  }
  throw new Error(`Stored LoopSpec source is invalid: ${value}`);
}

function numericRevision(value: number | string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("LoopSpec workspace revision is invalid");
  }
  return revision;
}

function parseObject(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  label: string
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`LoopSpec ${label} must be a non-empty string`);
  }
  return value;
}

function firstRow<T>(data: unknown): T | undefined {
  if (Array.isArray(data)) return data[0] as T | undefined;
  return data && typeof data === "object" ? data as T : undefined;
}
