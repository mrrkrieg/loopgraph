import { describe, expect, it, vi } from "vitest";

const authorizeCronApiRequest = vi.hoisted(() => vi.fn());
const runHermesDesignCallbackWorker = vi.hoisted(() => vi.fn());
const designStore = vi.hoisted(() => ({ kind: "shared-hermes-design" }));
const discoveryStore = vi.hoisted(() => ({ kind: "shared-discovery-design" }));

vi.mock("loopgraph/runtime", () => ({
  runHermesDesignCallbackWorker
}));
vi.mock("../../../../lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeCronApiRequest
}));
vi.mock("../../../../lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot: () => "/runtime/org/main",
  getDiscoveryDesignStore: () => discoveryStore,
  getHermesDesignStore: () => designStore
}));

import { GET } from "./route";

describe("Hermes design callback schedule", () => {
  it("uses a distinct cron capability and the shared callback inbox", async () => {
    authorizeCronApiRequest.mockResolvedValue(null);
    runHermesDesignCallbackWorker.mockResolvedValue({
      workerId: "hermes-callback-cron",
      claimed: 0,
      completed: 0,
      retryScheduled: 0,
      deadLettered: 0,
      items: []
    });

    const response = await GET(new Request(
      "https://loopgraph.local/api/cron/hermes-callbacks"
    ));

    expect(response.status).toBe(202);
    expect(authorizeCronApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "schedule.hermes_callbacks"
    );
    expect(runHermesDesignCallbackWorker).toHaveBeenCalledWith({
      projectRoot: "/runtime/org/main",
      store: designStore,
      discoveryStore,
      workerId: "hermes-callback-cron",
      limit: 25,
      leaseSeconds: 300
    });
  });
});
