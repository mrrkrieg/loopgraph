import { NextResponse } from "next/server";
import { connectorActionPrepareRequestSchema } from "loopgraph/core";
import { ConnectorBrokerError } from "loopgraph/runtime";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { connectorTenantBoundaryResponse, connectorWorkloadGrantHeaderResponse } from "@/lib/connector-broker/tenant-binding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.connector_broker");
  if (unauthorized) return unauthorized;
  try {
    const input = connectorActionPrepareRequestSchema.parse(await readBoundedJson(request));
    const tenantDenied = connectorTenantBoundaryResponse(input.tenant);
    if (tenantDenied) return tenantDenied;
    const workloadDenied = connectorWorkloadGrantHeaderResponse(request, input);
    if (workloadDenied) return workloadDenied;
    const response = await getConnectorBrokerRuntime().broker.prepareAction(input);
    return NextResponse.json(response, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof ConnectorBrokerError && error.denied ? 403 : 400;
    const code = error instanceof ConnectorBrokerError ? error.code : "invalid_request";
    const message = error instanceof ConnectorBrokerError ? error.safeMessage : "Connector action prepare request is invalid.";
    return NextResponse.json({ error: message, code }, { status, headers: { "cache-control": "no-store" } });
  }
}

async function readBoundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 256 * 1024) throw new ConnectorBrokerError("request_too_large", "Connector request exceeds 256 KiB.", false, true);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) throw new ConnectorBrokerError("request_too_large", "Connector request exceeds 256 KiB.", false, true);
  return JSON.parse(text) as unknown;
}
