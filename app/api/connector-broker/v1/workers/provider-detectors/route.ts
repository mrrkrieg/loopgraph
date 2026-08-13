import { NextResponse } from "next/server";
import {
  AmbientWorkloadTokenProvider,
  HttpHermesProviderDetectorForwarder,
  ProviderDetectorScheduler
} from "loopgraph/runtime";
import { getConnectorBrokerRuntime, getWebhookReceiptSigningKey } from "@/lib/connector-broker/runtime";
import { authorizeCronApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

async function run(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.connector_detectors");
  if (unauthorized) return unauthorized;
  const hermesUrl = process.env.HERMES_WEBHOOK_URL;
  const audience = process.env.LOOPGRAPH_HERMES_WEBHOOK_AUDIENCE;
  if (!hermesUrl || !audience) {
    return NextResponse.json({ error: "Hermes detector forwarding is unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
  let signingKey: Awaited<ReturnType<typeof getWebhookReceiptSigningKey>> | undefined;
  try {
    const connectorRuntime = getConnectorBrokerRuntime();
    signingKey = await getWebhookReceiptSigningKey();
    const scheduler = new ProviderDetectorScheduler({
      store: connectorRuntime.store,
      broker: connectorRuntime.broker,
      forwarder: new HttpHermesProviderDetectorForwarder({
        url: hermesUrl,
        audience,
        tokenProvider: new AmbientWorkloadTokenProvider()
      }),
      receiptSigningKey: signingKey.reveal(),
      receiptKeyId: process.env.LOOPGRAPH_WEBHOOK_RECEIPT_KEY_ID ?? "connector-broker-primary"
    });
    const summary = await scheduler.run({ limit: 5, leaseSeconds: 300 });
    return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Provider detector worker is unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  } finally {
    signingKey?.dispose();
  }
}

export const GET = run;
export const POST = run;
