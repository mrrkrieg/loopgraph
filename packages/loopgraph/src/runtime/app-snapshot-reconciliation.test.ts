import { describe, expect, it } from "vitest";
import { canonicalAppDigest, type WorkspaceAppInstallation } from "../core";
import type { AppInstallationRegistry, AppLifecycleOperation } from "./app-installation-store";
import {
  detachedAppSnapshotDescriptor,
  reconcileAppSnapshots
} from "./app-snapshot-reconciliation";
import type { AppSnapshotDescriptor, AppSnapshotStore } from "./app-snapshot-store";

const artifactDigest = `sha256:${"a".repeat(64)}`;
const filesDigest = `sha256:${"b".repeat(64)}`;
const snapshotPath = ".loopgraph/apps/private-snapshots/private.product.feedback/1.0.0";

function installation(overrides: Partial<WorkspaceAppInstallation> = {}): WorkspaceAppInstallation {
  return {
    id: "installation-1",
    artifactDigest,
    derivation: {
      derivedAppId: "private.product.feedback",
      upstreamAppId: "official.product.feedback",
      upstreamVersion: "1.0.0",
      upstreamDigest: artifactDigest,
      createdAt: "2026-08-22T11:00:00.000Z",
      createdBy: "operator",
      detachedAt: "2026-08-22T12:00:00.000Z",
      detachedBy: "operator",
      snapshotPath,
      snapshotFilesDigest: filesDigest
    },
    ...overrides
  } as WorkspaceAppInstallation;
}

function registry(
  installations: WorkspaceAppInstallation[],
  lifecycleOperations: AppLifecycleOperation[] = []
): AppInstallationRegistry {
  return { installations, lifecycleOperations } as AppInstallationRegistry;
}

class FakeSnapshotStore implements AppSnapshotStore {
  readonly persistence = "distributed" as const;
  readonly checked: AppSnapshotDescriptor[] = [];

  constructor(
    private readonly states: Array<"verified" | "missing" | "corrupt" | "unavailable">
  ) {}

  async exists(descriptor: AppSnapshotDescriptor): Promise<boolean> {
    this.checked.push(descriptor);
    const state = this.states[this.checked.length - 1];
    if (state === "unavailable") throw new Error("storage unavailable");
    return state !== "missing";
  }

  async assertExact(): Promise<void> {
    if (this.states[this.checked.length - 1] === "corrupt") throw new Error("digest mismatch");
  }

  async materialize(): Promise<void> {
    throw new Error("not used");
  }

  async loadExact(): Promise<never> {
    throw new Error("not used");
  }
}

describe("App snapshot reconciliation", () => {
  it("uses the detached installation as durable recovery authority after journal aging", () => {
    const current = installation();
    expect(detachedAppSnapshotDescriptor(registry([current]), current)).toEqual({
      snapshotPath,
      artifactDigest,
      filesDigest
    });
  });

  it("keeps a bounded legacy journal fallback", () => {
    const legacy = installation({
      derivation: {
        derivedAppId: "private.product.feedback",
        upstreamAppId: "official.product.feedback",
        upstreamVersion: "1.0.0",
        upstreamDigest: artifactDigest,
        createdAt: "2026-08-22T11:00:00.000Z",
        createdBy: "operator",
        detachedAt: "2026-08-22T12:00:00.000Z",
        detachedBy: "operator",
        snapshotPath
      }
    });
    const operation = {
      action: "detach",
      installationId: legacy.id,
      status: "completed",
      detach: {
        snapshotPath,
        snapshotArtifactDigest: artifactDigest,
        snapshotFilesDigest: filesDigest,
        targetInstallationDigest: canonicalAppDigest(legacy)
      }
    } as AppLifecycleOperation;
    expect(detachedAppSnapshotDescriptor(registry([legacy], [operation]), legacy)).toEqual({
      snapshotPath,
      artifactDigest,
      filesDigest
    });
  });

  it("returns aggregate-only fail-closed health across every detached installation", async () => {
    const installations = [
      installation({ id: "verified" }),
      installation({ id: "missing" }),
      installation({ id: "corrupt" }),
      installation({ id: "unavailable" }),
      installation({
        id: "untracked",
        derivation: {
          derivedAppId: "private.product.feedback",
          upstreamAppId: "official.product.feedback",
          upstreamVersion: "1.0.0",
          upstreamDigest: artifactDigest,
          createdAt: "2026-08-22T11:00:00.000Z",
          createdBy: "operator",
          detachedAt: "2026-08-22T12:00:00.000Z",
          detachedBy: "operator"
        }
      })
    ];
    const store = new FakeSnapshotStore(["verified", "missing", "corrupt", "unavailable"]);
    const result = await reconcileAppSnapshots(registry(installations), store);

    expect(result).toEqual({
      detachedInstallations: 5,
      verifiedSnapshots: 1,
      missingSnapshots: 1,
      corruptSnapshots: 1,
      untrackedSnapshots: 1,
      unavailableSnapshots: 1,
      healthy: false
    });
    expect(Object.keys(result).sort()).toEqual([
      "corruptSnapshots",
      "detachedInstallations",
      "healthy",
      "missingSnapshots",
      "unavailableSnapshots",
      "untrackedSnapshots",
      "verifiedSnapshots"
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|snapshotPath|sha256/);
  });

  it("treats an empty inventory as healthy without inventing evidence", async () => {
    await expect(reconcileAppSnapshots(registry([]), new FakeSnapshotStore([]))).resolves.toEqual({
      detachedInstallations: 0,
      verifiedSnapshots: 0,
      missingSnapshots: 0,
      corruptSnapshots: 0,
      untrackedSnapshots: 0,
      unavailableSnapshots: 0,
      healthy: true
    });
  });
});
