import { NextResponse } from "next/server";
import {
  enqueueLoopControllerTrigger,
  runLoopControllerScheduler
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeCronApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.controller");
  if (unauthorized) return unauthorized;
  const now = new Date();
  const projectRoot = getActiveLoopgraphProjectRoot();
  const bucket = Math.floor(now.getTime() / (15 * 60 * 1000));
  const enqueue = await enqueueLoopControllerTrigger({
    projectRoot,
    type: "schedule",
    triggerId: `schedule_${bucket}`,
    sourceRef: "loopgraph-cron",
    occurredAt: now.toISOString(),
    requestedBy: "loopgraph-cron"
  }, { now });
  const scheduler = await runLoopControllerScheduler({
    projectRoot,
    limit: 20,
    now
  });
  return NextResponse.json({ enqueue, scheduler }, {
    status: 202,
    headers: { "cache-control": "no-store" }
  });
}

export async function POST(request: Request) {
  return GET(request);
}
