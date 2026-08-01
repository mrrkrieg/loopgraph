import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { providerIdSchema, type ProviderId } from "../core";
import { z } from "zod";

export const providerWebhookVerificationReceiptSchema = z.object({
  schemaVersion: z.literal("provider-webhook-verification/v1"),
  id: z.string().min(8),
  providerId: providerIdSchema,
  installationId: z.string().min(1),
  deliveryId: z.string().min(1),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  signer: z.string().min(1),
  verifiedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  keyId: z.string().min(1),
  secretVersionId: z.string().regex(/^[a-f0-9]{16}$/).optional(),
  attestation: z.string().min(32)
});

export type ProviderWebhookVerificationReceipt = {
  schemaVersion: "provider-webhook-verification/v1";
  id: string;
  providerId: ProviderId;
  installationId: string;
  deliveryId: string;
  bodyHash: string;
  signer: string;
  verifiedAt: string;
  expiresAt: string;
  keyId: string;
  secretVersionId?: string;
  attestation: string;
};

export interface WebhookReplayStore {
  claim(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: ProviderId;
    deliveryId: string;
    bodyHash: string;
    expiresAt: string;
  }): Promise<boolean>;
}

export class ProviderWebhookVerifier {
  constructor(private readonly dependencies: {
    replay: WebhookReplayStore;
    receiptSigningKey: string;
    receiptKeyId: string;
    secretVersionId?: string;
    now?: () => Date;
  }) {
    if (dependencies.receiptSigningKey.length < 32) throw new Error("Webhook receipt signing key must contain at least 32 characters");
  }

  async verify(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: ProviderId;
    rawBody: string;
    headers: Headers | Record<string, string | undefined>;
    webhookSecret: string;
    requestMethod?: string;
    requestUrl?: string;
  }): Promise<ProviderWebhookVerificationReceipt> {
    if (Buffer.byteLength(input.rawBody, "utf8") > 1024 * 1024) throw new WebhookVerificationError("payload_too_large", 413);
    const headers = normalizeHeaders(input.headers);
    const now = this.now();
    const verification = verifyProviderSignature({ ...input, headers, now });
    if (!verification.verified) throw new WebhookVerificationError(verification.reason ?? "invalid_signature", 401);
    const bodyHash = hash(input.rawBody);
    const claimed = await this.dependencies.replay.claim({
      organizationId: input.organizationId,
      projectKey: input.projectKey,
      installationId: input.installationId,
      providerId: input.providerId,
      deliveryId: verification.deliveryId,
      bodyHash,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString()
    });
    if (!claimed) throw new WebhookVerificationError("replayed_delivery", 409);
    const unsigned = {
      schemaVersion: "provider-webhook-verification/v1" as const,
      id: `webhook_verification_${randomUUID()}`,
      providerId: input.providerId,
      installationId: input.installationId,
      deliveryId: verification.deliveryId,
      bodyHash,
      signer: verification.signer,
      verifiedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      keyId: this.dependencies.receiptKeyId,
      ...(this.dependencies.secretVersionId ? { secretVersionId: this.dependencies.secretVersionId } : {})
    };
    return { ...unsigned, attestation: signReceipt(unsigned, this.dependencies.receiptSigningKey) };
  }

  verifyReceipt(receipt: ProviderWebhookVerificationReceipt, rawBody: string) {
    if (receipt.bodyHash !== hash(rawBody) || Date.parse(receipt.expiresAt) < this.now().getTime()) return false;
    const { attestation, ...unsigned } = receipt;
    return constantTimeEqual(attestation, signReceipt(unsigned, this.dependencies.receiptSigningKey));
  }

  private now() {
    return this.dependencies.now?.() ?? new Date();
  }
}

export class WebhookVerificationError extends Error {
  constructor(readonly code: string, readonly status: 400 | 401 | 409 | 413) {
    super(`Provider webhook denied: ${code}`);
    this.name = "WebhookVerificationError";
  }
}

function verifyProviderSignature(input: {
  providerId: ProviderId;
  rawBody: string;
  headers: Record<string, string>;
  webhookSecret: string;
  requestMethod?: string;
  requestUrl?: string;
  now: Date;
}): { verified: boolean; deliveryId: string; signer: string; reason?: string } {
  const header = (name: string) => input.headers[name.toLowerCase()] ?? "";
  const timestampFresh = (value: string, seconds = 300) => {
    const milliseconds = /^\d{10}$/.test(value) ? Number(value) * 1_000 : Date.parse(value);
    return Number.isFinite(milliseconds) && Math.abs(input.now.getTime() - milliseconds) <= seconds * 1_000;
  };
  if (input.providerId === "github") {
    return result(
      constantTimeEqual(header("x-hub-signature-256"), `sha256=${hmacHex(input.webhookSecret, input.rawBody)}`),
      header("x-github-delivery"),
      "github:x-hub-signature-256"
    );
  }
  if (input.providerId === "slack") {
    const timestamp = header("x-slack-request-timestamp");
    if (!timestampFresh(timestamp)) return result(false, "", "slack:v0", "stale_timestamp");
    return result(
      constantTimeEqual(header("x-slack-signature"), `v0=${hmacHex(input.webhookSecret, `v0:${timestamp}:${input.rawBody}`)}`),
      header("x-slack-request-id") || hash(`${timestamp}:${input.rawBody}`),
      "slack:v0"
    );
  }
  if (input.providerId === "stripe") {
    const parts = Object.fromEntries(header("stripe-signature").split(",").map((part) => part.split("=", 2))) as Record<string, string>;
    if (!timestampFresh(parts.t ?? "")) return result(false, "", "stripe:v1", "stale_timestamp");
    return result(
      constantTimeEqual(parts.v1 ?? "", hmacHex(input.webhookSecret, `${parts.t}.${input.rawBody}`)),
      readJsonId(input.rawBody) || hash(`${parts.t}:${input.rawBody}`),
      "stripe:v1"
    );
  }
  if (input.providerId === "hubspot") {
    const timestamp = header("x-hubspot-request-timestamp");
    if (!timestampFresh(timestamp)) return result(false, "", "hubspot:v3", "stale_timestamp");
    if (!input.requestUrl) return result(false, "", "hubspot:v3", "request_url_required");
    const source = `${input.requestMethod ?? "POST"}${input.requestUrl}${input.rawBody}${timestamp}`;
    const digest = createHmac("sha256", input.webhookSecret).update(source).digest("base64");
    return result(
      constantTimeEqual(header("x-hubspot-signature-v3"), digest),
      header("x-hubspot-delivery-id") || hash(`${timestamp}:${input.rawBody}`),
      "hubspot:v3"
    );
  }
  if (input.providerId === "intercom") {
    return result(
      constantTimeEqual(
        header("x-hub-signature"),
        `sha1=${createHmac("sha1", input.webhookSecret).update(input.rawBody).digest("hex")}`
      ),
      header("x-intercom-delivery-id") || readJsonId(input.rawBody) || hash(input.rawBody),
      "intercom:hmac-sha1"
    );
  }
  if (input.providerId === "notion") {
    return result(
      constantTimeEqual(header("x-notion-signature"), `sha256=${hmacHex(input.webhookSecret, input.rawBody)}`),
      header("x-notion-delivery-id") || readJsonId(input.rawBody) || hash(input.rawBody),
      "notion:hmac-sha256"
    );
  }
  if (input.providerId === "zendesk") {
    const timestamp = header("x-zendesk-webhook-signature-timestamp");
    if (!timestampFresh(timestamp)) return result(false, "", "zendesk:hmac-sha256", "stale_timestamp");
    const digest = createHmac("sha256", input.webhookSecret).update(`${timestamp}${input.rawBody}`).digest("base64");
    return result(
      constantTimeEqual(header("x-zendesk-webhook-signature"), digest),
      header("x-zendesk-webhook-invocation-id") || hash(`${timestamp}:${input.rawBody}`),
      "zendesk:hmac-sha256"
    );
  }
  if (input.providerId === "greenhouse") {
    const signature = header("signature");
    return result(
      constantTimeEqual(signature, `sha256 ${hmacHex(input.webhookSecret, input.rawBody)}`),
      header("greenhouse-event-id") || hash(input.rawBody),
      "greenhouse:hmac-sha256"
    );
  }
  if (input.providerId === "quickbooks") {
    const digest = createHmac("sha256", input.webhookSecret).update(input.rawBody).digest("base64");
    return result(
      constantTimeEqual(header("intuit-signature"), digest),
      header("intuit-t-id") || hash(input.rawBody),
      "quickbooks:intuit-signature"
    );
  }
  return result(false, "", `${input.providerId}:unsupported`, "provider_signature_strategy_unimplemented");
}

function result(verified: boolean, deliveryId: string, signer: string, reason?: string) {
  return {
    verified: verified && deliveryId.length > 0,
    deliveryId,
    signer,
    reason: reason ?? (deliveryId.length === 0 ? "delivery_id_required" : verified ? undefined : "invalid_signature")
  };
}

function normalizeHeaders(headers: Headers | Record<string, string | undefined>) {
  const result: Record<string, string> = {};
  if (headers instanceof Headers) headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
  else for (const [key, value] of Object.entries(headers)) if (value !== undefined) result[key.toLowerCase()] = value;
  return result;
}

function hmacHex(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signReceipt(value: Omit<ProviderWebhookVerificationReceipt, "attestation">, secret: string) {
  return createHmac("sha256", secret).update(stableJson(value)).digest("base64url");
}

function stableJson(value: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function readJsonId(body: string) {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    return typeof value.id === "string" ? value.id : undefined;
  } catch {
    return undefined;
  }
}

export class InMemoryWebhookReplayStore implements WebhookReplayStore {
  private readonly deliveries = new Map<string, string>();

  async claim(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    providerId: ProviderId;
    deliveryId: string;
    bodyHash: string;
    expiresAt: string;
  }) {
    const key = `${input.organizationId}:${input.projectKey}:${input.installationId}:${input.providerId}:${input.deliveryId}`;
    if (this.deliveries.has(key)) return false;
    this.deliveries.set(key, input.bodyHash);
    return true;
  }
}
