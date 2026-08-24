import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketplaceAppSchema, type MarketplaceApp } from "loopgraph/core";

const mocks = vi.hoisted(() => ({
  runtimeTool: vi.fn(),
  ensureArtifact: vi.fn(),
  hasCachedArtifact: vi.fn(),
  requireContext: vi.fn(),
  hostedSearch: vi.fn(),
  getDatabase: vi.fn(),
  listInstallations: vi.fn(),
  getRouteActivationStatus: vi.fn(),
  routeAuthorityProvider: vi.fn(),
  webhookDoctorProvider: vi.fn(),
  createRouteAuthorityProvider: vi.fn(),
  createWebhookDoctorProvider: vi.fn(),
  externalBroker: { execute: vi.fn(), prepareAction: vi.fn() },
  getExternalBroker: vi.fn(),
  activeProjectRoot: vi.fn(),
  outcomeStore: { persistence: "distributed" },
  hermesOperationsStore: {},
  routingStore: {},
  appInstallationStore: { persistence: "distributed" },
  appSnapshotStore: { persistence: "distributed" },
  appOperationActionStore: { persistence: "distributed" },
  appVerificationStore: { persistence: "distributed" },
  companyContextStore: { persistence: "distributed" },
  loopSpecStore: { persistence: "distributed" },
  connectorFieldMappingStore: { persistence: "distributed" },
  providerSchemaSnapshotStore: { persistence: "distributed" },
  routeActivationStore: { persistence: "distributed" },
  getOutcomeStore: vi.fn(),
  getHermesOperationsStore: vi.fn(),
  getRoutingStore: vi.fn(),
  getAppInstallationStore: vi.fn(),
  getAppSnapshotStore: vi.fn(),
  getAppOperationActionStore: vi.fn(),
  getCompanyContextStore: vi.fn(),
  getLoopSpecRegistryStore: vi.fn(),
  getConnectorFieldMappingStore: vi.fn(),
  getProviderSchemaSnapshotStore: vi.fn(),
  getAppVerificationStore: vi.fn(),
  getHermesRouteActivationStore: vi.fn()
}));

vi.mock("loopgraph/runtime", () => ({
  callLoopgraphAppTool: mocks.runtimeTool,
  connectionInstanceFromBrokerInstallation: vi.fn((installation) => installation),
  getHermesRouteActivationStatus: mocks.getRouteActivationStatus
}));
vi.mock("@/lib/auth/hosted-config", () => ({
  isHostedAuthRequired: vi.fn(() => true),
  getHostedOrganizationId: vi.fn(() => "123e4567-e89b-12d3-a456-426614174000")
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
  listConnectorInstallations: mocks.listInstallations,
  getExternalConnectorBrokerClient: mocks.getExternalBroker
}));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot: mocks.activeProjectRoot,
  getOutcomeStore: mocks.getOutcomeStore,
  getHermesOperationsStore: mocks.getHermesOperationsStore,
  getRoutingStore: mocks.getRoutingStore,
  getAppInstallationStore: mocks.getAppInstallationStore,
  getAppSnapshotStore: mocks.getAppSnapshotStore,
  getAppOperationActionStore: mocks.getAppOperationActionStore,
  getCompanyContextStore: mocks.getCompanyContextStore,
  getLoopSpecRegistryStore: mocks.getLoopSpecRegistryStore,
  getConnectorFieldMappingStore: mocks.getConnectorFieldMappingStore,
  getProviderSchemaSnapshotStore: mocks.getProviderSchemaSnapshotStore,
  getAppVerificationStore: mocks.getAppVerificationStore,
  getHermesRouteActivationStore: mocks.getHermesRouteActivationStore
}));
vi.mock("@/lib/loopgraph-runtime/hosted-hermes-route-authority", () => ({
  createHostedHermesRouteActivationAuthorityProvider: mocks.createRouteAuthorityProvider,
  createHostedHermesWebhookDoctorProvider: mocks.createWebhookDoctorProvider
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
  mocks.getExternalBroker.mockReturnValue(mocks.externalBroker);
  mocks.hasCachedArtifact.mockResolvedValue(false);
  mocks.activeProjectRoot.mockReturnValue("/srv/loopgraph/tenant/main");
  mocks.getOutcomeStore.mockReturnValue(mocks.outcomeStore);
  mocks.getHermesOperationsStore.mockReturnValue(mocks.hermesOperationsStore);
  mocks.getRoutingStore.mockReturnValue(mocks.routingStore);
  mocks.getAppInstallationStore.mockReturnValue(mocks.appInstallationStore);
  mocks.getAppSnapshotStore.mockReturnValue(mocks.appSnapshotStore);
  mocks.getAppOperationActionStore.mockReturnValue(mocks.appOperationActionStore);
  mocks.getCompanyContextStore.mockReturnValue(mocks.companyContextStore);
  mocks.getLoopSpecRegistryStore.mockReturnValue(mocks.loopSpecStore);
  mocks.getConnectorFieldMappingStore.mockReturnValue(mocks.connectorFieldMappingStore);
  mocks.getProviderSchemaSnapshotStore.mockReturnValue(mocks.providerSchemaSnapshotStore);
  mocks.getAppVerificationStore.mockReturnValue(mocks.appVerificationStore);
  mocks.getHermesRouteActivationStore.mockReturnValue(mocks.routeActivationStore);
  mocks.createRouteAuthorityProvider.mockReturnValue(mocks.routeAuthorityProvider);
  mocks.createWebhookDoctorProvider.mockReturnValue(mocks.webhookDoctorProvider);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hosted app tool bridge", () => {
  it("binds App state to the server project instead of a client-selected workspace", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.runtimeTool.mockImplementation(async (_name, input) => {
      expect(input).toMatchObject({ workspaceId: "main", companyId: "main" });
      return { installations: [] };
    });
    await callLoopgraphAppTool("loopgraph_app_install_status", {
      workspaceId: "other-tenant",
      companyId: "other-company"
    });
  });

  it("injects distributed operating evidence and workspace verification trust into maturity reads", async () => {
    mocks.runtimeTool.mockImplementation(async (_name, _input, options) => {
      expect(options).toMatchObject({
        outcomeStore: mocks.outcomeStore,
        hermesOperationsStore: mocks.hermesOperationsStore,
        loopSpecStore: mocks.loopSpecStore,
        routeActivationStatusProvider: expect.any(Function),
        webhookDoctorProvider: mocks.webhookDoctorProvider
      });
      await options.routeActivationStatusProvider({ now: new Date("2026-08-23T22:00:00.000Z") });
      expect(options.appVerificationStoreFactory("acme")).toBe(mocks.appVerificationStore);
      expect(options.appInstallationStoreFactory("acme")).toBe(mocks.appInstallationStore);
      expect(options.appSnapshotStoreFactory("acme")).toBe(mocks.appSnapshotStore);
      expect(options.companyContextStoreFactory("acme", "acme-company")).toBe(mocks.companyContextStore);
      expect(options.connectorFieldMappingStoreFactory("acme")).toBe(mocks.connectorFieldMappingStore);
      expect(options.providerSchemaSnapshotStoreFactory("acme")).toBe(mocks.providerSchemaSnapshotStore);
      return { maturity: "concept" };
    });
    await callLoopgraphAppTool("loopgraph_app_maturity_get", {
      projectRoot: "/tmp/untrusted",
      installationId: "install.app"
    });
    expect(mocks.getOutcomeStore).toHaveBeenCalledWith({ projectRoot: "/srv/loopgraph/tenant/main" });
    expect(mocks.getAppVerificationStore).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "acme"
    });
    expect(mocks.getAppInstallationStore).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "acme"
    });
    expect(mocks.getAppSnapshotStore).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "acme"
    });
    expect(mocks.getCompanyContextStore).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "acme",
      companyId: "acme-company"
    });
  });

  it("uses the same distributed tenant evidence for fleet renewal planning", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.runtimeTool.mockImplementation(async (name, input, options) => {
      expect(name).toBe("loopgraph_apps_renewal_plan");
      expect(input).toMatchObject({ workspaceId: "main", companyId: "main" });
      expect(options).toMatchObject({
        outcomeStore: mocks.outcomeStore,
        hermesOperationsStore: mocks.hermesOperationsStore,
        loopSpecStore: mocks.loopSpecStore
      });
      expect(options.appVerificationStoreFactory("main")).toBe(mocks.appVerificationStore);
      return { totalInstallations: 0, totalMatched: 0, items: [] };
    });
    await callLoopgraphAppTool("loopgraph_apps_renewal_plan", {
      workspaceId: "other-tenant",
      companyId: "other-company"
    });
    expect(mocks.getOutcomeStore).toHaveBeenCalledWith({ projectRoot: "/srv/loopgraph/tenant/main" });
    expect(mocks.getAppVerificationStore).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "main"
    });
  });

  it("injects distributed outcome and Hermes execution evidence into every activation boundary", async () => {
    mocks.runtimeTool.mockImplementation(async (name, _input, options) => {
      expect([
        "loopgraph_app_activation_gate_get",
        "loopgraph_app_activation_approve",
        "loopgraph_app_activate"
      ]).toContain(name);
      expect(options).toMatchObject({
        outcomeStore: mocks.outcomeStore,
        hermesOperationsStore: mocks.hermesOperationsStore,
        loopSpecStore: mocks.loopSpecStore,
        routeActivationStatusProvider: expect.any(Function),
        webhookDoctorProvider: mocks.webhookDoctorProvider
      });
      await options.routeActivationStatusProvider({ now: new Date("2026-08-23T22:00:00.000Z") });
      return { ok: true };
    });
    for (const name of [
      "loopgraph_app_activation_gate_get",
      "loopgraph_app_activation_approve",
      "loopgraph_app_activate"
    ] as const) {
      await callLoopgraphAppTool(name, {
        installationId: "install.app",
        mode: "shadow",
        ...(name === "loopgraph_app_activation_approve" ? {
          approvedBy: "security-approver",
          reason: "Review the evidence-bound gate."
        } : {}),
        ...(name === "loopgraph_app_activate" ? {
          actor: "operations-activator",
          approvalReceiptId: "activation-approval.1111111111111111"
        } : {})
      });
    }
    expect(mocks.getOutcomeStore).toHaveBeenCalledTimes(3);
    expect(mocks.getHermesOperationsStore).toHaveBeenCalledTimes(3);
    expect(mocks.getRouteActivationStatus).toHaveBeenCalledTimes(3);
    expect(mocks.getRouteActivationStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      projectRoot: "/srv/loopgraph/tenant/main",
      recordStore: mocks.routeActivationStore,
      authorityProvider: expect.any(Function)
    }));
    const snapshotProvider = mocks.getRouteActivationStatus.mock.calls.at(-1)?.[0].authorityProvider;
    expect(mocks.createWebhookDoctorProvider).toHaveBeenCalledWith(snapshotProvider);
  });

  it("binds headless Hermes App execution to the verified machine tenant without a browser session", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.runtimeTool.mockImplementation(async (name, input, options) => {
      expect(name).toBe("loopgraph_app_operation_invoke");
      expect(input).toMatchObject({ workspaceId: "main", companyId: "main" });
      expect(options).toMatchObject({
        connectorBroker: mocks.externalBroker,
        connectorTenant: {
          organizationId: "123e4567-e89b-12d3-a456-426614174000",
          projectKey: "main"
        },
        routingStore: mocks.routingStore,
        hermesOperationsStore: mocks.hermesOperationsStore,
        appOperationActionStore: mocks.appOperationActionStore,
        outcomeStore: mocks.outcomeStore,
        connections: []
      });
      return { disposition: "invoke_read" };
    });

    await callLoopgraphAppTool("loopgraph_app_operation_invoke", {
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-read-lead-1",
      input: { leadId: "lead-42" }
    });

    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.listInstallations).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      hosted: true
    }));
  });

  it("serves prepared App action ownership through the same distributed store", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.runtimeTool.mockImplementation(async (name, input, options) => {
      expect(name).toBe("loopgraph_app_operation_actions_get");
      expect(input).toMatchObject({ workspaceId: "main", companyId: "main", installationId: "installed-sales" });
      expect(options.appOperationActionStore).toBe(mocks.appOperationActionStore);
      return { actions: [] };
    });

    await callLoopgraphAppTool("loopgraph_app_operation_actions_get", {
      installationId: "installed-sales"
    });
    expect(mocks.getAppOperationActionStore).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "main"
    });
  });

  it("binds App action commits to the same trusted machine tenant and distributed ledgers", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.runtimeTool.mockImplementation(async (name, input, options) => {
      expect(name).toBe("loopgraph_app_operation_action_commit");
      expect(input).toMatchObject({
        workspaceId: "main",
        companyId: "main",
        installationId: "installed-sales-app",
        actionId: "appact_12345678"
      });
      expect(options).toMatchObject({
        connectorBroker: mocks.externalBroker,
        connectorTenant: { organizationId: "123e4567-e89b-12d3-a456-426614174000", projectKey: "main" },
        routingStore: mocks.routingStore,
        hermesOperationsStore: mocks.hermesOperationsStore,
        appOperationActionStore: mocks.appOperationActionStore,
        outcomeStore: mocks.outcomeStore,
        connections: []
      });
      return { status: "succeeded" };
    });

    await callLoopgraphAppTool("loopgraph_app_operation_action_commit", {
      installationId: "installed-sales-app",
      actionId: "appact_12345678",
      routeJobId: "job-sales-write",
      agentInstanceId: "hermes-sales",
      callId: "commit-1"
    });
  });

  it("reconciles interrupted App commits through the same trusted Broker and distributed ledgers", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.runtimeTool.mockImplementation(async (name, input, options) => {
      expect(name).toBe("loopgraph_app_operation_action_reconcile");
      expect(input).toMatchObject({
        workspaceId: "main",
        companyId: "main",
        installationId: "installed-sales-app",
        actionId: "appact_12345678"
      });
      expect(options).toMatchObject({
        connectorBroker: mocks.externalBroker,
        connectorTenant: { organizationId: "123e4567-e89b-12d3-a456-426614174000", projectKey: "main" },
        routingStore: mocks.routingStore,
        hermesOperationsStore: mocks.hermesOperationsStore,
        appOperationActionStore: mocks.appOperationActionStore,
        outcomeStore: mocks.outcomeStore
      });
      return { status: "resolved_succeeded" };
    });

    await callLoopgraphAppTool("loopgraph_app_operation_action_reconcile", {
      installationId: "installed-sales-app",
      actionId: "appact_12345678",
      routeJobId: "job-sales-write",
      agentInstanceId: "hermes-sales",
      callId: "reconcile-1"
    });
  });

  it("allows internal Loopgraph reads without requiring an external provider Broker", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.getExternalBroker.mockReturnValue(undefined);
    mocks.runtimeTool.mockImplementation(async (_name, _input, options) => {
      expect(options.connectorBroker).toBeUndefined();
      expect(options.connectorTenant).toEqual({
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        projectKey: "main"
      });
      return { disposition: "invoke_loopgraph_runtime" };
    });

    await callLoopgraphAppTool("loopgraph_app_operation_invoke", {
      installationId: "installed-management-app",
      loopId: "management-review",
      capability: "loopgraph.topology.read",
      routeJobId: "job-management-read",
      agentInstanceId: "hermes-management",
      callId: "task-read-topology-1",
      input: { limit: 20 }
    });
  });

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
