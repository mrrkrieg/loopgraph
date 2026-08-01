import { NextResponse } from "next/server";
import { z } from "zod";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import { approveConnectorPreparedAction } from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

const approvalSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(3).max(1000)
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ installationId: string; actionId: string }> }
) {
  try {
    const { installationId, actionId } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(installationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{7,159}$/.test(actionId)) {
      return NextResponse.json({ error: "Invalid connector action identity" }, { status: 400 });
    }
    const database = await getWorkspaceDatabase("integrations.manage");
    await requireHostedStepUp();
    const input = approvalSchema.parse(await request.json());
    const approval = await approveConnectorPreparedAction({ database, installationId, actionId, ...input });
    return NextResponse.json({ schemaVersion: "connector-action-approval/v1", approval }, {
      status: 201,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    if (error instanceof HostedAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Connector approval is invalid", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: safeConnectorError(error, "Connector approval failed") }, { status: 409 });
  }
}
