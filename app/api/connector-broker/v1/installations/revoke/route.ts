import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { connectorTenantBoundaryResponse } from "@/lib/connector-broker/tenant-binding";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

const inputSchema = z.object({
  schemaVersion: z.literal("connector-revocation/v1"),
  tenant: z.object({ organizationId: z.string().min(1), projectKey: z.string().min(1) }),
  installationId: z.string().min(3).max(128),
  reason: z.string().min(3).max(500),
  emergency: z.boolean().default(false),
  actor: z.object({ type: z.enum(["user", "workload"]), subject: z.string().min(1) }),
  correlationId: z.string().min(8).max(128)
});

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.revocation_worker");
  if (unauthorized) return unauthorized;
  try {
    const input = inputSchema.parse(await request.json());
    const tenantDenied = connectorTenantBoundaryResponse(input.tenant);
    if (tenantDenied) return tenantDenied;
    const installation = await getConnectorBrokerRuntime().oauth.revoke({
      ...input.tenant,
      installationId: input.installationId,
      actorId: input.actor.subject,
      correlationId: input.correlationId,
      emergency: input.emergency
    });
    return NextResponse.json({ installation }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: safeConnectorError(error, "Connector revocation failed") }, { status: 503 });
  }
}
