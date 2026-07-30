import { describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn());
const runHermesDesignCallbackWorker = vi.hoisted(() => vi.fn());
const designStore = vi.hoisted(() => ({ kind: "shared-hermes-design" }));
const discoveryStore = vi.hoisted(() => ({ kind: "shared-discovery-design" }));
const loopSpecStore = vi.hoisted(() => ({ kind: "shared-loop-specs" }));

vi.mock("loopgraph/runtime", () => ({
  runHermesDesignCallbackWorker
}));
vi.mock("../../../../../lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeWorkerApiRequest
}));
vi.mock("../../../../../lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot: () => "/runtime/org/main",
  getDiscoveryDesignStore: () => discoveryStore,
  getHermesDesignStore: () => designStore,
  getLoopSpecRegistryStore: () => loopSpecStore
}));

import { POST } from "./route";

describe("Hermes design callback worker API", () => {
  it("authorizes the callback-processing capability and injects the shared store", async () => {
    authorizeWorkerApiRequest.mockResolvedValue(null);
    runHermesDesignCallbackWorker.mockResolvedValue({
      workerId: "callback-worker-primary",
      claimed: 0,
      completed: 0,
      retryScheduled: 0,
      deadLettered: 0,
      items: []
    });

    const response = await POST(new Request(
      "https://loopgraph.local/api/hermes/design-callbacks/worker",
      {
        method: "POST",
        body: JSON.stringify({
          workerId: "callback-worker-primary",
          limit: 25,
          leaseSeconds: 600
        })
      }
    ));

    expect(response.status).toBe(202);
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "hermes.design_callback_process"
    );
    expect(runHermesDesignCallbackWorker).toHaveBeenCalledWith({
      projectRoot: "/runtime/org/main",
      store: designStore,
      discoveryStore,
      loopSpecStore,
      workerId: "callback-worker-primary",
      limit: 25,
      leaseSeconds: 600
    });
  });
});
