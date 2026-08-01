import { NextResponse } from "next/server";
import { z } from "zod";
import { credentialReferenceSchema } from "loopgraph/core";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { connectorTenantBoundaryResponse } from "@/lib/connector-broker/tenant-binding";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

const inputSchema = z.object({
  schemaVersion: z.literal("connector-webhook-activation/v1"),
  tenant: z.object({ organizationId: z.string().min(1), projectKey: z.string().min(1) }),
  installationId: z.string().min(3).max(128),
  webhookSecretRef: credentialReferenceSchema.optional(),
  providerSubscriptionId: z.string().min(1).max(256).optional(),
  providerConfigured: z.boolean().default(false),
  actor: z.object({ type: z.enum(["user", "workload"]), subject: z.string().min(1) }),
  correlationId: z.string().min(8).max(128)
});

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.connector_broker");
  if (unauthorized) return unauthorized;
  try {
    const input = inputSchema.parse(await request.json());
    const tenantDenied = connectorTenantBoundaryResponse(input.tenant);
    if (tenantDenied) return tenantDenied;
    const subscriptions = getConnectorBrokerRuntime().subscriptions;
    if (!subscriptions) return NextResponse.json({ error: "LOOPGRAPH_PUBLIC_URL is required" }, { status: 503 });
    const result = await subscriptions.activate({ ...input.tenant, ...input });
    await getConnectorBrokerRuntime().store.appendOAuthAudit({
      eventType: "connector.webhook_activated",
      outcome: "accepted",
      tenant: input.tenant,
      installationId: input.installationId,
      providerId: result.installation.providerId,
      actorId: input.actor.subject,
      correlationId: input.correlationId
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json({ error: safeConnectorError(error, "Webhook activation failed") }, { status: 503 });
  }
}
