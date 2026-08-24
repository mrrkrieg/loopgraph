import { NextResponse } from "next/server";
import { loadEventRoutingOperations, routingOperationsQueryFromUrl } from "loopgraph/runtime";
import { isHostedAuthRequired } from "../../../../lib/auth/hosted-config";
import { createHostedHermesRouteActivationAuthorityProvider } from "../../../../lib/loopgraph-runtime/hosted-hermes-route-authority";
import {
  getActiveLoopgraphProjectRoot,
  getHermesRouteActivationStore,
  getLoopSpecRegistryStore,
  getRoutingStore
} from "../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(request: Request) {
  try {
    const query = routingOperationsQueryFromUrl(new URL(request.url));
    const projectRoot = getBrowserProjectRoot();
    const workspaceId = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    const hosted = isHostedAuthRequired();
    const model = await loadEventRoutingOperations({
      projectRoot,
      store: getRoutingStore(),
      loopSpecStore: getLoopSpecRegistryStore({ projectRoot }),
      ...(hosted ? {
        routeActivationStore: getHermesRouteActivationStore({ projectRoot, workspaceId }),
        routeActivationAuthorityProvider: createHostedHermesRouteActivationAuthorityProvider({
          projectRoot,
          workspaceId
        })
      } : {}),
      ...query
    });

    return NextResponse.json({
      ok: true,
      model
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load Hermes routing operations"
    }, { status: 400 });
  }
}

function getBrowserProjectRoot(): string {
  return getActiveLoopgraphProjectRoot();
}
