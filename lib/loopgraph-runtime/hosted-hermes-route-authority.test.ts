import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectorInstallationViewSchema,
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  validateLoopSpec
} from "loopgraph/core";

const mocks = vi.hoisted(() => ({
  getHostedOrganizationId: vi.fn(),
  listConnectorInstallations: vi.fn(),
  getLoopSpecRegistryStore: vi.fn(),
  getAppInstallationStore: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/hosted-config", () => ({
  getHostedOrganizationId: mocks.getHostedOrganizationId
}));
vi.mock("@/lib/connector-broker/admin", () => ({
  listConnectorInstallations: mocks.listConnectorInstallations
}));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({
  getLoopSpecRegistryStore: mocks.getLoopSpecRegistryStore,
  getAppInstallationStore: mocks.getAppInstallationStore
}));

import { createHostedHermesRouteActivationAuthorityProvider } from "./hosted-hermes-route-authority";

describe("hosted Hermes route authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.getHostedOrganizationId.mockReturnValue("123e4567-e89b-12d3-a456-426614174000");
    mocks.listConnectorInstallations.mockResolvedValue([hubspotInstallation()]);
  });

  it("compiles secret-free desired state from distributed LoopSpecs, Apps, and Broker connections", async () => {
    const loopStore = distributedLoopStore();
    const appStore = distributedAppStore();
    mocks.getLoopSpecRegistryStore.mockReturnValue(loopStore);
    mocks.getAppInstallationStore.mockReturnValue(appStore);
    const provider = createHostedHermesRouteActivationAuthorityProvider({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "main"
    });

    const authority = await provider({
      projectRoot: "/srv/loopgraph/tenant/main",
      now: new Date("2026-08-23T22:00:00.000Z")
    });

    expect(authority).toMatchObject({
      schemaVersion: "hermes-route-activation-authority/v1alpha1",
      projectRootHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      manifestDigest: expect.stringMatching(/^[a-f0-9]{16}$/),
      appConnectionBindingsByLoopId: {
        product_feedback: ["provider_hubspot_main"]
      },
      connections: [expect.objectContaining({
        id: "provider_hubspot_main",
        source: "hermes_connector_broker",
        status: "connected"
      })]
    });
    expect(authority.webhookPlan.routes).toContainEqual(expect.objectContaining({
      sourcePattern: "*",
      loopIds: ["product_feedback"]
    }));
    expect(JSON.stringify(authority)).not.toMatch(/credential|access_token|client_secret|Bearer /i);
    expect(loopStore.listActiveLoopSpecs).toHaveBeenCalledTimes(2);
    expect(appStore.read).toHaveBeenCalledTimes(2);
    expect(mocks.listConnectorInstallations).toHaveBeenCalledTimes(2);
  });

  it("fails closed if distributed authority changes during compilation", async () => {
    const loopStore = distributedLoopStore();
    const first = appRegistry(3);
    const changed = appRegistry(4);
    const appStore = {
      persistence: "distributed" as const,
      read: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(changed)
    };
    mocks.getLoopSpecRegistryStore.mockReturnValue(loopStore);
    mocks.getAppInstallationStore.mockReturnValue(appStore);
    const provider = createHostedHermesRouteActivationAuthorityProvider({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "main"
    });

    await expect(provider({
      projectRoot: "/srv/loopgraph/tenant/main",
      now: new Date("2026-08-23T22:00:00.000Z")
    })).rejects.toThrow(/changed while it was being compiled/i);
  });

  it("rejects replica-local stores and cross-project workspace selection", async () => {
    mocks.getLoopSpecRegistryStore.mockReturnValue({
      ...distributedLoopStore(),
      persistence: "file"
    });
    mocks.getAppInstallationStore.mockReturnValue(distributedAppStore());
    const localProvider = createHostedHermesRouteActivationAuthorityProvider({
      projectRoot: "/srv/loopgraph/tenant/main",
      workspaceId: "main"
    });
    await expect(localProvider({
      projectRoot: "/srv/loopgraph/tenant/main",
      now: new Date()
    })).rejects.toThrow(/requires distributed LoopSpec and App registries/i);

    const crossProjectProvider = createHostedHermesRouteActivationAuthorityProvider({
      projectRoot: "/srv/loopgraph/tenant/other",
      workspaceId: "other"
    });
    await expect(crossProjectProvider({
      projectRoot: "/srv/loopgraph/tenant/other",
      now: new Date()
    })).rejects.toThrow(/must match the server-bound project/i);
  });
});

function distributedLoopStore() {
  const artifact = loopArtifact();
  const snapshot = {
    workspace: {
      version: 1,
      schemaVersion: "workspace/v1alpha1",
      projectRoot: "/srv/loopgraph/tenant/main",
      projectRootId: "project_main",
      displayName: "Main",
      demoCatalogEnabled: false,
      registeredSpecs: [artifact.entry],
      initializedAt: "2026-08-23T21:00:00.000Z",
      updatedAt: "2026-08-23T21:00:00.000Z"
    },
    revision: 9
  };
  return {
    persistence: "distributed" as const,
    getWorkspace: vi.fn(async () => snapshot),
    listActiveLoopSpecs: vi.fn(async () => [artifact]),
    getActiveLoopSpec: vi.fn(async () => artifact),
    commitMaterializationAtomically: vi.fn()
  };
}

function distributedAppStore() {
  return {
    persistence: "distributed" as const,
    read: vi.fn(async () => appRegistry(3))
  };
}

function appRegistry(revision: number) {
  return {
    schemaVersion: "loopgraph-app-install/v1alpha1",
    workspaceId: "main",
    revision,
    installations: [{
      id: "install.product-feedback",
      ownedAssets: [{ kind: "loop_spec", assetId: "loop.product_feedback" }],
      connectionBindings: { "crm.lead.read": "provider_hubspot_main" },
      operationBindings: {}
    }],
    assets: [],
    evaluations: [],
    updatedAt: "2026-08-23T21:00:00.000Z"
  };
}

function loopArtifact() {
  const createdAt = "2026-08-23T21:00:00.000Z";
  const entry = {
    id: "product_feedback",
    name: "Product Feedback",
    path: "distributed:loop/product_feedback",
    department: "product",
    addedAt: createdAt
  };
  return {
    loopId: "product_feedback",
    versionHash: "loop_version_product_feedback",
    entry,
    fixtures: {},
    source: "import" as const,
    sourceRef: "app:io.loopgraph.product-feedback@1.0.0",
    createdAt,
    spec: validateLoopSpec({
      apiVersion: LOOPGRAPH_API_VERSION,
      kind: LOOP_KIND,
      metadata: {
        id: "product_feedback",
        name: "Product Feedback",
        version: "1.0.0",
        description: "Turn repeated customer evidence into a product problem."
      },
      trigger: { type: "event", source: "hermes", event: "business_event" },
      input: { schema: { type: "object" } },
      output: {
        schema: {
          type: "object",
          required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
          properties: {
            decisionSummary: { type: "string" },
            proposedActions: { type: "array" },
            evidence: { type: "array" },
            policyInputs: { type: "array" },
            verificationRequest: { type: "object" }
          }
        }
      },
      context: { sources: [], precedence: [] },
      routine: {
        steps: [{
          id: "observe",
          name: "Observe",
          stepType: "observe",
          actor: "system",
          description: "Observe trusted feedback evidence."
        }]
      },
      tools: [{
        key: "draft_review",
        adapterId: "manual",
        label: "Draft review",
        writeCapable: false,
        riskLevel: "low"
      }],
      policy: {
        allowedActions: [{
          toolKey: "draft_review",
          allowed: true,
          requiresApproval: false,
          riskLevel: "low"
        }],
        forbiddenActions: [],
        escalationRules: []
      },
      verification: [],
      approval: {
        requireFingerprintMatch: true,
        separateCustomerFacingApproval: true,
        allowedRoles: ["owner"]
      },
      persistence: { idempotency: { enabled: true } },
      trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
      topology: { department: "product" },
      routing: {
        schemaVersion: "routing-contract/v1alpha1",
        problemTypes: ["repeated_customer_feedback"],
        accepts: [{
          sourcePattern: "*",
          eventTypePattern: "feedback.received",
          subjectTypes: ["customer"],
          requiredFields: ["subject.id"]
        }],
        inputMapping: { subjectId: "subject.id" },
        minimumConfidence: 0.8,
        activationMode: "shadow",
        requiredConnections: ["crm.lead.read"]
      }
    })
  };
}

function hubspotInstallation() {
  return connectorInstallationViewSchema.parse({
    id: "provider_hubspot_main",
    tenant: {
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      projectKey: "main"
    },
    providerId: "hubspot",
    displayName: "Main HubSpot",
    environment: "production",
    status: "active",
    grantedScopes: [
      "crm.objects.companies.read",
      "crm.objects.contacts.read",
      "crm.objects.deals.read"
    ],
    allowedCapabilities: [
      "provider.health.read",
      "provider.data.read",
      "provider.webhooks.subscribe",
      "provider.webhooks.verify"
    ],
    webhookStatus: "active",
    connectedBy: "admin-main",
    connectedAt: "2026-08-23T20:00:00.000Z",
    lastHealthCheckAt: "2026-08-23T21:55:00.000Z",
    createdAt: "2026-08-23T20:00:00.000Z",
    updatedAt: "2026-08-23T21:55:00.000Z",
    customerManagedKeyConfigured: true
  });
}
