import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectorInstallationAdminSchema, providerIdSchema } from "loopgraph/core";
import { PROVIDER_ONBOARDING_CATALOG } from "loopgraph/runtime";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  appendConnectorAdminAudit,
  getExternalConnectorBrokerClient,
  listConnectorInstallations,
  persistConnectorInstallation,
  toConnectorInstallationView
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createIntegrationSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string().trim().min(1).max(120),
  environment: z.enum(["development", "staging", "production"]),
  customerManagedKeyRef: z.string().trim().max(1024).optional()
});

const brokerStartResponseSchema = z.object({
  installation: connectorInstallationAdminSchema,
  authorizationUrl: z.string().url().optional(),
  instructionsUrl: z.string().url().optional(),
  expiresAt: z.string().datetime().optional()
});

export async function GET() {
  try {
    const database = await getWorkspaceDatabase("integrations.read");
    const installations = await listConnectorInstallations(database);
    return NextResponse.json({
      schemaVersion: "connector-admin/v1",
      brokerConfigured: Boolean(getExternalConnectorBrokerClient()),
      providers: PROVIDER_ONBOARDING_CATALOG,
      installations
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectorError(error);
  }
}

export async function POST(request: Request) {
  try {
    const database = await getWorkspaceDatabase("integrations.manage");
    await requireHostedStepUp();
    if (!database.organizationId || !database.userId) {
      return NextResponse.json({ error: "Enterprise connector onboarding requires an authenticated organization." }, { status: 409 });
    }
    const input = createIntegrationSchema.parse(await request.json());
    const broker = getExternalConnectorBrokerClient();
    if (!broker) {
      return NextResponse.json({
        error: "Configure LOOPGRAPH_CONNECTOR_BROKER_URL and LOOPGRAPH_CONNECTOR_BROKER_AUDIENCE before connecting provider credentials."
      }, { status: 503 });
    }
    const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    const correlationId = `connector_start_${randomUUID()}`;
    const response = brokerStartResponseSchema.parse(await broker.startOAuth({
      schemaVersion: "connector-oauth-start/v1",
      tenant: { organizationId: database.organizationId, projectKey },
      providerId: input.providerId,
      displayName: input.displayName,
      environment: input.environment,
      customerManagedKeyRef: input.customerManagedKeyRef || undefined,
      actor: { type: "user", subject: database.userId },
      correlationId
    }));
    if (
      response.installation.providerId !== input.providerId ||
      response.installation.tenant.organizationId !== database.organizationId ||
      response.installation.tenant.projectKey !== projectKey
    ) {
      throw new Error("Connector broker returned a mismatched installation");
    }
    const profile = PROVIDER_ONBOARDING_CATALOG.find((item) => item.providerId === input.providerId);
    const consentUrl = response.authorizationUrl ?? response.instructionsUrl;
    if (!profile || (consentUrl && !providerNavigationUrlAllowed(profile, consentUrl))) {
      throw new Error("Connector broker returned an untrusted provider navigation URL");
    }
    await persistConnectorInstallation(database, response.installation);
    await appendConnectorAdminAudit({
      organizationId: database.organizationId,
      projectKey,
      eventType: "connector.consent_requested",
      outcome: "accepted",
      actorId: database.userId,
      correlationId,
      resourceType: "connector_installation",
      resourceId: response.installation.id,
      metadata: { providerId: input.providerId }
    });
    return NextResponse.json({
      ...response,
      installation: toConnectorInstallationView(response.installation)
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectorError(error);
  }
}

function providerNavigationUrlAllowed(
  profile: (typeof PROVIDER_ONBOARDING_CATALOG)[number],
  value: string
) {
  const expected = profile.authorization.mode === "oauth2"
    ? profile.authorization.authorizationUrl
    : profile.authorization.mode === "provider_app"
      ? profile.authorization.installationUrl
      : profile.authorization.instructionsUrl;
  const actualUrl = new URL(value);
  const expectedUrl = new URL(expected);
  return actualUrl.protocol === "https:" &&
    actualUrl.username === "" &&
    actualUrl.password === "" &&
    actualUrl.origin === expectedUrl.origin &&
    actualUrl.pathname === expectedUrl.pathname;
}

function connectorError(error: unknown) {
  if (error instanceof HostedAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Connector request is invalid", issues: error.issues }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ error: safeConnectorError(error, "Connector administration failed") }, {
    status: 503,
    headers: { "cache-control": "no-store" }
  });
}
