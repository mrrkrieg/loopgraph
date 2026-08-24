import { NextResponse } from "next/server";
import type { AppOperationActionReconciliationResult } from "loopgraph/core";
import { runAppActionReconciliationWorker } from "loopgraph/runtime";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
import {
  getActiveLoopgraphProjectRoot,
  getAppOperationActionStore
} from "@/lib/loopgraph-runtime/storage-resolver";
import { authorizeCronApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.app_action_reconciliation");
  if (unauthorized) return unauthorized;
  try {
    const projectRoot = getActiveLoopgraphProjectRoot();
    const workspaceId = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    const result = await runAppActionReconciliationWorker({
      actionStore: getAppOperationActionStore({ projectRoot, workspaceId }),
      workspaceId,
      limit: 25,
      minimumAgeMs: 60_000,
      reconcile: (input) => callLoopgraphAppTool(
        "loopgraph_app_operation_action_reconcile",
        input,
        { projectRoot }
      ) as Promise<AppOperationActionReconciliationResult>
    });
    return NextResponse.json(result, {
      status: 202,
      headers: { "cache-control": "no-store" }
    });
  } catch {
    return NextResponse.json({
      error: "App action reconciliation is temporarily unavailable"
    }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
