import { NextResponse } from "next/server";
import {
  enqueueLoopControllerTrigger,
  runLoopControllerScheduler
} from "loopgraph/runtime";
import { loopControllerTriggerTypeSchema } from "loopgraph/core";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore,
  getHermesDesignStore,
  getLoopControllerStore,
  getLoopOpportunityStore,
  getLoopSpecRegistryStore,
  getRoutingStore,
  getSemanticGraphStore
} from "../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeWorkerApiRequest } from "../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "controller.operate");
  if (unauthorized) return unauthorized;
  const projectRoot = getActiveLoopgraphProjectRoot();
  const store = getLoopControllerStore({ projectRoot });
  const [policy, checkpoint, runs, triggers] = await Promise.all([
    store.readPolicy(),
    store.readCheckpoint(),
    store.listRuns(),
    store.listTriggers()
  ]);
  return NextResponse.json({
    policy,
    checkpoint,
    runs,
    triggers
  }, {
    headers: { "cache-control": "no-store" }
  });
}

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "controller.operate");
  if (unauthorized) return unauthorized;
  try {
    const body = await optionalJson(request);
    const projectRoot = getActiveLoopgraphProjectRoot();
    const store = getLoopControllerStore({ projectRoot });
    const mode = stringValue(body.mode) ?? "run";
    if (!["enqueue", "drain", "run"].includes(mode)) {
      throw new Error("mode must be enqueue, drain, or run");
    }
    let enqueueResult;
    if (mode !== "drain") {
      const triggerType = loopControllerTriggerTypeSchema.parse(stringValue(body.triggerType) ?? "manual");
      const now = new Date();
      enqueueResult = await enqueueLoopControllerTrigger({
        projectRoot,
        type: triggerType,
        triggerId: stringValue(body.triggerId) ?? defaultTriggerId(triggerType, now),
        sourceRef: stringValue(body.sourceRef) ?? "loopgraph-controller-api",
        occurredAt: stringValue(body.occurredAt),
        requestedBy: stringValue(body.requestedBy) ?? "controller-api",
        evidenceRefs: stringArray(body.evidenceRefs)
      }, { now, store });
    }
    if (mode === "enqueue") {
      return NextResponse.json({ enqueue: enqueueResult }, { status: 202 });
    }
    const loopSpecStore = getLoopSpecRegistryStore({ projectRoot });
    const semanticGraphStore = getSemanticGraphStore({ projectRoot });
    const scheduler = await runLoopControllerScheduler({
      projectRoot,
      limit: integerValue(body.limit, 20, 1, 100),
      maxAttempts: integerValue(body.maxAttempts, 3, 1, 20),
      processingLeaseSeconds: integerValue(body.processingLeaseSeconds, 300, 30, 3600)
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
    return NextResponse.json({
      enqueue: enqueueResult,
      scheduler
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to operate the loop controller"
    }, { status: 400 });
  }
}

async function optionalJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`Expected an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function defaultTriggerId(type: string, now: Date) {
  return `${type}_${Math.floor(now.getTime() / (15 * 60 * 1000))}`;
}
