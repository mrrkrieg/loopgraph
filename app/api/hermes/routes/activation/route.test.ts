import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authorizeBearerApiRequest = vi.hoisted(() => vi.fn(async () => null));
const getActiveLoopgraphProjectRoot = vi.hoisted(() => vi.fn(() => "/srv/loopgraph/acme/main"));
const routeActivationStore = vi.hoisted(() => ({
  persistence: "distributed" as const,
  reference: "supabase:hermes-route-activation",
  read: vi.fn(),
  write: vi.fn()
}));
const getHermesRouteActivationStore = vi.hoisted(() => vi.fn(() => routeActivationStore));
const authorityProvider = vi.hoisted(() => vi.fn());
const createHostedHermesRouteActivationAuthorityProvider = vi.hoisted(() =>
  vi.fn(() => authorityProvider)
);
const prepareHermesRouteActivation = vi.hoisted(() => vi.fn(async () => ({
  schemaVersion: "hermes-route-activation-plan/v1alpha1",
  planDigest: "1234567890abcdef",
  routes: []
})));
const activateHermesRoutes = vi.hoisted(() => vi.fn(async () => ({ ready: true })));
const getHermesRouteActivationStatus = vi.hoisted(() => vi.fn(async () => ({
  projectRoot: "/srv/loopgraph/acme/main",
  recordPath: "supabase:hermes-route-activation",
  checkedAt: "2026-08-23T21:00:00.000Z",
  exists: true,
  current: true,
  ready: true,
  planDigest: "1234567890abcdef",
  currentPlanDigest: "1234567890abcdef",
  routeStates: [{
    routeId: "route-product-events",
    routeName: "product-events",
    routeKind: "provider_event",
    loopIds: ["product-feedback"],
    state: "shadow",
    subscriptionState: "active",
    signatureVerificationConfigured: true,
    ready: true
  }],
  warnings: [],
  nextActions: ["Monitor the shadow route."]
})));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeBearerApiRequest }));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot,
  getHermesRouteActivationStore
}));
vi.mock("@/lib/loopgraph-runtime/hosted-hermes-route-authority", () => ({
  createHostedHermesRouteActivationAuthorityProvider
}));
vi.mock("loopgraph/runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("loopgraph/runtime")>(),
  activateHermesRoutes,
  getHermesRouteActivationStatus,
  prepareHermesRouteActivation
}));

import { GET, POST } from "./route";

describe("hosted Hermes route activation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    vi.stubEnv("LOOPGRAPH_HERMES_ROUTE_CONTROLLER_URL", "https://hermes.example.test/v1/routes/reconcile");
    vi.stubEnv("LOOPGRAPH_HERMES_ROUTE_CONTROLLER_AUDIENCE", "hermes-route-controller");
    vi.stubEnv("LOOPGRAPH_HERMES_ROUTE_CONTROLLER_TOKEN_FILE", "/run/secrets/loopgraph/hermes-controller.jwt");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns the current server-derived plan behind the narrow workload capability", async () => {
    const response = await GET(request(undefined, "?view=plan"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeBearerApiRequest).toHaveBeenCalledWith(expect.any(Request), {
      environmentVariable: "LOOPGRAPH_HERMES_ROUTE_ACTIVATION_API_TOKEN",
      credentialEnvironmentVariable: "LOOPGRAPH_HERMES_ROUTE_ACTIVATION_CREDENTIAL_ID",
      capability: "hermes.route_activation",
      rateLimit: 10
    });
    expect(prepareHermesRouteActivation).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: "/srv/loopgraph/acme/main",
      authorityProvider
    }));
    await expect(response.json()).resolves.toEqual({
      plan: expect.objectContaining({ planDigest: "1234567890abcdef" })
    });
  });

  it("applies only an exact digest using the server-derived controller, identity, scope, and store", async () => {
    const response = await POST(request({
      schemaVersion: "hosted-hermes-route-activation-request/v1alpha1",
      confirmationDigest: "1234567890abcdef"
    }));

    expect(response.status).toBe(200);
    expect(getHermesRouteActivationStore).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/acme/main",
      workspaceId: "main"
    });
    expect(createHostedHermesRouteActivationAuthorityProvider).toHaveBeenCalledWith({
      projectRoot: "/srv/loopgraph/acme/main",
      workspaceId: "main"
    });
    expect(activateHermesRoutes).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: "/srv/loopgraph/acme/main",
      recordStore: routeActivationStore,
      authorityProvider,
      confirmationDigest: "1234567890abcdef",
      controllerUrl: "https://hermes.example.test/v1/routes/reconcile",
      audience: "hermes-route-controller",
      tokenProvider: expect.objectContaining({})
    }));
    const body = await response.json();
    expect(body.status).toMatchObject({
      schemaVersion: "hosted-hermes-route-activation-status/v1alpha1",
      current: true,
      ready: true,
      routeStates: [expect.objectContaining({ routeId: "route-product-events" })]
    });
    expect(body.status).not.toHaveProperty("projectRoot");
    expect(body.status).not.toHaveProperty("recordPath");
  });

  it("rejects caller-selected controller, identity, tenant, paths, or receipts", async () => {
    const response = await POST(request({
      schemaVersion: "hosted-hermes-route-activation-request/v1alpha1",
      confirmationDigest: "1234567890abcdef",
      controllerUrl: "https://attacker.invalid",
      audience: "other",
      token: "not-allowed",
      organizationId: "other",
      workspaceId: "other",
      projectRoot: "/other",
      receipt: { ready: true }
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Hermes route activation accepts only the versioned current-plan confirmation digest"
    });
    expect(activateHermesRoutes).not.toHaveBeenCalled();
    expect(getHermesRouteActivationStore).not.toHaveBeenCalled();
    expect(createHostedHermesRouteActivationAuthorityProvider).not.toHaveBeenCalled();
  });

  it("fails closed when the deployment did not bind a controller target and audience", async () => {
    vi.stubEnv("LOOPGRAPH_HERMES_ROUTE_CONTROLLER_URL", "");
    vi.stubEnv("LOOPGRAPH_HERMES_ROUTE_CONTROLLER_AUDIENCE", "");
    const response = await POST(request({
      schemaVersion: "hosted-hermes-route-activation-request/v1alpha1",
      confirmationDigest: "1234567890abcdef"
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted Hermes route activation requires a configured controller URL and audience"
    });
    expect(activateHermesRoutes).not.toHaveBeenCalled();
  });

  it("does not resolve plan or storage before workload authorization", async () => {
    authorizeBearerApiRequest.mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 }) as never);
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(getActiveLoopgraphProjectRoot).not.toHaveBeenCalled();
    expect(getHermesRouteActivationStore).not.toHaveBeenCalled();
    expect(createHostedHermesRouteActivationAuthorityProvider).not.toHaveBeenCalled();
    expect(prepareHermesRouteActivation).not.toHaveBeenCalled();
  });
});

function request(body?: Record<string, unknown>, suffix = "") {
  return new Request(`https://loopgraph.example/api/hermes/routes/activation${suffix}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}
