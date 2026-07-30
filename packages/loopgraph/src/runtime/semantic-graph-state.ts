import path from "node:path";
import {
  contentHash,
  loopSpecHash,
  type GraphChangeSet,
  type GraphSnapshotEntry
} from "../core";
import { loadLoopSpecFromPath } from "./loader";
import {
  readLoopgraphWorkspace,
  type LoopgraphWorkspaceRegistry
} from "./workspace";

export type WorkspaceGraphState = {
  workspace: LoopgraphWorkspaceRegistry;
  entries: GraphSnapshotEntry[];
  graphHash: string;
};

export async function readWorkspaceGraphState(projectRoot = process.cwd()): Promise<WorkspaceGraphState> {
  const resolvedProjectRoot = path.resolve(projectRoot);
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
      spec: loaded.spec
    });
  }
  entries.sort((left, right) => left.id.localeCompare(right.id));
  return {
    workspace,
    entries,
    graphHash: graphHashForEntries(entries)
  };
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
