import { afterEach, describe, expect, it, vi } from "vitest";

const authorizeCronApiRequest = vi.hoisted(() => vi.fn(async () => null));
const runAppActionReconciliationWorker = vi.hoisted(() => vi.fn(async (workerInput: {
  reconcile: (input: {
    installationId: string;
    actionId: string;
    routeJobId: string;
    agentInstanceId: string;
    callId: string;
  }) => Promise<unknown>;
}) => {
  void workerInput;
  return {
    schemaVersion: "loopgraph-app-action-reconciliation-worker/v1alpha1",
    workspaceId: "main",
    scanned: 0,
    eligible: 0,
    resolvedSucceeded: 0,
    resolvedFailed: 0,
    pending: 0,
    unresolved: 0,
    failed: 0,
    items: [],
    completedAt: "2026-08-21T12:00:00.000Z"
  };
}));
const callLoopgraphAppTool = vi.hoisted(() => vi.fn());
const actionStore = vi.hoisted(() => ({ kind: "distributed-app-actions" }));

vi.mock("loopgraph/runtime", () => ({ runAppActionReconciliationWorker }));
vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool }));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot: () => "/srv/loopgraph",
  getAppOperationActionStore: () => actionStore
}));
vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeCronApiRequest }));

import { GET } from "./route";

describe("App action reconciliation schedule", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses a distinct cron capability and the receipt-only App boundary", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    const response = await GET(new Request("https://loopgraph.local/api/cron/app-action-reconciliation"));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeCronApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "schedule.app_action_reconciliation"
    );
    expect(runAppActionReconciliationWorker).toHaveBeenCalledWith(expect.objectContaining({
      actionStore,
      workspaceId: "main",
      limit: 25,
      minimumAgeMs: 60_000,
      reconcile: expect.any(Function)
    }));

    const workerInput = runAppActionReconciliationWorker.mock.calls[0]![0];
    await workerInput.reconcile({
      installationId: "installed-sales",
      actionId: "action-sales",
      routeJobId: "route-sales",
      agentInstanceId: "hermes-sales",
      callId: "scheduled-reconcile-1"
    });
    expect(callLoopgraphAppTool).toHaveBeenCalledWith(
      "loopgraph_app_operation_action_reconcile",
      expect.objectContaining({ actionId: "action-sales", callId: "scheduled-reconcile-1" }),
      { projectRoot: "/srv/loopgraph" }
    );
  });
});
