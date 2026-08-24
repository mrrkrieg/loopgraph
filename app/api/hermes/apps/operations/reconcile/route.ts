import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { appOperationActionReconcileInputSchema } from "loopgraph/runtime";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

const MAX_APP_RECONCILIATION_BODY_BYTES = 16 * 1024;
const workloadReconciliationSchema = appOperationActionReconcileInputSchema.omit({
  projectRoot: true,
  workspaceId: true,
  companyId: true
}).strict();

/**
 * Narrow Hermes recovery boundary. It never calls a provider operation; it
 * asks Connector Broker for the durable result of the already-requested
 * idempotent commit and closes the App ledger only when that receipt matches.
 */
export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "hermes.app_operations");
  if (unauthorized) return unauthorized;
  try {
    const input = workloadReconciliationSchema.parse(await readBoundedJson(request));
    const result = await callLoopgraphAppTool("loopgraph_app_operation_action_reconcile", input);
    return NextResponse.json(result, {
      status: 200,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof ZodError
      ? "App action reconciliation is invalid. Only installation, App action, route job, agent, and call identities are accepted."
      : safeConnectorError(error, "App action reconciliation failed.");
    return NextResponse.json({ error: message }, {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }
}

async function readBoundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_APP_RECONCILIATION_BODY_BYTES) throw new Error("App action reconciliation exceeds 16 KiB.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_APP_RECONCILIATION_BODY_BYTES) throw new Error("App action reconciliation exceeds 16 KiB.");
  return JSON.parse(text) as unknown;
}
