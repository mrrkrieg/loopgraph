import { describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn());
const runRouteJobWorker = vi.hoisted(() => vi.fn());
const routingStore = vi.hoisted(() => ({ kind: "shared-routing" }));
const storageAdapter = vi.hoisted(() => ({ kind: "shared-traces" }));
const loopSpecStore = vi.hoisted(() => ({ kind: "shared-loop-specs" }));
const controllerStore = vi.hoisted(() => ({ kind: "shared-controller" }));
const operationsStore = vi.hoisted(() => ({ kind: "shared-hermes-operations" }));

vi.mock("loopgraph/runtime", () => ({
  runRouteJobWorker
}));
vi.mock("../../../../lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeWorkerApiRequest
}));
vi.mock("../../../../lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot: () => "/runtime/org/main",
  getLoopControllerStore: () => controllerStore,
  getLoopSpecRegistryStore: () => loopSpecStore,
  getHermesOperationsStore: () => operationsStore,
  getRoutingStore: () => routingStore,
  getStorageAdapter: () => storageAdapter
}));

import { POST } from "./route";

describe("route-job worker API", () => {
  it("injects the shared hosted routing and trace stores", async () => {
    authorizeWorkerApiRequest.mockResolvedValue(null);
    runRouteJobWorker.mockResolvedValue({
      schemaVersion: "route-job-worker-run/v1alpha1",
      claimed: 0
    });

    const response = await POST(new Request("https://loopgraph.local/api/routing/worker", {
      method: "POST",
      body: JSON.stringify({
        workerId: "worker_primary",
        limit: 25,
        leaseSeconds: 600
      })
    }));

    expect(response.status).toBe(202);
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "routing.worker"
    );
    expect(runRouteJobWorker).toHaveBeenCalledWith({
      projectRoot: "/runtime/org/main",
      workerId: "worker_primary",
      limit: 25,
      leaseSeconds: 600,
      store: routingStore,
      loopSpecStore,
      controllerStore,
      storage: storageAdapter,
      operationsStore
    });
  });
});
