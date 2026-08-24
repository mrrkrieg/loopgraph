import { cp, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  artifactDigestSchema,
  canonicalAppDigest,
  packRelativePathSchema
} from "../core/app-platform";
import { contentHash } from "../core/hash";
import {
  loadLoopPackDirectory,
  type LoopPackLoadResult
} from "./app-pack-loader";

export type AppSnapshotDescriptor = {
  snapshotPath: string;
  artifactDigest: string;
  filesDigest: string;
};

export type AppSnapshotMaterialization = AppSnapshotDescriptor & {
  operationId: string;
  source: LoopPackLoadResult;
};

/**
 * Durable immutable App artifact boundary.
 *
 * The path is a logical, project-confined snapshot identity. Local runtimes
 * materialize it beneath the project root; hosted runtimes may map the same
 * identity into tenant-scoped object storage and use local disk only as a
 * verified read-through cache.
 */
export interface AppSnapshotStore {
  readonly persistence: "local" | "distributed";
  exists(descriptor: AppSnapshotDescriptor): Promise<boolean>;
  materialize(input: AppSnapshotMaterialization): Promise<void>;
  assertExact(descriptor: AppSnapshotDescriptor): Promise<void>;
  loadExact(descriptor: AppSnapshotDescriptor): Promise<LoopPackLoadResult>;
}

export class FileAppSnapshotStore implements AppSnapshotStore {
  readonly persistence = "local" as const;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  async exists(descriptor: AppSnapshotDescriptor): Promise<boolean> {
    const parsed = appSnapshotDescriptor(descriptor);
    const target = resolveSnapshotPath(this.projectRoot, parsed.snapshotPath);
    await assertNoSymbolicLinkAncestors(this.projectRoot, target);
    return pathExists(target);
  }

  async materialize(input: AppSnapshotMaterialization): Promise<void> {
    const parsed = appSnapshotDescriptor(input);
    assertSourceArtifact(input.source, parsed);
    const snapshotRoot = resolveSnapshotPath(this.projectRoot, parsed.snapshotPath);
    await assertNoSymbolicLinkAncestors(this.projectRoot, snapshotRoot);
    if (await pathExists(snapshotRoot)) {
      await this.assertExact(parsed);
      return;
    }

    const stagingPath = path.posix.join(
      ".loopgraph",
      "apps",
      "private-snapshots",
      ".staging",
      contentHash({ operationId: input.operationId, snapshotPath: parsed.snapshotPath })
    );
    const stagingRoot = resolveSnapshotPath(this.projectRoot, stagingPath, true);
    await assertNoSymbolicLinkAncestors(this.projectRoot, stagingRoot);
    await rm(stagingRoot, { recursive: true, force: true });
    await mkdir(path.dirname(stagingRoot), { recursive: true });
    await cp(input.source.root, stagingRoot, { recursive: true, force: false, errorOnExist: true });
    await assertLoadedSnapshot(stagingRoot, parsed);
    await mkdir(path.dirname(snapshotRoot), { recursive: true });
    await assertNoSymbolicLinkAncestors(this.projectRoot, path.dirname(snapshotRoot));
    try {
      await rename(stagingRoot, snapshotRoot);
    } catch (error) {
      if (!(await pathExists(snapshotRoot))) throw error;
      await this.assertExact(parsed);
      await rm(stagingRoot, { recursive: true, force: true });
    }
    await this.assertExact(parsed);
  }

  async assertExact(descriptor: AppSnapshotDescriptor): Promise<void> {
    await this.loadExact(descriptor);
  }

  async loadExact(descriptor: AppSnapshotDescriptor): Promise<LoopPackLoadResult> {
    const parsed = appSnapshotDescriptor(descriptor);
    const snapshotRoot = resolveSnapshotPath(this.projectRoot, parsed.snapshotPath);
    await assertNoSymbolicLinkAncestors(this.projectRoot, snapshotRoot);
    return assertLoadedSnapshot(snapshotRoot, parsed);
  }
}

export function appSnapshotFilesDigest(loaded: LoopPackLoadResult): string {
  return canonicalAppDigest(loaded.artifact.files
    .map((file) => ({ path: file.path, digest: file.digest, sizeBytes: file.sizeBytes }))
    .sort((left, right) => left.path.localeCompare(right.path)));
}

export function appSnapshotDescriptor(input: AppSnapshotDescriptor): AppSnapshotDescriptor {
  const snapshotPath = packRelativePathSchema.parse(input.snapshotPath);
  artifactDigestSchema.parse(input.artifactDigest);
  artifactDigestSchema.parse(input.filesDigest);
  if (!/^\.loopgraph\/apps\/private-snapshots\/[a-z0-9]/.test(snapshotPath)) {
    throw new Error("App snapshot path must use the private snapshot namespace");
  }
  return { snapshotPath, artifactDigest: input.artifactDigest, filesDigest: input.filesDigest };
}

function assertSourceArtifact(source: LoopPackLoadResult, descriptor: AppSnapshotDescriptor): void {
  if (
    source.artifact.digest !== descriptor.artifactDigest ||
    appSnapshotFilesDigest(source) !== descriptor.filesDigest
  ) {
    throw new Error("App snapshot source does not match the exact recorded artifact");
  }
}

async function assertLoadedSnapshot(
  snapshotRoot: string,
  descriptor: AppSnapshotDescriptor
): Promise<LoopPackLoadResult> {
  const snapshot = await loadLoopPackDirectory(snapshotRoot);
  if (
    snapshot.artifact.digest !== descriptor.artifactDigest ||
    appSnapshotFilesDigest(snapshot) !== descriptor.filesDigest
  ) {
    throw new Error("Private App snapshot no longer matches its recorded immutable artifact digest");
  }
  return snapshot;
}

function resolveSnapshotPath(projectRoot: string, snapshotPath: string, allowStaging = false): string {
  const parsed = packRelativePathSchema.parse(snapshotPath);
  const allowed = allowStaging
    ? /^\.loopgraph\/apps\/private-snapshots\/(?:\.staging\/[a-f0-9]+|[a-z0-9])/
    : /^\.loopgraph\/apps\/private-snapshots\/[a-z0-9]/;
  if (!allowed.test(parsed)) throw new Error("App snapshot path must use the private snapshot namespace");
  const absolute = path.resolve(projectRoot, parsed);
  const relative = path.relative(projectRoot, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("App snapshot path escaped the project root");
  }
  return absolute;
}

async function assertNoSymbolicLinkAncestors(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("App snapshot path escaped the project root");
  }
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`App snapshot path contains a symbolic link: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
