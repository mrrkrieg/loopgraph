import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { connectorTenantBoundaryResponse } from "@/lib/connector-broker/tenant-binding";

const inputSchema = z.object({
  schemaVersion: z.literal("connector-revocation/v1"),
  tenant: z.object({ organizationId: z.string().min(1), projectKey: z.string().min(1) }),
  reason: z.string().trim().min(3).max(1000),
  emergency: z.boolean().default(false),
  actor: z.object({ type: z.enum(["user", "workload"]), subject: z.string().min(1) }),
  correlationId: z.string().min(8).max(128)
}).strict();

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.revocation_worker");
  if (unauthorized) return unauthorized;
  try {
    const { installationId } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(installationId)) {
      return NextResponse.json({ error: "Invalid connector installation ID" }, { status: 400 });
    }
    const input = inputSchema.parse(await request.json());
    const tenantDenied = connectorTenantBoundaryResponse(input.tenant);
    if (tenantDenied) return tenantDenied;
    const installation = await getConnectorBrokerRuntime().oauth.revoke({
      ...input.tenant,
      installationId,
      actorId: input.actor.subject,
      correlationId: input.correlationId,
      emergency: input.emergency
    });
    return NextResponse.json({ installation }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: safeConnectorError(error, "Connector revocation failed") }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
