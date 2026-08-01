import { NextResponse } from "next/server";
import { runRouteJobWorker } from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getLoopControllerStore,
  getHermesOperationsStore,
  getLoopSpecRegistryStore,
  getRoutingStore,
  getStorageAdapter
} from "../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeWorkerApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "routing.worker");
  if (unauthorized) return unauthorized;

  try {
    const body = await optionalJson(request);
    const result = await runRouteJobWorker({
      projectRoot: getActiveLoopgraphProjectRoot(),
      workerId: stringValue(body.workerId),
      limit: integerValue(body.limit, 10, 1, 100),
      leaseSeconds: integerValue(body.leaseSeconds, 300, 30, 3600),
      store: getRoutingStore(),
      loopSpecStore: getLoopSpecRegistryStore(),
      controllerStore: getLoopControllerStore(),
      storage: getStorageAdapter(),
      operationsStore: getHermesOperationsStore()
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to run the route-job worker"
    }, { status: 400 });
  }
}

async function optionalJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`Expected an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}
