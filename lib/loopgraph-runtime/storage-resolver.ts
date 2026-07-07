import path from "node:path";
import type { StorageAdapter } from "loopgraph/sdk";
import { FileStorageAdapter } from "loopgraph/sdk";
import { getLoopgraphRoot as getPackageLoopgraphRoot } from "loopgraph/runtime";
import {
  createSupabaseStorageAdapter,
  isSupabaseStorageEnabled
} from "@/lib/db/adapters/supabase-storage";

let cachedAdapter: StorageAdapter | null = null;

export function getLoopgraphRoot(cwd = process.cwd()) {
  return getPackageLoopgraphRoot(cwd);
}

export function getStorageAdapter(options?: { rootDir?: string; forceFile?: boolean }): StorageAdapter {
  if (!options?.forceFile && cachedAdapter) {
    return cachedAdapter;
  }

  if (!options?.forceFile && isSupabaseStorageEnabled()) {
    cachedAdapter = createSupabaseStorageAdapter();
    return cachedAdapter;
  }

  const adapter = new FileStorageAdapter(options?.rootDir ?? getLoopgraphRoot());
  if (!options?.forceFile) {
    cachedAdapter = adapter;
  }
  return adapter;
}

export function resetStorageAdapterCache() {
  cachedAdapter = null;
}
