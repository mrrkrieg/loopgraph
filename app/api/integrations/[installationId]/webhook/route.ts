import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectorInstallationAdminSchema } from "loopgraph/core";
import { HostedAccessError } from "@/lib/auth/hosted-access";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  appendConnectorAdminAudit,
  getExternalConnectorBrokerClient,
  persistConnectorInstallation,
  toConnectorInstallationView
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

const inputSchema = z.object({
  providerSubscriptionId: z.string().trim().max(256).optional(),
  providerConfigured: z.boolean().default(false)
});

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try {
    const { installationId } = await context.params;
    const input = inputSchema.parse(await request.json());
    const database = await getWorkspaceDatabase("integrations.manage");
    if (!database.organizationId || !database.userId) return NextResponse.json({ error: "Hosted connector storage is unavailable" }, { status: 409 });
    const broker = getExternalConnectorBrokerClient();
    if (!broker) return NextResponse.json({ error: "Connector broker is not configured" }, { status: 503 });
    const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    const correlationId = `connector_webhook_${randomUUID()}`;
    const response = await broker.activateWebhook({
      schemaVersion: "connector-webhook-activation/v1",
      tenant: { organizationId: database.organizationId, projectKey },
      installationId,
      providerSubscriptionId: input.providerSubscriptionId || undefined,
      providerConfigured: input.providerConfigured,
      actor: { type: "user", subject: database.userId },
      correlationId
    }) as Record<string, unknown>;
    const installation = connectorInstallationAdminSchema.parse(response.installation);
    await persistConnectorInstallation(database, installation);
    await appendConnectorAdminAudit({
      organizationId: database.organizationId,
      projectKey,
      eventType: "connector.webhook_activation_requested",
      outcome: "accepted",
      actorId: database.userId,
      correlationId,
      resourceType: "connector_installation",
      resourceId: installationId,
      metadata: { providerId: installation.providerId, webhookStatus: installation.webhookStatus }
    });
    return NextResponse.json({
      installation: toConnectorInstallationView(installation),
      endpointUrl: response.endpointUrl,
      requiresProviderConfirmation: response.requiresProviderConfirmation
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HostedAccessError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Webhook activation request is invalid", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: safeConnectorError(error, "Webhook activation failed") }, { status: 503 });
  }
}
