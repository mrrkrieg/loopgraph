import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  processHermesDesignCallback,
  verifyHermesCallbackSignature
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../../../lib/loopgraph-runtime/storage-resolver";
import { authorizeVerifiedHostedMachineRequest } from "../../../../../../lib/loopgraph-runtime/worker-api-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const secret =
    process.env.LOOPGRAPH_HERMES_CALLBACK_SECRET ??
    process.env.LOOPGRAPH_HERMES_TASK_SECRET;
  if (!secret) {
    return NextResponse.json({
      error: "Hermes callback verification is not configured"
    }, { status: 503 });
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-hermes-timestamp") ?? "";
  const signature = request.headers.get("x-hermes-signature") ?? "";
  if (!verifyHermesCallbackSignature({
    body: rawBody,
    timestamp,
    signature,
    secret
  })) {
    return NextResponse.json({ error: "Invalid Hermes callback signature" }, { status: 401 });
  }

  try {
    const callback = JSON.parse(rawBody) as Record<string, unknown>;
    const { taskId } = await context.params;
    if (callback.taskId !== taskId) {
      return NextResponse.json({ error: "Hermes callback taskId does not match route" }, { status: 400 });
    }
    const callbackId = typeof callback.callbackId === "string" ? callback.callbackId : "";
    if (!callbackId) {
      return NextResponse.json({ error: "Hermes callbackId is required" }, { status: 400 });
    }
    const guardResponse = await authorizeVerifiedHostedMachineRequest({
      capability: "hermes.design_callback",
      credentialEnvironmentVariable: "LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID",
      requestId: `hermes_${digest(callbackId).slice(0, 32)}`,
      requestHash: digest(rawBody),
      requestedAt: timestamp,
      rateLimit: positiveInteger(
        process.env.LOOPGRAPH_HERMES_CALLBACK_RATE_LIMIT_PER_MINUTE,
        60
      )
    });
    if (guardResponse) return guardResponse;
    const result = await processHermesDesignCallback({
      projectRoot: getActiveLoopgraphProjectRoot(),
      callback
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Invalid Hermes callback"
    }, { status: 400 });
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
