import { describe, expect, it, vi } from "vitest";
import { CONNECTOR_BROKER_PROTOCOL_VERSION } from "loopgraph/core";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn(async () => null));
const reconcileAction = vi.hoisted(() => vi.fn(async (input) => ({
  protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
  requestId: input.requestId,
  originalRequestId: input.originalRequestId,
  status: "pending",
  preparedActionStatus: "committing",
  reasonCode: "connector_commit_in_progress"
})));
const tenantBoundary = vi.hoisted(() => vi.fn(() => null));
const workloadBoundary = vi.hoisted(() => vi.fn(() => null));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeWorkerApiRequest }));
vi.mock("@/lib/connector-broker/runtime", () => ({
  getConnectorBrokerRuntime: () => ({ broker: { reconcileAction } })
}));
vi.mock("@/lib/connector-broker/tenant-binding", () => ({
  connectorTenantBoundaryResponse: tenantBoundary,
  connectorWorkloadGrantHeaderResponse: workloadBoundary
}));

import { POST } from "./route";

describe("connector broker action reconciliation route", () => {
  it("authorizes and preserves the exact machine-bound reconciliation request", async () => {
    const input = reconciliationRequest();
    const response = await POST(new Request("https://loopgraph.example/api/connector-broker/v1/actions/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(expect.any(Request), "provider.connector_broker");
    expect(tenantBoundary).toHaveBeenCalledWith(input.tenant);
    expect(workloadBoundary).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({
      preparedActionId: input.preparedActionId,
      originalRequestId: input.originalRequestId
    }));
    expect(reconcileAction).toHaveBeenCalledWith(expect.objectContaining(input));
  });
});

function reconciliationRequest() {
  return {
    protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
    requestId: "reconcile_request_12345678",
    idempotencyKey: "reconcile_idempotency_12345678",
    tenant: { organizationId: "org-1", projectKey: "main" },
    actor: { type: "workload", subject: "hermes-agent:hermes-sales" },
    providerId: "hubspot",
    installationId: "hubspot-1",
    capability: "provider.action.execute",
    operation: "contact.update",
    context: {
      workspaceId: "main",
      environment: "production",
      agentInstanceId: "hermes-sales",
      companyObject: { type: "contact", id: "contact-1" },
      loopId: "sales-lead-qualification",
      loopSpecHash: "a".repeat(64),
      routeJobId: "job-sales-write",
      activationMode: "execute"
    },
    issuedAt: "2026-08-21T12:00:00.000Z",
    expiresAt: "2026-08-21T12:02:00.000Z",
    correlationId: "sales-correlation-1",
    preparedActionId: "prepared_action_12345678",
    preparedActionFingerprint: "b".repeat(64),
    originalRequestId: "appcommit_request_12345678",
    originalIdempotencyKey: "appcommit_idempotency_12345678"
  };
}
