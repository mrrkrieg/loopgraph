import { NextResponse } from "next/server";
import { z } from "zod";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import { disableConnectorLocally } from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

const inputSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try {
    const { installationId } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(installationId)) {
      return NextResponse.json({ error: "Invalid connector installation ID" }, { status: 400 });
    }
    const database = await getWorkspaceDatabase("credentials.revoke");
    await requireHostedStepUp();
    const input = inputSchema.parse(await request.json());
    const result = await disableConnectorLocally({ database, installationId, reason: input.reason });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HostedAccessError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Disable request is invalid", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: safeConnectorError(error, "Connector disable failed") }, { status: 503 });
  }
}
