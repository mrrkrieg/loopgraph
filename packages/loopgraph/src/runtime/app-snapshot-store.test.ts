import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLoopPackDirectory } from "./app-pack-loader";
import {
  appSnapshotDescriptor,
  appSnapshotFilesDigest,
  FileAppSnapshotStore
} from "./app-snapshot-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("file App snapshot store", () => {
  it("materializes and verifies an immutable project-confined snapshot", async () => {
    const projectRoot = await temporaryRoot("loopgraph-file-snapshot-");
    const source = await loadLoopPackDirectory(path.resolve(
      process.cwd(),
      "packs/official/product/turn-feedback-into-product-problems"
    ));
    const descriptor = {
      snapshotPath: ".loopgraph/apps/private-snapshots/private.product-feedback/1.0.0",
      artifactDigest: source.artifact.digest,
      filesDigest: appSnapshotFilesDigest(source)
    };
    const store = new FileAppSnapshotStore(projectRoot);

    await store.materialize({ ...descriptor, operationId: "detach-1", source });
    const loaded = await store.loadExact(descriptor);

    expect(loaded.artifact.digest).toBe(source.artifact.digest);
    expect(appSnapshotFilesDigest(loaded)).toBe(descriptor.filesDigest);
    await writeFile(path.join(projectRoot, descriptor.snapshotPath, "README.md"), "tampered");
    await expect(store.assertExact(descriptor)).rejects.toThrow(/immutable artifact digest/);
  });

  it("rejects paths outside the private snapshot namespace", () => {
    expect(() => appSnapshotDescriptor({
      snapshotPath: ".loopgraph/apps/catalog/example/1.0.0",
      artifactDigest: `sha256:${"1".repeat(64)}`,
      filesDigest: `sha256:${"2".repeat(64)}`
    })).toThrow(/private snapshot namespace/);
  });

  it("rejects symbolic-link ancestors before reading or writing a snapshot", async () => {
    const projectRoot = await temporaryRoot("loopgraph-file-snapshot-root-");
    const outsideRoot = await temporaryRoot("loopgraph-file-snapshot-outside-");
    await mkdir(path.join(projectRoot, ".loopgraph", "apps"), { recursive: true });
    await symlink(outsideRoot, path.join(projectRoot, ".loopgraph", "apps", "private-snapshots"));
    const store = new FileAppSnapshotStore(projectRoot);

    await expect(store.exists({
      snapshotPath: ".loopgraph/apps/private-snapshots/private.example/1.0.0",
      artifactDigest: `sha256:${"1".repeat(64)}`,
      filesDigest: `sha256:${"2".repeat(64)}`
    })).rejects.toThrow(/symbolic link/);
  });
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}
