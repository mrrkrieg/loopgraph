import { afterEach, describe, expect, it, vi } from "vitest";

const authorizeBearerApiRequest = vi.hoisted(() => vi.fn());
const authorizeCliSessionRequest = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => ({ kind: "admin" }));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeBearerApiRequest
}));
vi.mock("@/lib/auth/cli-session-api", () => ({
  authorizeCliSessionRequest
}));
vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => adminClient
}));

import { requireHostedMarketplaceMachineContext } from "./hosted-marketplace-machine-api";

describe("hosted marketplace machine API context", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("requires the dedicated consume capability before exposing tenant context", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "123e4567-e89b-12d3-a456-426614174000");
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    authorizeCliSessionRequest.mockResolvedValue({ handled: false });
    authorizeBearerApiRequest.mockResolvedValue(null);
    const request = new Request("https://loopgraph.example/api/marketplace/client/catalog");

    await expect(requireHostedMarketplaceMachineContext(request)).resolves.toEqual({
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      projectKey: "main",
      adminClient
    });
    expect(authorizeBearerApiRequest).toHaveBeenCalledWith(request, {
      environmentVariable: "LOOPGRAPH_MARKETPLACE_API_TOKEN",
      credentialEnvironmentVariable: "LOOPGRAPH_MARKETPLACE_CREDENTIAL_ID",
      capability: "marketplace.consume",
      rateLimit: 120
    });
  });

  it("returns an authorization denial without resolving service context", async () => {
    authorizeCliSessionRequest.mockResolvedValue({ handled: false });
    const denied = new Response("denied", { status: 401 });
    authorizeBearerApiRequest.mockResolvedValue(denied);
    await expect(requireHostedMarketplaceMachineContext(new Request("https://loopgraph.example")))
      .resolves.toEqual({ response: denied });
  });

  it("accepts a capability-scoped human CLI session without invoking workload authorization", async () => {
    const request = new Request("https://loopgraph.example/api/marketplace/client/catalog");
    authorizeCliSessionRequest.mockResolvedValue({
      handled: true,
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      projectKey: "main",
      adminClient
    });
    await expect(requireHostedMarketplaceMachineContext(request)).resolves.toEqual({
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      projectKey: "main",
      adminClient
    });
    expect(authorizeBearerApiRequest).not.toHaveBeenCalled();
  });
});
