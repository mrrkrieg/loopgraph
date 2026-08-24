import { canonicalAppDigest, type WorkspaceAppInstallation } from "../core";
import type { AppInstallationRegistry } from "./app-installation-store";
import {
  appSnapshotDescriptor,
  type AppSnapshotDescriptor,
  type AppSnapshotStore
} from "./app-snapshot-store";

export type AppSnapshotReconciliationResult = {
  detachedInstallations: number;
  verifiedSnapshots: number;
  missingSnapshots: number;
  corruptSnapshots: number;
  untrackedSnapshots: number;
  unavailableSnapshots: number;
  healthy: boolean;
};

/**
 * Resolves the immutable recovery authority for one currently detached App.
 *
 * New installations carry the complete descriptor directly. The journal
 * fallback keeps registries created before that field was introduced readable,
 * while reconciliation reports an aged-out legacy record as untracked.
 */
export function detachedAppSnapshotDescriptor(
  registry: AppInstallationRegistry,
  installation: WorkspaceAppInstallation
): AppSnapshotDescriptor | undefined {
  const derivation = installation.derivation;
  if (!derivation?.detachedAt) return undefined;
  if (!derivation.snapshotPath) return undefined;
  if (derivation.snapshotFilesDigest) {
    return appSnapshotDescriptor({
      snapshotPath: derivation.snapshotPath,
      artifactDigest: installation.artifactDigest,
      filesDigest: derivation.snapshotFilesDigest
    });
  }
  const completed = [...registry.lifecycleOperations].reverse().find((operation) =>
    operation.action === "detach" &&
    operation.installationId === installation.id &&
    operation.status === "completed" &&
    operation.detach?.snapshotPath === derivation.snapshotPath &&
    operation.detach?.snapshotArtifactDigest === installation.artifactDigest &&
    operation.detach?.targetInstallationDigest === canonicalAppDigest(installation)
  );
  if (!completed?.detach) return undefined;
  return appSnapshotDescriptor({
    snapshotPath: completed.detach.snapshotPath,
    artifactDigest: completed.detach.snapshotArtifactDigest,
    filesDigest: completed.detach.snapshotFilesDigest
  });
}

/**
 * Verifies every current detached App against durable snapshot storage.
 *
 * The result deliberately contains counts only. Callers cannot recover App,
 * installation, workspace, object-key, path, or digest information from it.
 */
export async function reconcileAppSnapshots(
  registry: AppInstallationRegistry,
  snapshotStore: AppSnapshotStore
): Promise<AppSnapshotReconciliationResult> {
  const detached = registry.installations.filter((installation) => installation.derivation?.detachedAt);
  const result: AppSnapshotReconciliationResult = {
    detachedInstallations: detached.length,
    verifiedSnapshots: 0,
    missingSnapshots: 0,
    corruptSnapshots: 0,
    untrackedSnapshots: 0,
    unavailableSnapshots: 0,
    healthy: false
  };

  for (const installation of detached) {
    const descriptor = detachedAppSnapshotDescriptor(registry, installation);
    if (!descriptor) {
      result.untrackedSnapshots += 1;
      continue;
    }
    let exists: boolean;
    try {
      exists = await snapshotStore.exists(descriptor);
    } catch {
      result.unavailableSnapshots += 1;
      continue;
    }
    if (!exists) {
      result.missingSnapshots += 1;
      continue;
    }
    try {
      await snapshotStore.assertExact(descriptor);
      result.verifiedSnapshots += 1;
    } catch {
      result.corruptSnapshots += 1;
    }
  }

  result.healthy =
    result.verifiedSnapshots === result.detachedInstallations &&
    result.missingSnapshots === 0 &&
    result.corruptSnapshots === 0 &&
    result.untrackedSnapshots === 0 &&
    result.unavailableSnapshots === 0;
  return result;
}
