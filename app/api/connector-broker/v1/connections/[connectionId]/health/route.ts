import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CONNECTOR_BROKER_PROTOCOL_VERSION } from "loopgraph/core";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.connector_broker");
  if (unauthorized) return unauthorized;
  const { connectionId } = await context.params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(connectionId)) {
    return NextResponse.json({ error: "Invalid connection ID" }, { status: 400 });
  }
  try {
    const runtimeState = getConnectorBrokerRuntime();
    const installation = await runtimeState.store.findInstallationGlobal({ installationId: connectionId });
    const organizationId = request.headers.get("x-loopgraph-organization-id");
    const projectKey = request.headers.get("x-loopgraph-project-key");
    if (!installation || installation.tenant.organizationId !== organizationId || installation.tenant.projectKey !== projectKey) {
      return NextResponse.json({ error: "Connection is unavailable" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    const now = new Date();
    const requestId = `connector_health_${randomUUID()}`;
    const result = await runtimeState.broker.execute({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId,
      idempotencyKey: requestId,
      tenant: installation.tenant,
      actor: { type: "workload", subject: "connector-broker:health" },
      providerId: installation.providerId,
      installationId: installation.id,
      capability: "provider.health.read",
      operation: "health.check",
      input: {},
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      correlationId: requestId
    });
    return NextResponse.json({ connectionId, status: result.status, receipt: result.receipt }, {
      status: result.status === "succeeded" ? 200 : 503,
      headers: { "cache-control": "no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Connection health is unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
