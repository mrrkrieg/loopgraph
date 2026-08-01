import { NextResponse } from "next/server";
import { hermesExecutionEventSchema } from "loopgraph/core";
import { ingestHermesExecutionEvent } from "loopgraph/runtime";
import {
  getHermesOperationsStore,
  getRoutingStore,
  getStorageAdapter
} from "../../../../../lib/loopgraph-runtime/storage-resolver";
import { verifyHermesMachineRequest } from "../../../../../lib/loopgraph-runtime/hermes-machine-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const verified = await verifyHermesMachineRequest(request, "hermes.execution_events");
  if (verified.response) return verified.response;
  try {
    const event = hermesExecutionEventSchema.parse(verified.body);
    const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
    if (organizationId && event.organizationId !== organizationId) {
      return NextResponse.json({ error: "Execution event organization does not match the hosted runtime" }, { status: 403 });
    }
    const result = await ingestHermesExecutionEvent({
      event,
      operationsStore: getHermesOperationsStore(),
      routingStore: getRoutingStore(),
      storage: getStorageAdapter()
    });
    return NextResponse.json({
      accepted: true,
      duplicate: !result.created,
      eventId: result.event.id,
      routeJobId: result.job.id,
      runId: result.trace.id,
      status: result.job.status
    }, { status: result.created ? 202 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    const status = code?.includes("NOT_FOUND") ? 404 : code?.includes("MISMATCH") || code?.includes("CONFLICT") ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Hermes execution event failed" }, { status });
  }
}
