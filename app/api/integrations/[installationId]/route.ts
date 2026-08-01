import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  appendConnectorAdminAudit,
  deleteConnectorInstallationMetadata
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";

export async function DELETE(_request: Request, context: { params: Promise<{ installationId: string }> }) {
  try {
    const { installationId } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(installationId)) {
      return NextResponse.json({ error: "Invalid connector installation ID" }, { status: 400 });
    }
    const database = await getWorkspaceDatabase("credentials.revoke");
    await requireHostedStepUp();
    if (!database.client || !database.organizationId || !database.userId) {
      return NextResponse.json({ error: "Hosted connector storage is unavailable" }, { status: 409 });
    }
    const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    const data = await deleteConnectorInstallationMetadata({ database, installationId, projectKey });
    if (!data) return NextResponse.json({ error: "Revoke the provider before deleting its metadata." }, { status: 409 });
    await appendConnectorAdminAudit({
      organizationId: database.organizationId,
      projectKey,
      eventType: "connector.metadata_deleted",
      outcome: "accepted",
      actorId: database.userId,
      correlationId: `connector_delete_${randomUUID()}`,
      resourceType: "connector_installation",
      resourceId: installationId,
      metadata: { providerId: String(data.provider_id) }
    });
    return NextResponse.json({ deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HostedAccessError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: safeConnectorError(error, "Connector metadata deletion failed") }, { status: 503 });
  }
}
