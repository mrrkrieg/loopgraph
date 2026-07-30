import { NextResponse } from "next/server";
import {
  reconcileConnectionsAndMeasurements,
  scheduleDueMeasurements
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeCronApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = authorizeCronApiRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const projectRoot = getActiveLoopgraphProjectRoot();
    const now = new Date();
    const schedule = await scheduleDueMeasurements({ projectRoot, now });
    const reconciliation = await reconcileConnectionsAndMeasurements({ projectRoot, now });
    return NextResponse.json({ schedule, reconciliation }, {
      status: 202,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Measurement scheduler failed"
    }, {
      status: 500,
      headers: { "cache-control": "no-store" }
    });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
