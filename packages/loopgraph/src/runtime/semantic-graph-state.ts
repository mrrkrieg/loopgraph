import path from "node:path";
import {
  contentHash,
  loopSpecHash,
  type GraphChangeSet,
  type GraphSnapshotEntry
} from "../core";
import { loadLoopSpecFromPath } from "./loader";
import type {
  LoopSpecRegistryStore,
  StoredLoopSpecArtifact
} from "./loop-spec-store";
import {
  readLoopgraphWorkspace,
  type LoopgraphWorkspaceRegistry
} from "./workspace";

export type WorkspaceGraphState = {
  workspace: LoopgraphWorkspaceRegistry;
  entries: GraphSnapshotEntry[];
  graphHash: string;
};

export async function readWorkspaceGraphState(
  projectRoot = process.cwd(),
  registryStore?: LoopSpecRegistryStore
): Promise<WorkspaceGraphState> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (registryStore) {
    const [{ workspace }, artifacts] = await Promise.all([
      registryStore.getWorkspace(resolvedProjectRoot),
      registryStore.listActiveLoopSpecs(resolvedProjectRoot)
    ]);
    const entries = snapshotEntriesFromArtifacts(artifacts);
    const workspaceIds = [...workspace.registeredSpecs]
      .map((entry) => entry.id)
      .sort();
    const artifactIds = entries.map((entry) => entry.id).sort();
    if (contentHash(workspaceIds) !== contentHash(artifactIds)) {
      throw new Error(
        "Cannot calculate graph state because the active LoopSpec registry " +
          "does not match its workspace"
      );
    }
    return {
      workspace,
      entries,
      graphHash: graphHashForEntries(entries)
    };
  }
  const workspace = await readLoopgraphWorkspace(resolvedProjectRoot);
  const entries: GraphSnapshotEntry[] = [];
  for (const entry of workspace.registeredSpecs) {
    const sourcePath = path.isAbsolute(entry.path)
      ? entry.path
      : path.resolve(resolvedProjectRoot, entry.path);
    const loaded = await loadLoopSpecFromPath(sourcePath);
    if (!loaded.ok) {
      throw new Error(`Cannot calculate graph state because LoopSpec ${entry.id} is invalid: ${loaded.errors.join("; ")}`);
    }
    if (loaded.spec.metadata.id !== entry.id) {
      throw new Error(
        `Cannot calculate graph state because registry ID ${entry.id} does not match LoopSpec ID ${loaded.spec.metadata.id}`
      );
    }
    entries.push({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      ...(entry.templateId ? { templateId: entry.templateId } : {}),
      department: entry.department,
      addedAt: entry.addedAt,
      specHash: loopSpecHash(loaded.spec),
      spec: loaded.spec,
      fixtures: {}
    });
  }
  entries.sort((left, right) => left.id.localeCompare(right.id));
  return {
    workspace,
    entries,
    graphHash: graphHashForEntries(entries)
  };
}

export function snapshotEntriesFromArtifacts(
  artifacts: StoredLoopSpecArtifact[]
): GraphSnapshotEntry[] {
  return artifacts
    .map((artifact) => {
      if (artifact.loopId !== artifact.entry.id) {
        throw new Error(
          `Cannot calculate graph state because artifact ${artifact.loopId} ` +
            "does not match its registry entry"
        );
      }
      if (artifact.spec.metadata.id !== artifact.loopId) {
        throw new Error(
          `Cannot calculate graph state because artifact ${artifact.loopId} ` +
            "does not match its LoopSpec"
        );
      }
      return {
        id: artifact.entry.id,
        name: artifact.entry.name,
        path: artifact.entry.path,
        ...(artifact.entry.templateId
          ? { templateId: artifact.entry.templateId }
          : {}),
        department: artifact.entry.department,
        addedAt: artifact.entry.addedAt,
        specHash: loopSpecHash(artifact.spec),
        versionHash: artifact.versionHash,
        spec: artifact.spec,
        fixtures: artifact.fixtures
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function graphHashForEntries(entries: GraphSnapshotEntry[]): string {
  return contentHash(entries
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      templateId: entry.templateId,
      department: entry.department,
      addedAt: entry.addedAt,
      specHash: entry.specHash
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function graphChangeSetHash(changeSet: GraphChangeSet): string {
  return contentHash({
    id: changeSet.id,
    version: changeSet.version,
    workspaceId: changeSet.workspaceId,
    companyId: changeSet.companyId,
    baseGraphHash: changeSet.baseGraphHash,
    opportunityId: changeSet.opportunityId,
    changes: changeSet.changes.map((change) => ({
      ...change,
      targetLoopIds: [...change.targetLoopIds].sort(),
      evidenceRefs: [...change.evidenceRefs].sort()
    }))
  });
}
