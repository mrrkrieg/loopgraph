import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn(async () => null));
const callLoopgraphAppTool = vi.hoisted(() => vi.fn(async () => ({
  schemaVersion: "loopgraph-app-operation-action-reconciliation/v1alpha1",
  status: "resolved_succeeded"
})));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeWorkerApiRequest }));
vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool }));

import { POST } from "./route";

describe("Hermes App action reconciliation route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts only the App action and durable Hermes execution identity", async () => {
    const input = {
      installationId: "installed-sales-app",
      actionId: "appact_12345678",
      routeJobId: "job-sales-write",
      agentInstanceId: "hermes-sales",
      callId: "reconcile-follow-up-1"
    };
    const response = await POST(request(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(expect.any(Request), "hermes.app_operations");
    expect(callLoopgraphAppTool).toHaveBeenCalledWith("loopgraph_app_operation_action_reconcile", input);
  });

  it("rejects caller-selected provider and original commit identities", async () => {
    const response = await POST(request({
      installationId: "installed-sales-app",
      actionId: "appact_12345678",
      routeJobId: "job-sales-write",
      agentInstanceId: "hermes-sales",
      callId: "reconcile-follow-up-2",
      providerId: "custom",
      originalRequestId: "caller-selected",
      originalIdempotencyKey: "caller-selected",
      tenant: { organizationId: "another", projectKey: "other" }
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.stringContaining("Only installation, App action")
    }));
    expect(callLoopgraphAppTool).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request("https://loopgraph.example/api/hermes/apps/operations/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
