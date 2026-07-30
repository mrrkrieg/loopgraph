import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore,
  getLoopSpecRegistryStore,
  getStorageAdapter,
  resetStorageAdapterCache,
  resolveHostedRuntimeProjectRoot
} from "./storage-resolver";

describe("hosted runtime namespaces", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetStorageAdapterCache();
  });

  it("builds a deterministic organization and project namespace", () => {
    const root = resolveHostedRuntimeProjectRoot({
      NODE_ENV: "production",
      LOOPGRAPH_HOSTED_RUNTIME_ROOT: "/var/lib/loopgraph",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: "123e4567-e89b-12d3-a456-426614174000",
      LOOPGRAPH_HOSTED_PROJECT_KEY: "main"
    } as NodeJS.ProcessEnv);
    expect(root).toBe(path.resolve(
      "/var/lib/loopgraph",
      "123e4567-e89b-12d3-a456-426614174000",
      "main"
    ));
  });

  it("fails closed for missing or unsafe hosted bindings", () => {
    expect(() => resolveHostedRuntimeProjectRoot({
      NODE_ENV: "production"
    } as NodeJS.ProcessEnv)).toThrow("LOOPGRAPH_HOSTED_RUNTIME_ROOT");
    expect(() => resolveHostedRuntimeProjectRoot({
      NODE_ENV: "production",
      LOOPGRAPH_HOSTED_RUNTIME_ROOT: "/var/lib/loopgraph",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: "../other-tenant"
    } as NodeJS.ProcessEnv)).toThrow("must be a UUID");
    expect(() => resolveHostedRuntimeProjectRoot({
      NODE_ENV: "production",
      LOOPGRAPH_HOSTED_RUNTIME_ROOT: "/var/lib/loopgraph",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: "123e4567-e89b-12d3-a456-426614174000",
      LOOPGRAPH_HOSTED_PROJECT_KEY: "../../escape"
    } as NodeJS.ProcessEnv)).toThrow("LOOPGRAPH_HOSTED_PROJECT_KEY");
  });

  it("ignores the repository project root in authenticated hosted mode", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", "/unsafe/shared-root");
    vi.stubEnv("LOOPGRAPH_HOSTED_RUNTIME_ROOT", "/var/lib/loopgraph");
    vi.stubEnv(
      "LOOPGRAPH_HOSTED_ORGANIZATION_ID",
      "123e4567-e89b-12d3-a456-426614174000"
    );
    expect(getActiveLoopgraphProjectRoot()).toBe(path.resolve(
      "/var/lib/loopgraph",
      "123e4567-e89b-12d3-a456-426614174000",
      "default"
    ));
  });

  it("caches file adapters per resolved namespace instead of globally", () => {
    const first = getStorageAdapter({ rootDir: "/tmp/loopgraph-org-a", forceFile: false });
    const firstAgain = getStorageAdapter({ rootDir: "/tmp/loopgraph-org-a", forceFile: false });
    const second = getStorageAdapter({ rootDir: "/tmp/loopgraph-org-b", forceFile: false });
    expect(firstAgain).toBe(first);
    expect(second).not.toBe(first);
  });

  it("caches discovery design stores per local namespace", () => {
    const first = getDiscoveryDesignStore({
      rootDir: "/tmp/loopgraph-discovery-a"
    });
    const firstAgain = getDiscoveryDesignStore({
      rootDir: "/tmp/loopgraph-discovery-a"
    });
    const second = getDiscoveryDesignStore({
      rootDir: "/tmp/loopgraph-discovery-b"
    });
    expect(firstAgain).toBe(first);
    expect(second).not.toBe(first);
    expect(first.persistence).toBe("file");
  });

  it("caches local LoopSpec registries per project namespace", () => {
    const first = getLoopSpecRegistryStore({
      projectRoot: "/tmp/loopgraph-registry-a",
      forceFile: true
    });
    const second = getLoopSpecRegistryStore({
      projectRoot: "/tmp/loopgraph-registry-b",
      forceFile: true
    });
    expect(first.persistence).toBe("file");
    expect(second.persistence).toBe("file");
    expect(second).not.toBe(first);
  });
});
