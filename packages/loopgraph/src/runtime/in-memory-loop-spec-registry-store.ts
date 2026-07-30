import { contentHash } from "../core";
import {
  createStoredLoopSpecArtifact,
  type LoopSpecMaterializationCommitInput,
  type LoopSpecMaterializationCommitResult,
  type LoopSpecRegistryStore,
  type LoopSpecWorkspaceSnapshot,
  type StoredLoopSpecArtifact
} from "./loop-spec-store";

/**
 * Transaction-scoped registry used to prepare a complete semantic graph
 * mutation before one distributed database commit. It never persists work.
 */
export class InMemoryLoopSpecRegistryStore implements LoopSpecRegistryStore {
  readonly persistence = "distributed" as const;
  private revision: number;
  private workspace: LoopSpecWorkspaceSnapshot["workspace"];
  private readonly artifacts = new Map<string, StoredLoopSpecArtifact>();
  private readonly receipts = new Map<
    string,
    LoopSpecMaterializationCommitResult
  >();

  constructor(input: {
    snapshot: LoopSpecWorkspaceSnapshot;
    artifacts: StoredLoopSpecArtifact[];
  }) {
    this.revision = input.snapshot.revision;
    this.workspace = structuredClone(input.snapshot.workspace);
    for (const artifact of input.artifacts) {
      this.artifacts.set(
        artifact.loopId,
        createStoredLoopSpecArtifact(artifact)
      );
    }
  }

  async getWorkspace(projectRoot?: string): Promise<LoopSpecWorkspaceSnapshot> {
    void projectRoot;
    return {
      workspace: structuredClone(this.workspace),
      revision: this.revision
    };
  }

  async listActiveLoopSpecs(
    projectRoot?: string
  ): Promise<StoredLoopSpecArtifact[]> {
    void projectRoot;
    return [...this.artifacts.values()]
      .map((artifact) => structuredClone(artifact))
      .sort((left, right) => left.loopId.localeCompare(right.loopId));
  }

  async getActiveLoopSpec(
    _projectRoot: string,
    loopId: string
  ): Promise<StoredLoopSpecArtifact | undefined> {
    const artifact = this.artifacts.get(loopId);
    return artifact ? structuredClone(artifact) : undefined;
  }

  async commitMaterializationAtomically(
    input: LoopSpecMaterializationCommitInput
  ): Promise<LoopSpecMaterializationCommitResult> {
    const existing = this.receipts.get(input.idempotencyKey);
    if (existing) {
      assertSameArtifacts(input.artifacts, existing.artifacts);
      return { ...structuredClone(existing), created: false };
    }
    if (input.expectedRevision !== this.revision) {
      throw new Error(
        `LoopSpec workspace revision mismatch: expected ${input.expectedRevision}, found ${this.revision}`
      );
    }
    for (const artifact of input.artifacts) {
      const parsed = createStoredLoopSpecArtifact(artifact);
      this.artifacts.set(parsed.loopId, parsed);
    }
    const registeredSpecs = [...this.artifacts.values()]
      .map((artifact) => artifact.entry)
      .sort((left, right) => left.name.localeCompare(right.name));
    this.workspace = {
      ...this.workspace,
      registeredSpecs,
      updatedAt: input.committedAt
    };
    this.revision += 1;
    const result: LoopSpecMaterializationCommitResult = {
      workspace: structuredClone(this.workspace),
      workspaceRevision: this.revision,
      artifacts: input.artifacts.map((artifact) =>
        structuredClone(createStoredLoopSpecArtifact(artifact))
      ),
      ...(input.discoverySessionTransition
        ? {
            discoverySession: structuredClone(
              input.discoverySessionTransition.session
            )
          }
        : {}),
      created: true,
      commitRef: `memory://${encodeURIComponent(input.commitId)}`
    };
    this.receipts.set(input.idempotencyKey, structuredClone(result));
    return result;
  }

  retire(loopIds: string[], updatedAt: string): void {
    for (const loopId of loopIds) this.artifacts.delete(loopId);
    this.workspace = {
      ...this.workspace,
      registeredSpecs: [...this.artifacts.values()]
        .map((artifact) => artifact.entry)
        .sort((left, right) => left.name.localeCompare(right.name)),
      updatedAt
    };
  }

  replaceArtifacts(
    artifacts: StoredLoopSpecArtifact[],
    updatedAt: string
  ): void {
    this.artifacts.clear();
    for (const artifact of artifacts) {
      const parsed = createStoredLoopSpecArtifact(artifact);
      this.artifacts.set(parsed.loopId, parsed);
    }
    this.workspace = {
      ...this.workspace,
      registeredSpecs: [...this.artifacts.values()]
        .map((artifact) => artifact.entry)
        .sort((left, right) => left.name.localeCompare(right.name)),
      updatedAt
    };
  }
}

function assertSameArtifacts(
  expected: StoredLoopSpecArtifact[],
  actual: StoredLoopSpecArtifact[]
): void {
  const bindings = (artifacts: StoredLoopSpecArtifact[]) =>
    artifacts
      .map(({ loopId, versionHash }) => ({ loopId, versionHash }))
      .sort((left, right) => left.loopId.localeCompare(right.loopId));
  if (contentHash(bindings(expected)) !== contentHash(bindings(actual))) {
    throw new Error(
      "Idempotent in-memory materialization resolved to conflicting content"
    );
  }
}
