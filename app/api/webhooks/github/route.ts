import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

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
  const deliveryId = request.headers.get("x-github-delivery") ?? randomUUID();
  const hermesWebhookUrl = process.env.HERMES_WEBHOOK_URL;

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
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

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
