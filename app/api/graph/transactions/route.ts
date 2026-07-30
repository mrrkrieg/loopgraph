import { NextResponse } from "next/server";
import {
  callLoopgraphSemanticGraphTool,
  type LoopgraphSemanticGraphToolName
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeBearerApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

const GRAPH_ACTION_TO_TOOL = {
  decide: "loopgraph_graph_change_decide",
  apply: "loopgraph_graph_change_apply",
  history: "loopgraph_graph_history_get",
  promotion_rehearse: "loopgraph_promotion_rehearsal_run",
  promotion_rehearsals_get: "loopgraph_promotion_rehearsals_get",
  promotion_approve: "loopgraph_loop_promotion_approve",
  promote: "loopgraph_loop_promote",
  lifecycle_approve: "loopgraph_loop_lifecycle_approve",
  lifecycle_set: "loopgraph_loop_lifecycle_set",
  rollback_approve: "loopgraph_graph_rollback_approve",
  rollback: "loopgraph_graph_rollback"
} as const satisfies Record<string, LoopgraphSemanticGraphToolName>;

export async function GET(request: Request) {
  const unauthorized = authorizeGraphTransactionRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const url = new URL(request.url);
    const result = await callLoopgraphSemanticGraphTool("loopgraph_graph_history_get", {
      projectRoot: getActiveLoopgraphProjectRoot(),
      transactionId: queryValue(url, "transactionId"),
      snapshotId: queryValue(url, "snapshotId"),
      approvalReceiptId: queryValue(url, "approvalReceiptId"),
      promotionReceiptId: queryValue(url, "promotionReceiptId"),
      rehearsalReportId: queryValue(url, "rehearsalReportId"),
      changeSetId: queryValue(url, "changeSetId"),
      loopId: queryValue(url, "loopId")
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = authorizeGraphTransactionRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await requiredJson(request);
    const action = stringValue(body.action);
    if (!action || !(action in GRAPH_ACTION_TO_TOOL)) {
      throw new Error(`action must be one of: ${Object.keys(GRAPH_ACTION_TO_TOOL).join(", ")}`);
    }
    const argumentsWithoutBinding = { ...body };
    delete argumentsWithoutBinding.action;
    delete argumentsWithoutBinding.projectRoot;
    const toolName = GRAPH_ACTION_TO_TOOL[action as keyof typeof GRAPH_ACTION_TO_TOOL];
    const result = await callLoopgraphSemanticGraphTool(toolName, {
      ...argumentsWithoutBinding,
      projectRoot: getActiveLoopgraphProjectRoot()
    });
    return NextResponse.json(result, {
      status: action === "history" || action === "promotion_rehearsals_get" ? 200 : 202,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function authorizeGraphTransactionRequest(request: Request) {
  return authorizeBearerApiRequest(
    request,
    "LOOPGRAPH_WORKER_API_TOKEN",
    "semantic graph transaction HTTP API"
  );
}

async function requiredJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw.trim()) throw new Error("Request body must be a JSON object.");
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function queryValue(url: URL, key: string): string | undefined {
  return stringValue(url.searchParams.get(key));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Failed to operate the semantic graph"
  }, {
    status: 400,
    headers: { "cache-control": "no-store" }
  });
}
