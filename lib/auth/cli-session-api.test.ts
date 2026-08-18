import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const emitOperationalLog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ rpc })
}));
vi.mock("@/lib/observability/operational-log", () => ({ emitOperationalLog }));

import { authorizeCliSessionRequest } from "./cli-session-api";

const accessToken = `lgcli_access_${"a".repeat(43)}`;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("human CLI session request guard", () => {
  it("leaves non-CLI bearer tokens to workload identity", async () => {
    const result = await authorizeCliSessionRequest(new Request("https://loopgraph.example/api/marketplace/client/catalog", {
      headers: { authorization: `Bearer ${"w".repeat(64)}` }
    }), "marketplace.consume", 120);
    expect(result).toEqual({ handled: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("authorizes an exact scoped session through the durable request guard without forwarding the raw token", async () => {
    hostedEnvironment();
    rpc.mockResolvedValue({
      data: [{ authorized: true, reason: "accepted", credential_id: "cli_123" }],
      error: null
    });
    const timestamp = new Date().toISOString();
    const request = new Request("https://loopgraph.example/api/marketplace/client/catalog?q=risk", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-loopgraph-request-id": "marketplace_request_123",
        "x-loopgraph-timestamp": timestamp,
        "x-loopgraph-organization-id": "123e4567-e89b-12d3-a456-426614174000",
        "x-loopgraph-project-key": "main"
      }
    });
    const result = await authorizeCliSessionRequest(request, "marketplace.consume", 120);
    expect(result).toMatchObject({
      handled: true,
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      projectKey: "main"
    });
    expect(rpc).toHaveBeenCalledWith("authorize_cli_session_request", expect.objectContaining({
      p_access_token_hash: createHash("sha256").update(accessToken).digest("hex"),
      p_capability: "marketplace.consume",
      p_request_id: "marketplace_request_123",
      p_rate_limit: 120
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(accessToken);
  });

  it("fails before storage on tenant mismatch and maps replay and rate decisions", async () => {
    hostedEnvironment();
    const mismatched = await authorizeCliSessionRequest(cliRequest({
      "x-loopgraph-organization-id": "223e4567-e89b-12d3-a456-426614174000"
    }), "marketplace.consume", 120);
    expect(mismatched).toMatchObject({ handled: true, response: expect.objectContaining({ status: 403 }) });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValueOnce({ data: [{ authorized: false, reason: "replayed_request" }], error: null });
    const replay = await authorizeCliSessionRequest(cliRequest(), "marketplace.consume", 120);
    expect(replay).toMatchObject({ response: expect.objectContaining({ status: 409 }) });

    rpc.mockResolvedValueOnce({ data: [{ authorized: false, reason: "rate_limited", retry_after_seconds: 17 }], error: null });
    const limited = await authorizeCliSessionRequest(cliRequest({ "x-loopgraph-request-id": "marketplace_request_456" }), "marketplace.consume", 120);
    expect(limited).toMatchObject({ response: expect.objectContaining({ status: 429 }) });
    if ("response" in limited) expect(limited.response.headers.get("retry-after")).toBe("17");
  });
});

function hostedEnvironment() {
  vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "123e4567-e89b-12d3-a456-426614174000");
  vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
}

function cliRequest(headers: Record<string, string> = {}) {
  return new Request("https://loopgraph.example/api/marketplace/client/catalog", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-loopgraph-request-id": "marketplace_request_123",
      "x-loopgraph-timestamp": new Date().toISOString(),
      ...headers
    }
  });
}
