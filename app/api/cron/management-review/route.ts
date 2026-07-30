import { NextRequest, NextResponse } from "next/server";
import { generateAndPersistManagementRollup } from "@/lib/loopgraph-runtime/management-rollup";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore,
  getLoopControllerStore,
  getLoopOpportunityStore,
  getRoutingStore,
  getStorageAdapter
} from "@/lib/loopgraph-runtime/storage-resolver";
import { authorizeCronApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";
import {
  enqueueLoopControllerTrigger,
  runLoopControllerScheduler
} from "loopgraph/runtime";

export async function GET(request: NextRequest) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.management");
  if (unauthorized) return unauthorized;

  const storage = getStorageAdapter();
  const rollup = await generateAndPersistManagementRollup(storage);
  const projectRoot = getActiveLoopgraphProjectRoot();
  const controllerStore = getLoopControllerStore({ projectRoot });
  const enqueue = await enqueueLoopControllerTrigger({
    projectRoot,
    type: "management_cycle",
    triggerId: `management-review-${rollup.weekKey}`,
    sourceRef: `management-rollup:${rollup.weekKey}`,
    occurredAt: rollup.generatedAt,
    requestedBy: "loopgraph-management-cron"
  }, { store: controllerStore });
  const controller = await runLoopControllerScheduler({
    projectRoot,
    limit: 20
  }, {
    store: controllerStore,
    routingStore: getRoutingStore(),
    designStore: getHermesDesignStore(),
    opportunityStore: getLoopOpportunityStore({ projectRoot }),
    allowAutoShadowMaterialization:
      controllerStore.persistence === "file"
  });

  return NextResponse.json({
    generatedAt: rollup.generatedAt,
    weekKey: rollup.weekKey,
    openCases: rollup.openCases,
    plans: rollup.plans,
    decisionsNeeded: rollup.decisionsNeeded,
    controller: { enqueue, scheduler: controller }
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
