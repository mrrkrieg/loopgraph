import { NextResponse } from "next/server";
import {
  callLoopgraphConnectionTool,
  callLoopgraphMeasurementTool,
  type LoopgraphConnectionToolName,
  type LoopgraphMeasurementToolName
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeWorkerApiRequest } from "../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

const measurementActions = {
  set_binding: "loopgraph_metric_bindings_set",
  get_bindings: "loopgraph_metric_bindings_get",
  schedule: "loopgraph_measurements_schedule",
  claim: "loopgraph_measurement_jobs_claim",
  complete: "loopgraph_measurement_jobs_complete",
  fail: "loopgraph_measurement_jobs_fail",
  get_jobs: "loopgraph_measurement_jobs_get",
  reconcile: "loopgraph_connections_reconcile",
  get_reconciliations: "loopgraph_connections_reconciliations_get"
} as const satisfies Record<string, LoopgraphMeasurementToolName>;

const connectionActions = {
  register_connection: "loopgraph_connections_register",
  report_connection_health: "loopgraph_connections_health_report",
  get_connections: "loopgraph_connections_get"
} as const satisfies Record<string, LoopgraphConnectionToolName>;

export async function GET(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "measurements.collect");
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "jobs";
  const input = {
    bindingId: optionalParam(url, "bindingId"),
    loopId: optionalParam(url, "loopId"),
    jobId: optionalParam(url, "jobId"),
    connectionInstanceId: optionalParam(url, "connectionInstanceId"),
    status: optionalParam(url, "status"),
    reportId: optionalParam(url, "reportId"),
    instanceId: optionalParam(url, "instanceId")
  };
  try {
    if (view === "bindings") return json(await callMeasurement("loopgraph_metric_bindings_get", input));
    if (view === "reconciliations") {
      return json(await callMeasurement("loopgraph_connections_reconciliations_get", input));
    }
    if (view === "connections") return json(await callConnection("loopgraph_connections_get", input));
    if (view === "jobs") return json(await callMeasurement("loopgraph_measurement_jobs_get", input));
    throw new Error("view must be bindings, jobs, connections, or reconciliations");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "measurements.collect");
  if (unauthorized) return unauthorized;
  try {
    const body = await requiredJson(request);
    const action = typeof body.action === "string" ? body.action : "";
    const input = { ...body };
    delete input.action;
    delete input.projectRoot;
    const measurementTool = measurementActions[action as keyof typeof measurementActions];
    if (measurementTool) return json(await callMeasurement(measurementTool, input), 202);
    const connectionTool = connectionActions[action as keyof typeof connectionActions];
    if (connectionTool) return json(await callConnection(connectionTool, input), 202);
    throw new Error(`Unsupported measurement action: ${action || "(missing)"}`);
  } catch (error) {
    return errorResponse(error);
  }
}

async function callMeasurement(name: LoopgraphMeasurementToolName, input: Record<string, unknown>) {
  const projectRoot = getActiveLoopgraphProjectRoot();
  return callLoopgraphMeasurementTool(name, { ...input, projectRoot }, { projectRoot });
}

async function callConnection(name: LoopgraphConnectionToolName, input: Record<string, unknown>) {
  const projectRoot = getActiveLoopgraphProjectRoot();
  return callLoopgraphConnectionTool(name, { ...input, projectRoot }, { projectRoot });
}

async function requiredJson(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json() as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function optionalParam(url: URL, key: string) {
  return url.searchParams.get(key) ?? undefined;
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

function errorResponse(error: unknown) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Measurement request failed"
  }, {
    status: 400,
    headers: { "cache-control": "no-store" }
  });
}
