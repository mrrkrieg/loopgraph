import "server-only";

import { mkdtemp, mkdir, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalAppDigest } from "loopgraph/core";
import {
  appSnapshotDescriptor,
  appSnapshotFilesDigest,
  createLoopPackArchive,
  extractLoopPackArchive,
  loadLoopPackDirectory,
  type AppSnapshotDescriptor,
  type AppSnapshotMaterialization,
  type AppSnapshotStore,
  type LoopPackLoadResult
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

export const HOSTED_APP_SNAPSHOT_BUCKET = "loopgraph-app-snapshots";
export const HOSTED_APP_SNAPSHOT_MEDIA_TYPE = "application/json";
export const MAX_HOSTED_APP_SNAPSHOT_BYTES = 100 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,159}$/;
const DIGEST_SEGMENT_PATTERN = /^[a-f0-9]{64}$/;
const ARCHIVE_NAME_PATTERN = /^[a-f0-9]{64}\.loopgraph-pack\.json$/;
const SNAPSHOT_INVENTORY_PAGE_SIZE = 100;
const MAX_SNAPSHOT_INVENTORY_ENTRIES = 50_000;
const MAX_SNAPSHOT_INVENTORY_DEPTH = 8;

export type HostedAppSnapshotScope = {
  organizationId: string;
  projectKey: string;
  workspaceId: string;
};

export type HostedAppSnapshotInventory = {
  objectKeyDigests: string[];
  malformedObjects: number;
};

/**
 * Service-role-only immutable App snapshot storage for hosted runtimes.
 *
 * Object names are tenant-scoped and content-bound. Upload never uses upsert:
 * the first exact writer wins, while a collision is accepted only after the
 * existing archive downloads and verifies against both recorded digests.
 */
export class SupabaseAppSnapshotStore implements AppSnapshotStore {
  readonly persistence = "distributed" as const;
  private readonly projectRoot: string;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: HostedAppSnapshotScope,
    projectRoot: string
  ) {
    assertHostedAppSnapshotScope(scope);
    this.projectRoot = path.resolve(projectRoot);
  }

  async exists(descriptor: AppSnapshotDescriptor): Promise<boolean> {
    const parsed = appSnapshotDescriptor(descriptor);
    const { data, error } = await this.supabase.storage
      .from(HOSTED_APP_SNAPSHOT_BUCKET)
      .list(hostedAppSnapshotLogicalPrefix(this.scope, parsed), { limit: 1 });
    if (error) throw new Error("Hosted App snapshot store could not check immutable object identity");
    return (data ?? []).length > 0;
  }

  async materialize(input: AppSnapshotMaterialization): Promise<void> {
    const descriptor = appSnapshotDescriptor(input);
    if (
      input.source.artifact.digest !== descriptor.artifactDigest ||
      appSnapshotFilesDigest(input.source) !== descriptor.filesDigest
    ) {
      throw new Error("Hosted App snapshot source does not match the exact recorded artifact");
    }
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-app-snapshot-upload-"));
    const archivePath = path.join(temporaryRoot, "snapshot.loopgraph-pack.json");
    try {
      const artifact = await createLoopPackArchive(input.source.root, archivePath);
      if (artifact.digest !== descriptor.artifactDigest) {
        throw new Error("Hosted App snapshot archive changed during creation");
      }
      const bytes = await readFile(archivePath);
      assertArchiveSize(bytes.byteLength);
      const { error } = await this.supabase.storage
        .from(HOSTED_APP_SNAPSHOT_BUCKET)
        .upload(hostedAppSnapshotObjectKey(this.scope, descriptor), bytes, {
          contentType: HOSTED_APP_SNAPSHOT_MEDIA_TYPE,
          cacheControl: "0",
          upsert: false
        });
      if (error && !isAlreadyExistsError(error)) {
        throw new Error("Hosted App snapshot upload failed");
      }
      await this.assertExact(descriptor);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async assertExact(descriptor: AppSnapshotDescriptor): Promise<void> {
    const parsed = appSnapshotDescriptor(descriptor);
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-app-snapshot-verify-"));
    try {
      await this.downloadAndExtract(parsed, temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async loadExact(descriptor: AppSnapshotDescriptor): Promise<LoopPackLoadResult> {
    const parsed = appSnapshotDescriptor(descriptor);
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-app-snapshot-load-"));
    try {
      const staged = await this.downloadAndExtract(parsed, temporaryRoot);
      const cacheRoot = path.join(
        this.projectRoot,
        ".loopgraph",
        "apps",
        "snapshot-cache",
        canonicalAppDigest({
          snapshotPath: parsed.snapshotPath,
          artifactDigest: parsed.artifactDigest,
          filesDigest: parsed.filesDigest
        }).slice("sha256:".length)
      );
      await assertNoSymbolicLinkAncestors(this.projectRoot, cacheRoot);
      await mkdir(path.dirname(cacheRoot), { recursive: true });
      if (await pathExists(cacheRoot)) {
        try {
          const cached = await loadLoopPackDirectory(cacheRoot);
          assertLoadedSnapshot(cached, parsed);
          return cached;
        } catch {
          await rm(cacheRoot, { recursive: true, force: true });
        }
      }
      try {
        await rename(staged.root, cacheRoot);
      } catch (error) {
        if (!(await pathExists(cacheRoot))) throw error;
      }
      const cached = await loadLoopPackDirectory(cacheRoot);
      assertLoadedSnapshot(cached, parsed);
      return cached;
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  private async downloadAndExtract(
    descriptor: AppSnapshotDescriptor,
    temporaryRoot: string
  ): Promise<LoopPackLoadResult> {
    const { data, error } = await this.supabase.storage
      .from(HOSTED_APP_SNAPSHOT_BUCKET)
      .download(hostedAppSnapshotObjectKey(this.scope, descriptor));
    if (error || !data) throw new Error("Hosted App snapshot is unavailable");
    const bytes = new Uint8Array(await data.arrayBuffer());
    assertArchiveSize(bytes.byteLength);
    const mediaType = data.type?.split(";", 1)[0];
    if (mediaType && mediaType !== HOSTED_APP_SNAPSHOT_MEDIA_TYPE) {
      throw new Error("Hosted App snapshot has an unexpected media type");
    }
    const archivePath = path.join(temporaryRoot, "snapshot.loopgraph-pack.json");
    const packRoot = path.join(temporaryRoot, "pack");
    await writeFile(archivePath, bytes, { flag: "wx", mode: 0o600 });
    const artifact = await extractLoopPackArchive(archivePath, packRoot);
    if (artifact.digest !== descriptor.artifactDigest) {
      throw new Error("Hosted App snapshot archive does not match its recorded artifact digest");
    }
    const loaded = await loadLoopPackDirectory(packRoot);
    assertLoadedSnapshot(loaded, descriptor);
    return loaded;
  }

}

export function hostedAppSnapshotObjectKey(
  scope: HostedAppSnapshotScope,
  descriptor: AppSnapshotDescriptor
): string {
  const parsed = appSnapshotDescriptor(descriptor);
  assertHostedAppSnapshotScope(scope);
  const artifact = parsed.artifactDigest.slice("sha256:".length);
  const files = parsed.filesDigest.slice("sha256:".length);
  return [
    hostedAppSnapshotLogicalPrefix(scope, parsed),
    artifact,
    `${files}.loopgraph-pack.json`
  ].join("/");
}

export function hostedAppSnapshotLogicalPrefix(
  scope: HostedAppSnapshotScope,
  descriptor: AppSnapshotDescriptor
): string {
  const parsed = appSnapshotDescriptor(descriptor);
  assertHostedAppSnapshotScope(scope);
  const logicalPath = canonicalAppDigest({ snapshotPath: parsed.snapshotPath }).slice("sha256:".length);
  return [scope.organizationId, scope.projectKey, scope.workspaceId, logicalPath].join("/");
}

/**
 * Inventories one exact tenant/project prefix without returning Storage object keys.
 *
 * Supabase Storage exposes virtual folders through paged `list` calls. The traversal is bounded,
 * accepts only the server-derived four-segment object shape, and projects every valid key to an
 * opaque digest before returning it to reconciliation.
 */
export async function inventoryHostedAppSnapshotObjects(
  supabase: SupabaseClient,
  scope: Pick<HostedAppSnapshotScope, "organizationId" | "projectKey">
): Promise<HostedAppSnapshotInventory> {
  assertHostedAppSnapshotTenantScope(scope);
  const root = `${scope.organizationId}/${scope.projectKey}`;
  const queue = [{ prefix: root, depth: 0 }];
  const queued = new Set([root]);
  const objectKeyDigests = new Set<string>();
  let malformedObjects = 0;
  let entriesSeen = 0;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (let offset = 0; ; offset += SNAPSHOT_INVENTORY_PAGE_SIZE) {
      const { data, error } = await supabase.storage
        .from(HOSTED_APP_SNAPSHOT_BUCKET)
        .list(current.prefix, {
          limit: SNAPSHOT_INVENTORY_PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" }
        });
      if (error) throw new Error("Hosted App snapshot inventory is unavailable");
      const entries = (data ?? []) as Array<{ id?: unknown; name?: unknown }>;
      entriesSeen += entries.length;
      if (entriesSeen > MAX_SNAPSHOT_INVENTORY_ENTRIES) {
        throw new Error("Hosted App snapshot inventory exceeded its bounded entry limit");
      }

      for (const entry of entries) {
        if (
          typeof entry.name !== "string" || entry.name.length < 1 || entry.name.length > 256 ||
          entry.name === "." || entry.name === ".." || entry.name.includes("/")
        ) {
          throw new Error("Hosted App snapshot inventory contained an invalid path segment");
        }
        const objectPath = `${current.prefix}/${entry.name}`;
        if (entry.id === null) {
          if (current.depth >= MAX_SNAPSHOT_INVENTORY_DEPTH) {
            throw new Error("Hosted App snapshot inventory exceeded its bounded path depth");
          }
          if (!queued.has(objectPath)) {
            queued.add(objectPath);
            queue.push({ prefix: objectPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (typeof entry.id !== "string" || entry.id.length < 1) {
          throw new Error("Hosted App snapshot inventory contained an indeterminate object entry");
        }

        const relative = objectPath.slice(root.length + 1).split("/");
        if (
          relative.length !== 4 || !SCOPE_ID_PATTERN.test(relative[0] ?? "") ||
          !DIGEST_SEGMENT_PATTERN.test(relative[1] ?? "") ||
          !DIGEST_SEGMENT_PATTERN.test(relative[2] ?? "") ||
          !ARCHIVE_NAME_PATTERN.test(relative[3] ?? "")
        ) {
          malformedObjects += 1;
          continue;
        }
        objectKeyDigests.add(canonicalAppDigest({ objectKey: objectPath }));
      }
      if (entries.length < SNAPSHOT_INVENTORY_PAGE_SIZE) break;
    }
  }

  return { objectKeyDigests: [...objectKeyDigests].sort(), malformedObjects };
}

export function isSupabaseAppSnapshotStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseAppSnapshotStore(
  workspaceId: string,
  projectRoot: string
): SupabaseAppSnapshotStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) throw new Error("Supabase App snapshot storage requires a hosted organization");
  return new SupabaseAppSnapshotStore(supabase, { organizationId, projectKey, workspaceId }, projectRoot);
}

function assertLoadedSnapshot(loaded: LoopPackLoadResult, descriptor: AppSnapshotDescriptor): void {
  if (
    loaded.artifact.digest !== descriptor.artifactDigest ||
    appSnapshotFilesDigest(loaded) !== descriptor.filesDigest
  ) {
    throw new Error("Hosted App snapshot no longer matches its immutable artifact identity");
  }
}

function assertHostedAppSnapshotScope(scope: HostedAppSnapshotScope): void {
  assertHostedAppSnapshotTenantScope(scope);
  if (!SCOPE_ID_PATTERN.test(scope.workspaceId)) {
    throw new Error("App snapshot store workspace ID is invalid");
  }
}

function assertHostedAppSnapshotTenantScope(
  scope: Pick<HostedAppSnapshotScope, "organizationId" | "projectKey">
): void {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("App snapshot store organization ID must be a UUID");
  }
  if (!SCOPE_ID_PATTERN.test(scope.projectKey) || scope.projectKey.length > 64) {
    throw new Error("App snapshot store project key is invalid");
  }
}

function assertArchiveSize(sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_HOSTED_APP_SNAPSHOT_BYTES) {
    throw new Error(`Hosted App snapshot archive must be between 1 and ${MAX_HOSTED_APP_SNAPSHOT_BYTES} bytes`);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { message?: unknown; statusCode?: unknown };
  const status = Number(value.statusCode);
  return status === 409 || /already exists|duplicate/i.test(String(value.message ?? ""));
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

async function assertNoSymbolicLinkAncestors(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Hosted App snapshot cache escaped the project root");
  }
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error("Hosted App snapshot cache contains a symbolic link");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}
