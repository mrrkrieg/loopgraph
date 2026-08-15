import { describe, expect, it, vi } from "vitest";
import { CONNECTOR_BROKER_PROTOCOL_VERSION } from "loopgraph/core";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn(async () => null));
const execute = vi.hoisted(() => vi.fn());

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeWorkerApiRequest }));
vi.mock("@/lib/connector-broker/runtime", () => ({
  getConnectorBrokerRuntime: () => ({ broker: { execute } })
}));
vi.mock("@/lib/connector-broker/tenant-binding", () => ({
  connectorTenantBoundaryResponse: () => null,
  connectorWorkloadGrantHeaderResponse: () => null
}));

import { POST } from "./route";

describe("connector broker execute route", () => {
  it("does not expose internal provider detector operations to broker clients", async () => {
    const response = await POST(new Request("https://loopgraph.example/api/connector-broker/v1/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
        requestId: "request_detector_12345678",
        idempotencyKey: "idempotency_detector_12345678",
        tenant: { organizationId: "org-1", projectKey: "main" },
        actor: { type: "system", subject: "system:provider-detector" },
        providerId: "bigquery",
        installationId: "bigquery-1",
        capability: "provider.events.emit",
        operation: "company-metrics.detect",
        input: {
          windowStart: "2026-08-13T11:00:00.000Z",
          windowEnd: "2026-08-13T12:00:00.000Z",
          limit: 100
        },
        issuedAt: "2026-08-13T11:59:30.000Z",
        expiresAt: "2026-08-13T12:00:30.000Z",
        correlationId: "detector-run-1"
      })
    }));
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});
