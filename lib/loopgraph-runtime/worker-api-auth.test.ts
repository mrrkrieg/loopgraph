import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeCronApiRequest,
  authorizeObservabilityApiRequest,
  authorizeWorkerApiRequest,
  machineCapabilityRequiresDurableGrant,
  resolveDurableWorkloadGrantScope
} from "./worker-api-auth";

const originalToken = process.env.LOOPGRAPH_WORKER_API_TOKEN;
const originalCronSecret = process.env.CRON_SECRET;
const originalObservabilityToken = process.env.LOOPGRAPH_OBSERVABILITY_API_TOKEN;
const originalDurableGrantRequirement = process.env.LOOPGRAPH_REQUIRE_DURABLE_WORKLOAD_GRANTS;

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.LOOPGRAPH_WORKER_API_TOKEN;
  } else {
    process.env.LOOPGRAPH_WORKER_API_TOKEN = originalToken;
  }
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
  if (originalObservabilityToken === undefined) {
    delete process.env.LOOPGRAPH_OBSERVABILITY_API_TOKEN;
  } else {
    process.env.LOOPGRAPH_OBSERVABILITY_API_TOKEN = originalObservabilityToken;
  }
  if (originalDurableGrantRequirement === undefined) {
    delete process.env.LOOPGRAPH_REQUIRE_DURABLE_WORKLOAD_GRANTS;
  } else {
    process.env.LOOPGRAPH_REQUIRE_DURABLE_WORKLOAD_GRANTS = originalDurableGrantRequirement;
  }
});

describe("route-job HTTP API authorization", () => {
  it("does not let provider headers weaken a marketplace durable grant", () => {
    const request = new Request("https://example.test/api/marketplace/client/catalog", {
      headers: {
        "x-loopgraph-provider-capability": "provider.github.issues.read",
        "x-loopgraph-connection-id": "github-prod"
      }
    });

    expect(resolveDurableWorkloadGrantScope(request, "marketplace.consume")).toEqual({
      capability: "marketplace.consume",
      connectionId: null
    });
  });

  it("keeps Hermes App execution on its own non-provider durable grant", () => {
    const request = new Request("https://example.test/api/hermes/apps/operations/invoke", {
      headers: {
        "x-loopgraph-provider-capability": "provider.action.execute",
        "x-loopgraph-connection-id": "hubspot-prod"
      }
    });

    expect(resolveDurableWorkloadGrantScope(request, "hermes.app_operations")).toEqual({
      capability: "hermes.app_operations",
      connectionId: null
    });
  });

  it("retains fine-grained provider grant selection for provider operations", () => {
    const request = new Request("https://example.test/api/integrations/broker", {
      headers: {
        "x-loopgraph-provider-capability": "provider.github.issues.read",
        "x-loopgraph-connection-id": "github-prod"
      }
    });

    expect(resolveDurableWorkloadGrantScope(request, "provider.connector_broker")).toEqual({
      capability: "provider.github.issues.read",
      connectionId: "github-prod"
    });
  });

  it("requires a durable grant for hosted Hermes route activation", () => {
    process.env.LOOPGRAPH_REQUIRE_DURABLE_WORKLOAD_GRANTS = "true";
    expect(machineCapabilityRequiresDurableGrant("hermes.route_activation")).toBe(true);
    expect(machineCapabilityRequiresDurableGrant("hermes.app_operations")).toBe(true);
    expect(machineCapabilityRequiresDurableGrant("routing.worker")).toBe(false);
  });

  it("fails closed without a configured token even for a localhost URL", async () => {
    delete process.env.LOOPGRAPH_WORKER_API_TOKEN;

    const response = await authorizeWorkerApiRequest(new Request("http://localhost/api/routing/worker", {
      method: "POST"
    }));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error:
        "LOOPGRAPH_WORKER_API_TOKEN must be configured before the " +
        "routing.worker machine API can be used."
    });
  });

  it("rejects missing, malformed, and incorrect bearer credentials", async () => {
    process.env.LOOPGRAPH_WORKER_API_TOKEN = "strong-worker-token";

    for (const authorization of [undefined, "Basic abc", "Bearer wrong-worker-token"]) {
      const headers = authorization ? { authorization } : undefined;
      const response = await authorizeWorkerApiRequest(new Request("https://example.test/api/routing/worker", {
        method: "POST",
        headers
      }));
      expect(response?.status).toBe(401);
      expect(response?.headers.get("www-authenticate")).toBe("Bearer");
    }
  });

  it("accepts only the exact configured bearer credential", async () => {
    process.env.LOOPGRAPH_WORKER_API_TOKEN = "strong-worker-token";

    const response = await authorizeWorkerApiRequest(new Request("https://example.test/api/routing/worker", {
      method: "POST",
      headers: {
        authorization: "Bearer strong-worker-token"
      }
    }));

    expect(response).toBeNull();
  });

  it("requires an independently configured cron bearer secret", async () => {
    process.env.CRON_SECRET = "strong-cron-secret";
    expect(await authorizeCronApiRequest(new Request("https://example.test/api/cron/controller", {
      headers: { authorization: "Bearer strong-cron-secret" }
    }))).toBeNull();
    const rejected = await authorizeCronApiRequest(
      new Request("https://example.test/api/cron/controller", {
        headers: { authorization: "Bearer strong-worker-token" }
      })
    );
    expect(rejected?.status).toBe(401);
  });

  it("keeps the read-only observability credential separate from worker credentials", async () => {
    process.env.LOOPGRAPH_WORKER_API_TOKEN = "strong-worker-token";
    process.env.LOOPGRAPH_OBSERVABILITY_API_TOKEN = "strong-observability-token";
    expect(await authorizeObservabilityApiRequest(new Request(
      "https://example.test/api/operations/metrics",
      { headers: { authorization: "Bearer strong-observability-token" } }
    ))).toBeNull();
    const rejected = await authorizeObservabilityApiRequest(new Request(
      "https://example.test/api/operations/metrics",
      { headers: { authorization: "Bearer strong-worker-token" } }
    ));
    expect(rejected?.status).toBe(401);
  });
});
