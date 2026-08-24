import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalAppDigest } from "loopgraph/core";
import {
  appSnapshotFilesDigest,
  loadLoopPackDirectory,
  type AppSnapshotDescriptor
} from "loopgraph/runtime";
import {
  HOSTED_APP_SNAPSHOT_BUCKET,
  HOSTED_APP_SNAPSHOT_MEDIA_TYPE,
  MAX_HOSTED_APP_SNAPSHOT_BYTES,
  SupabaseAppSnapshotStore,
  hostedAppSnapshotObjectKey
} from "../lib/db/adapters/supabase-app-snapshot-store";
import { readProjectedSecretFile } from "./projected-secret-file";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type RestoreCheckName =
  | "separate_private_bounded_buckets"
  | "source_archive_exported"
  | "target_first_writer_restore"
  | "isolated_target_exact_load"
  | "source_preserved_after_target_cleanup"
  | "cleanup_verified";

export type HostedAppSnapshotRestoreReceipt = {
  schemaVersion: "hosted-app-snapshot-restore-rehearsal/v1";
  sourceOrigin: string;
  restoreOrigin: string;
  organizationId: string;
  projectKey: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  archiveSizeBytes: number;
  snapshotIdentityDigest: string;
  artifactDigest: string;
  filesDigest: string;
  checks: Array<{
    name: RestoreCheckName;
    ok: true;
    detail: string;
  }>;
};

export async function rehearseHostedAppSnapshotRestore(
  config: {
    sourceUrl: string;
    restoreUrl: string;
    expectedRestoreOrigin: string;
    confirmIsolatedRestore: boolean;
    organizationId: string;
    projectKey: string;
  },
  dependencies: {
    sourceClient: SupabaseClient;
    restoreClient: SupabaseClient;
    now?: () => Date;
    nowMs?: () => number;
    temporaryRoot?: (prefix: string) => Promise<string>;
  }
): Promise<HostedAppSnapshotRestoreReceipt> {
  if (!config.confirmIsolatedRestore) {
    throw new Error("Explicit isolated App snapshot restore confirmation is required");
  }
  const sourceOrigin = trustedSupabaseOrigin(config.sourceUrl).origin;
  const restoreOrigin = trustedSupabaseOrigin(config.restoreUrl).origin;
  if (sourceOrigin === restoreOrigin) {
    throw new Error("App snapshot source and isolated restore origins must be different");
  }
  if (restoreOrigin !== trustedSupabaseOrigin(config.expectedRestoreOrigin).origin) {
    throw new Error("App snapshot restore target does not match the protected expected origin");
  }
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("App snapshot restore organization ID must be a UUID");
  }
  if (!SCOPE_PATTERN.test(config.projectKey)) {
    throw new Error("App snapshot restore project key is invalid");
  }
  const workspaceId = `snapshot-restore-${randomUUID().replace(/-/g, "")}`;
  const sourcePackRoot = path.resolve("packs/official/product/turn-feedback-into-product-problems");
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAt = now();
  const startedAtMs = nowMs();
  const temporaryRoot = dependencies.temporaryRoot ??
    ((prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix)));
  const roots = await Promise.all([
    temporaryRoot("loopgraph-snapshot-restore-source-"),
    temporaryRoot("loopgraph-snapshot-restore-target-")
  ]);
  const source = await loadLoopPackDirectory(sourcePackRoot);
  const descriptor: AppSnapshotDescriptor = {
    snapshotPath: `.loopgraph/apps/private-snapshots/restore-rehearsal.${workspaceId}/1.0.0`,
    artifactDigest: source.artifact.digest,
    filesDigest: appSnapshotFilesDigest(source)
  };
  const scope = { organizationId: config.organizationId, projectKey: config.projectKey, workspaceId };
  const sourceStore = new SupabaseAppSnapshotStore(
    dependencies.sourceClient,
    scope,
    roots[0]!
  );
  const restoreStore = new SupabaseAppSnapshotStore(
    dependencies.restoreClient,
    scope,
    roots[1]!
  );
  const objectKey = hostedAppSnapshotObjectKey(scope, descriptor);
  const sourceBucket = dependencies.sourceClient.storage.from(HOSTED_APP_SNAPSHOT_BUCKET);
  const restoreBucket = dependencies.restoreClient.storage.from(HOSTED_APP_SNAPSHOT_BUCKET);
  const checks: HostedAppSnapshotRestoreReceipt["checks"] = [];
  let sourceRemoved = false;
  let restoreRemoved = false;
  let archiveSizeBytes = 0;

  try {
    await Promise.all([
      assertPrivateBoundedBucket(dependencies.sourceClient, "source"),
      assertPrivateBoundedBucket(dependencies.restoreClient, "restore")
    ]);
    checks.push({
      name: "separate_private_bounded_buckets",
      ok: true,
      detail: "Source and isolated restore origins expose separate private JSON-only 100 MiB buckets."
    });

    await sourceStore.materialize({
      ...descriptor,
      operationId: `restore-source-${workspaceId}`,
      source
    });
    await sourceStore.assertExact(descriptor);
    const exported = await sourceBucket.download(objectKey);
    if (exported.error || !exported.data) {
      throw new Error("App snapshot restore rehearsal could not export the exact source archive");
    }
    const mediaType = exported.data.type?.split(";", 1)[0];
    const archiveBytes = new Uint8Array(await exported.data.arrayBuffer());
    archiveSizeBytes = archiveBytes.byteLength;
    if (
      archiveSizeBytes < 1 || archiveSizeBytes > MAX_HOSTED_APP_SNAPSHOT_BYTES ||
      (mediaType && mediaType !== HOSTED_APP_SNAPSHOT_MEDIA_TYPE)
    ) {
      throw new Error("App snapshot restore rehearsal exported an invalid source archive");
    }
    checks.push({
      name: "source_archive_exported",
      ok: true,
      detail: "The source service exported one bounded archive after verifying its signed content identity."
    });

    const restored = await restoreBucket.upload(objectKey, archiveBytes, {
      contentType: HOSTED_APP_SNAPSHOT_MEDIA_TYPE,
      cacheControl: "0",
      upsert: false
    });
    if (restored.error) {
      await restoreStore.assertExact(descriptor);
    }
    await restoreStore.assertExact(descriptor);
    checks.push({
      name: "target_first_writer_restore",
      ok: true,
      detail: "The isolated target accepted one content-bound first writer or an exact retry of it."
    });

    const loaded = await restoreStore.loadExact(descriptor);
    if (
      loaded.artifact.digest !== descriptor.artifactDigest ||
      appSnapshotFilesDigest(loaded) !== descriptor.filesDigest ||
      path.resolve(loaded.root).startsWith(path.resolve(roots[0]!) + path.sep)
    ) {
      throw new Error("Isolated App snapshot restore did not load the exact signed LoopPack");
    }
    checks.push({
      name: "isolated_target_exact_load",
      ok: true,
      detail: "A clean target runtime loaded the exact artifact and complete signed file inventory."
    });

    await removeExactProbe(restoreBucket, objectKey, "restore");
    restoreRemoved = true;
    await sourceStore.assertExact(descriptor);
    checks.push({
      name: "source_preserved_after_target_cleanup",
      ok: true,
      detail: "Deleting the isolated restored probe left the verified source archive unchanged."
    });

    await removeExactProbe(sourceBucket, objectKey, "source");
    sourceRemoved = true;
    checks.push({
      name: "cleanup_verified",
      ok: true,
      detail: "The rehearsal removed only its exact fresh probe from both service-only origins."
    });

    if (checks.length !== 6) throw new Error("App snapshot restore rehearsal omitted a required check");
    const completedAt = now();
    return {
      schemaVersion: "hosted-app-snapshot-restore-rehearsal/v1",
      sourceOrigin,
      restoreOrigin,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, nowMs() - startedAtMs),
      archiveSizeBytes,
      snapshotIdentityDigest: canonicalAppDigest({
        organizationId: config.organizationId,
        projectKey: config.projectKey,
        workspaceId,
        descriptor
      }),
      artifactDigest: descriptor.artifactDigest,
      filesDigest: descriptor.filesDigest,
      checks
    };
  } finally {
    const cleanupErrors: unknown[] = [];
    if (!restoreRemoved) {
      try {
        await removeExactProbe(restoreBucket, objectKey, "restore");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (!sourceRemoved) {
      try {
        await removeExactProbe(sourceBucket, objectKey, "source");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    if (cleanupErrors.length > 0) {
      throw new Error("App snapshot restore rehearsal could not verify exact probe cleanup");
    }
  }
}

async function assertPrivateBoundedBucket(client: SupabaseClient, label: string): Promise<void> {
  const result = await client.storage.getBucket(HOSTED_APP_SNAPSHOT_BUCKET);
  if (
    result.error || !result.data || result.data.public !== false ||
    result.data.file_size_limit !== MAX_HOSTED_APP_SNAPSHOT_BYTES ||
    result.data.allowed_mime_types?.length !== 1 ||
    result.data.allowed_mime_types[0] !== HOSTED_APP_SNAPSHOT_MEDIA_TYPE
  ) {
    throw new Error(`App snapshot ${label} bucket is not private and bounded as required`);
  }
}

async function removeExactProbe(
  bucket: ReturnType<SupabaseClient["storage"]["from"]>,
  objectKey: string,
  label: string
): Promise<void> {
  const removed = await bucket.remove([objectKey]);
  if (removed.error) throw new Error(`App snapshot ${label} probe cleanup was denied`);
  const after = await bucket.download(objectKey);
  if (!after.error || after.data) {
    throw new Error(`App snapshot ${label} probe cleanup did not remove the exact object`);
  }
}

function trustedSupabaseOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash
  ) {
    throw new Error("App snapshot restore Supabase URL must be one HTTPS origin");
  }
  return url;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for App snapshot restore rehearsal`);
  return value;
}

async function main() {
  const sourceUrl = required("LOOPGRAPH_APP_SNAPSHOT_BACKUP_SOURCE_URL");
  const restoreUrl = required("LOOPGRAPH_APP_SNAPSHOT_RESTORE_TARGET_URL");
  const sourceServiceRole = await readProjectedSecretFile(
    required("LOOPGRAPH_APP_SNAPSHOT_BACKUP_SOURCE_SERVICE_ROLE_KEY_FILE"),
    "LOOPGRAPH_APP_SNAPSHOT_BACKUP_SOURCE_SERVICE_ROLE_KEY_FILE"
  );
  const restoreServiceRole = await readProjectedSecretFile(
    required("LOOPGRAPH_APP_SNAPSHOT_RESTORE_TARGET_SERVICE_ROLE_KEY_FILE"),
    "LOOPGRAPH_APP_SNAPSHOT_RESTORE_TARGET_SERVICE_ROLE_KEY_FILE"
  );
  if (sourceServiceRole === restoreServiceRole) {
    throw new Error("App snapshot source and restore service identities must be different");
  }
  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  };
  const receipt = await rehearseHostedAppSnapshotRestore({
    sourceUrl,
    restoreUrl,
    expectedRestoreOrigin: required("LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RESTORE_ORIGIN"),
    confirmIsolatedRestore:
      process.env.LOOPGRAPH_CONFIRM_ISOLATED_APP_SNAPSHOT_RESTORE?.trim() === "yes",
    organizationId: required("LOOPGRAPH_APP_SNAPSHOT_RESTORE_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_APP_SNAPSHOT_RESTORE_PROJECT_KEY")
  }, {
    sourceClient: createClient(sourceUrl, sourceServiceRole, clientOptions),
    restoreClient: createClient(restoreUrl, restoreServiceRole, clientOptions)
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
