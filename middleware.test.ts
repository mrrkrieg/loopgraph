import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn()
}));

const mockedCreateServerClient = vi.mocked(createServerClient);

describe("hosted middleware request guards", () => {
  beforeEach(() => {
    vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://database.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "00000000-0000-0000-0000-000000000001");
    mockedCreateServerClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves scoped Hermes machine endpoints to their route-level verifier", async () => {
    const response = await middleware(new NextRequest(
      "https://app.example/api/hermes/executions/events",
      { method: "POST" }
    ));
    expect(response.status).toBe(200);
    expect(mockedCreateServerClient).not.toHaveBeenCalled();
  });

  it("adds the durable quota decision to an allowed browser API response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        allowed: true,
        reason: "accepted",
        retry_after_seconds: null,
        remaining: 299,
        quota_limit: 300,
        reset_at: "2026-08-17T12:01:00.000Z"
      }],
      error: null
    });
    mockedCreateServerClient.mockReturnValue(hostedClient(rpc) as never);

    const response = await middleware(new NextRequest(
      "https://app.example/api/opportunities",
      { method: "GET" }
    ));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("consume_user_api_quota", {
      p_organization_id: "00000000-0000-0000-0000-000000000001",
      p_bucket: "read"
    });
    expect(response.headers.get("x-ratelimit-limit")).toBe("300");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("299");
  });

  it("returns a bounded 429 response when the database quota is saturated", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        allowed: false,
        reason: "rate_limited",
        retry_after_seconds: 17,
        remaining: 0,
        quota_limit: 30,
        reset_at: "2026-08-17T12:01:00.000Z"
      }],
      error: null
    });
    mockedCreateServerClient.mockReturnValue(hostedClient(rpc, "operator") as never);

    const response = await middleware(new NextRequest(
      "https://app.example/api/opportunities",
      {
        method: "POST",
        headers: { origin: "https://app.example" }
      }
    ));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    await expect(response.json()).resolves.toMatchObject({ code: "rate_limited" });
  });

  it("fails closed without leaking database errors when the quota RPC is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "relation user_api_quota_windows does not exist" }
    });
    mockedCreateServerClient.mockReturnValue(hostedClient(rpc) as never);

    const response = await middleware(new NextRequest(
      "https://app.example/api/opportunities",
      { method: "GET" }
    ));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("user_api_quota_windows");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

function hostedClient(rpc: ReturnType<typeof vi.fn>, role = "viewer") {
  const secondEq = vi.fn().mockResolvedValue({
    data: [{
      organization_id: "00000000-0000-0000-0000-000000000001",
      role
    }],
    error: null
  });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { sub: "00000000-0000-0000-0000-000000000002" } },
        error: null
      })
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: firstEq })
    }),
    rpc
  };
}
