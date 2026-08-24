import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  contentHash,
  loopSpecVersionHash,
  normalizeDepartmentType,
  validateLoopSpec,
  type BusinessDiscoverySession,
  type LoopSpec
} from "../core";
import { loadLoopSpecFromPath } from "./loader";
import type {
  LoopgraphWorkspaceRegistry,
  RegisteredLoopSpec
} from "./workspace";

export type StoredLoopSpecArtifact = {
  loopId: string;
  versionHash: string;
  spec: LoopSpec;
  entry: RegisteredLoopSpec;
  fixtures: Record<string, unknown>;
  source: "hermes_design" | "semantic_graph" | "design_studio" | "import";
  sourceRef?: string;
  createdAt: string;
};

export type LoopSpecWorkspaceSnapshot = {
  workspace: LoopgraphWorkspaceRegistry;
  revision: number;
};

export type LoopSpecMaterializationCommitInput = {
  commitId: string;
  idempotencyKey: string;
  expectedRevision: number;
  projectRoot: string;
  committedAt: string;
  artifacts: StoredLoopSpecArtifact[];
  removeLoopIds?: string[];
  discoverySessionTransition?: {
    expectedRevision: number;
    session: BusinessDiscoverySession;
  };
};

export type LoopSpecMaterializationCommitResult = {
  workspace: LoopgraphWorkspaceRegistry;
  workspaceRevision: number;
  artifacts: StoredLoopSpecArtifact[];
  removedLoopIds?: string[];
  discoverySession?: BusinessDiscoverySession;
  created: boolean;
  commitRef: string;
};

/**
 * Canonical active/versioned LoopSpec boundary. Hosted implementations keep
 * immutable versions and the active registry in one tenant/project database
 * transaction. The local implementation preserves portable project files.
 */
export interface LoopSpecRegistryStore {
  readonly persistence: "file" | "distributed";
  getWorkspace(projectRoot: string): Promise<LoopSpecWorkspaceSnapshot>;
  listActiveLoopSpecs(
    projectRoot: string
  ): Promise<StoredLoopSpecArtifact[]>;
  getActiveLoopSpec(
    projectRoot: string,
    loopId: string
  ): Promise<StoredLoopSpecArtifact | undefined>;
  commitMaterializationAtomically(
    input: LoopSpecMaterializationCommitInput
  ): Promise<LoopSpecMaterializationCommitResult>;
}

export class FileLoopSpecRegistryStore implements LoopSpecRegistryStore {
  readonly persistence = "file" as const;

  constructor(private readonly defaultProjectRoot = process.cwd()) {}

  async getWorkspace(projectRoot: string): Promise<LoopSpecWorkspaceSnapshot> {
    const resolvedProjectRoot = path.resolve(
      projectRoot || this.defaultProjectRoot
    );
    const workspace = await readWorkspaceFile(resolvedProjectRoot);
    const revision = await readRevisionFile(resolvedProjectRoot);
    return { workspace, revision };
  }

  async listActiveLoopSpecs(
    projectRoot: string
  ): Promise<StoredLoopSpecArtifact[]> {
    const resolvedProjectRoot = path.resolve(
      projectRoot || this.defaultProjectRoot
    );
    const { workspace } = await this.getWorkspace(resolvedProjectRoot);
    const artifacts: StoredLoopSpecArtifact[] = [];
    for (const entry of workspace.registeredSpecs) {
      const sourcePath = resolveConfinedPath(resolvedProjectRoot, entry.path);
      const loaded = await loadLoopSpecFromPath(sourcePath);
      if (!loaded.ok) continue;
      artifacts.push({
        loopId: loaded.spec.metadata.id,
        versionHash: loopSpecVersionHash(loaded.spec),
        spec: loaded.spec,
        entry,
        fixtures: {},
        source: sourceFromSpec(loaded.spec),
        sourceRef: loaded.sourcePath,
        createdAt: entry.addedAt
      });
    }
    return artifacts.sort((left, right) =>
      left.entry.name.localeCompare(right.entry.name)
    );
  }

  async getActiveLoopSpec(
    projectRoot: string,
    loopId: string
  ): Promise<StoredLoopSpecArtifact | undefined> {
    return (await this.listActiveLoopSpecs(projectRoot)).find(
      (artifact) => artifact.loopId === loopId
    );
  }

  async commitMaterializationAtomically(
    input: LoopSpecMaterializationCommitInput
  ): Promise<LoopSpecMaterializationCommitResult> {
    const projectRoot = path.resolve(input.projectRoot);
    validateCommitInput(input);
    return withFileLock(projectRoot, async () => {
      const existingReceipt = await readCommitReceipt(
        projectRoot,
        input.idempotencyKey
      );
      if (existingReceipt) {
        assertSameCommit(input, existingReceipt);
        return {
          ...existingReceipt,
          created: false
        };
      }

      const current = await this.getWorkspace(projectRoot);
      if (current.revision !== input.expectedRevision) {
        throw new Error(
          `LoopSpec workspace revision mismatch: expected ${input.expectedRevision}, found ${current.revision}`
        );
      }

      const entriesById = new Map(
        current.workspace.registeredSpecs.map((entry) => [entry.id, entry])
      );
      const removeLoopIds = Array.from(new Set(input.removeLoopIds ?? [])).sort();
      const removedEntries = removeLoopIds.flatMap((loopId) => {
        const entry = entriesById.get(loopId);
        return entry ? [entry] : [];
      });
      for (const loopId of removeLoopIds) entriesById.delete(loopId);
      for (const artifact of input.artifacts) {
        const finalPath = resolveConfinedPath(projectRoot, artifact.entry.path);
        await writeSpecAtomic(finalPath, artifact.spec);
        await writeFixtures(projectRoot, finalPath, artifact.fixtures);
        entriesById.set(artifact.loopId, {
          ...artifact.entry,
          path: registryPath(projectRoot, finalPath)
        });
      }

      const workspace: LoopgraphWorkspaceRegistry = {
        ...current.workspace,
        registeredSpecs: [...entriesById.values()].sort((left, right) =>
          left.name.localeCompare(right.name)
        ),
        updatedAt: input.committedAt
      };
      await writeWorkspaceFile(projectRoot, workspace);
      await writeRevisionFile(projectRoot, current.revision + 1);
      for (const entry of removedEntries) {
        await rm(resolveConfinedPath(projectRoot, entry.path), { force: true });
      }

      const result: LoopSpecMaterializationCommitResult = {
        workspace,
        workspaceRevision: current.revision + 1,
        artifacts: input.artifacts.map((artifact) => ({
          ...artifact,
          entry: {
            ...artifact.entry,
            path: registryPath(
              projectRoot,
              resolveConfinedPath(projectRoot, artifact.entry.path)
            )
          },
          sourceRef: resolveConfinedPath(projectRoot, artifact.entry.path)
        })),
        removedLoopIds: removeLoopIds,
        ...(input.discoverySessionTransition
          ? { discoverySession: input.discoverySessionTransition.session }
          : {}),
        created: true,
        commitRef: commitReceiptPath(projectRoot, input.idempotencyKey)
      };
      await writeCommitReceipt(projectRoot, input, result);
      return result;
    });
  }
}

export function createStoredLoopSpecArtifact(input: {
  spec: LoopSpec;
  entry: RegisteredLoopSpec;
  fixtures?: Record<string, unknown>;
  source: StoredLoopSpecArtifact["source"];
  sourceRef?: string;
  createdAt: string;
}): StoredLoopSpecArtifact {
  const spec = validateLoopSpec(input.spec);
  if (spec.metadata.id !== input.entry.id) {
    throw new Error("LoopSpec artifact entry does not match its spec identity");
  }
  return {
    loopId: spec.metadata.id,
    versionHash: loopSpecVersionHash(spec),
    spec,
    entry: input.entry,
    fixtures: input.fixtures ?? {},
    source: input.source,
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    createdAt: input.createdAt
  };
}

function validateCommitInput(input: LoopSpecMaterializationCommitInput): void {
  if (!input.commitId || !input.idempotencyKey) {
    throw new Error("LoopSpec materialization commit identity is required");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("LoopSpec workspace revision is invalid");
  }
  const removeLoopIds = Array.from(new Set(input.removeLoopIds ?? []));
  if (input.artifacts.length + removeLoopIds.length === 0 || input.artifacts.length + removeLoopIds.length > 32) {
    throw new Error("LoopSpec materialization must contain 1 to 32 artifact writes or removals");
  }
  const loopIds = new Set<string>();
  for (const artifact of input.artifacts) {
    const parsed = createStoredLoopSpecArtifact(artifact);
    if (parsed.versionHash !== artifact.versionHash) {
      throw new Error(
        `LoopSpec version hash does not match content: ${artifact.loopId}`
      );
    }
    if (loopIds.has(artifact.loopId)) {
      throw new Error(`Duplicate LoopSpec in materialization: ${artifact.loopId}`);
    }
    loopIds.add(artifact.loopId);
  }
  for (const loopId of removeLoopIds) {
    if (!loopId) throw new Error("Removed LoopSpec identity is required");
    if (loopIds.has(loopId)) throw new Error(`LoopSpec cannot be written and removed in one materialization: ${loopId}`);
  }
}

function assertSameCommit(
  input: LoopSpecMaterializationCommitInput,
  existing: LoopSpecMaterializationCommitResult
): void {
  const expected = input.artifacts.map((artifact) => ({
    loopId: artifact.loopId,
    versionHash: artifact.versionHash
  }));
  const actual = existing.artifacts.map((artifact) => ({
    loopId: artifact.loopId,
    versionHash: artifact.versionHash
  }));
  if (contentHash({ artifacts: expected, removedLoopIds: [...(input.removeLoopIds ?? [])].sort() }) !== contentHash({
    artifacts: actual,
    removedLoopIds: [...(existing.removedLoopIds ?? [])].sort()
  })) {
    throw new Error(
      "Idempotent LoopSpec materialization resolved to conflicting content"
    );
  }
}

async function readWorkspaceFile(
  projectRoot: string
): Promise<LoopgraphWorkspaceRegistry> {
  const registryPath = workspacePath(projectRoot);
  const epoch = new Date(0).toISOString();
  try {
    const raw = JSON.parse(await readFile(registryPath, "utf8")) as Record<
      string,
      unknown
    >;
    const registeredSpecs = Array.isArray(raw.registeredSpecs)
      ? raw.registeredSpecs.flatMap(parseEntry)
      : [];
    return {
      version: 1,
      schemaVersion: "workspace/v1alpha1",
      projectRoot,
      projectRootId:
        typeof raw.projectRootId === "string"
          ? raw.projectRootId
          : `project_${contentHash(projectRoot)}`,
      displayName:
        typeof raw.displayName === "string"
          ? raw.displayName
          : path.basename(projectRoot),
      demoCatalogEnabled: raw.demoCatalogEnabled === true,
      registeredSpecs,
      initializedAt:
        typeof raw.initializedAt === "string" ? raw.initializedAt : epoch,
      updatedAt:
        typeof raw.updatedAt === "string"
          ? raw.updatedAt
          : typeof raw.initializedAt === "string"
            ? raw.initializedAt
            : epoch
    };
  } catch {
    return {
      version: 1,
      schemaVersion: "workspace/v1alpha1",
      projectRoot,
      projectRootId: `project_${contentHash(projectRoot)}`,
      displayName: path.basename(projectRoot),
      demoCatalogEnabled: false,
      registeredSpecs: [],
      initializedAt: epoch,
      updatedAt: epoch
    };
  }
}

function parseEntry(value: unknown): RegisteredLoopSpec[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.path !== "string"
  ) {
    return [];
  }
  return [{
    id: item.id,
    name: item.name,
    path: item.path,
    ...(typeof item.templateId === "string"
      ? { templateId: item.templateId }
      : {}),
    department:
      typeof item.department === "string"
        ? normalizeDepartmentType(item.department) ?? "custom"
        : "custom",
    addedAt:
      typeof item.addedAt === "string"
        ? item.addedAt
        : new Date(0).toISOString()
  }];
}

async function writeWorkspaceFile(
  projectRoot: string,
  workspace: LoopgraphWorkspaceRegistry
): Promise<void> {
  await writeJsonAtomic(workspacePath(projectRoot), workspace);
}

async function readRevisionFile(projectRoot: string): Promise<number> {
  try {
    const raw = JSON.parse(
      await readFile(revisionPath(projectRoot), "utf8")
    ) as { revision?: unknown };
    const revision = Number(raw.revision);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  } catch {
    return 0;
  }
}

async function writeRevisionFile(
  projectRoot: string,
  revision: number
): Promise<void> {
  await writeJsonAtomic(revisionPath(projectRoot), { revision });
}

async function writeSpecAtomic(filePath: string, spec: LoopSpec): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const serialized = filePath.endsWith(".json")
    ? `${JSON.stringify(spec, null, 2)}\n`
    : `${YAML.stringify(spec)}\n`;
  await writeTextAtomic(filePath, serialized);
}

async function writeFixtures(
  projectRoot: string,
  specPath: string,
  fixtures: Record<string, unknown>
): Promise<void> {
  for (const [relativePath, fixture] of Object.entries(fixtures)) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/u).includes("..")
    ) {
      throw new Error("LoopSpec fixture path must stay inside its artifact");
    }
    const filePath = path.resolve(path.dirname(specPath), relativePath);
    assertInside(projectRoot, filePath);
    await writeJsonAtomic(filePath, fixture);
  }
}

async function readCommitReceipt(
  projectRoot: string,
  idempotencyKey: string
): Promise<LoopSpecMaterializationCommitResult | undefined> {
  try {
    const raw = JSON.parse(
      await readFile(commitReceiptPath(projectRoot, idempotencyKey), "utf8")
    ) as { result?: LoopSpecMaterializationCommitResult };
    return raw.result;
  } catch {
    return undefined;
  }
}

async function writeCommitReceipt(
  projectRoot: string,
  input: LoopSpecMaterializationCommitInput,
  result: LoopSpecMaterializationCommitResult
): Promise<void> {
  await writeJsonAtomic(commitReceiptPath(projectRoot, input.idempotencyKey), {
    commitId: input.commitId,
    idempotencyKey: input.idempotencyKey,
    artifactBindings: input.artifacts.map((artifact) => ({
      loopId: artifact.loopId,
      versionHash: artifact.versionHash
    })),
    removedLoopIds: [...(input.removeLoopIds ?? [])].sort(),
    result
  });
}

async function withFileLock<T>(
  projectRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = path.join(
    projectRoot,
    ".loopgraph",
    "loop-spec-store",
    ".registry.lock"
  );
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        return await operation();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      await delay(Math.min(100, 5 + attempt * 2));
    }
  }
  throw new Error("Timed out waiting for LoopSpec registry lock");
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(
  filePath: string,
  value: string
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, value, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function sourceFromSpec(spec: LoopSpec): StoredLoopSpecArtifact["source"] {
  const source = spec.metadata.labels?.source;
  if (source === "hermes-design") return "hermes_design";
  if (source === "semantic-graph") return "semantic_graph";
  if (source === "design-studio") return "design_studio";
  return "import";
}

function resolveConfinedPath(projectRoot: string, value: string): string {
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(projectRoot, value);
  assertInside(projectRoot, resolved);
  return resolved;
}

function assertInside(projectRoot: string, candidate: string): void {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("LoopSpec artifact path escapes the project root");
  }
}

function registryPath(projectRoot: string, filePath: string): string {
  const relative = path.relative(projectRoot, filePath);
  return relative.startsWith("..") ? filePath : relative;
}

function workspacePath(projectRoot: string): string {
  return path.join(projectRoot, ".loopgraph", "workspace.json");
}

function revisionPath(projectRoot: string): string {
  return path.join(
    projectRoot,
    ".loopgraph",
    "loop-spec-store",
    "workspace-revision.json"
  );
}

function commitReceiptPath(
  projectRoot: string,
  idempotencyKey: string
): string {
  return path.join(
    projectRoot,
    ".loopgraph",
    "loop-spec-store",
    "commits",
    `${encodeURIComponent(idempotencyKey)}.json`
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
