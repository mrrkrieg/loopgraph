import { afterEach, describe, expect, it } from "vitest";
import { authorizeWorkerApiRequest } from "./worker-api-auth";

const originalToken = process.env.LOOPGRAPH_WORKER_API_TOKEN;

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.LOOPGRAPH_WORKER_API_TOKEN;
  } else {
    process.env.LOOPGRAPH_WORKER_API_TOKEN = originalToken;
  }
});

describe("route-job HTTP API authorization", () => {
  it("fails closed without a configured token even for a localhost URL", async () => {
    delete process.env.LOOPGRAPH_WORKER_API_TOKEN;

    const response = authorizeWorkerApiRequest(new Request("http://localhost/api/routing/worker", {
      method: "POST"
    }));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "LOOPGRAPH_WORKER_API_TOKEN must be configured before the route-job HTTP API can be used."
    });
  });

  it("rejects missing, malformed, and incorrect bearer credentials", () => {
    process.env.LOOPGRAPH_WORKER_API_TOKEN = "strong-worker-token";

    for (const authorization of [undefined, "Basic abc", "Bearer wrong-worker-token"]) {
      const headers = authorization ? { authorization } : undefined;
      const response = authorizeWorkerApiRequest(new Request("https://example.test/api/routing/worker", {
        method: "POST",
        headers
      }));
      expect(response?.status).toBe(401);
      expect(response?.headers.get("www-authenticate")).toBe("Bearer");
    }
  });

  it("accepts only the exact configured bearer credential", () => {
    process.env.LOOPGRAPH_WORKER_API_TOKEN = "strong-worker-token";

    const response = authorizeWorkerApiRequest(new Request("https://example.test/api/routing/worker", {
      method: "POST",
      headers: {
        authorization: "Bearer strong-worker-token"
      }
    }));

    expect(response).toBeNull();
  });
});
