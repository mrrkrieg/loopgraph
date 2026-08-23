import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActiveLoopgraphProjectRoot,
  getAppInstallationStore,
  getAppSnapshotStore,
  getAppVerificationStore,
  getCompanyContextStore,
  getConnectorFieldMappingStore,
  getDiscoveryDesignStore,
  getEntityResolutionStore,
  getHermesRouteActivationStore,
  getLoopControllerStore,
  getLoopOpportunityStore,
  getLoopSpecRegistryStore,
  getMeasurementStore,
  getOutcomeStore,
  getStorageAdapter,
  getProviderSchemaSnapshotStore,
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

  it("keeps local controller and opportunity stores scoped by project", () => {
    const firstController = getLoopControllerStore({
      projectRoot: "/tmp/loopgraph-controller-a",
      forceFile: true
    });
    const secondController = getLoopControllerStore({
      projectRoot: "/tmp/loopgraph-controller-b",
      forceFile: true
    });
    const firstOpportunities = getLoopOpportunityStore({
      projectRoot: "/tmp/loopgraph-opportunities-a",
      forceFile: true
    });
    const secondOpportunities = getLoopOpportunityStore({
      projectRoot: "/tmp/loopgraph-opportunities-b",
      forceFile: true
    });
    expect(firstController.persistence).toBe("file");
    expect(firstOpportunities.persistence).toBe("file");
    expect(secondController).not.toBe(firstController);
    expect(secondOpportunities).not.toBe(firstOpportunities);
  });

  it("scopes local App verification trust by project and workspace", () => {
    const first = getAppVerificationStore({ projectRoot: "/tmp/loopgraph-app-trust-a", workspaceId: "acme", forceFile: true });
    const firstAgain = getAppVerificationStore({ projectRoot: "/tmp/loopgraph-app-trust-a", workspaceId: "acme", forceFile: true });
    const secondWorkspace = getAppVerificationStore({ projectRoot: "/tmp/loopgraph-app-trust-a", workspaceId: "globex", forceFile: true });
    expect(first.persistence).toBe("local");
    expect(firstAgain).toBe(first);
    expect(secondWorkspace).not.toBe(first);
  });

  it("scopes local Hermes route activation proof by project and workspace", () => {
    const first = getHermesRouteActivationStore({ projectRoot: "/tmp/loopgraph-routes-a", workspaceId: "acme", forceFile: true });
    const firstAgain = getHermesRouteActivationStore({ projectRoot: "/tmp/loopgraph-routes-a", workspaceId: "acme", forceFile: true });
    const secondWorkspace = getHermesRouteActivationStore({ projectRoot: "/tmp/loopgraph-routes-a", workspaceId: "globex", forceFile: true });
    expect(first.persistence).toBe("file");
    expect(firstAgain).toBe(first);
    expect(secondWorkspace).not.toBe(first);
  });

  it("scopes local App installation registries by project and workspace", () => {
    const first = getAppInstallationStore({ projectRoot: "/tmp/loopgraph-apps-a", workspaceId: "acme", forceFile: true });
    const firstAgain = getAppInstallationStore({ projectRoot: "/tmp/loopgraph-apps-a", workspaceId: "acme", forceFile: true });
    const secondWorkspace = getAppInstallationStore({ projectRoot: "/tmp/loopgraph-apps-a", workspaceId: "globex", forceFile: true });
    expect(first.persistence).toBe("file");
    expect(firstAgain).toBe(first);
    expect(secondWorkspace).not.toBe(first);
  });

  it("scopes local App snapshots by project and workspace", () => {
    const first = getAppSnapshotStore({ projectRoot: "/tmp/loopgraph-apps-a", workspaceId: "acme", forceFile: true });
    const firstAgain = getAppSnapshotStore({ projectRoot: "/tmp/loopgraph-apps-a", workspaceId: "acme", forceFile: true });
    const secondWorkspace = getAppSnapshotStore({ projectRoot: "/tmp/loopgraph-apps-a", workspaceId: "globex", forceFile: true });
    expect(first.persistence).toBe("local");
    expect(firstAgain).toBe(first);
    expect(secondWorkspace).not.toBe(first);
  });

  it("scopes local App connector metadata by project and workspace", () => {
    const mappings = getConnectorFieldMappingStore({ projectRoot: "/tmp/loopgraph-metadata-a", workspaceId: "acme", forceFile: true });
    const mappingsAgain = getConnectorFieldMappingStore({ projectRoot: "/tmp/loopgraph-metadata-a", workspaceId: "acme", forceFile: true });
    const schemas = getProviderSchemaSnapshotStore({ projectRoot: "/tmp/loopgraph-metadata-a", workspaceId: "acme", forceFile: true });
    expect(mappings.persistence).toBe("file");
    expect(schemas.persistence).toBe("file");
    expect(mappingsAgain).toBe(mappings);
  });

  it("scopes local company context by project, workspace, and company", () => {
    const first = getCompanyContextStore({ projectRoot: "/tmp/loopgraph-context-a", workspaceId: "acme", companyId: "acme-company", forceFile: true });
    const firstAgain = getCompanyContextStore({ projectRoot: "/tmp/loopgraph-context-a", workspaceId: "acme", companyId: "acme-company", forceFile: true });
    const secondCompany = getCompanyContextStore({ projectRoot: "/tmp/loopgraph-context-a", workspaceId: "acme", companyId: "globex-company", forceFile: true });
    expect(first.persistence).toBe("file");
    expect(firstAgain).toBe(first);
    expect(secondCompany).not.toBe(first);
  });

  it("scopes local learning evidence and canonical entities by project", () => {
    const firstMeasurements = getMeasurementStore({
      projectRoot: "/tmp/loopgraph-learning-a",
      forceFile: true
    });
    const firstOutcomes = getOutcomeStore({
      projectRoot: "/tmp/loopgraph-learning-a",
      forceFile: true
    });
    const firstEntities = getEntityResolutionStore({
      projectRoot: "/tmp/loopgraph-learning-a",
      forceFile: true
    });
    const secondMeasurements = getMeasurementStore({
      projectRoot: "/tmp/loopgraph-learning-b",
      forceFile: true
    });
    const secondOutcomes = getOutcomeStore({
      projectRoot: "/tmp/loopgraph-learning-b",
      forceFile: true
    });
    const secondEntities = getEntityResolutionStore({
      projectRoot: "/tmp/loopgraph-learning-b",
      forceFile: true
    });

    expect(firstMeasurements.persistence).toBe("local");
    expect(firstOutcomes.persistence).toBe("local");
    expect(firstEntities.persistence).toBe("local");
    expect(secondMeasurements).not.toBe(firstMeasurements);
    expect(secondOutcomes).not.toBe(firstOutcomes);
    expect(secondEntities).not.toBe(firstEntities);
  });

  it("fails closed instead of using file state for hosted controller data", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    expect(() => getLoopControllerStore()).toThrow(
      "Supabase loop controller storage requires"
    );
    expect(() => getLoopOpportunityStore()).toThrow(
      "Supabase loop opportunity storage requires"
    );
    expect(() => getAppVerificationStore({ workspaceId: "acme" })).toThrow(
      "Distributed App verification storage is required"
    );
    expect(() => getHermesRouteActivationStore({ workspaceId: "acme" })).toThrow(
      "Distributed Hermes route activation storage is required"
    );
    expect(() => getAppInstallationStore({ workspaceId: "acme" })).toThrow(
      "Distributed App installation storage is required"
    );
    expect(() => getAppSnapshotStore({ workspaceId: "acme" })).toThrow(
      "Distributed App snapshot storage is required"
    );
    expect(() => getConnectorFieldMappingStore({ workspaceId: "acme" })).toThrow(
      "Distributed App field-mapping storage is required"
    );
    expect(() => getProviderSchemaSnapshotStore({ workspaceId: "acme" })).toThrow(
      "Distributed provider-schema storage is required"
    );
    expect(() => getCompanyContextStore({ workspaceId: "acme", companyId: "acme-company" })).toThrow(
      "Distributed company-context storage is required"
    );
    expect(() => getMeasurementStore()).toThrow(
      "Distributed measurement storage is required"
    );
    expect(() => getOutcomeStore()).toThrow(
      "Distributed outcome storage is required"
    );
    expect(() => getEntityResolutionStore()).toThrow(
      "Distributed entity resolution is required"
    );
  });
});
