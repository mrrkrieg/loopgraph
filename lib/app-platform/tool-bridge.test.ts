import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { marketplaceAppSchema, type MarketplaceApp } from "loopgraph/core";

const mocks = vi.hoisted(() => ({
  runtimeTool: vi.fn(),
  ensureArtifact: vi.fn(),
  hasCachedArtifact: vi.fn(),
  requireContext: vi.fn(),
  hostedSearch: vi.fn(),
  getDatabase: vi.fn(),
  listInstallations: vi.fn(),
  activeProjectRoot: vi.fn()
}));

vi.mock("loopgraph/runtime", () => ({
  callLoopgraphAppTool: mocks.runtimeTool,
  connectionInstanceFromBrokerInstallation: vi.fn((installation) => installation)
}));
vi.mock("@/lib/auth/hosted-config", () => ({
  isHostedAuthRequired: vi.fn(() => true)
}));
vi.mock("./hosted-marketplace-cache", () => ({
  ensureHostedMarketplaceArtifact: mocks.ensureArtifact,
  hasCachedHostedMarketplaceArtifact: mocks.hasCachedArtifact
}));
vi.mock("./hosted-marketplace-api", () => ({
  requireHostedMarketplaceContext: mocks.requireContext
}));
vi.mock("@/lib/db/workspace-database", () => ({
  getWorkspaceDatabase: mocks.getDatabase
}));
vi.mock("@/lib/connector-broker/admin", () => ({
  listConnectorInstallations: mocks.listInstallations
}));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot: mocks.activeProjectRoot
}));
vi.mock("@/lib/db/adapters/supabase-marketplace-registry-store", () => ({
  SupabaseMarketplaceRegistryStore: class {
    searchVisibleApps = mocks.hostedSearch;
  }
}));

import { callLoopgraphAppTool } from "./tool-bridge";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue({
    userClient: {},
    organizationId: "123e4567-e89b-12d3-a456-426614174000"
  });
  mocks.getDatabase.mockResolvedValue({});
  mocks.listInstallations.mockResolvedValue([]);
  mocks.hasCachedArtifact.mockResolvedValue(false);
  mocks.activeProjectRoot.mockReturnValue("/srv/loopgraph/tenant/main");
});

describe("hosted app tool bridge", () => {
  it("merges local and RLS-visible hosted metadata without downloading artifacts", async () => {
    const localApp = appFixture("acme.sales.local", "filesystem.local", "1.0.0", "a");
    const hostedApp = appFixture("acme.product.hosted", "hosted.tenant", "2.0.0", "b");
    mocks.runtimeTool.mockResolvedValue({
      schemaVersion: "loopgraph-marketplace-search/v1alpha1",
      query: "growth",
      results: [{ app: localApp, score: 0.5, matchedTerms: ["growth"] }]
    });
    mocks.hostedSearch.mockResolvedValue([
      { app: hostedApp, score: 80, matchedTerms: ["summary"] }
    ]);

    const result = await callLoopgraphAppTool("loopgraph_marketplace_search", {
      projectRoot: "/tmp/loopgraph-company",
      query: "growth",
      limit: 20
    }) as { count: number; results: Array<{ app: MarketplaceApp }>; sources: unknown };

    expect(result.count).toBe(2);
    expect(result.results.map((entry) => entry.app.id)).toEqual([
      "acme.product.hosted",
      "acme.sales.local"
    ]);
    expect(result.sources).toEqual({ local: 1, hosted: 1 });
    expect(mocks.ensureArtifact).not.toHaveBeenCalled();
    expect(mocks.requireContext).toHaveBeenCalledWith("workspace.read");
    expect(mocks.runtimeTool).toHaveBeenCalledWith(
      "loopgraph_marketplace_search",
      expect.objectContaining({ projectRoot: "/srv/loopgraph/tenant/main" }),
      expect.any(Object)
    );
  });

  it("fails closed when two visible catalogs claim different digests for one version", async () => {
    const localApp = appFixture("acme.product.shared", "filesystem.local", "1.0.0", "a");
    const hostedApp = appFixture("acme.product.shared", "hosted.tenant", "1.0.0", "b");
    mocks.runtimeTool.mockResolvedValue({
      schemaVersion: "loopgraph-marketplace-search/v1alpha1",
      results: [{ app: localApp, score: 1, matchedTerms: [] }]
    });
    mocks.hostedSearch.mockResolvedValue([
      { app: hostedApp, score: 1, matchedTerms: [] }
    ]);

    await expect(callLoopgraphAppTool("loopgraph_marketplace_search", {
      projectRoot: "/tmp/loopgraph-company"
    })).rejects.toThrow(/immutable marketplace version conflict/i);
  });

  it("stages one exact hosted release and retries the existing runtime tool", async () => {
    mocks.runtimeTool
      .mockRejectedValueOnce(new Error("Marketplace app not found: acme.product.hosted"))
      .mockResolvedValueOnce({ schemaVersion: "loopgraph-app-detail/v1alpha1" });
    mocks.ensureArtifact.mockResolvedValue({});

    const result = await callLoopgraphAppTool("loopgraph_app_get", {
      projectRoot: "/tmp/loopgraph-company/../loopgraph-company",
      appId: "acme.product.hosted",
      version: "2.0.0"
    });

    expect(result).toEqual({ schemaVersion: "loopgraph-app-detail/v1alpha1" });
    expect(mocks.ensureArtifact).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      appId: "acme.product.hosted",
      version: "2.0.0",
      artifactDigest: undefined,
      includeDeprecated: true
    });
    expect(mocks.runtimeTool).toHaveBeenCalledTimes(2);
  });

  it("resolves a hosted range before using the existing governed install planner", async () => {
    mocks.runtimeTool
      .mockRejectedValueOnce(new Error("Marketplace app not found: acme.product.hosted"))
      .mockResolvedValueOnce({ schemaVersion: "loopgraph-app-install-plan/v1alpha1" });
    mocks.ensureArtifact.mockResolvedValue({});

    await callLoopgraphAppTool("loopgraph_app_install_plan", {
      projectRoot: "/tmp/loopgraph-company",
      appId: "acme.product.hosted",
      versionRange: "^2.0.0",
      presetId: "default"
    });

    expect(mocks.ensureArtifact).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      appId: "acme.product.hosted",
      versionRange: "^2.0.0",
      artifactDigest: undefined,
      includeDeprecated: false
    });
    expect(mocks.getDatabase).toHaveBeenCalledWith("integrations.read");
    expect(mocks.runtimeTool).toHaveBeenCalledTimes(2);
  });

  it("stages hosted onboarding and projects only secret-free Connector Broker authority", async () => {
    mocks.runtimeTool
      .mockRejectedValueOnce(new Error("Marketplace app not found: acme.product.hosted"))
      .mockResolvedValueOnce({ schemaVersion: "loopgraph-app-onboarding/v1alpha1" });
    mocks.ensureArtifact.mockResolvedValue({});
    mocks.listInstallations.mockResolvedValue([{ id: "provider-hubspot", providerId: "hubspot" }]);

    await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot: "/tmp/loopgraph-company",
      appId: "acme.product.hosted",
      versionRange: "^2.0.0",
      presetId: "default"
    });

    expect(mocks.ensureArtifact).toHaveBeenCalledWith(expect.objectContaining({
      appId: "acme.product.hosted",
      versionRange: "^2.0.0",
      includeDeprecated: true
    }));
    expect(mocks.getDatabase).toHaveBeenCalledWith("integrations.read");
    expect(mocks.runtimeTool).toHaveBeenLastCalledWith(
      "loopgraph_app_onboarding_get",
      expect.objectContaining({ appId: "acme.product.hosted" }),
      expect.objectContaining({
        connections: [{ id: "provider-hubspot", providerId: "hubspot" }],
        hostedMarketplaceClient: null
      })
    );
  });

  it("rechecks tenant visibility before using a cached hosted release", async () => {
    mocks.hasCachedArtifact.mockResolvedValue(true);
    mocks.ensureArtifact.mockResolvedValue({});
    mocks.runtimeTool.mockResolvedValue({ schemaVersion: "loopgraph-app-detail/v1alpha1" });

    await callLoopgraphAppTool("loopgraph_app_get", {
      projectRoot: "/tmp/loopgraph-company",
      appId: "acme.product.hosted",
      version: "2.0.0"
    });

    expect(mocks.ensureArtifact).toHaveBeenCalledBefore(mocks.runtimeTool);
    expect(mocks.ensureArtifact).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      appId: "acme.product.hosted",
      version: "2.0.0",
      artifactDigest: undefined,
      includeDeprecated: true
    });
    expect(mocks.activeProjectRoot).toHaveBeenCalledWith(
      path.resolve("/tmp/loopgraph-company")
    );
  });
});

function appFixture(
  id: string,
  sourceId: string,
  version: string,
  digestCharacter: string
): MarketplaceApp {
  const digest = `sha256:${digestCharacter.repeat(64)}`;
  return marketplaceAppSchema.parse({
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    id,
    name: id,
    summary: "Turn trusted growth signals into reviewed work.",
    description: "A marketplace fixture for the hosted tool bridge.",
    department: id.includes("sales") ? "sales" : "product",
    publisher: { id: "acme", name: "Acme", verified: false },
    visibility: "private",
    tags: ["growth"],
    latestVersion: version,
    searchTerms: ["growth"],
    versions: [{
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      appId: id,
      version,
      digest,
      publishedAt: "2026-08-16T00:00:00.000Z",
      compatibility: { loopgraph: "*", hermes: "*", platforms: ["darwin", "linux", "win32"] },
      dependencies: [],
      permissions: [{
        capability: "crm.lead.read",
        authority: "read",
        mode: "required",
        risk: "low",
        purpose: "Read a bounded business signal.",
        customerFacing: false,
        defaultPolicy: "allowed",
        dataClasses: []
      }],
      requiredCapabilities: ["crm.lead.read"],
      presets: [{
        id: "default",
        name: "Default",
        description: "Safe default configuration.",
        path: "presets/default.yaml"
      }],
      modules: [],
      maturity: "tested",
      deprecated: false,
      artifactUri: `hosted://marketplace/${id}/${version}`,
      source: {
        sourceId,
        sourceType: sourceId.startsWith("hosted") ? "hosted" : "filesystem",
        sourceUri: `hosted://catalog/${sourceId}`,
        sourceRef: version,
        snapshotDigest: digest,
        trustPolicy: sourceId.startsWith("hosted") ? "signed" : "explicit_local",
        synchronizedAt: "2026-08-16T00:00:00.000Z"
      },
      provenanceVerified: true
    }]
  });
}
