import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CONNECTOR_BROKER_PROTOCOL_VERSION } from "loopgraph/core";
import { HostedAccessError } from "@/lib/auth/hosted-access";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  appendConnectorAdminAudit,
  getExternalConnectorBrokerClient,
  listConnectorInstallations,
  updateConnectorHealth
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

export async function POST(_request: Request, context: { params: Promise<{ installationId: string }> }) {
  try {
    const { installationId } = await context.params;
    const database = await getWorkspaceDatabase("integrations.manage");
    if (!database.organizationId || !database.userId || !database.client) return NextResponse.json({ error: "Hosted connector storage is unavailable" }, { status: 409 });
    const installation = (await listConnectorInstallations(database)).find((item) => item.id === installationId);
    if (!installation) return NextResponse.json({ error: "Connector installation was not found" }, { status: 404 });
    const broker = getExternalConnectorBrokerClient();
    if (!broker) return NextResponse.json({ error: "Connector broker is not configured" }, { status: 503 });
    const now = new Date();
    const requestId = `connector_health_${randomUUID()}`;
    const response = await broker.execute({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId,
      idempotencyKey: requestId,
      tenant: installation.tenant,
      actor: { type: "user", subject: database.userId },
      providerId: installation.providerId,
      installationId,
      capability: "provider.health.read",
      operation: "health.check",
      input: {},
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      correlationId: requestId
    });
    const checkedAt = now.toISOString();
    const status = response.status === "succeeded" ? "active" : "degraded";
    await updateConnectorHealth({
      database,
      installationId,
      projectKey: installation.tenant.projectKey,
      status,
      checkedAt
    });
    await appendConnectorAdminAudit({
      organizationId: database.organizationId,
      projectKey: installation.tenant.projectKey,
      eventType: "connector.health_checked",
      outcome: response.status === "succeeded" ? "accepted" : "error",
      actorId: database.userId,
      correlationId: requestId,
      resourceType: "connector_installation",
      resourceId: installationId,
      metadata: { providerId: installation.providerId, status }
    });
    return NextResponse.json({ status, checkedAt, receipt: response.receipt }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HostedAccessError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: safeConnectorError(error, "Connector health check failed") }, { status: 503 });
  }
}
