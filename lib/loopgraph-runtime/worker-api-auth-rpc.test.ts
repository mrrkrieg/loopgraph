import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ rpc })
}));

import { authorizeVerifiedHostedMachineRequest } from "./worker-api-auth";

describe("durable hosted machine request decisions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
    vi.stubEnv(
      "LOOPGRAPH_HOSTED_ORGANIZATION_ID",
      "123e4567-e89b-12d3-a456-426614174000"
    );
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    vi.stubEnv("LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID", "hermes_callback");
    rpc.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("records verified signed requests under their narrow capability", async () => {
    rpc.mockResolvedValue({
      data: [{ authorized: true, reason: "accepted", retry_after_seconds: null }],
      error: null
    });

    const response = await authorizeVerifiedHostedMachineRequest(verifiedRequest());

    expect(response).toBeNull();
    expect(rpc).toHaveBeenCalledWith("authorize_machine_request", expect.objectContaining({
      p_organization_id: "123e4567-e89b-12d3-a456-426614174000",
      p_project_key: "main",
      p_credential_id: "hermes_callback",
      p_capability: "hermes.design_callback",
      p_request_id: "hermes_1234567890abcdef1234567890abcdef",
      p_rate_limit: 60
    }));
  });

  it("turns a durable replay decision into a conflict", async () => {
    rpc.mockResolvedValue({
      data: [{ authorized: false, reason: "replayed_request", retry_after_seconds: null }],
      error: null
    });

    const response = await authorizeVerifiedHostedMachineRequest(verifiedRequest());

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({ error: "replayed_request" });
  });

  it("returns the durable retry window when rate limited", async () => {
    rpc.mockResolvedValue({
      data: [{ authorized: false, reason: "rate_limited", retry_after_seconds: 17 }],
      error: null
    });

    const response = await authorizeVerifiedHostedMachineRequest(verifiedRequest());

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("17");
  });
});

function verifiedRequest() {
  return {
    capability: "hermes.design_callback" as const,
    credentialEnvironmentVariable: "LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID",
    requestId: "hermes_1234567890abcdef1234567890abcdef",
    requestHash: "a".repeat(64),
    requestedAt: new Date().toISOString(),
    rateLimit: 60
  };
}
