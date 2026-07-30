import { NextResponse } from "next/server";
import {
  listHermesDesignTasks,
  startHermesDesignTask
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore
} from "../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const tasks = await listHermesDesignTasks(getActiveLoopgraphProjectRoot(), {
    sessionId,
    status: isTaskStatus(status) ? status : undefined
  }, getHermesDesignStore());
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!isRecord(body) || typeof body.sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const result = await startHermesDesignTask({
      projectRoot: getActiveLoopgraphProjectRoot(),
      sessionId: body.sessionId,
      department: stringValue(body.department),
      reason: reasonValue(body.reason),
      originProblemIds: stringArrayValue(body.originProblemIds),
      originOpportunityId: stringValue(body.originOpportunityId),
      requestedBy: stringValue(body.requestedBy) ?? "api",
      callbackUrl: stringValue(body.callbackUrl)
    }, { store: getHermesDesignStore() });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to start Hermes design task"
    }, { status: 400 });
  }
}

function reasonValue(value: unknown) {
  return value === "loop_opportunity" ||
    value === "unhandled_problem" ||
    value === "improvement" ||
    value === "user_requested"
    ? value
    : "user_requested";
}

function isTaskStatus(value?: string): value is
  | "queued"
  | "needs_input"
  | "awaiting_hermes"
  | "designing"
  | "needs_repair"
  | "completed"
  | "failed"
  | "cancelled" {
  return Boolean(value && [
    "queued",
    "needs_input",
    "awaiting_hermes",
    "designing",
    "needs_repair",
    "completed",
    "failed",
    "cancelled"
  ].includes(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
