import { NextResponse } from "next/server";
import {
  reconcileConnectionsAndMeasurements,
  scheduleDueMeasurements
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getHermesRouteActivationStore,
  getMeasurementStore
} from "../../../../lib/loopgraph-runtime/storage-resolver";
import { isHostedAuthRequired } from "../../../../lib/auth/hosted-config";
import { createHostedHermesRouteActivationAuthorityProvider } from "../../../../lib/loopgraph-runtime/hosted-hermes-route-authority";
import { authorizeCronApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.measurements");
  if (unauthorized) return unauthorized;
  try {
    const projectRoot = getActiveLoopgraphProjectRoot();
    const now = new Date();
    const workspaceId = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    const measurementStore = getMeasurementStore({ projectRoot });
    const routeActivationStore = getHermesRouteActivationStore({ projectRoot, workspaceId });
    const routeActivationAuthorityProvider = isHostedAuthRequired()
      ? createHostedHermesRouteActivationAuthorityProvider({ projectRoot, workspaceId })
      : undefined;
    const schedule = await scheduleDueMeasurements({ projectRoot, now }, { store: measurementStore });
    const reconciliation = await reconcileConnectionsAndMeasurements(
      { projectRoot, now },
      { store: measurementStore, routeActivationStore, routeActivationAuthorityProvider }
    );
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
