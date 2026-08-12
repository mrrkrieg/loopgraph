import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  buildCredentialNamespace,
  connectorBrokerRequestSchema,
  connectorInstallationAdminSchema,
  connectorInstallationViewSchema,
  credentialReferenceMatchesNamespace,
  credentialReferenceSchema,
  deriveCredentialChildReference,
  type ConnectorInstallationAdmin
} from "../core";
import { HermesConnectorBroker, InMemoryConnectorState, operationKey } from "./connector-broker";
import { PROVIDER_OPERATION_CATALOG } from "./connector-capabilities";
import { createProviderOperationHandlers } from "./provider-operation-handlers";
import { OAuthLifecycleService, type OAuthLifecycleStore, type OAuthTransaction } from "./oauth-lifecycle";
import { ProviderSubscriptionService } from "./provider-subscriptions";
import { deriveJiraWebhookCallbackBinding, InMemoryWebhookReplayStore, ProviderWebhookVerifier } from "./provider-webhook-verifier";
import { assertSecretFree, containsSecretMaterial, redactSensitive } from "./secret-redaction";
import { CompositeVault, GcpSecretManagerAdapter, type SecretResolutionContext, type VaultAdapter } from "./vault-adapters";
import { WorkloadIdentityVerifier } from "./workload-identity";

describe("enterprise connector security boundary", () => {
  it("accepts only opaque tenant-namespaced credential references", () => {
    const namespace = buildCredentialNamespace({
      organizationId: "org-1",
      projectKey: "main",
      providerId: "github",
      installationId: "provider-1"
    });
    const installation = connectorInstallationAdminSchema.parse({
      id: "provider-1",
      tenant: { organizationId: "org-1", projectKey: "main" },
      providerId: "github",
      displayName: "Production GitHub",
      status: "active",
      credentialRef: `vault://${namespace}/tokens/provider`,
      credentialNamespace: namespace,
      grantedScopes: ["contents:read"],
      allowedCapabilities: ["provider.health.read"],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    expect(installation.webhookStatus).toBe("not_configured");
    const browserView = connectorInstallationViewSchema.parse({
      ...installation,
      customerManagedKeyConfigured: false
    });
    expect(JSON.stringify(browserView)).not.toMatch(/credentialRef|credentialNamespace|webhookSecret(?:Previous)?Ref|customerManagedKeyRef/);
    const rawToken = ["ghp", "this_is_a_raw_token_not_a_reference"].join("_");
    expect(() => connectorInstallationAdminSchema.parse({ ...installation, credentialRef: rawToken })).toThrow();
    expect(() => credentialReferenceSchema.parse(`vault://${namespace}/../other-tenant/secret`)).toThrow();
    expect(credentialReferenceMatchesNamespace(
      `vault://organizations/org-10/projects/main/providers/github/installations/provider-1/token`,
      namespace
    )).toBe(false);
    expect(deriveCredentialChildReference(
      "gcp-sm://projects/demo/secrets/0123456789abcdef01234567",
      "oauth/verifier"
    )).toMatch(/^gcp-sm:\/\/projects\/demo\/secrets\/0123456789abcdef01234567--[a-f0-9]{16}$/);
    expect(deriveCredentialChildReference(
      "azure-kv://company-vault/0123456789abcdef01234567",
      "webhooks/signing"
    )).toMatch(/^azure-kv:\/\/company-vault\/0123456789abcdef01234567--[a-f0-9]{16}$/);
  });

  it("redacts known tokens recursively and rejects secret-bearing output", () => {
    const input = {
      safe: "ok",
      nested: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz", note: "token=abcdefghijklmno" },
      github: ["ghp", "abcdefghijklmnopqrstuvwxyz123456"].join("_")
    };
    expect(redactSensitive(input)).toEqual({
      safe: "ok",
      nested: { authorization: "[REDACTED]", note: "token=[REDACTED]" },
      github: "[REDACTED]"
    });
    expect(containsSecretMaterial(input)).toBe(true);
    expect(() => assertSecretFree(input, "test")).toThrow(/Secret-like material was blocked/);
  });

  it("ships a fixed handler for every provider data, draft, and action operation", () => {
    const handlers = createProviderOperationHandlers();
    for (const descriptor of PROVIDER_OPERATION_CATALOG.filter((item) =>
      ["provider.data.read", "provider.draft.write", "provider.action.execute", "provider.health.read"].includes(item.capability)
    )) {
      expect(handlers.has(operationKey(descriptor.providerId, descriptor.operation)), `${descriptor.providerId}:${descriptor.operation}`).toBe(true);
    }
    expect([...handlers.keys()]).not.toContain("http.request");
    expect([...handlers.keys()]).not.toContain("provider.raw_api");
  });

  it("enforces capability, scope, fixed operation, no arbitrary HTTP, and idempotency", async () => {
    const state = new InMemoryConnectorState();
    const installation = installationFixture();
    await state.save(installation);
    const vault = new CompositeVault([new MemoryVault([[installation.credentialRef, "opaque-token"]])]);
    const handler = vi.fn(async (context) => {
      const lease = await context.getCredential();
      expect(lease.reveal()).toBe("opaque-token");
      expect(() => JSON.stringify(lease)).toThrow(/cannot be serialized/);
      lease.dispose();
      return { status: "connected", providerReachable: true };
    });
    const broker = new HermesConnectorBroker({
      installations: state,
      idempotency: state,
      audit: state,
      vault,
      handlers: new Map([[operationKey("github", "health.check"), handler]]),
      now: () => new Date("2026-08-01T00:00:10.000Z")
    });
    const request = requestFixture();
    const first = await broker.execute(request);
    const duplicate = await broker.execute(request);
    expect(first.status).toBe("succeeded");
    expect(duplicate).toEqual(first);
    expect(handler).toHaveBeenCalledTimes(1);
    const actorConflict = await broker.execute({
      ...request,
      requestId: "request_changed_actor",
      actor: { type: "workload", subject: "spiffe://example/other-agent" }
    });
    expect(actorConflict.error?.code).toBe("idempotency_conflict");
    const idempotencyConflict = await broker.execute({
      ...request,
      requestId: "request_changed_payload",
      input: { check: "different" }
    });
    expect(idempotencyConflict.error?.code).toBe("idempotency_conflict");
    expect(handler).toHaveBeenCalledTimes(1);
    const escaped = await broker.execute({
      ...request,
      requestId: "request_http_escape",
      idempotencyKey: "idempotency_http_escape",
      input: { url: "https://attacker.example" }
    });
    expect(escaped.error?.code).toBe("arbitrary_http_blocked");
  });

  it("enforces hierarchical connector kill switches before resolving credentials", async () => {
    const state = new InMemoryConnectorState();
    const installation = installationFixture();
    await state.save(installation);
    const handler = vi.fn(async () => ({ status: "connected" }));
    const accessPolicy = { evaluate: vi.fn(async () => ({ allowed: false, reason: "connection:provider-1" })) };
    const broker = new HermesConnectorBroker({
      installations: state,
      idempotency: state,
      audit: state,
      accessPolicy,
      vault: new CompositeVault([new MemoryVault([[installation.credentialRef, "opaque-token"]])]),
      handlers: new Map([[operationKey("github", "health.check"), handler]]),
      now: () => new Date("2026-08-01T00:00:10.000Z")
    });
    const response = await broker.execute(requestFixture());
    expect(response).toMatchObject({ status: "denied", error: { code: "locally_disabled" } });
    expect(accessPolicy.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      providerId: "github",
      connectionId: "provider-1"
    }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails every provider write closed without an independently verified approval", async () => {
    const state = new InMemoryConnectorState();
    const namespace = buildCredentialNamespace({
      organizationId: "org-1",
      projectKey: "main",
      providerId: "slack",
      installationId: "slack-1",
      environment: "production"
    });
    const installation = connectorInstallationAdminSchema.parse({
      id: "slack-1",
      tenant: { organizationId: "org-1", projectKey: "main" },
      providerId: "slack",
      displayName: "Slack",
      environment: "production",
      status: "active",
      credentialRef: `vault://${namespace}/tokens/provider`,
      credentialNamespace: namespace,
      grantedScopes: ["chat:write"],
      allowedCapabilities: ["provider.action.execute"],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    await state.save(installation);
    const handler = vi.fn(async () => ({ delivered: true }));
    const request = connectorBrokerRequestSchema.parse({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: "request_slack_send_1",
      idempotencyKey: "idempotency_slack_send_1",
      tenant: installation.tenant,
      actor: { type: "workload", subject: "spiffe://example/hermes" },
      providerId: "slack",
      installationId: installation.id,
      capability: "provider.action.execute",
      operation: "message.send.execute",
      input: { channelId: "C123", text: "Approved update" },
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:01:00.000Z",
      correlationId: "correlation_slack_send_1"
    });
    const deniedBroker = new HermesConnectorBroker({
      installations: state,
      idempotency: state,
      audit: state,
      preparedActions: state,
      vault: new CompositeVault([new MemoryVault([[installation.credentialRef, "opaque-token"]])]),
      handlers: new Map([[operationKey("slack", "message.send.execute"), handler]]),
      now: () => new Date("2026-08-01T00:00:10.000Z")
    });
    await expect(deniedBroker.execute(request)).resolves.toMatchObject({
      status: "denied",
      error: { code: "prepare_commit_required" }
    });
    expect(handler).not.toHaveBeenCalled();

    const context = {
      workspaceId: "workspace-1",
      environment: "production" as const,
      agentInstanceId: "hermes-1",
      companyObject: { type: "SlackMessage", id: "message-1" },
      loopId: "management-comms",
      loopSpecHash: "a".repeat(64),
      routeJobId: "route-job-1",
      activationMode: "execute" as const
    };
    const prepared = await deniedBroker.prepareAction({
      ...request,
      requestId: "request_slack_prepare_1",
      idempotencyKey: "idempotency_slack_prepare_1",
      context
    });
    await expect(deniedBroker.commitAction({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: "request_slack_commit_1",
      idempotencyKey: "idempotency_slack_commit_1",
      tenant: installation.tenant,
      actor: request.actor,
      providerId: "slack",
      installationId: installation.id,
      capability: "provider.action.execute",
      operation: "message.send.execute",
      context,
      preparedActionId: prepared.preparedAction.actionId,
      preparedActionFingerprint: prepared.preparedAction.fingerprint,
      approvalReceiptId: "approval-unverified",
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:01:00.000Z",
      correlationId: "correlation_slack_commit_1"
    })).resolves.toMatchObject({ status: "denied", error: { code: "approval_required" } });

    const approvedBroker = new HermesConnectorBroker({
      installations: state,
      idempotency: new InMemoryConnectorState(),
      audit: state,
      preparedActions: state,
      approvals: { verify: vi.fn(async () => true) },
      vault: new CompositeVault([new MemoryVault([[installation.credentialRef, "opaque-token"]])]),
      handlers: new Map([[operationKey("slack", "message.send.execute"), handler]]),
      now: () => new Date("2026-08-01T00:00:10.000Z")
    });
    await expect(approvedBroker.commitAction({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: "request_slack_commit_2",
      idempotencyKey: "idempotency_slack_commit_2",
      tenant: installation.tenant,
      actor: request.actor,
      providerId: "slack",
      installationId: installation.id,
      capability: "provider.action.execute",
      operation: "message.send.execute",
      context,
      preparedActionId: prepared.preparedAction.actionId,
      preparedActionFingerprint: prepared.preparedAction.fingerprint,
      approvalReceiptId: "approval-verified",
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:01:00.000Z",
      correlationId: "correlation_slack_commit_2"
    })).resolves.toMatchObject({ status: "succeeded" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps draft writes fingerprint-bound without requiring a privileged human approval", async () => {
    const state = new InMemoryConnectorState();
    const namespace = buildCredentialNamespace({
      organizationId: "org-1",
      projectKey: "main",
      providerId: "slack",
      installationId: "slack-draft-1",
      environment: "production"
    });
    const installation = connectorInstallationAdminSchema.parse({
      id: "slack-draft-1",
      tenant: { organizationId: "org-1", projectKey: "main" },
      providerId: "slack",
      displayName: "Slack drafts",
      environment: "production",
      status: "active",
      credentialRef: `vault://${namespace}/tokens/provider`,
      credentialNamespace: namespace,
      grantedScopes: ["chat:write"],
      allowedCapabilities: ["provider.draft.write"],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    await state.save(installation);
    const handler = vi.fn(async () => ({ draftId: "draft-1" }));
    const broker = new HermesConnectorBroker({
      installations: state,
      idempotency: state,
      audit: state,
      preparedActions: state,
      vault: new CompositeVault([new MemoryVault([[installation.credentialRef, "opaque-token"]])]),
      handlers: new Map([[operationKey("slack", "message.draft.create"), handler]]),
      now: () => new Date("2026-08-01T00:00:10.000Z")
    });
    const context = {
      workspaceId: "workspace-1",
      environment: "production" as const,
      agentInstanceId: "hermes-1",
      companyObject: { type: "SlackMessage", id: "message-draft-1" },
      loopId: "management-comms",
      loopSpecHash: "c".repeat(64),
      routeJobId: "route-job-draft-1",
      activationMode: "recommend" as const
    };
    const prepared = await broker.prepareAction({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: "request_slack_draft_prepare",
      idempotencyKey: "idempotency_slack_draft_prepare",
      tenant: installation.tenant,
      actor: { type: "workload", subject: "spiffe://example/hermes" },
      providerId: "slack",
      installationId: installation.id,
      capability: "provider.draft.write",
      operation: "message.draft.create",
      input: { channelId: "C123", text: "Review this draft" },
      context,
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:01:00.000Z",
      correlationId: "correlation_slack_draft_prepare"
    });
    expect(prepared.preparedAction.approvalRequired).toBe(false);
    const committed = await broker.commitAction({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: "request_slack_draft_commit",
      idempotencyKey: "idempotency_slack_draft_commit",
      tenant: installation.tenant,
      actor: { type: "workload", subject: "spiffe://example/hermes" },
      providerId: "slack",
      installationId: installation.id,
      capability: "provider.draft.write",
      operation: "message.draft.create",
      context,
      preparedActionId: prepared.preparedAction.actionId,
      preparedActionFingerprint: prepared.preparedAction.fingerprint,
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:01:00.000Z",
      correlationId: "correlation_slack_draft_commit"
    });
    expect(committed).toMatchObject({
      status: "succeeded",
      receipt: {
        actorSubject: "spiffe://example/hermes",
        environment: "production",
        loopId: "management-comms",
        routeJobId: "route-job-draft-1"
      }
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("verifies provider raw-body signatures and suppresses replay", async () => {
    const secret = "provider-webhook-secret-value";
    const body = JSON.stringify({ id: "delivery_payload", action: "opened" });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const verifier = new ProviderWebhookVerifier({
      replay: new InMemoryWebhookReplayStore(),
      receiptSigningKey: "receipt-signing-key-that-is-long-enough",
      receiptKeyId: "receipt-key-1",
      now: () => new Date("2026-08-01T00:00:00.000Z")
    });
    const input = {
      organizationId: "org-1",
      projectKey: "main",
      installationId: "provider-1",
      providerId: "github" as const,
      rawBody: body,
      headers: { "x-hub-signature-256": signature, "x-github-delivery": "delivery-1" },
      webhookSecret: secret
    };
    const receipt = await verifier.verify(input);
    expect(verifier.verifyReceipt(receipt, body)).toBe(true);
    await expect(verifier.verify(input)).rejects.toMatchObject({ code: "replayed_delivery", status: 409 });
  });

  it("uses each provider's documented signature and delivery headers", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const secret = "provider-webhook-secret-value";
    const body = JSON.stringify({ id: "provider-event-1", type: "updated" });
    const timestamp = now.toISOString();
    const cases = [
      {
        providerId: "intercom" as const,
        headers: { "x-hub-signature": `sha1=${createHmac("sha1", secret).update(body).digest("hex")}` },
        signer: "intercom:hmac-sha1"
      },
      {
        providerId: "greenhouse" as const,
        headers: { signature: `sha256 ${createHmac("sha256", secret).update(body).digest("hex")}`, "greenhouse-event-id": "greenhouse-delivery-1" },
        signer: "greenhouse:hmac-sha256"
      },
      {
        providerId: "zendesk" as const,
        headers: {
          "x-zendesk-webhook-signature-timestamp": timestamp,
          "x-zendesk-webhook-signature": createHmac("sha256", secret).update(`${timestamp}${body}`).digest("base64"),
          "x-zendesk-webhook-invocation-id": "zendesk-invocation-1"
        },
        signer: "zendesk:hmac-sha256"
      },
      {
        providerId: "quickbooks" as const,
        headers: {
          "intuit-signature": createHmac("sha256", secret).update(body).digest("base64"),
          "intuit-t-id": "intuit-delivery-1"
        },
        signer: "quickbooks:intuit-signature"
      },
      {
        providerId: "notion" as const,
        headers: { "x-notion-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
        signer: "notion:hmac-sha256"
      }
    ];
    for (const item of cases) {
      const verifier = new ProviderWebhookVerifier({
        replay: new InMemoryWebhookReplayStore(),
        receiptSigningKey: "receipt-signing-key-that-is-long-enough",
        receiptKeyId: "receipt-key-1",
        now: () => now
      });
      await expect(verifier.verify({
        organizationId: "org-1",
        projectKey: "main",
        installationId: `provider-${item.providerId}`,
        providerId: item.providerId,
        rawBody: body,
        headers: item.headers,
        webhookSecret: secret
      })).resolves.toMatchObject({ signer: item.signer });
    }
  });

  it("binds webhook signing material to the connector's exact derived vault object", async () => {
    const installation = installationFixture();
    const store = new MemoryOAuthStore();
    store.installations.set(installation.id, installation);
    const expectedReference = deriveCredentialChildReference(installation.credentialRef, "webhooks/signing");
    const vault = new MemoryVault([[expectedReference, "provider-webhook-secret-value"]]);
    const subscriptions = new ProviderSubscriptionService({
      store,
      vault: new CompositeVault([vault]),
      publicUrl: "https://broker.example"
    });
    await expect(subscriptions.activate({
      ...installation.tenant,
      installationId: installation.id,
      providerConfigured: true,
      providerSubscriptionId: "provider-subscription-1"
    })).resolves.toMatchObject({
      installation: { webhookSecretRef: expectedReference, webhookStatus: "active" }
    });
    await expect(subscriptions.activate({
      ...installation.tenant,
      installationId: installation.id,
      webhookSecretRef: `vault://${installation.credentialNamespace}/webhooks/attacker-selected`
    })).rejects.toMatchObject({ code: "webhook_secret_reference_mismatch" });
  });

  it("generates a Jira callback URL bound to the exact tenant installation", async () => {
    const namespace = buildCredentialNamespace({ organizationId: "org-1", projectKey: "main", providerId: "jira", installationId: "jira-1" });
    const installation = connectorInstallationAdminSchema.parse({
      id: "jira-1",
      tenant: { organizationId: "org-1", projectKey: "main" },
      providerId: "jira",
      displayName: "Jira",
      status: "connected",
      credentialRef: `vault://${namespace}/tokens/provider`,
      credentialNamespace: namespace,
      grantedScopes: ["read:jira-work", "manage:jira-webhook", "offline_access"],
      allowedCapabilities: ["provider.health.read"],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    const webhookSecretRef = deriveCredentialChildReference(installation.credentialRef, "webhooks/signing");
    const webhookSecret = "jira-client-secret";
    const store = new MemoryOAuthStore();
    store.installations.set(installation.id, installation);
    const subscriptions = new ProviderSubscriptionService({
      store,
      vault: new CompositeVault([new MemoryVault([[webhookSecretRef, webhookSecret]])]),
      publicUrl: "https://broker.example"
    });

    const activated = await subscriptions.activate({ ...installation.tenant, installationId: installation.id, providerConfigured: true });
    const callback = new URL(activated.endpointUrl);
    expect(callback.pathname).toBe("/api/connector-broker/v1/webhooks/jira-1");
    expect(callback.searchParams.get("loopgraph_binding")).toBe(deriveJiraWebhookCallbackBinding({
      secret: webhookSecret,
      ...installation.tenant,
      installationId: installation.id
    }));
  });

  it("uses a workload access token for GCP Secret Manager and rejects cross-tenant references", async () => {
    const namespace = installationFixture().credentialNamespace;
    const reference = `gcp-sm://projects/demo/secrets/${namespace}/versions/latest`;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      void input;
      void init;
      return new Response(JSON.stringify({ payload: { data: Buffer.from("secret-value").toString("base64") }, name: "version-1" }), { status: 200 });
    });
    const adapter = new GcpSecretManagerAdapter(async () => "temporary-workload-access-token", fetcher as typeof fetch);
    const vault = new CompositeVault([adapter]);
    const lease = await vault.resolve(reference, { organizationId: "org-1", projectKey: "main", expectedNamespace: namespace });
    expect(lease.reveal()).toBe("secret-value");
    lease.dispose();
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ authorization: "Bearer temporary-workload-access-token" });
    await expect(vault.resolve(reference, { organizationId: "org-2", projectKey: "main", expectedNamespace: "organizations/org-2/projects/main/providers/github/installations/provider-1" })).rejects.toThrow(/outside the installation tenant namespace/);
  });

  it("verifies workload issuer, signature, audience, tenant, subject, and capability", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const issuer = "https://identity.example";
    const audience = "https://broker.example";
    const now = new Date("2026-08-01T00:00:00.000Z");
    const jwk = publicKey.export({ format: "jwk" });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] }), {
      headers: { "cache-control": "max-age=300", "content-type": "application/json" }
    }));
    const verifier = new WorkloadIdentityVerifier([{
      issuer,
      jwksUri: `${issuer}/jwks`,
      audiences: [audience],
      allowedSubjectPatterns: ["spiffe://company/hermes/*"],
      capabilityClaim: "capabilities",
      organizationClaim: "organization_id",
      projectClaim: "project_key"
    }], fetcher as typeof fetch, () => now.getTime());
    const claims = {
      iss: issuer,
      sub: "spiffe://company/hermes/worker-1",
      aud: audience,
      exp: Math.floor(now.getTime() / 1_000) + 300,
      capabilities: ["provider.connector_broker"],
      organization_id: "org-1",
      project_key: "main",
      cnf: { "x5t#S256": Buffer.alloc(32, 1).toString("base64url") }
    };
    const token = jwt(claims, privateKey);
    await expect(verifier.verifyBearer(token, {
      capability: "provider.connector_broker",
      organizationId: "org-1",
      projectKey: "main"
    })).resolves.toMatchObject({
      subject: claims.sub,
      organizationId: "org-1",
      projectKey: "main",
      confirmationKey: "01".repeat(32)
    });
    await expect(verifier.verifyBearer(token, {
      capability: "provider.revocation_worker",
      organizationId: "org-1",
      projectKey: "main"
    })).rejects.toMatchObject({ code: "capability_not_granted" });
    await expect(verifier.verifyBearer(jwt({ ...claims, capabilities: ["*"] }, privateKey), {
      capability: "provider.connector_broker",
      organizationId: "org-1",
      projectKey: "main"
    })).rejects.toMatchObject({ code: "capability_not_granted" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps OAuth code exchange, refresh, and revocation tokens inside the vault", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const store = new MemoryOAuthStore();
    const memoryVault = new MemoryVault();
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      return new Response(JSON.stringify(body.includes("refresh_token")
        ? { access_token: "refreshed-access-secret", refresh_token: "refresh-secret", expires_in: 3600, scope: "crm.objects.companies.read" }
        : { access_token: "initial-access-secret", refresh_token: "refresh-secret", expires_in: 3600, scope: "crm.objects.companies.read" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const oauth = new OAuthLifecycleService({
      store,
      vault: new CompositeVault([memoryVault]),
      clients: new Map([["hubspot", {
        providerId: "hubspot" as const,
        clientId: "client-id",
        redirectUri: "https://broker.example/oauth/callback",
        tokenAuthMethod: "none" as const
      }]]),
      audit: async () => undefined,
      allocateCredentialReference: ({ namespace }) => `vault://${namespace}/tokens/provider`,
      fetcher: fetcher as typeof fetch,
      now: () => now
    });
    const started = await oauth.begin({
      tenant: { organizationId: "org-1", projectKey: "main" },
      providerId: "hubspot",
      displayName: "HubSpot",
      actorId: "user-1",
      correlationId: "correlation_start_1"
    });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const connected = await oauth.completeCallback({
      tenant: started.installation.tenant,
      state,
      authorizationCode: "provider-code",
      actorId: "user-1",
      correlationId: "correlation_callback_1"
    });
    expect(JSON.stringify({ started, connected })).not.toContain("initial-access-secret");
    expect(memoryVault.values.get(connected.credentialRef)).toContain("initial-access-secret");
    const refreshed = await oauth.refreshInstallation({ ...connected.tenant, installationId: connected.id, actorId: "system:test", correlationId: "correlation_refresh_1" });
    expect(refreshed.credentialRef).not.toBe(connected.credentialRef);
    expect(memoryVault.values.has(connected.credentialRef)).toBe(false);
    expect(memoryVault.values.get(refreshed.credentialRef)).toContain("refreshed-access-secret");
    await oauth.revoke({ ...refreshed.tenant, installationId: refreshed.id, actorId: "user-1", correlationId: "correlation_revoke_1", emergency: true });
    expect(memoryVault.values.has(refreshed.credentialRef)).toBe(false);
  });
});

function installationFixture(): ConnectorInstallationAdmin {
  const namespace = buildCredentialNamespace({ organizationId: "org-1", projectKey: "main", providerId: "github", installationId: "provider-1" });
  return connectorInstallationAdminSchema.parse({
    id: "provider-1",
    tenant: { organizationId: "org-1", projectKey: "main" },
    providerId: "github",
    displayName: "GitHub",
    status: "active",
    credentialRef: `vault://${namespace}/tokens/provider`,
    credentialNamespace: namespace,
    grantedScopes: ["contents:read"],
    allowedCapabilities: ["provider.health.read"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  });
}

function requestFixture() {
  return connectorBrokerRequestSchema.parse({
    protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
    requestId: "request_health_123",
    idempotencyKey: "idempotency_health_123",
    tenant: { organizationId: "org-1", projectKey: "main" },
    actor: { type: "workload", subject: "spiffe://example/hermes" },
    providerId: "github",
    installationId: "provider-1",
    capability: "provider.health.read",
    operation: "health.check",
    input: {},
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:01:00.000Z",
    correlationId: "correlation_health_123"
  });
}

class MemoryVault implements VaultAdapter {
  readonly schemes = ["vault"];
  readonly values = new Map<string, string>();
  constructor(entries: Array<[string, string]> = []) { for (const [key, value] of entries) this.values.set(key, value); }
  async resolve(reference: string) {
    const value = this.values.get(reference);
    if (!value) throw new Error("missing secret");
    return { value };
  }
  async put(reference: string, value: string, context: SecretResolutionContext) { void context; this.values.set(reference, value); return {}; }
  async delete(reference: string) { this.values.delete(reference); }
}

class MemoryOAuthStore implements OAuthLifecycleStore {
  readonly transactions: OAuthTransaction[] = [];
  readonly installations = new Map<string, ConnectorInstallationAdmin>();
  async saveTransaction(transaction: OAuthTransaction) { this.transactions.push(transaction); }
  async findTransactionByStateHash(input: { organizationId: string; projectKey: string; stateHash: string }) {
    return this.transactions.find((item) => item.tenant.organizationId === input.organizationId && item.tenant.projectKey === input.projectKey && item.stateHash === input.stateHash);
  }
  async consumeTransaction(input: { transactionId: string; consumedAt: string }) {
    const transaction = this.transactions.find((item) => item.id === input.transactionId && !item.consumedAt);
    if (!transaction) return false;
    transaction.consumedAt = input.consumedAt;
    return true;
  }
  async saveInstallation(installation: ConnectorInstallationAdmin) { this.installations.set(installation.id, installation); }
  async getInstallation(input: { installationId: string }) { return this.installations.get(input.installationId); }
  async listRefreshDue() { return []; }
}

function jwt(claims: Record<string, unknown>, privateKey: Parameters<typeof sign>[2]) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
