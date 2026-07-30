import { NextRequest, NextResponse } from "next/server";
import { generateAndPersistManagementRollup } from "@/lib/loopgraph-runtime/management-rollup";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore,
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
  const enqueue = await enqueueLoopControllerTrigger({
    projectRoot,
    type: "management_cycle",
    triggerId: `management-review-${rollup.weekKey}`,
    sourceRef: `management-rollup:${rollup.weekKey}`,
    occurredAt: rollup.generatedAt,
    requestedBy: "loopgraph-management-cron"
  });
  const controller = await runLoopControllerScheduler({
    projectRoot,
    limit: 20
  }, {
    routingStore: getRoutingStore(),
    designStore: getHermesDesignStore()
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
