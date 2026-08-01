import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { connectorInstallationAdminSchema } from "loopgraph/core";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  appendConnectorAdminAudit,
  getExternalConnectorBrokerClient,
  persistConnectorInstallation,
  toConnectorInstallationView
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

export async function POST(_request: Request, context: { params: Promise<{ installationId: string }> }) {
  try {
    const { installationId } = await context.params;
    const database = await getWorkspaceDatabase("credentials.rotate");
    await requireHostedStepUp();
    if (!database.organizationId || !database.userId) return NextResponse.json({ error: "Hosted connector storage is unavailable" }, { status: 409 });
    const broker = getExternalConnectorBrokerClient();
    if (!broker) return NextResponse.json({ error: "Connector broker is not configured" }, { status: 503 });
    const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    const correlationId = `connector_rotate_${randomUUID()}`;
    const response = await broker.rotate({
      schemaVersion: "connector-rotation/v1",
      tenant: { organizationId: database.organizationId, projectKey },
      installationId,
      actor: { type: "user", subject: database.userId },
      correlationId
    }) as Record<string, unknown>;
    const installation = connectorInstallationAdminSchema.parse(response.installation ?? response);
    await persistConnectorInstallation(database, installation);
    await appendConnectorAdminAudit({
      organizationId: database.organizationId,
      projectKey,
      eventType: "connector.rotation_requested",
      outcome: "accepted",
      actorId: database.userId,
      correlationId,
      resourceType: "connector_installation",
      resourceId: installationId,
      metadata: { providerId: installation.providerId }
    });
    return NextResponse.json({ installation: toConnectorInstallationView(installation) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HostedAccessError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: safeConnectorError(error, "Connector rotation failed") }, { status: 503 });
  }
}
