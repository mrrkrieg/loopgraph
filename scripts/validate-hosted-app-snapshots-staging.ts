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
  hostedAppSnapshotLogicalPrefix,
  hostedAppSnapshotObjectKey
} from "../lib/db/adapters/supabase-app-snapshot-store";
import { readProjectedSupabaseSessionFile } from "./projected-supabase-session";
import { readProjectedSecretFile } from "./projected-secret-file";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type HostedAppSnapshotStagingReceipt = {
  schemaVersion: "hosted-app-snapshot-staging-validation/v1";
  targetOrigin: string;
  organizationId: string;
  projectKey: string;
  checkedAt: string;
  durationMs: number;
  snapshotIdentityDigest: string;
  artifactDigest: string;
  filesDigest: string;
  checks: Array<{
    name:
      | "private_bounded_bucket"
      | "authenticated_download_denial"
      | "authenticated_insert_denial"
      | "authenticated_update_denial"
      | "authenticated_delete_denial"
      | "immutable_first_writer"
      | "cross_replica_exact_recovery"
      | "cleanup_verified";
    ok: true;
    detail: string;
  }>;
};

export async function validateHostedAppSnapshotsStaging(
  config: {
    supabaseUrl: string;
    organizationId: string;
    projectKey: string;
    workspaceId?: string;
    sourcePackRoot?: string;
  },
  dependencies: {
    adminClient: SupabaseClient;
    authenticatedClient: SupabaseClient;
    now?: () => Date;
    nowMs?: () => number;
    temporaryRoot?: (prefix: string) => Promise<string>;
  }
): Promise<HostedAppSnapshotStagingReceipt> {
  const targetOrigin = trustedSupabaseOrigin(config.supabaseUrl).origin;
  if (!UUID_PATTERN.test(config.organizationId)) {
    throw new Error("App snapshot staging organization ID must be a UUID");
  }
  if (!SCOPE_PATTERN.test(config.projectKey)) {
    throw new Error("App snapshot staging project key is invalid");
  }
  const workspaceId = config.workspaceId ?? `snapshot-gate-${randomUUID().replace(/-/g, "")}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,159}$/.test(workspaceId)) {
    throw new Error("App snapshot staging workspace ID is invalid");
  }
  const sourcePackRoot = path.resolve(
    config.sourcePackRoot ?? "packs/official/product/turn-feedback-into-product-problems"
  );
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAt = nowMs();
  const temporaryRoot = dependencies.temporaryRoot ?? ((prefix) => mkdtemp(path.join(os.tmpdir(), prefix)));
  const roots = await Promise.all([
    temporaryRoot("loopgraph-snapshot-gate-writer-"),
    temporaryRoot("loopgraph-snapshot-gate-reader-")
  ]);
  const source = await loadLoopPackDirectory(sourcePackRoot);
  const descriptor: AppSnapshotDescriptor = {
    snapshotPath: `.loopgraph/apps/private-snapshots/staging.${workspaceId}/1.0.0`,
    artifactDigest: source.artifact.digest,
    filesDigest: appSnapshotFilesDigest(source)
  };
  const scope = { organizationId: config.organizationId, projectKey: config.projectKey, workspaceId };
  const writer = new SupabaseAppSnapshotStore(dependencies.adminClient, scope, roots[0]!);
  const reader = new SupabaseAppSnapshotStore(dependencies.adminClient, scope, roots[1]!);
  const objectKey = hostedAppSnapshotObjectKey(scope, descriptor);
  const clientProbeKey = `${objectKey}.client-probe`;
  const bucket = dependencies.adminClient.storage.from(HOSTED_APP_SNAPSHOT_BUCKET);
  const clientBucket = dependencies.authenticatedClient.storage.from(HOSTED_APP_SNAPSHOT_BUCKET);
  const checks: HostedAppSnapshotStagingReceipt["checks"] = [];

  try {
    const bucketResult = await dependencies.adminClient.storage.getBucket(HOSTED_APP_SNAPSHOT_BUCKET);
    if (
      bucketResult.error || !bucketResult.data || bucketResult.data.public !== false ||
      bucketResult.data.file_size_limit !== MAX_HOSTED_APP_SNAPSHOT_BYTES ||
      bucketResult.data.allowed_mime_types?.length !== 1 ||
      bucketResult.data.allowed_mime_types[0] !== HOSTED_APP_SNAPSHOT_MEDIA_TYPE
    ) {
      throw new Error("Hosted App snapshot bucket is not private and bounded as required");
    }
    checks.push({
      name: "private_bounded_bucket",
      ok: true,
      detail: "The shared archive bucket is private, JSON-only, and capped at 100 MiB."
    });

    await writer.materialize({ ...descriptor, operationId: `staging-${workspaceId}`, source });
    const overwriteProbe = await bucket.upload(
      objectKey,
      new Blob(["{}"], { type: HOSTED_APP_SNAPSHOT_MEDIA_TYPE }),
      { contentType: HOSTED_APP_SNAPSHOT_MEDIA_TYPE, upsert: false }
    );
    if (!overwriteProbe.error) {
      throw new Error("Hosted App snapshot bucket accepted an overwrite of the immutable object");
    }
    await writer.materialize({ ...descriptor, operationId: `staging-${workspaceId}`, source });
    await writer.assertExact(descriptor);
    const listed = await bucket.list(hostedAppSnapshotLogicalPrefix(scope, descriptor), { limit: 2 });
    if (listed.error || !listed.data || listed.data.length !== 1) {
      throw new Error("Hosted App snapshot first-writer identity was not immutable");
    }
    checks.push({
      name: "immutable_first_writer",
      ok: true,
      detail: "An exact replay reused one immutable content-bound object instead of overwriting it."
    });

    const deniedDownload = await clientBucket.download(objectKey);
    if (!deniedDownload.error || deniedDownload.data) {
      throw new Error("Authenticated staging client unexpectedly downloaded an App snapshot");
    }
    checks.push({
      name: "authenticated_download_denial",
      ok: true,
      detail: "An authenticated non-service session could not download the exact archive."
    });

    const deniedInsert = await clientBucket.upload(
      clientProbeKey,
      new Blob(["{}"], { type: HOSTED_APP_SNAPSHOT_MEDIA_TYPE }),
      { contentType: HOSTED_APP_SNAPSHOT_MEDIA_TYPE, upsert: false }
    );
    if (!deniedInsert.error) {
      throw new Error("Authenticated staging client unexpectedly inserted an App snapshot object");
    }
    checks.push({
      name: "authenticated_insert_denial",
      ok: true,
      detail: "An authenticated non-service session could not create an archive object."
    });

    const deniedUpdate = await clientBucket.update(
      objectKey,
      new Blob(["{}"], { type: HOSTED_APP_SNAPSHOT_MEDIA_TYPE }),
      { contentType: HOSTED_APP_SNAPSHOT_MEDIA_TYPE, upsert: true }
    );
    if (!deniedUpdate.error) {
      throw new Error("Authenticated staging client unexpectedly updated an App snapshot object");
    }
    await writer.assertExact(descriptor);
    checks.push({
      name: "authenticated_update_denial",
      ok: true,
      detail: "An authenticated non-service session could not replace the immutable archive."
    });

    await clientBucket.remove([objectKey]);
    await writer.assertExact(descriptor);
    checks.push({
      name: "authenticated_delete_denial",
      ok: true,
      detail: "A non-service delete attempt left the exact verified archive intact."
    });

    const loaded = await reader.loadExact(descriptor);
    if (
      loaded.artifact.digest !== descriptor.artifactDigest ||
      appSnapshotFilesDigest(loaded) !== descriptor.filesDigest ||
      path.resolve(loaded.root).startsWith(path.resolve(roots[0]!) + path.sep)
    ) {
      throw new Error("A second hosted replica did not recover the exact detached App archive");
    }
    checks.push({
      name: "cross_replica_exact_recovery",
      ok: true,
      detail: "A separate empty runtime root recovered and verified the same signed LoopPack."
    });
  } finally {
    let cleanupError: unknown;
    try {
      const removed = await bucket.remove([objectKey, clientProbeKey]);
      if (removed.error) cleanupError = new Error("App snapshot staging service cleanup was denied");
    } catch (error) {
      cleanupError = error;
    } finally {
      await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    }
    if (cleanupError) throw cleanupError;
  }

  const afterCleanup = await bucket.download(objectKey);
  if (!afterCleanup.error || afterCleanup.data) {
    throw new Error("App snapshot staging probe cleanup did not remove the temporary archive");
  }
  checks.push({
    name: "cleanup_verified",
    ok: true,
    detail: "The service-only gate removed its unique staging probe after verification."
  });

  if (checks.length !== 8) throw new Error("App snapshot staging gate omitted a required control");
  return {
    schemaVersion: "hosted-app-snapshot-staging-validation/v1",
    targetOrigin,
    organizationId: config.organizationId,
    projectKey: config.projectKey,
    checkedAt: now().toISOString(),
    durationMs: Math.max(0, nowMs() - startedAt),
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
}

function trustedSupabaseOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash
  ) {
    throw new Error("App snapshot staging Supabase URL must be one HTTPS origin");
  }
  return url;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; App snapshot staging validation cannot pass without it`);
  return value;
}

async function main() {
  const supabaseUrl = required("LOOPGRAPH_STAGING_SUPABASE_URL");
  const publishableKey = required("LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = await readProjectedSecretFile(
    required("LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE"),
    "LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE"
  );
  const session = await readProjectedSupabaseSessionFile(
    required("LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE"),
    "LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE"
  );
  const shared = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  };
  const adminClient = createClient(supabaseUrl, serviceRoleKey, shared);
  const authenticatedClient = createClient(supabaseUrl, publishableKey, {
    ...shared,
    global: { headers: { authorization: `Bearer ${session.access_token}` } }
  });
  const receipt = await validateHostedAppSnapshotsStaging({
    supabaseUrl,
    organizationId: required("LOOPGRAPH_STAGING_ORGANIZATION_ID"),
    projectKey: required("LOOPGRAPH_STAGING_PROJECT_KEY")
  }, { adminClient, authenticatedClient });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
