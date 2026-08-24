import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { appOperationInvokeInputSchema } from "loopgraph/runtime";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

const MAX_APP_OPERATION_BODY_BYTES = 128 * 1024;
const workloadInvocationSchema = appOperationInvokeInputSchema.omit({
  projectRoot: true,
  workspaceId: true,
  companyId: true
}).strict();

/**
 * Workload-authenticated bridge from a routed Hermes job to one installed App
 * capability. Provider identity, operation, connection, tenant, and company
 * object are intentionally absent from the public request contract.
 */
export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "hermes.app_operations");
  if (unauthorized) return unauthorized;
  try {
    const input = workloadInvocationSchema.parse(await readBoundedJson(request));
    const result = await callLoopgraphAppTool("loopgraph_app_operation_invoke", input);
    return NextResponse.json(result, {
      status: 200,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof ZodError
      ? "App operation request is invalid. Only installation, loop, capability, route job, agent, call, and bounded input are accepted."
      : safeConnectorError(error, "App operation invocation failed.");
    return NextResponse.json({ error: message }, {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }
}

async function readBoundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_APP_OPERATION_BODY_BYTES) {
    throw new Error("App operation request exceeds 128 KiB.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_APP_OPERATION_BODY_BYTES) {
    throw new Error("App operation request exceeds 128 KiB.");
  }
  return JSON.parse(text) as unknown;
}
