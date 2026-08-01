import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { connectorTenantBoundaryResponse } from "@/lib/connector-broker/tenant-binding";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

export const runtime = "nodejs";

const retrySchema = z.object({
  schemaVersion: z.literal("connector-installation-retry/v1"),
  tenant: z.object({ organizationId: z.string().min(1), projectKey: z.string().min(1) }).strict(),
  actor: z.object({ type: z.enum(["user", "workload"]), subject: z.string().min(1) }).strict(),
  correlationId: z.string().min(8).max(128)
}).strict();

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.connector_broker");
  if (unauthorized) return unauthorized;
  try {
    const { installationId } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(installationId)) {
      return NextResponse.json({ error: "Invalid connector installation ID" }, { status: 400 });
    }
    const input = retrySchema.parse(await request.json());
    const tenantDenied = connectorTenantBoundaryResponse(input.tenant);
    if (tenantDenied) return tenantDenied;
    const installation = await getConnectorBrokerRuntime().oauth.refreshInstallation({
      ...input.tenant,
      installationId,
      actorId: input.actor.subject,
      correlationId: input.correlationId
    });
    return NextResponse.json({ installation }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Connector retry request is invalid", issues: error.issues }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: safeConnectorError(error, "Connector retry failed") }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
