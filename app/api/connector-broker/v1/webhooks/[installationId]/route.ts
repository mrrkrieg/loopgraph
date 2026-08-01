import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { connectorInstallationHasExpectedNamespace, type ProviderId } from "loopgraph/core";
import { ProviderWebhookVerifier, WebhookVerificationError } from "loopgraph/runtime";
import { getConnectorBrokerRuntime, getWebhookReceiptSigningKey } from "@/lib/connector-broker/runtime";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  const { installationId } = await context.params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(installationId)) {
    return NextResponse.json({ error: "Unknown provider route" }, { status: 404 });
  }
  let claimedDelivery: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: ProviderId;
    deliveryId: string;
  } | undefined;
  try {
    const rawBody = await readBoundedRequestBody(request, 1024 * 1024);
    const broker = getConnectorBrokerRuntime();
    const installation = await broker.store.findInstallationGlobal({ installationId });
    if (!installation || !connectorInstallationHasExpectedNamespace(installation) || installation.status !== "active" || installation.webhookStatus !== "active" || !installation.webhookSecretRef) {
      return NextResponse.json({ error: "Provider webhook is not active" }, { status: 410, headers: { "cache-control": "no-store" } });
    }
    const providerId = installation.providerId;
    const receiptKey = await getWebhookReceiptSigningKey();
    let receipt;
    try {
      const signingKey = receiptKey.reveal();
      const references = [installation.webhookSecretRef, installation.webhookSecretPreviousRef]
        .filter((value, index, values): value is NonNullable<typeof value> => Boolean(value) && values.indexOf(value) === index);
      let lastVerificationError: WebhookVerificationError | undefined;
      for (const reference of references) {
        const webhookSecret = await broker.vault.resolve(reference, {
          ...installation.tenant,
          expectedNamespace: installation.credentialNamespace,
          customerManagedKeyRef: installation.customerManagedKeyRef
        });
        try {
          const verifier = new ProviderWebhookVerifier({
            replay: broker.store,
            receiptSigningKey: signingKey,
            receiptKeyId: process.env.LOOPGRAPH_WEBHOOK_RECEIPT_KEY_ID ?? "connector-broker-primary",
            secretVersionId: createHash("sha256").update(reference).digest("hex").slice(0, 16)
          });
          receipt = await verifier.verify({
            ...installation.tenant,
            installationId,
            providerId,
            rawBody,
            headers: request.headers,
            webhookSecret: webhookSecret.reveal(),
            requestMethod: request.method,
            requestUrl: request.url
          });
          break;
        } catch (error) {
          if (!(error instanceof WebhookVerificationError)) throw error;
          lastVerificationError = error;
        } finally {
          webhookSecret.dispose();
        }
      }
      if (!receipt) throw lastVerificationError ?? new WebhookVerificationError("invalid_signature", 401);
    } finally {
      receiptKey.dispose();
    }
    claimedDelivery = { ...installation.tenant, installationId, providerId, deliveryId: receipt.deliveryId };
    await broker.store.enqueueVerifiedWebhook({
      ...installation.tenant,
      installationId,
      providerId,
      deliveryId: receipt.deliveryId,
      rawBody,
      verificationReceipt: receipt as unknown as Record<string, unknown>
    });
    await broker.store.markWebhookDelivery({ ...claimedDelivery, status: "queued" });
    return NextResponse.json({ accepted: true, queued: true, deliveryId: receipt.deliveryId, verificationReceiptId: receipt.id }, {
      status: 202,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    if (claimedDelivery) {
      await getConnectorBrokerRuntime().store.markWebhookDelivery({
        ...claimedDelivery,
        status: "failed",
        errorCode: "durable_enqueue_failed"
      }).catch(() => undefined);
    }
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    const incidentId = createHash("sha256").update(`${installationId}:${Date.now()}`).digest("hex").slice(0, 16);
    return NextResponse.json({ error: "Provider webhook could not be accepted", incidentId }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

async function readBoundedRequestBody(request: Request, maximum: number) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new WebhookVerificationError("payload_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new WebhookVerificationError("payload_too_large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
