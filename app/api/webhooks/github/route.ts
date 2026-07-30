import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isHostedAuthRequired } from "@/lib/auth/hosted-config";
import { authorizeVerifiedHostedMachineRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";
import { emitOperationalLog } from "../../../../lib/observability/operational-log";

function verifyGithubSignature(payload: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  const expected = `sha256=${digest}`;
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const suppliedDeliveryId = request.headers.get("x-github-delivery");
  const deliveryId = suppliedDeliveryId ?? randomUUID();
  const hermesWebhookUrl =
    process.env.LOOPGRAPH_HERMES_WEBHOOK_URL ??
    process.env.HERMES_WEBHOOK_URL;

  if (!hermesWebhookUrl) {
    return NextResponse.json({
      ok: false,
      error: "Direct Loopgraph provider webhooks are disabled. Configure this GitHub webhook to point at Hermes, or set HERMES_WEBHOOK_URL as a temporary compatibility forwarder.",
      deliveryId
    }, { status: 410 });
  }
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({
      ok: false,
      error: "GITHUB_WEBHOOK_SECRET is required before the GitHub compatibility forwarder can be enabled.",
      deliveryId
    }, { status: 503 });
  }
  if (!verifyGithubSignature(rawBody, signature, secret)) {
    emitOperationalLog({
      level: "warn",
      event: "provider.github.denied",
      outcome: "denied",
      organizationId: process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID,
      projectKey: process.env.LOOPGRAPH_HOSTED_PROJECT_KEY ?? "default",
      requestId: deliveryId,
      reason: "invalid_signature"
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (isHostedAuthRequired() && !suppliedDeliveryId) {
    return NextResponse.json({ error: "x-github-delivery is required in hosted mode" }, {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }
  const guardResponse = await authorizeVerifiedHostedMachineRequest({
    capability: "provider.github_forward",
    credentialEnvironmentVariable: "LOOPGRAPH_GITHUB_WEBHOOK_CREDENTIAL_ID",
    requestId: `github_${digest(deliveryId).slice(0, 32)}`,
    requestHash: digest(rawBody),
    requestedAt: new Date().toISOString(),
    rateLimit: positiveInteger(
      process.env.LOOPGRAPH_GITHUB_WEBHOOK_RATE_LIMIT_PER_MINUTE,
      120
    )
  });
  if (guardResponse) return guardResponse;

  try {
    const hermesResponse = await fetch(hermesWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
        "x-loopgraph-compat-source": "github",
        "x-loopgraph-source-route": "github.compat",
        "x-github-delivery": deliveryId,
        ...(request.headers.get("x-github-event") ? { "x-github-event": request.headers.get("x-github-event")! } : {}),
        ...(signature ? { "x-hub-signature-256": signature } : {})
      },
      body: rawBody
    });

    return NextResponse.json({
      ok: true,
      forwardedToHermes: true,
      deliveryId,
      hermesStatus: hermesResponse.status
    }, { status: hermesResponse.ok ? 202 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to forward webhook to Hermes",
      deliveryId
    }, { status: 502 });
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
