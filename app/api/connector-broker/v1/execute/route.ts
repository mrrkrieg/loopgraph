import { NextResponse } from "next/server";
import { connectorBrokerRequestSchema } from "loopgraph/core";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { connectorTenantBoundaryResponse, connectorWorkloadGrantHeaderResponse } from "@/lib/connector-broker/tenant-binding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.connector_broker");
  if (unauthorized) return unauthorized;
  try {
    const input = connectorBrokerRequestSchema.parse(await request.json());
    if (input.capability === "provider.events.emit") {
      return NextResponse.json({ error: "Provider detector operations are internal to the authenticated scheduler" }, {
        status: 403,
        headers: { "cache-control": "no-store" }
      });
    }
    const tenantDenied = connectorTenantBoundaryResponse(input.tenant);
    if (tenantDenied) return tenantDenied;
    const workloadDenied = connectorWorkloadGrantHeaderResponse(request, input);
    if (workloadDenied) return workloadDenied;
    const response = await getConnectorBrokerRuntime().broker.execute(input);
    return NextResponse.json(response, {
      status: response.status === "succeeded" ? 200 : response.status === "denied" ? 403 : 502,
      headers: { "cache-control": "no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Connector broker request is invalid" }, {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }
}
