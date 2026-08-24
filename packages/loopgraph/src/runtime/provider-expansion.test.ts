import { describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  buildCredentialNamespace,
  connectorBrokerRequestSchema,
  connectorInstallationAdminSchema,
  type ProviderId
} from "../core";
import { getProviderOperation } from "./connector-capabilities";
import { createProviderOperationHandlers } from "./provider-operation-handlers";
import { InMemoryWebhookReplayStore, ProviderWebhookVerifier } from "./provider-webhook-verifier";
import { SecretLease } from "./vault-adapters";

describe("App Platform provider expansion", () => {
  it("calls fixed Gmail endpoints and rejects an injected URL", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ id: "message-1", threadId: "thread-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("gmail:messages.send")!;
    await expect(handler(context("gmail", "messages.send", {
      to: "owner@example.com",
      subject: "Prepared follow-up",
      body: "Approved message",
      url: "https://attacker.example"
    }, JSON.stringify({ access_token: "gmail-access" })))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();

    await expect(handler(context("gmail", "messages.send", {
      to: "owner@example.com",
      subject: "Prepared follow-up",
      body: "Approved message"
    }, JSON.stringify({ access_token: "gmail-access" })))).resolves.toMatchObject({ delivered: true });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", redirect: "error" });
  });

  it("reads only a saved PostHog insight on a trusted PostHog host", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ id: 42, name: "Activation", result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("posthog:insights.query")!;
    await expect(handler(context("posthog", "insights.query", { insightId: "42" }, JSON.stringify({
      access_token: "posthog-personal-key",
      project_id: "1001",
      instance_url: "https://eu.posthog.com"
    })))).resolves.toMatchObject({ providerObjectRef: "posthog:project:1001:insight:42" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://eu.posthog.com/api/projects/1001/insights/42/");

    await expect(handler(context("posthog", "insights.query", { insightId: "42" }, JSON.stringify({
      access_token: "posthog-personal-key",
      project_id: "1001",
      instance_url: "https://attacker.example"
    })))).rejects.toMatchObject({ code: "provider_instance_untrusted" });
  });

  it("validates Microsoft Graph clientState and rejects a mismatched batch", async () => {
    const secret = "microsoft-graph-client-state-secret";
    const validBody = JSON.stringify({ value: [
      { subscriptionId: "sub-1", changeType: "created", clientState: secret, resourceData: { id: "message-1" } },
      { subscriptionId: "sub-2", changeType: "updated", clientState: secret, resourceData: { id: "message-2" } }
    ] });
    const verifier = new ProviderWebhookVerifier({
      replay: new InMemoryWebhookReplayStore(),
      receiptSigningKey: "receipt-signing-key-that-is-long-enough",
      receiptKeyId: "receipt-key-1"
    });
    await expect(verifier.verify({ organizationId: "org-1", projectKey: "main", installationId: "outlook-1", providerId: "outlook", rawBody: validBody, headers: {}, webhookSecret: secret }))
      .resolves.toMatchObject({ signer: "outlook:microsoft-graph-client-state" });

    const forgedBody = JSON.stringify({ value: [
      { subscriptionId: "sub-1", clientState: secret },
      { subscriptionId: "sub-2", clientState: "wrong-secret" }
    ] });
    await expect(verifier.verify({ organizationId: "org-1", projectKey: "main", installationId: "outlook-1", providerId: "outlook", rawBody: forgedBody, headers: {}, webhookSecret: secret }))
      .rejects.toMatchObject({ code: "invalid_client_state", status: 401 });
  });
});

function context(providerId: ProviderId, operation: string, input: Record<string, unknown>, secret: string) {
  const namespace = buildCredentialNamespace({ organizationId: "org-1", projectKey: "main", providerId, installationId: `${providerId}-1` });
  const installation = connectorInstallationAdminSchema.parse({
    id: `${providerId}-1`,
    tenant: { organizationId: "org-1", projectKey: "main" },
    providerId,
    displayName: providerId,
    environment: "production",
    status: "active",
    credentialRef: `vault://${namespace}/tokens/provider`,
    credentialNamespace: namespace,
    grantedScopes: [],
    allowedCapabilities: ["provider.data.read", "provider.draft.write", "provider.action.execute"],
    webhookStatus: "not_configured",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z"
  });
  const descriptor = getProviderOperation(providerId, operation);
  if (!descriptor) throw new Error(`Missing descriptor: ${providerId}:${operation}`);
  return {
    request: connectorBrokerRequestSchema.parse({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: "request-provider-expansion",
      idempotencyKey: "idempotency-provider-expansion",
      tenant: installation.tenant,
      actor: { type: "workload", subject: "hermes" },
      providerId,
      installationId: installation.id,
      capability: descriptor.capability,
      operation,
      input,
      issuedAt: "2026-08-10T00:00:00.000Z",
      expiresAt: "2026-08-10T00:05:00.000Z",
      correlationId: "correlation-provider-expansion"
    }),
    installation,
    descriptor,
    getCredential: async () => new SecretLease({ value: secret })
  };
}
