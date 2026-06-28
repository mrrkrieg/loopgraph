import path from "node:path";
import type { StorageAdapter } from "../loopgraph-sdk/adapters";
import { FileStorageAdapter } from "../loopgraph-sdk/storage";

let cachedAdapter: StorageAdapter | null = null;

export function getLoopgraphRoot(cwd = process.cwd()) {
  return path.join(cwd, ".loopgraph");
}

export function getStorageAdapter(options?: { rootDir?: string; forceFile?: boolean }): StorageAdapter {
  if (!options?.forceFile && cachedAdapter) {
    return cachedAdapter;
  }

  // SupabaseStorageAdapter is wired in when env is configured (see supabase-storage.ts).
  const supabaseModule = tryLoadSupabaseAdapter();
  if (!options?.forceFile && supabaseModule?.isSupabaseStorageEnabled()) {
    cachedAdapter = supabaseModule.createSupabaseStorageAdapter();
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

function tryLoadSupabaseAdapter():
  | {
      isSupabaseStorageEnabled: () => boolean;
      createSupabaseStorageAdapter: () => StorageAdapter;
    }
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../loopgraph-sdk/supabase-storage") as {
      isSupabaseStorageEnabled: () => boolean;
      createSupabaseStorageAdapter: () => StorageAdapter;
    };
  } catch {
    return null;
  }
}
