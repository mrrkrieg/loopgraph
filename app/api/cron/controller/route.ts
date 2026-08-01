import { NextResponse } from "next/server";
import {
  enqueueLoopControllerTrigger,
  runLoopControllerScheduler
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore,
  getHermesDesignStore,
  getLoopControllerStore,
  getLoopOpportunityStore,
  getLoopSpecRegistryStore,
  getRoutingStore,
  getSemanticGraphStore
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
  const loopSpecStore = getLoopSpecRegistryStore({ projectRoot });
  const semanticGraphStore = getSemanticGraphStore({ projectRoot });
  const scheduler = await runLoopControllerScheduler({
    projectRoot,
    limit: 20,
    now
  }, {
    store,
    routingStore: getRoutingStore(),
    designStore: getHermesDesignStore(),
    discoveryDesignStore: getDiscoveryDesignStore(),
    opportunityStore: getLoopOpportunityStore({ projectRoot }),
    loopSpecStore,
    semanticGraphStore,
    allowAutoShadowMaterialization:
      (store.persistence === "file" &&
        loopSpecStore.persistence === "file" &&
        semanticGraphStore.persistence === "file") ||
      (store.persistence === "distributed" &&
        loopSpecStore.persistence === "distributed" &&
        semanticGraphStore.persistence === "distributed")
  });
  return NextResponse.json({ enqueue, scheduler }, {
    status: 202,
    headers: { "cache-control": "no-store" }
  });
}

export async function POST(request: Request) {
  return GET(request);
}
