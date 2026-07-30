import { describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn());
const retryRouteJob = vi.hoisted(() => vi.fn());
const cancelRouteJob = vi.hoisted(() => vi.fn());
const routingStore = vi.hoisted(() => ({ kind: "shared-routing" }));

vi.mock("loopgraph/runtime", () => ({
  retryRouteJob,
  cancelRouteJob
}));
vi.mock("../../../../../lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeWorkerApiRequest
}));
vi.mock("../../../../../lib/loopgraph-runtime/storage-resolver", () => ({
  getRoutingStore: () => routingStore
}));

import { POST } from "./route";

describe("route-job operator API", () => {
  it("retries through the shared hosted routing store", async () => {
    authorizeWorkerApiRequest.mockResolvedValue(null);
    retryRouteJob.mockResolvedValue({ id: "job_1", status: "queued" });

    const response = await POST(
      new Request("https://loopgraph.local/api/routing/jobs/job_1", {
        method: "POST",
        body: JSON.stringify({
          action: "retry",
          reason: "connector recovered",
          actor: "operator@example.com"
        })
      }),
      { params: Promise.resolve({ jobId: "job_1" }) }
    );

    expect(response.status).toBe(200);
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "routing.jobs"
    );
    expect(retryRouteJob).toHaveBeenCalledWith({
      store: routingStore,
      jobId: "job_1",
      reason: "connector recovered",
      requestedBy: "operator@example.com"
    });
  });
});
