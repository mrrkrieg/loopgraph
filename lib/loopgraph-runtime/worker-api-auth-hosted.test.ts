import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeCronApiRequest,
  authorizeWorkerApiRequest
} from "./worker-api-auth";

describe("hosted machine request authorization", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
    vi.stubEnv(
      "LOOPGRAPH_HOSTED_ORGANIZATION_ID",
      "123e4567-e89b-12d3-a456-426614174000"
    );
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    vi.stubEnv("LOOPGRAPH_WORKER_API_TOKEN", "worker-secret");
    vi.stubEnv("LOOPGRAPH_WORKER_CREDENTIAL_ID", "worker_primary");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("LOOPGRAPH_CRON_CREDENTIAL_ID", "cron_primary");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires the configured credential identity after bearer verification", async () => {
    const response = await authorizeWorkerApiRequest(request());
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: "Invalid machine credential identity"
    });
  });

  it("rejects organization and project scope mismatches", async () => {
    const response = await authorizeWorkerApiRequest(request({
      "x-loopgraph-credential-id": "worker_primary",
      "x-loopgraph-organization-id": "223e4567-e89b-12d3-a456-426614174000"
    }));
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "Machine credential scope mismatch"
    });
  });

  it("requires a fresh durable replay identity", async () => {
    const response = await authorizeWorkerApiRequest(request({
      "x-loopgraph-credential-id": "worker_primary",
      "x-loopgraph-request-id": "request_12345678",
      "x-loopgraph-timestamp": "2020-01-01T00:00:00.000Z"
    }));
    expect(response?.status).toBe(400);
  });

  it("rejects oversized bodies before touching the durable guard", async () => {
    const response = await authorizeWorkerApiRequest(request({
      "content-length": String(1024 * 1024 + 1),
      "x-loopgraph-credential-id": "worker_primary",
      "x-loopgraph-request-id": "request_12345678",
      "x-loopgraph-timestamp": new Date().toISOString()
    }));
    expect(response?.status).toBe(413);
  });

  it("fails closed when durable authorization storage is unavailable", async () => {
    const response = await authorizeWorkerApiRequest(request({
      "x-loopgraph-credential-id": "worker_primary",
      "x-loopgraph-request-id": "request_12345678",
      "x-loopgraph-timestamp": new Date().toISOString()
    }));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "Supabase service authorization is not configured."
    });
  });

  it("derives replay metadata from Vercel's request identity for scheduled calls", async () => {
    const response = await authorizeCronApiRequest(new Request(
      "https://example.test/api/cron/controller",
      {
        headers: {
          authorization: "Bearer cron-secret",
          "x-vercel-id": "sfo1::abcde-1785420000000-123456789"
        }
      }
    ));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "Supabase service authorization is not configured."
    });
  });
});

function request(extraHeaders: Record<string, string> = {}) {
  return new Request("https://example.test/api/routing/worker", {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      ...extraHeaders
    },
    body: "{}"
  });
}
