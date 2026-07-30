import { NextResponse } from "next/server";
import { getOperationalReadiness } from "../../../../lib/observability/operational-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const readiness = await getOperationalReadiness();
  return NextResponse.json({
    status: readiness.ready ? "ready" : "not_ready",
    service: "loopgraph",
    checkedAt: readiness.checkedAt
  }, {
    status: readiness.ready ? 200 : 503,
    headers: { "cache-control": "no-store" }
  });
}
