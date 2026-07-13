import path from "node:path";
import type { StorageAdapter } from "../sdk/adapters";
import { FileStorageAdapter } from "../sdk/storage";

let cachedAdapter: StorageAdapter | null = null;

export function getLoopgraphRoot(cwd = process.cwd()) {
  return path.join(cwd, ".loopgraph");
}

export function getStorageAdapter(options?: { rootDir?: string; forceFile?: boolean }): StorageAdapter {
  if (!options?.forceFile && cachedAdapter) {
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
