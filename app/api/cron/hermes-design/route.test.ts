import { describe, expect, it, vi } from "vitest";

const authorizeCronApiRequest = vi.hoisted(() => vi.fn());
const runHermesDesignDispatchWorker = vi.hoisted(() => vi.fn());
const designStore = vi.hoisted(() => ({ kind: "shared-hermes-design" }));

vi.mock("loopgraph/runtime", () => ({
  runHermesDesignDispatchWorker
}));
vi.mock("../../../../lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeCronApiRequest
}));
vi.mock("../../../../lib/loopgraph-runtime/storage-resolver", () => ({
  getHermesDesignStore: () => designStore
}));

import { GET } from "./route";

describe("Hermes design dispatch schedule", () => {
  it("uses a distinct cron capability and the shared design store", async () => {
    authorizeCronApiRequest.mockResolvedValue(null);
    runHermesDesignDispatchWorker.mockResolvedValue({
      workerId: "hermes-design-cron",
      claimed: 0,
      completed: 0,
      retryScheduled: 0,
      deadLettered: 0,
      reconciled: 0,
      items: []
    });

    const response = await GET(new Request(
      "https://loopgraph.local/api/cron/hermes-design"
    ));

    expect(response.status).toBe(202);
    expect(authorizeCronApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "schedule.hermes_design"
    );
    expect(runHermesDesignDispatchWorker).toHaveBeenCalledWith({
      store: designStore,
      workerId: "hermes-design-cron",
      limit: 25,
      leaseSeconds: 300
    });
  });
});
