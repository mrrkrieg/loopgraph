import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  buildCredentialNamespace,
  connectorBrokerRequestSchema,
  connectorInstallationAdminSchema,
  type ProviderId
} from "../core";
import { getProviderOperation } from "./connector-capabilities";
import { getProviderOnboardingProfile } from "./provider-onboarding";
import { createProviderOperationHandlers } from "./provider-operation-handlers";
import { deriveJiraWebhookCallbackBinding, InMemoryWebhookReplayStore, ProviderWebhookVerifier } from "./provider-webhook-verifier";
import { SecretLease } from "./vault-adapters";

describe("Engineering provider expansion", () => {
  it("uses a fixed Linear GraphQL document and rejects caller-supplied GraphQL", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ data: { issue: { id: "issue-1", identifier: "ENG-42", title: "Queue regression", updatedAt: "2026-08-10T00:00:00.000Z" } } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("linear:issues.read")!;
    await expect(handler(context("linear", "issues.read", { issueId: "ENG-42", query: "query { users { email } }" }, JSON.stringify({ access_token: "linear-token" })))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();

    await expect(handler(context("linear", "issues.read", { issueId: "ENG-42" }, JSON.stringify({ access_token: "linear-token" })))).resolves.toMatchObject({ providerObjectRef: "linear:issue:issue-1" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.linear.app/graphql");
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request.query).toContain("query LoopgraphIssue");
    expect(request.query).not.toContain("users");
  });

  it("pins Jira requests to the installation cloud ID and accepts no URL or JQL", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ id: "10042", key: "ENG-42", fields: { summary: "Queue regression", updated: "2026-08-10T00:00:00.000Z" } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("jira:issues.read")!;
    const credential = JSON.stringify({ access_token: "jira-token", cloud_id: "11111111-2222-3333-4444-555555555555" });
    await expect(handler(context("jira", "issues.read", { issueIdOrKey: "ENG-42", url: "https://attacker.example", jql: "all" }, credential))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();

    await expect(handler(context("jira", "issues.read", { issueIdOrKey: "ENG-42" }, credential))).resolves.toMatchObject({ providerObjectRef: "jira:issue:ENG-42" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.atlassian.com/ex/jira/11111111-2222-3333-4444-555555555555/rest/api/3/issue/ENG-42?fields=summary,description,status,priority,labels,assignee,reporter,created,updated,resolutiondate,fixVersions,project,issuetype");
  });

  it("pins GitLab reads to gitlab.com and encodes the project path", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ id: 42, iid: 7, title: "Queue regression", updated_at: "2026-08-10T00:00:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("gitlab:issues.read")!;
    await expect(handler(context("gitlab", "issues.read", { projectIdOrPath: "example/api", issueIid: 7, instanceUrl: "https://attacker.example" }, JSON.stringify({ access_token: "gitlab-token" })))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();

    await expect(handler(context("gitlab", "issues.read", { projectIdOrPath: "example/api", issueIid: 7 }, JSON.stringify({ access_token: "gitlab-token" })))).resolves.toMatchObject({ providerObjectRef: "gitlab:project:example/api:issue:7" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://gitlab.com/api/v4/projects/example%2Fapi/issues/7");
  });

  it("verifies Linear, Jira, and GitLab webhook authenticity and freshness", async () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const verifier = new ProviderWebhookVerifier({ replay: new InMemoryWebhookReplayStore(), receiptSigningKey: "receipt-signing-key-that-is-long-enough", receiptKeyId: "receipt-key-1", now: () => now });

    const linearSecret = "linear-webhook-secret";
    const linearBody = JSON.stringify({ action: "update", type: "Issue", webhookTimestamp: now.getTime(), data: { id: "issue-1" } });
    await expect(verifier.verify({ organizationId: "org", projectKey: "main", installationId: "linear-1", providerId: "linear", rawBody: linearBody, headers: { "linear-delivery": "11111111-2222-4333-8444-555555555555", "linear-signature": createHmac("sha256", linearSecret).update(linearBody).digest("hex") }, webhookSecret: linearSecret })).resolves.toMatchObject({ signer: "linear:hmac-sha256" });

    const jiraSecret = "jira-client-secret";
    const jiraBody = JSON.stringify({ webhookEvent: "jira:issue_updated", issue: { key: "ENG-42" } });
    const jiraToken = jwt(jiraSecret, { iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 300, jti: "jira-delivery-1" });
    const jiraBinding = deriveJiraWebhookCallbackBinding({ secret: jiraSecret, organizationId: "org", projectKey: "main", installationId: "jira-1" });
    await expect(verifier.verify({ organizationId: "org", projectKey: "main", installationId: "jira-1", providerId: "jira", rawBody: jiraBody, headers: { authorization: `Bearer ${jiraToken}` }, webhookSecret: jiraSecret, requestUrl: `https://broker.example/api/connector-broker/v1/webhooks/jira-1?loopgraph_binding=${jiraBinding}` })).resolves.toMatchObject({ signer: "jira:oauth-webhook-jwt", deliveryId: "jira-delivery-1" });

    const gitlabKey = Buffer.from("gitlab-standard-webhook-signing-key");
    const gitlabSecret = `whsec_${gitlabKey.toString("base64")}`;
    const gitlabBody = JSON.stringify({ object_kind: "issue", object_attributes: { id: 42 } });
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const messageId = "gitlab-delivery-1";
    const signature = `v1,${createHmac("sha256", gitlabKey).update(`${messageId}.${timestamp}.${gitlabBody}`).digest("base64")}`;
    await expect(verifier.verify({ organizationId: "org", projectKey: "main", installationId: "gitlab-1", providerId: "gitlab", rawBody: gitlabBody, headers: { "webhook-id": messageId, "webhook-timestamp": timestamp, "webhook-signature": signature }, webhookSecret: gitlabSecret })).resolves.toMatchObject({ signer: "gitlab:standard-webhooks", deliveryId: messageId });
  });

  it("derives Linear replay identity from the signed body instead of a mutable header", async () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const verifier = new ProviderWebhookVerifier({ replay: new InMemoryWebhookReplayStore(), receiptSigningKey: "receipt-signing-key-that-is-long-enough", receiptKeyId: "receipt-key-1", now: () => now });
    const secret = "linear-webhook-secret";
    const rawBody = JSON.stringify({ action: "update", type: "Issue", webhookTimestamp: now.getTime(), data: { id: "issue-1" } });
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    const base = { organizationId: "org", projectKey: "main", installationId: "linear-1", providerId: "linear" as const, rawBody, webhookSecret: secret };

    await expect(verifier.verify({ ...base, headers: { "linear-delivery": "delivery-a", "linear-signature": signature } })).resolves.toMatchObject({ signer: "linear:hmac-sha256" });
    await expect(verifier.verify({ ...base, headers: { "linear-delivery": "delivery-b", "linear-signature": signature } })).rejects.toMatchObject({ code: "replayed_delivery", status: 409 });
  });

  it("binds a Jira webhook token to the receiving installation", async () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const verifier = new ProviderWebhookVerifier({ replay: new InMemoryWebhookReplayStore(), receiptSigningKey: "receipt-signing-key-that-is-long-enough", receiptKeyId: "receipt-key-1", now: () => now });
    const secret = "jira-client-secret";
    const rawBody = JSON.stringify({ webhookEvent: "jira:issue_updated", issue: { key: "ENG-42" } });
    const token = jwt(secret, { iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 300, jti: "jira-delivery-1" });
    const binding = deriveJiraWebhookCallbackBinding({ secret, organizationId: "org-a", projectKey: "main", installationId: "jira-a" });

    await expect(verifier.verify({ organizationId: "org-a", projectKey: "main", installationId: "jira-a", providerId: "jira", rawBody, headers: { authorization: `Bearer ${token}` }, webhookSecret: secret, requestUrl: `https://broker.example/api/connector-broker/v1/webhooks/jira-a?loopgraph_binding=${binding}` })).resolves.toMatchObject({ deliveryId: "jira-delivery-1" });
    await expect(verifier.verify({ organizationId: "org-b", projectKey: "main", installationId: "jira-b", providerId: "jira", rawBody, headers: { authorization: `Bearer ${token}` }, webhookSecret: secret, requestUrl: `https://broker.example/api/connector-broker/v1/webhooks/jira-b?loopgraph_binding=${binding}` })).rejects.toMatchObject({ code: "invalid_bearer_jwt", status: 401 });
  });

  it("requests read-only provider scopes during initial consent", () => {
    expect(getProviderOnboardingProfile("linear").authorization).toMatchObject({ mode: "oauth2", scopes: ["read"] });
    expect(getProviderOnboardingProfile("jira").authorization).toMatchObject({ mode: "oauth2", scopes: ["read:jira-work", "manage:jira-webhook", "offline_access"] });
    expect(getProviderOnboardingProfile("gitlab").authorization).toMatchObject({ mode: "oauth2", scopes: ["read_api"] });
  });
});

function context(providerId: ProviderId, operation: string, input: Record<string, unknown>, secret: string) {
  const namespace = buildCredentialNamespace({ organizationId: "org-1", projectKey: "main", providerId, installationId: `${providerId}-1` });
  const installation = connectorInstallationAdminSchema.parse({ id: `${providerId}-1`, tenant: { organizationId: "org-1", projectKey: "main" }, providerId, displayName: providerId, environment: "production", status: "active", credentialRef: `vault://${namespace}/tokens/provider`, credentialNamespace: namespace, grantedScopes: [], allowedCapabilities: ["provider.data.read", "provider.action.execute"], webhookStatus: "not_configured", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" });
  const descriptor = getProviderOperation(providerId, operation);
  if (!descriptor) throw new Error(`Missing descriptor: ${providerId}:${operation}`);
  return { request: connectorBrokerRequestSchema.parse({ protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION, requestId: "request-engineering-provider", idempotencyKey: "idempotency-engineering-provider", tenant: installation.tenant, actor: { type: "workload", subject: "hermes" }, providerId, installationId: installation.id, capability: descriptor.capability, operation, input, issuedAt: "2026-08-10T00:00:00.000Z", expiresAt: "2026-08-10T00:05:00.000Z", correlationId: "correlation-engineering-provider" }), installation, descriptor, getCredential: async () => new SecretLease({ value: secret }) };
}

function jwt(secret: string, claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
