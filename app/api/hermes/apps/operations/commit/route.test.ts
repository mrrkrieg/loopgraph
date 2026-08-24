import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn(async () => null));
const callLoopgraphAppTool = vi.hoisted(() => vi.fn(async () => ({
  schemaVersion: "loopgraph-app-operation-action-commit/v1alpha1",
  status: "succeeded"
})));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeWorkerApiRequest }));
vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool }));

import { POST } from "./route";

describe("Hermes App action commit route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts only the App action and durable Hermes execution identity", async () => {
    const input = {
      installationId: "installed-sales-app",
      actionId: "appact_12345678",
      routeJobId: "job-sales-write",
      agentInstanceId: "hermes-sales",
      callId: "commit-follow-up-1"
    };
    const response = await POST(request(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(expect.any(Request), "hermes.app_operations");
    expect(callLoopgraphAppTool).toHaveBeenCalledWith("loopgraph_app_operation_action_commit", input);
  });

  it("rejects caller-selected provider, operation, connection, fingerprint, approval, and tenant fields", async () => {
    const response = await POST(request({
      installationId: "installed-sales-app",
      actionId: "appact_12345678",
      routeJobId: "job-sales-write",
      agentInstanceId: "hermes-sales",
      callId: "commit-follow-up-2",
      providerId: "custom",
      operation: "arbitrary.request",
      connectionId: "untrusted",
      fingerprint: "f".repeat(64),
      approvalReceiptId: "caller-chosen",
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
  return new Request("https://loopgraph.example/api/hermes/apps/operations/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
