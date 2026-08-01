import { NextResponse } from "next/server";
import {
  cancelRouteJob,
  retryRouteJob
} from "loopgraph/runtime";
import { getRoutingStore } from "../../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeWorkerApiRequest } from "../../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const unauthorized = await authorizeWorkerApiRequest(request, "routing.jobs");
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json() as Record<string, unknown>;
    const { jobId } = await context.params;
    const action = body.action;
    const reason = requiredString(body.reason, "reason");
    const actor = requiredString(body.actor, "actor");
    const store = getRoutingStore();
    const job = action === "retry"
      ? await retryRouteJob({
          store,
          jobId,
          reason,
          requestedBy: actor
        })
      : action === "cancel"
        ? await cancelRouteJob({
            store,
            jobId,
            reason,
            cancelledBy: actor
          })
        : undefined;
    if (!job) {
      return NextResponse.json({ error: "action must be retry or cancel" }, { status: 400 });
    }
    return NextResponse.json({ action, job });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to update route job"
    }, { status: 400 });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}
