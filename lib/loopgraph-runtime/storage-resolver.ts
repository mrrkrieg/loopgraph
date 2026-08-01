import path from "node:path";
import type { StorageAdapter } from "loopgraph/sdk";
import { FileStorageAdapter } from "loopgraph/sdk";
import {
  FileHermesDesignStore,
  FileHermesOperationsStore,
  FileDiscoveryDesignStore,
  FileLoopControllerStore,
  FileLoopOpportunityStore,
  FileLoopSpecRegistryStore,
  FileRoutingStore,
  FileSemanticGraphStore,
  getLoopgraphRoot as getPackageLoopgraphRoot,
  type DiscoveryDesignStore,
  type HermesDesignStore,
  type HermesOperationsStore,
  type LoopControllerStore,
  type LoopOpportunityStore,
  type LoopSpecRegistryStore,
  type RoutingStore,
  type SemanticGraphStore
} from "loopgraph/runtime";
import {
  createSupabaseStorageAdapter,
  isSupabaseStorageEnabled
} from "@/lib/db/adapters/supabase-storage";
import {
  createSupabaseRoutingStore,
  isSupabaseRoutingStoreEnabled
} from "@/lib/db/adapters/supabase-routing-store";
import {
  createSupabaseHermesDesignStore,
  isSupabaseHermesDesignStoreEnabled
} from "@/lib/db/adapters/supabase-hermes-design-store";
import {
  createSupabaseHermesOperationsStore,
  isSupabaseHermesOperationsStoreEnabled
} from "@/lib/db/adapters/supabase-hermes-operations-store";
import {
  createSupabaseDiscoveryDesignStore,
  isSupabaseDiscoveryDesignStoreEnabled
} from "@/lib/db/adapters/supabase-discovery-design-store";
import {
  createSupabaseLoopSpecRegistryStore,
  isSupabaseLoopSpecRegistryStoreEnabled
} from "@/lib/db/adapters/supabase-loop-spec-registry-store";
import {
  createSupabaseLoopControllerStore,
  isSupabaseLoopControllerStoreEnabled
} from "@/lib/db/adapters/supabase-loop-controller-store";
import {
  createSupabaseLoopOpportunityStore,
  isSupabaseLoopOpportunityStoreEnabled
} from "@/lib/db/adapters/supabase-loop-opportunity-store";
import {
  createSupabaseSemanticGraphStore,
  isSupabaseSemanticGraphStoreEnabled
} from "@/lib/db/adapters/supabase-semantic-graph-store";
import { isHostedAuthRequired } from "@/lib/auth/hosted-config";

const cachedAdapters = new Map<string, StorageAdapter>();
const cachedRoutingStores = new Map<string, RoutingStore>();
const cachedHermesDesignStores = new Map<string, HermesDesignStore>();
const cachedHermesOperationsStores = new Map<string, HermesOperationsStore>();
const cachedDiscoveryDesignStores = new Map<string, DiscoveryDesignStore>();
const cachedLoopSpecRegistryStores = new Map<string, LoopSpecRegistryStore>();
const cachedLoopControllerStores = new Map<string, LoopControllerStore>();
const cachedLoopOpportunityStores = new Map<string, LoopOpportunityStore>();
const cachedSemanticGraphStores = new Map<string, SemanticGraphStore>();

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

export function getRoutingStore(options?: {
  rootDir?: string;
  forceFile?: boolean;
}): RoutingStore {
  const rootDir = path.resolve(options?.rootDir ?? getLoopgraphRoot());
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const cacheKey = isSupabaseRoutingStoreEnabled()
    ? `supabase-routing:${organizationId}:${projectKey}`
    : `file-routing:${rootDir}`;
  if (!options?.forceFile && cachedRoutingStores.has(cacheKey)) {
    return cachedRoutingStores.get(cacheKey)!;
  }

  const store = !options?.forceFile && isSupabaseRoutingStoreEnabled()
    ? createSupabaseRoutingStore()
    : new FileRoutingStore(rootDir);
  if (!options?.forceFile) cachedRoutingStores.set(cacheKey, store);
  return store;
}

export function getHermesDesignStore(options?: {
  rootDir?: string;
  forceFile?: boolean;
}): HermesDesignStore {
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const useSupabase =
    !options?.forceFile && isSupabaseHermesDesignStoreEnabled();
  if (!options?.forceFile && isHostedAuthRequired() && !useSupabase) {
    throw new Error(
      "Supabase Hermes design storage requires NEXT_PUBLIC_SUPABASE_URL, " +
      "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  const rootDir = useSupabase
    ? undefined
    : path.resolve(options?.rootDir ?? getLoopgraphRoot());
  const cacheKey = useSupabase
    ? `supabase-hermes-design:${organizationId}:${projectKey}`
    : `file-hermes-design:${rootDir!}`;
  if (!options?.forceFile && cachedHermesDesignStores.has(cacheKey)) {
    return cachedHermesDesignStores.get(cacheKey)!;
  }

  const store = useSupabase
    ? createSupabaseHermesDesignStore()
    : new FileHermesDesignStore(rootDir!);
  if (!options?.forceFile) cachedHermesDesignStores.set(cacheKey, store);
  return store;
}

export function getHermesOperationsStore(options?: {
  rootDir?: string;
  forceFile?: boolean;
}): HermesOperationsStore {
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const useSupabase = !options?.forceFile && isSupabaseHermesOperationsStoreEnabled();
  if (!options?.forceFile && isHostedAuthRequired() && !useSupabase) {
    throw new Error("Supabase Hermes operations storage is required for the hosted runtime");
  }
  const rootDir = useSupabase ? undefined : path.resolve(options?.rootDir ?? getLoopgraphRoot());
  const cacheKey = useSupabase
    ? `supabase-hermes-operations:${organizationId}:${projectKey}`
    : `file-hermes-operations:${rootDir!}`;
  if (!options?.forceFile && cachedHermesOperationsStores.has(cacheKey)) {
    return cachedHermesOperationsStores.get(cacheKey)!;
  }
  const store = useSupabase
    ? createSupabaseHermesOperationsStore()
    : new FileHermesOperationsStore(rootDir!);
  if (!options?.forceFile) cachedHermesOperationsStores.set(cacheKey, store);
  return store;
}

export function getDiscoveryDesignStore(options?: {
  rootDir?: string;
  forceFile?: boolean;
}): DiscoveryDesignStore {
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const useSupabase =
    !options?.forceFile && isSupabaseDiscoveryDesignStoreEnabled();
  if (!options?.forceFile && isHostedAuthRequired() && !useSupabase) {
    throw new Error(
      "Supabase discovery design storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  const rootDir = useSupabase
    ? undefined
    : path.resolve(options?.rootDir ?? getLoopgraphRoot());
  const cacheKey = useSupabase
    ? `supabase-discovery-design:${organizationId}:${projectKey}`
    : `file-discovery-design:${rootDir!}`;
  if (!options?.forceFile && cachedDiscoveryDesignStores.has(cacheKey)) {
    return cachedDiscoveryDesignStores.get(cacheKey)!;
  }

  const store = useSupabase
    ? createSupabaseDiscoveryDesignStore()
    : new FileDiscoveryDesignStore(rootDir!);
  if (!options?.forceFile) {
    cachedDiscoveryDesignStores.set(cacheKey, store);
  }
  return store;
}

export function getLoopSpecRegistryStore(options?: {
  projectRoot?: string;
  forceFile?: boolean;
}): LoopSpecRegistryStore {
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const useSupabase =
    !options?.forceFile && isSupabaseLoopSpecRegistryStoreEnabled();
  if (!options?.forceFile && isHostedAuthRequired() && !useSupabase) {
    throw new Error(
      "Supabase LoopSpec registry storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  const projectRoot = path.resolve(
    options?.projectRoot ?? getActiveLoopgraphProjectRoot()
  );
  const cacheKey = useSupabase
    ? `supabase-loop-spec-registry:${organizationId}:${projectKey}`
    : `file-loop-spec-registry:${projectRoot}`;
  if (!options?.forceFile && cachedLoopSpecRegistryStores.has(cacheKey)) {
    return cachedLoopSpecRegistryStores.get(cacheKey)!;
  }

  const store = useSupabase
    ? createSupabaseLoopSpecRegistryStore()
    : new FileLoopSpecRegistryStore(projectRoot);
  if (!options?.forceFile) {
    cachedLoopSpecRegistryStores.set(cacheKey, store);
  }
  return store;
}

export function getLoopControllerStore(options?: {
  projectRoot?: string;
  forceFile?: boolean;
}): LoopControllerStore {
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const useSupabase =
    !options?.forceFile && isSupabaseLoopControllerStoreEnabled();
  if (!options?.forceFile && isHostedAuthRequired() && !useSupabase) {
    throw new Error(
      "Supabase loop controller storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  const projectRoot = path.resolve(
    options?.projectRoot ?? getActiveLoopgraphProjectRoot()
  );
  const cacheKey = useSupabase
    ? `supabase-loop-controller:${organizationId}:${projectKey}`
    : `file-loop-controller:${projectRoot}`;
  if (!options?.forceFile && cachedLoopControllerStores.has(cacheKey)) {
    return cachedLoopControllerStores.get(cacheKey)!;
  }
  const store = useSupabase
    ? createSupabaseLoopControllerStore()
    : new FileLoopControllerStore(getPackageLoopgraphRoot(projectRoot));
  if (!options?.forceFile) cachedLoopControllerStores.set(cacheKey, store);
  return store;
}

export function getLoopOpportunityStore(options?: {
  projectRoot?: string;
  forceFile?: boolean;
}): LoopOpportunityStore {
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const useSupabase =
    !options?.forceFile && isSupabaseLoopOpportunityStoreEnabled();
  if (!options?.forceFile && isHostedAuthRequired() && !useSupabase) {
    throw new Error(
      "Supabase loop opportunity storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  const projectRoot = path.resolve(
    options?.projectRoot ?? getActiveLoopgraphProjectRoot()
  );
  const cacheKey = useSupabase
    ? `supabase-loop-opportunities:${organizationId}:${projectKey}`
    : `file-loop-opportunities:${projectRoot}`;
  if (!options?.forceFile && cachedLoopOpportunityStores.has(cacheKey)) {
    return cachedLoopOpportunityStores.get(cacheKey)!;
  }
  const store = useSupabase
    ? createSupabaseLoopOpportunityStore()
    : new FileLoopOpportunityStore(getPackageLoopgraphRoot(projectRoot));
  if (!options?.forceFile) cachedLoopOpportunityStores.set(cacheKey, store);
  return store;
}

export function getSemanticGraphStore(options?: {
  projectRoot?: string;
  forceFile?: boolean;
}): SemanticGraphStore {
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const useSupabase =
    !options?.forceFile && isSupabaseSemanticGraphStoreEnabled();
  if (!options?.forceFile && isHostedAuthRequired() && !useSupabase) {
    throw new Error(
      "Supabase semantic graph storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  const projectRoot = path.resolve(
    options?.projectRoot ?? getActiveLoopgraphProjectRoot()
  );
  const cacheKey = useSupabase
    ? `supabase-semantic-graph:${organizationId}:${projectKey}`
    : `file-semantic-graph:${projectRoot}`;
  if (!options?.forceFile && cachedSemanticGraphStores.has(cacheKey)) {
    return cachedSemanticGraphStores.get(cacheKey)!;
  }
  const store = useSupabase
    ? createSupabaseSemanticGraphStore()
    : new FileSemanticGraphStore(getPackageLoopgraphRoot(projectRoot));
  if (!options?.forceFile) cachedSemanticGraphStores.set(cacheKey, store);
  return store;
}

export function resetStorageAdapterCache() {
  cachedAdapters.clear();
  cachedRoutingStores.clear();
  cachedHermesDesignStores.clear();
  cachedHermesOperationsStores.clear();
  cachedDiscoveryDesignStores.clear();
  cachedLoopSpecRegistryStores.clear();
  cachedLoopControllerStores.clear();
  cachedLoopOpportunityStores.clear();
  cachedSemanticGraphStores.clear();
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
