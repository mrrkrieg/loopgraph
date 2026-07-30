import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createHermesDesignCallbackJob,
  runHermesDesignCallbackWorker,
  verifyHermesCallbackSignature
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore
} from "../../../../../../lib/loopgraph-runtime/storage-resolver";
import { prepareVerifiedHostedMachineRequest } from "../../../../../../lib/loopgraph-runtime/worker-api-auth";
import { emitOperationalLog } from "../../../../../../lib/observability/operational-log";

const MAX_CALLBACK_BODY_BYTES = 1024 * 1024;

export const runtime = "nodejs";

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
  if (Buffer.byteLength(rawBody, "utf8") > MAX_CALLBACK_BODY_BYTES) {
    return NextResponse.json({ error: "Hermes callback body exceeds 1 MiB." }, {
      status: 413,
      headers: { "cache-control": "no-store" }
    });
  }
  const timestamp = request.headers.get("x-hermes-timestamp") ?? "";
  const signature = request.headers.get("x-hermes-signature") ?? "";
  if (!verifyHermesCallbackSignature({
    body: rawBody,
    timestamp,
    signature,
    secret
  })) {
    emitOperationalLog({
      level: "warn",
      event: "hermes.callback.denied",
      outcome: "denied",
      organizationId: process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID,
      projectKey: process.env.LOOPGRAPH_HOSTED_PROJECT_KEY ?? "default",
      reason: "invalid_signature"
    });
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
    const requestHash = digest(rawBody);
    const prepared = prepareVerifiedHostedMachineRequest({
      capability: "hermes.design_callback",
      credentialEnvironmentVariable: "LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID",
      requestId: `hermes_${digest(callbackId).slice(0, 32)}`,
      requestHash,
      requestedAt: timestamp,
      rateLimit: positiveInteger(
        process.env.LOOPGRAPH_HERMES_CALLBACK_RATE_LIMIT_PER_MINUTE,
        60
      )
    });
    if (prepared.response) return prepared.response;

    const now = new Date();
    const job = createHermesDesignCallbackJob({
      callback,
      requestHash,
      now
    });
    let acceptance;
    let store;
    try {
      store = getHermesDesignStore();
      acceptance = await store.acceptCallbackJobAtomically({
        job,
        ...(prepared.context
          ? {
              machineRequest: {
                ...prepared.context,
                capability: "hermes.design_callback" as const
              }
            }
          : {})
      });
    } catch (error) {
      if (prepared.context) {
        emitOperationalLog({
          level: "error",
          event: "hermes.callback.inbox_unavailable",
          outcome: "error",
          capability: "hermes.design_callback",
          credentialId: prepared.context.credentialId,
          organizationId: prepared.context.organizationId,
          projectKey: prepared.context.projectKey,
          requestId: prepared.context.requestId,
          correlationId: prepared.context.requestId,
          reason: "callback_acceptance_failed"
        });
        return NextResponse.json({
          error: error instanceof Error
            ? error.message
            : "Hermes callback inbox is unavailable"
        }, {
          status: 503,
          headers: { "cache-control": "no-store" }
        });
      }
      throw error;
    }
    if (!acceptance.authorized || !acceptance.job) {
      const rateLimited = acceptance.reason === "rate_limited";
      emitOperationalLog({
        level: "warn",
        event: "hermes.callback.denied",
        outcome: "denied",
        capability: "hermes.design_callback",
        credentialId: prepared.context?.credentialId,
        organizationId: prepared.context?.organizationId,
        projectKey: prepared.context?.projectKey,
        requestId: prepared.context?.requestId,
        correlationId: prepared.context?.requestId,
        reason: acceptance.reason
      });
      return NextResponse.json({ error: acceptance.reason }, {
        status: rateLimited ? 429 : 409,
        headers: {
          "cache-control": "no-store",
          ...(rateLimited && acceptance.retryAfterSeconds
            ? { "retry-after": String(acceptance.retryAfterSeconds) }
            : {})
        }
      });
    }

    emitOperationalLog({
      level: "info",
      event: "hermes.callback.queued",
      outcome: "accepted",
      capability: "hermes.design_callback",
      credentialId: prepared.context?.credentialId,
      organizationId: prepared.context?.organizationId,
      projectKey: prepared.context?.projectKey,
      requestId: prepared.context?.requestId,
      correlationId: prepared.context?.requestId,
      reason: acceptance.reason,
      metadata: {
        resourceType: "hermes_design_callback_job",
        resourceId: acceptance.job.id
      }
    });

    if (prepared.context) {
      return NextResponse.json({
        accepted: true,
        duplicate: !acceptance.created,
        callbackJob: acceptance.job
      }, {
        status: acceptance.created ? 202 : 200,
        headers: { "cache-control": "no-store" }
      });
    }

    const projectRoot = getActiveLoopgraphProjectRoot();
    const worker = await runHermesDesignCallbackWorker({
      projectRoot,
      store,
      workerId: "hermes-callback-local",
      limit: 100,
      leaseSeconds: 300,
      now
    });
    return NextResponse.json({
      accepted: true,
      duplicate: !acceptance.created,
      callbackJob:
        await store.getCallbackJob(acceptance.job.id) ?? acceptance.job,
      processing: worker.items.find((item) => item.jobId === acceptance.job?.id)
    }, {
      status: acceptance.created ? 202 : 200,
      headers: { "cache-control": "no-store" }
    });
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
