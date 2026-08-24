import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn(async () => null));
const callLoopgraphAppTool = vi.hoisted(() => vi.fn(async () => ({
  schemaVersion: "loopgraph-app-operation-execution/v1alpha1",
  disposition: "invoke_read"
})));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeWorkerApiRequest }));
vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool }));

import { POST } from "./route";

describe("Hermes App operation invocation route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts only a logical capability and durable execution identity", async () => {
    const input = {
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-read-lead-1",
      input: { leadId: "lead-42" }
    };
    const response = await POST(request(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(expect.any(Request), "hermes.app_operations");
    expect(callLoopgraphAppTool).toHaveBeenCalledWith("loopgraph_app_operation_invoke", input);
  });

  it("rejects caller-selected providers, operations, connections, tenants, and URLs", async () => {
    const response = await POST(request({
      installationId: "installed-sales-app",
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      routeJobId: "job-sales-read",
      agentInstanceId: "hermes-sales",
      callId: "task-read-lead-2",
      input: { leadId: "lead-42" },
      providerId: "custom",
      operation: "arbitrary.request",
      connectionId: "untrusted-connection",
      tenant: { organizationId: "another-tenant", projectKey: "other" },
      url: "https://example.invalid"
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.stringContaining("Only installation, loop, capability")
    }));
    expect(callLoopgraphAppTool).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request("https://loopgraph.example/api/hermes/apps/operations/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
