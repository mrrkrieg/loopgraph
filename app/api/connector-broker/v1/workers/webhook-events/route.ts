import { NextResponse } from "next/server";
import { providerIdSchema } from "loopgraph/core";
import {
  AmbientWorkloadTokenProvider,
  normalizeProviderEvent,
  providerWebhookVerificationReceiptSchema,
  ProviderWebhookVerifier
} from "loopgraph/runtime";
import { authorizeCronApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { getConnectorBrokerRuntime, getWebhookReceiptSigningKey } from "@/lib/connector-broker/runtime";

export const runtime = "nodejs";

async function run(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.connector_webhooks");
  if (unauthorized) return unauthorized;
  const database = createSupabaseAdminClient();
  if (!database) return NextResponse.json({ error: "Webhook inbox storage is unavailable" }, { status: 503 });
  const { data, error } = await database.rpc("claim_provider_webhook_inbox", { p_limit: 20, p_lease_seconds: 90 });
  if (error) return NextResponse.json({ error: "Webhook inbox worker is unavailable" }, { status: 503 });
  const signingKey = await getWebhookReceiptSigningKey();
  const runtime = getConnectorBrokerRuntime();
  const verifier = new ProviderWebhookVerifier({
    replay: runtime.store,
    receiptSigningKey: signingKey.reveal(),
    receiptKeyId: process.env.LOOPGRAPH_WEBHOOK_RECEIPT_KEY_ID ?? "connector-broker-primary"
  });
  signingKey.dispose();
  let forwarded = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const row of data ?? []) {
    const provider = providerIdSchema.safeParse(row.provider_id);
    const receipt = providerWebhookVerificationReceiptSchema.safeParse(row.verification_receipt);
    const rawBody = decodeBody(row.raw_body_base64);
    try {
      if (!provider.success || !receipt.success || !rawBody || !verifier.verifyReceipt(receipt.data, rawBody)) {
        throw new WebhookInboxError("verification_receipt_invalid", false);
      }
      const installation = await runtime.store.getInstallation({
        organizationId: String(row.organization_id),
        projectKey: String(row.project_key),
        installationId: String(row.installation_id)
      });
      if (!installation || installation.status !== "active" || installation.webhookStatus !== "active") {
        throw new WebhookInboxError("installation_inactive", false);
      }
      const event = normalizeProviderEvent({
        providerId: provider.data,
        workspaceId: installation.tenant.projectKey,
        companyId: installation.tenant.organizationId,
        sourceRoute: `connector-broker/${provider.data}/${installation.id}`,
        deliveryId: receipt.data.deliveryId,
        receivedAt: receipt.data.verifiedAt,
        signatureVerified: true,
        signer: receipt.data.signer
      }, JSON.parse(rawBody) as unknown);
      await forwardToHermes(event, receipt.data);
      const forwardedAt = new Date().toISOString();
      const { error: updateError } = await database.from("provider_webhook_inbox").update({
        status: "forwarded",
        forwarded_at: forwardedAt,
        leased_until: forwardedAt,
        last_error_code: null
      }).eq("id", row.id).eq("status", "leased");
      if (updateError) throw updateError;
      await runtime.store.markWebhookDelivery({
        organizationId: installation.tenant.organizationId,
        projectKey: installation.tenant.projectKey,
        installationId: installation.id,
        providerId: provider.data,
        deliveryId: receipt.data.deliveryId,
        status: "forwarded"
      });
      forwarded += 1;
    } catch (caught) {
      const terminal = caught instanceof WebhookInboxError && !caught.retryable || Number(row.attempt_count) >= 10;
      const delaySeconds = Math.min(15 * 2 ** Math.max(Number(row.attempt_count) - 1, 0), 3600);
      await database.from("provider_webhook_inbox").update({
        status: terminal ? "dead_letter" : "queued",
        available_at: new Date(Date.now() + delaySeconds * 1_000).toISOString(),
        leased_until: null,
        last_error_code: caught instanceof WebhookInboxError ? caught.code : "hermes_forward_failed"
      }).eq("id", row.id).eq("status", "leased");
      if (terminal && provider.success && receipt.success) {
        await runtime.store.markWebhookDelivery({
          organizationId: String(row.organization_id),
          projectKey: String(row.project_key),
          installationId: String(row.installation_id),
          providerId: provider.data,
          deliveryId: receipt.data.deliveryId,
          status: "failed",
          errorCode: caught instanceof WebhookInboxError ? caught.code : "hermes_forward_failed"
        }).catch(() => undefined);
        deadLettered += 1;
      } else {
        retried += 1;
      }
    }
  }
  return NextResponse.json({ claimed: (data ?? []).length, forwarded, retried, deadLettered }, {
    headers: { "cache-control": "no-store" }
  });
}

export const GET = run;
export const POST = run;

async function forwardToHermes(event: ReturnType<typeof normalizeProviderEvent>, receipt: ReturnType<typeof providerWebhookVerificationReceiptSchema.parse>) {
  const hermesUrl = process.env.HERMES_WEBHOOK_URL;
  const audience = process.env.LOOPGRAPH_HERMES_WEBHOOK_AUDIENCE;
  if (!hermesUrl || !audience) throw new WebhookInboxError("hermes_route_unconfigured", true);
  const target = new URL(hermesUrl);
  if ((process.env.NODE_ENV === "production" && target.protocol !== "https:") || target.username || target.password || target.search || target.hash) {
    throw new WebhookInboxError("hermes_route_untrusted", false);
  }
  const workloadToken = await new AmbientWorkloadTokenProvider().getToken({ audience });
  const response = await fetch(target, {
    method: "POST",
    headers: {
      authorization: `Bearer ${workloadToken}`,
      "content-type": "application/json",
      "x-loopgraph-webhook-verification-id": receipt.id,
      "x-loopgraph-correlation-id": event.id
    },
    body: JSON.stringify({ schemaVersion: "hermes-verified-provider-event/v1", event, verificationReceipt: receipt }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new WebhookInboxError(response.status === 429 ? "hermes_rate_limited" : "hermes_forward_failed", response.status === 429 || response.status >= 500);
}

function decodeBody(value: unknown) {
  if (typeof value !== "string" || value.length > 1_398_104) return undefined;
  const body = Buffer.from(value, "base64").toString("utf8");
  return Buffer.byteLength(body, "utf8") <= 1024 * 1024 ? body : undefined;
}

class WebhookInboxError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
  }
}
