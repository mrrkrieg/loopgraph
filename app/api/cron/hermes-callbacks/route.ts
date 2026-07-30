import { NextResponse } from "next/server";
import { runHermesDesignCallbackWorker } from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore,
  getHermesDesignStore,
  getLoopSpecRegistryStore
} from "../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeCronApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeCronApiRequest(
    request,
    "schedule.hermes_callbacks"
  );
  if (unauthorized) return unauthorized;
  try {
    const result = await runHermesDesignCallbackWorker({
      projectRoot: getActiveLoopgraphProjectRoot(),
      store: getHermesDesignStore(),
      discoveryStore: getDiscoveryDesignStore(),
      loopSpecStore: getLoopSpecRegistryStore(),
      workerId: "hermes-callback-cron",
      limit: 25,
      leaseSeconds: 300
    });
    return NextResponse.json(result, {
      status: 202,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error
        ? error.message
        : "Failed to run the Hermes callback schedule"
    }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
