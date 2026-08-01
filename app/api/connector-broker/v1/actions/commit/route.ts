import { NextResponse } from "next/server";
import { connectorActionCommitRequestSchema } from "loopgraph/core";
import { ConnectorBrokerError } from "loopgraph/runtime";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { connectorTenantBoundaryResponse, connectorWorkloadGrantHeaderResponse } from "@/lib/connector-broker/tenant-binding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.connector_broker");
  if (unauthorized) return unauthorized;
  try {
    const input = connectorActionCommitRequestSchema.parse(await readBoundedJson(request));
    const tenantDenied = connectorTenantBoundaryResponse(input.tenant);
    if (tenantDenied) return tenantDenied;
    const workloadDenied = connectorWorkloadGrantHeaderResponse(request, input);
    if (workloadDenied) return workloadDenied;
    const response = await getConnectorBrokerRuntime().broker.commitAction(input);
    return NextResponse.json(response, {
      status: response.status === "succeeded" ? 200 : response.status === "denied" ? 403 : 502,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    const status = error instanceof ConnectorBrokerError && error.denied ? 403 : 400;
    const code = error instanceof ConnectorBrokerError ? error.code : "invalid_request";
    const message = error instanceof ConnectorBrokerError ? error.safeMessage : "Connector action commit request is invalid.";
    return NextResponse.json({ error: message, code }, { status, headers: { "cache-control": "no-store" } });
  }
}

async function readBoundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 64 * 1024) throw new ConnectorBrokerError("request_too_large", "Connector commit request exceeds 64 KiB.", false, true);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 64 * 1024) throw new ConnectorBrokerError("request_too_large", "Connector commit request exceeds 64 KiB.", false, true);
  return JSON.parse(text) as unknown;
}
