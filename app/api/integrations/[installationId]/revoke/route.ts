import { NextResponse } from "next/server";
import { z } from "zod";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  completeConnectorRevocation,
  getExternalConnectorBrokerClient,
  queueConnectorRevocation
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

export const runtime = "nodejs";

const inputSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  emergency: z.boolean().default(false)
});

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try {
    const { installationId } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(installationId)) {
      return NextResponse.json({ error: "Invalid connector installation ID" }, { status: 400 });
    }
    const input = inputSchema.parse(await request.json());
    const database = await getWorkspaceDatabase("credentials.revoke");
    await requireHostedStepUp();
    const queued = await queueConnectorRevocation({ database, installationId, ...input });
    const broker = getExternalConnectorBrokerClient();
    if (!broker) {
      return NextResponse.json({
        accepted: true,
        status: "revoking",
        jobId: queued.jobId,
        warning: "Connector access is disabled in Loopgraph; provider/vault revocation remains queued until the broker is reachable."
      }, { status: 202, headers: { "cache-control": "no-store" } });
    }
    try {
      await broker.revoke({
        schemaVersion: "connector-revocation/v1",
        tenant: queued.installation.tenant,
        installationId,
        emergency: input.emergency,
        reason: input.reason,
        actor: { type: "user", subject: database.userId },
        correlationId: `connector_revoke_${queued.jobId}`
      });
      await completeConnectorRevocation({ database, installationId, jobId: queued.jobId, success: true });
      return NextResponse.json({ accepted: true, status: "revoked", jobId: queued.jobId }, { headers: { "cache-control": "no-store" } });
    } catch {
      await completeConnectorRevocation({ database, installationId, jobId: queued.jobId, success: false, errorCode: "broker_unavailable" });
      return NextResponse.json({ accepted: true, status: "revoking", jobId: queued.jobId }, { status: 202, headers: { "cache-control": "no-store" } });
    }
  } catch (error) {
    if (error instanceof HostedAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Revocation request is invalid", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: safeConnectorError(error, "Revocation request failed") }, { status: 503 });
  }
}
