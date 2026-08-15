import { NextResponse } from "next/server";
import { HostedAccessError } from "@/lib/auth/hosted-access";
import { listProviderDetectorOperations } from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const database = await getWorkspaceDatabase("integrations.read");
    return NextResponse.json({
      schemaVersion: "provider-detector-operations/v1",
      detectors: await listProviderDetectorOperations(database)
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HostedAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.status,
        headers: { "cache-control": "no-store" }
      });
    }
    return NextResponse.json({ error: safeConnectorError(error, "Detector operations could not be loaded") }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
