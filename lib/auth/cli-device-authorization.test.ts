import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ rpc })
}));

import {
  createCliDeviceAuthorization,
  decideCliDeviceAuthorization,
  exchangeCliDeviceAuthorization,
  normalizeUserCode
} from "./cli-device-authorization";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("hosted CLI device authorization service", () => {
  it("stores only digests while returning one-time device material", async () => {
    hostedEnvironment();
    rpc.mockResolvedValue({
      data: [{
        authorization_id: "123e4567-e89b-12d3-a456-426614174001",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        interval_seconds: 5
      }],
      error: null
    });
    const result = await createCliDeviceAuthorization(new Request("https://loopgraph.example/api/auth/device/code", {
      headers: { "x-forwarded-for": "203.0.113.4", "user-agent": "loopgraph-test" }
    }));
    expect(result.device_code).toMatch(/^lgdc_/);
    expect(result.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const params = rpc.mock.calls[0]?.[1];
    expect(params).toMatchObject({
      p_device_code_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_user_code_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_request_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_capabilities: ["marketplace.consume"]
    });
    expect(JSON.stringify(params)).not.toContain(result.device_code);
    expect(JSON.stringify(params)).not.toContain(result.user_code);
  });

  it("trusts forwarding addresses only behind an explicit platform or proxy boundary", async () => {
    hostedEnvironment();
    vi.stubEnv("VERCEL", "");
    rpc.mockResolvedValue({
      data: [{
        authorization_id: "123e4567-e89b-12d3-a456-426614174001",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        interval_seconds: 5
      }],
      error: null
    });
    const request = (address: string) => new Request("https://loopgraph.example/api/auth/device/code", {
      headers: { "x-forwarded-for": address, "user-agent": "loopgraph-test" }
    });
    await createCliDeviceAuthorization(request("203.0.113.4"));
    await createCliDeviceAuthorization(request("198.51.100.8"));
    expect(rpc.mock.calls[0]?.[1].p_request_fingerprint_hash)
      .toBe(rpc.mock.calls[1]?.[1].p_request_fingerprint_hash);

    vi.stubEnv("LOOPGRAPH_TRUSTED_PROXY_HEADERS", "true");
    await createCliDeviceAuthorization(request("203.0.113.4"));
    await createCliDeviceAuthorization(request("198.51.100.8"));
    expect(rpc.mock.calls[2]?.[1].p_request_fingerprint_hash)
      .not.toBe(rpc.mock.calls[3]?.[1].p_request_fingerprint_hash);
  });

  it("exchanges approval for short-lived credentials without persisting raw values through the RPC", async () => {
    hostedEnvironment();
    rpc.mockResolvedValue({
      data: [{
        authorized: true,
        reason: "authorized",
        organization_id: "123e4567-e89b-12d3-a456-426614174000",
        project_key: "main",
        capabilities: ["marketplace.consume"],
        access_expires_at: new Date(Date.now() + 900_000).toISOString(),
        refresh_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        interval_seconds: 5
      }],
      error: null
    });
    const response = await exchangeCliDeviceAuthorization(`lgdc_${"d".repeat(43)}`);
    expect(response.access_token).toMatch(/^lgcli_access_/);
    expect(response.refresh_token).toMatch(/^lgcli_refresh_/);
    const params = rpc.mock.calls[0]?.[1];
    expect(params.p_access_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(params.p_refresh_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(params)).not.toContain(response.access_token);
    expect(JSON.stringify(params)).not.toContain(response.refresh_token);
  });

  it("normalizes the browser code and binds approval to the authenticated organization member", async () => {
    hostedEnvironment();
    rpc.mockResolvedValue({ data: [{ decided: true, reason: "approved" }], error: null });
    expect(normalizeUserCode("abcd efgh")).toBe("ABCD-EFGH");
    await expect(decideCliDeviceAuthorization({
      userCode: "abcd-efgh",
      userId: "123e4567-e89b-12d3-a456-426614174002",
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      approve: true
    })).resolves.toEqual({ decision: "approved" });
    expect(rpc).toHaveBeenCalledWith("decide_cli_device_authorization", expect.objectContaining({
      p_user_code_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_organization_id: "123e4567-e89b-12d3-a456-426614174000",
      p_user_id: "123e4567-e89b-12d3-a456-426614174002",
      p_approve: true
    }));
  });
});

function hostedEnvironment() {
  vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "123e4567-e89b-12d3-a456-426614174000");
  vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
  vi.stubEnv("LOOPGRAPH_PUBLIC_URL", "https://loopgraph.example");
  vi.stubEnv("LOOPGRAPH_DEVICE_AUTH_FINGERPRINT_SECRET", "s".repeat(32));
}
