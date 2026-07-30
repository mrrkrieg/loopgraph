import { describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn());
const runHermesDesignDispatchWorker = vi.hoisted(() => vi.fn());
const designStore = vi.hoisted(() => ({ kind: "shared-hermes-design" }));

vi.mock("loopgraph/runtime", () => ({
  runHermesDesignDispatchWorker
}));
vi.mock("../../../../../lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeWorkerApiRequest
}));
vi.mock("../../../../../lib/loopgraph-runtime/storage-resolver", () => ({
  getHermesDesignStore: () => designStore
}));

import { POST } from "./route";

describe("Hermes design dispatch worker API", () => {
  it("authorizes the dispatch capability and injects the shared store", async () => {
    authorizeWorkerApiRequest.mockResolvedValue(null);
    runHermesDesignDispatchWorker.mockResolvedValue({
      workerId: "worker_primary",
      claimed: 0,
      completed: 0,
      retryScheduled: 0,
      deadLettered: 0,
      reconciled: 0,
      items: []
    });

    const response = await POST(new Request(
      "https://loopgraph.local/api/hermes/design-dispatch/worker",
      {
        method: "POST",
        body: JSON.stringify({
          workerId: "worker_primary",
          limit: 25,
          leaseSeconds: 600
        })
      }
    ));

    expect(response.status).toBe(202);
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "hermes.design_dispatch"
    );
    expect(runHermesDesignDispatchWorker).toHaveBeenCalledWith({
      store: designStore,
      workerId: "worker_primary",
      limit: 25,
      leaseSeconds: 600
    });
  });
});
