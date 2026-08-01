import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildCredentialNamespace,
  customerManagedKeyReferenceSchema,
  providerIdSchema,
  type ConnectorInstallationAdmin
} from "loopgraph/core";
import { getProviderOnboardingProfile } from "loopgraph/runtime";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { connectorTenantBoundaryResponse } from "@/lib/connector-broker/tenant-binding";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

export const runtime = "nodejs";

const inputSchema = z.object({
  schemaVersion: z.literal("connector-oauth-start/v1"),
  tenant: z.object({ organizationId: z.string().min(1), projectKey: z.string().min(1) }),
  providerId: providerIdSchema,
  displayName: z.string().min(1).max(120),
  environment: z.enum(["development", "staging", "production"]),
  customerManagedKeyRef: customerManagedKeyReferenceSchema.optional(),
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
    const runtime = getConnectorBrokerRuntime();
    const profile = getProviderOnboardingProfile(input.providerId);
    if (profile.authorization.mode === "oauth2") {
      const result = await runtime.oauth.begin({
        tenant: input.tenant,
        providerId: input.providerId,
        displayName: input.displayName,
        environment: input.environment,
        customerManagedKeyRef: input.customerManagedKeyRef,
        actorId: input.actor.subject,
        correlationId: input.correlationId
      });
      return NextResponse.json(result, { status: 201, headers: { "cache-control": "no-store" } });
    }

    const id = `provider_${randomUUID()}`;
    const namespace = buildCredentialNamespace({ ...input.tenant, providerId: input.providerId, installationId: id, environment: input.environment });
    const now = new Date().toISOString();
    const installation: ConnectorInstallationAdmin = {
      id,
      tenant: input.tenant,
      providerId: input.providerId,
      displayName: input.displayName,
      environment: input.environment,
      status: profile.authorization.mode === "provider_app" ? "awaiting_consent" : "prepared",
      credentialRef: runtime.allocateCredentialReference({ namespace, providerId: input.providerId, installationId: id }),
      credentialNamespace: namespace,
      customerManagedKeyRef: input.customerManagedKeyRef,
      grantedScopes: [],
      allowedCapabilities: ["provider.health.read", "provider.disconnect"],
      webhookStatus: "not_configured",
      createdAt: now,
      updatedAt: now
    };
    await runtime.store.saveInstallation(installation);
    await runtime.store.recordCredentialNamespace(installation);
    await runtime.store.appendOAuthAudit({
      eventType: "connector.provider_setup_started",
      outcome: "accepted",
      tenant: input.tenant,
      installationId: id,
      providerId: input.providerId,
      actorId: input.actor.subject,
      correlationId: input.correlationId
    });
    return NextResponse.json({
      installation,
      instructionsUrl: profile.authorization.mode === "provider_app"
        ? profile.authorization.installationUrl
        : profile.authorization.instructionsUrl
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "OAuth start request is invalid", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: safeConnectorError(error, "OAuth start failed") }, { status: 503 });
  }
}
