import path from "node:path";
import type { StorageAdapter } from "loopgraph/sdk";
import { FileStorageAdapter } from "loopgraph/sdk";
import { getLoopgraphRoot as getPackageLoopgraphRoot } from "loopgraph/runtime";
import {
  createSupabaseStorageAdapter,
  isSupabaseStorageEnabled
} from "@/lib/db/adapters/supabase-storage";
import { isHostedAuthRequired } from "@/lib/auth/hosted-config";

const cachedAdapters = new Map<string, StorageAdapter>();

export function getActiveLoopgraphProjectRoot(projectRoot?: string) {
  if (isHostedAuthRequired()) {
    return resolveHostedRuntimeProjectRoot(process.env);
  }
  return path.resolve(projectRoot ?? process.env.LOOPGRAPH_PROJECT_ROOT ?? process.cwd());
}

export function resolveHostedRuntimeProjectRoot(env: NodeJS.ProcessEnv): string {
  const runtimeRoot = requiredValue(
    env.LOOPGRAPH_HOSTED_RUNTIME_ROOT,
    "LOOPGRAPH_HOSTED_RUNTIME_ROOT"
  );
  const organizationId = requiredValue(
    env.LOOPGRAPH_HOSTED_ORGANIZATION_ID,
    "LOOPGRAPH_HOSTED_ORGANIZATION_ID"
  );
  const projectKey = env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!UUID_PATTERN.test(organizationId)) {
    throw new Error("LOOPGRAPH_HOSTED_ORGANIZATION_ID must be a UUID.");
  }
  if (!PROJECT_KEY_PATTERN.test(projectKey)) {
    throw new Error(
      "LOOPGRAPH_HOSTED_PROJECT_KEY must start with a lowercase letter or number " +
      "and contain only lowercase letters, numbers, underscores, or hyphens."
    );
  }

  const base = path.resolve(runtimeRoot);
  const resolved = path.resolve(base, organizationId, projectKey);
  if (resolved === base || !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("Hosted runtime project root escaped its configured namespace.");
  }
  return resolved;
}

export function getLoopgraphRoot(cwd = getActiveLoopgraphProjectRoot()) {
  return getPackageLoopgraphRoot(cwd);
}

export function getStorageAdapter(options?: { rootDir?: string; forceFile?: boolean }): StorageAdapter {
  const rootDir = path.resolve(options?.rootDir ?? getLoopgraphRoot());
  const cacheKey = isSupabaseStorageEnabled()
    ? `supabase:${process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID}`
    : `file:${rootDir}`;
  if (!options?.forceFile && cachedAdapters.has(cacheKey)) {
    return cachedAdapters.get(cacheKey)!;
  }

  if (!options?.forceFile && isSupabaseStorageEnabled()) {
    const adapter = createSupabaseStorageAdapter();
    cachedAdapters.set(cacheKey, adapter);
    return adapter;
  }

  const adapter = new FileStorageAdapter(rootDir);
  if (!options?.forceFile) {
    cachedAdapters.set(cacheKey, adapter);
  }
  return adapter;
}

export function resetStorageAdapterCache() {
  cachedAdapters.clear();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function requiredValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `${name} must be configured for an authenticated hosted runtime.`
    );
  }
  return trimmed;
}
