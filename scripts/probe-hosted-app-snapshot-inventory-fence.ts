import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalAppDigest } from "loopgraph/core";
import { HOSTED_APP_SNAPSHOT_BUCKET, HOSTED_APP_SNAPSHOT_MEDIA_TYPE } from "../lib/db/adapters/supabase-app-snapshot-store";
import { readProjectedSecretFile } from "./projected-secret-file";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PROBE_SUFFIX_PATTERN = /^[0-9a-f]{24}$/;

export type HostedAppSnapshotFenceProbeConfig = {
  supabaseUrl: string;
  organizationId: string;
  expectedScopeDigest: string;
  allowMutation: boolean;
};

export type HostedAppSnapshotFenceProbeReceipt = {
  schemaVersion: "hosted-app-snapshot-fence-probe/v1";
  checkedAt: string;
  durationMs: number;
  scopeDigest: string;
  healthy: true;
  checks: Array<{
    name:
      | "registry_insert_advanced"
      | "registry_update_advanced"
      | "registry_delete_advanced"
      | "storage_upload_advanced"
      | "storage_replace_advanced"
      | "storage_delete_advanced"
      | "probe_authority_clean"
      | "probe_generation_clean";
    ok: true;
  }>;
};

export function hostedAppSnapshotFenceProbeScopeDigest(input: {
  supabaseUrl: string;
  organizationId: string;
}): string {
  return canonicalAppDigest({
    origin: trustedOrigin(input.supabaseUrl),
    organizationId: assertOrganizationId(input.organizationId),
    probeNamespace: "fence_probe"
  });
}

export async function probeHostedAppSnapshotInventoryFence(
  config: HostedAppSnapshotFenceProbeConfig,
  dependencies: {
    client: SupabaseClient;
    probeSuffix?: () => string;
    now?: () => Date;
    nowMs?: () => number;
  }
): Promise<HostedAppSnapshotFenceProbeReceipt> {
  if (!config.allowMutation) {
    throw new Error("Hosted App snapshot fence probe mutation was not explicitly enabled");
  }
  const scopeDigest = hostedAppSnapshotFenceProbeScopeDigest(config);
  if (!DIGEST_PATTERN.test(config.expectedScopeDigest) || config.expectedScopeDigest !== scopeDigest) {
    throw new Error("Hosted App snapshot fence probe target does not match the pinned staging scope");
  }
  const suffix = dependencies.probeSuffix?.() ?? randomBytes(12).toString("hex");
  if (!PROBE_SUFFIX_PATTERN.test(suffix)) {
    throw new Error("Hosted App snapshot fence probe identity is invalid");
  }
  const projectKey = `fence_probe_${suffix}`;
  const workspaceId = `fence-probe-${suffix}`;
  const objectKey = [
    config.organizationId,
    projectKey,
    workspaceId,
    digestSegment(`path:${suffix}`),
    digestSegment(`artifact:${suffix}`),
    `${digestSegment(`files:${suffix}`)}.loopgraph-pack.json`
  ].join("/");
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAt = nowMs();

  await registryProbe(dependencies.client, config.organizationId, projectKey);
  const generationBefore = await readGeneration(dependencies.client, config.organizationId, projectKey);
  if (generationBefore !== 0) {
    throw new Error("Hosted App snapshot fence probe registry cleanup left residual generation state");
  }

  const bucket = dependencies.client.storage.from(HOSTED_APP_SNAPSHOT_BUCKET);
  let uploaded = false;
  let removed = false;
  let storageUploadAdvanced = false;
  let storageReplaceAdvanced = false;
  let storageDeleteAdvanced = false;
  let operationError: unknown;
  let cleanupError: unknown;
  try {
    const upload = await bucket.upload(
      objectKey,
      probeBytes("upload", suffix),
      { contentType: HOSTED_APP_SNAPSHOT_MEDIA_TYPE, cacheControl: "0", upsert: false }
    );
    if (upload.error) throw new Error("Hosted App snapshot fence probe upload failed");
    uploaded = true;
    const afterUpload = await readGeneration(dependencies.client, config.organizationId, projectKey);
    storageUploadAdvanced = afterUpload > generationBefore;
    if (!storageUploadAdvanced) {
      throw new Error("Hosted App snapshot Storage upload did not advance the fence");
    }

    const replace = await bucket.update(
      objectKey,
      probeBytes("replace", suffix),
      { contentType: HOSTED_APP_SNAPSHOT_MEDIA_TYPE, cacheControl: "0", upsert: true }
    );
    if (replace.error) throw new Error("Hosted App snapshot fence probe replace failed");
    const afterReplace = await readGeneration(dependencies.client, config.organizationId, projectKey);
    storageReplaceAdvanced = afterReplace > afterUpload;
    if (!storageReplaceAdvanced) {
      throw new Error("Hosted App snapshot Storage replace did not advance the fence");
    }

    const remove = await bucket.remove([objectKey]);
    if (remove.error) throw new Error("Hosted App snapshot fence probe removal failed");
    removed = true;
    const afterDelete = await readGeneration(dependencies.client, config.organizationId, projectKey);
    storageDeleteAdvanced = afterDelete > afterReplace;
    if (!storageDeleteAdvanced) {
      throw new Error("Hosted App snapshot Storage delete did not advance the fence");
    }
  } catch (error) {
    operationError = error;
  } finally {
    if (uploaded && !removed) {
      const cleanup = await bucket.remove([objectKey]);
      if (cleanup.error) cleanupError = new Error("Hosted App snapshot fence probe object cleanup failed");
      else removed = true;
    }
    const cleanup = await dependencies.client.rpc(
      "loopgraph_app_snapshot_storage_fence_probe_cleanup",
      { p_organization_id: config.organizationId, p_project_key: projectKey }
    );
    if (cleanup.error || cleanup.data !== true) {
      cleanupError = new Error("Hosted App snapshot fence probe database cleanup failed");
    }
  }
  if (cleanupError) throw cleanupError;
  if (operationError) throw operationError;

  return {
    schemaVersion: "hosted-app-snapshot-fence-probe/v1",
    checkedAt: now().toISOString(),
    durationMs: Math.max(0, nowMs() - startedAt),
    scopeDigest,
    healthy: true,
    checks: [
      { name: "registry_insert_advanced", ok: true },
      { name: "registry_update_advanced", ok: true },
      { name: "registry_delete_advanced", ok: true },
      { name: "storage_upload_advanced", ok: true },
      { name: "storage_replace_advanced", ok: true },
      { name: "storage_delete_advanced", ok: true },
      { name: "probe_authority_clean", ok: true },
      { name: "probe_generation_clean", ok: true }
    ]
  };
}

async function registryProbe(client: SupabaseClient, organizationId: string, projectKey: string) {
  const { data, error } = await client.rpc("loopgraph_app_snapshot_registry_fence_probe", {
    p_organization_id: organizationId,
    p_project_key: projectKey
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Hosted App snapshot registry fence probe is unavailable");
  }
  const status = data as Record<string, unknown>;
  const expectedKeys = [
    "deleteAdvanced",
    "generationClean",
    "insertAdvanced",
    "registryClean",
    "schemaVersion",
    "updateAdvanced"
  ];
  const keys = Object.keys(status).sort();
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => keys[index] !== key) ||
    status.schemaVersion !== "hosted-app-snapshot-registry-fence-probe/v1" ||
    status.insertAdvanced !== true ||
    status.updateAdvanced !== true ||
    status.deleteAdvanced !== true ||
    status.registryClean !== true ||
    status.generationClean !== true
  ) {
    throw new Error("Hosted App snapshot registry fence probe did not prove every mutation");
  }
  return status as {
    insertAdvanced: true;
    updateAdvanced: true;
    deleteAdvanced: true;
    registryClean: true;
    generationClean: true;
  };
}

async function readGeneration(client: SupabaseClient, organizationId: string, projectKey: string) {
  const { data, error } = await client.rpc("loopgraph_app_snapshot_inventory_generation_get", {
    p_organization_id: organizationId,
    p_project_key: projectKey
  });
  const generation = typeof data === "string" && /^\d+$/.test(data) ? Number(data) : data;
  if (error || !Number.isSafeInteger(generation) || Number(generation) < 0) {
    throw new Error("Hosted App snapshot fence probe generation is unavailable");
  }
  return Number(generation);
}

function probeBytes(stage: "upload" | "replace", suffix: string) {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: "hosted-app-snapshot-fence-probe/v1",
    stage,
    nonceDigest: canonicalAppDigest({ suffix })
  }));
}

function digestSegment(value: string) {
  return canonicalAppDigest({ value }).slice("sha256:".length);
}

function trustedOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash
  ) {
    throw new Error("Hosted App snapshot fence probe requires a bare HTTPS origin");
  }
  return url.origin;
}

function assertOrganizationId(value: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Hosted App snapshot fence probe organization must be a UUID");
  }
  return value.toLowerCase();
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the hosted App snapshot fence probe`);
  return value;
}

async function main() {
  const supabaseUrl = required("LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_SUPABASE_URL");
  const organizationId = required("LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_ORGANIZATION_ID");
  if (process.argv.includes("--print-scope-digest")) {
    process.stdout.write(`${hostedAppSnapshotFenceProbeScopeDigest({ supabaseUrl, organizationId })}\n`);
    return;
  }
  if (required("LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_ALLOW_MUTATION") !== "yes") {
    throw new Error("LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_ALLOW_MUTATION must be exactly yes");
  }
  const serviceRole = await readProjectedSecretFile(
    required("LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_SERVICE_ROLE_KEY_FILE"),
    "LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_SERVICE_ROLE_KEY_FILE"
  );
  const client = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const receipt = await probeHostedAppSnapshotInventoryFence({
    supabaseUrl,
    organizationId,
    expectedScopeDigest: required("LOOPGRAPH_EXPECTED_APP_SNAPSHOT_FENCE_PROBE_SCOPE_DIGEST"),
    allowMutation: true
  }, { client });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Hosted App snapshot fence probe failed"}\n`);
    process.exitCode = 1;
  });
}
