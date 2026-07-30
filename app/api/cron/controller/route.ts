import { NextResponse } from "next/server";
import {
  enqueueLoopControllerTrigger,
  runLoopControllerScheduler
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore,
  getLoopControllerStore,
  getLoopOpportunityStore,
  getRoutingStore
} from "../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeCronApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.controller");
  if (unauthorized) return unauthorized;
  const now = new Date();
  const projectRoot = getActiveLoopgraphProjectRoot();
  const store = getLoopControllerStore({ projectRoot });
  const bucket = Math.floor(now.getTime() / (15 * 60 * 1000));
  const enqueue = await enqueueLoopControllerTrigger({
    projectRoot,
    type: "schedule",
    triggerId: `schedule_${bucket}`,
    sourceRef: "loopgraph-cron",
    occurredAt: now.toISOString(),
    requestedBy: "loopgraph-cron"
  }, { now, store });
  const scheduler = await runLoopControllerScheduler({
    projectRoot,
    limit: 20,
    now
  }, {
    store,
    routingStore: getRoutingStore(),
    designStore: getHermesDesignStore(),
    opportunityStore: getLoopOpportunityStore({ projectRoot }),
    allowAutoShadowMaterialization: store.persistence === "file"
  });
  return NextResponse.json({ enqueue, scheduler }, {
    status: 202,
    headers: { "cache-control": "no-store" }
  });
}

export async function POST(request: Request) {
  return GET(request);
}
