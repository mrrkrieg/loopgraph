import "server-only";

import { z } from "zod";
import {
  credentialNamespaceFingerprint,
  credentialReferenceSchema,
  providerIdSchema,
  type CredentialReference,
  type ProviderId
} from "loopgraph/core";
import {
  AmbientWorkloadTokenProvider,
  AwsSecretsManagerAdapter,
  AwsWorkloadSecretsManagerClient,
  AzureKeyVaultAdapter,
  CompositeVault,
  DevelopmentEnvironmentAdapter,
  GcpSecretManagerAdapter,
  HashicorpVaultAdapter,
  HermesConnectorBroker,
  MacOsKeychainAdapter,
  OAuthLifecycleService,
  ProviderSubscriptionService,
  createProviderOperationHandlers,
  type OAuthClientRegistration,
  type WorkloadAccessTokenProvider
} from "loopgraph/runtime";
import { SupabaseConnectorBrokerStore } from "./supabase-store";

const oauthClientSchema = z.object({
  providerId: providerIdSchema,
  clientId: z.string().min(1),
  clientSecretRef: credentialReferenceSchema.optional(),
  redirectUri: z.string().url(),
  tokenAuthMethod: z.enum(["client_secret_basic", "client_secret_post", "none"]),
  revocationUrl: z.string().url().optional()
});

let cachedRuntime: ReturnType<typeof createRuntime> | undefined;

export function getConnectorBrokerRuntime() {
  cachedRuntime ??= createRuntime();
  return cachedRuntime;
}

export async function getWebhookReceiptSigningKey() {
  const runtime = getConnectorBrokerRuntime();
  const reference = credentialReferenceSchema.parse(process.env.LOOPGRAPH_WEBHOOK_RECEIPT_SIGNING_KEY_REF);
  const namespace = process.env.LOOPGRAPH_CONNECTOR_PLATFORM_SECRET_NAMESPACE?.trim();
  if (!namespace) throw new Error("LOOPGRAPH_CONNECTOR_PLATFORM_SECRET_NAMESPACE is required");
  return runtime.vault.resolve(reference, {
    organizationId: "platform",
    projectKey: "connector-broker",
    expectedNamespace: namespace
  });
}

export async function getConnectorCapabilityManifestSigningKey() {
  const runtime = getConnectorBrokerRuntime();
  const reference = credentialReferenceSchema.parse(process.env.LOOPGRAPH_CONNECTOR_MANIFEST_SIGNING_KEY_REF);
  const namespace = process.env.LOOPGRAPH_CONNECTOR_PLATFORM_SECRET_NAMESPACE?.trim();
  if (!namespace) throw new Error("LOOPGRAPH_CONNECTOR_PLATFORM_SECRET_NAMESPACE is required");
  return runtime.vault.resolve(reference, {
    organizationId: "platform",
    projectKey: "connector-broker",
    expectedNamespace: namespace
  });
}

function createRuntime() {
  const store = SupabaseConnectorBrokerStore.fromEnvironment();
  const vault = createVault();
  const clients = parseOAuthClients();
  const oauth = new OAuthLifecycleService({
    store,
    vault,
    clients,
    audit: store.appendOAuthAudit,
    platformSecretNamespace: process.env.LOOPGRAPH_CONNECTOR_PLATFORM_SECRET_NAMESPACE,
    allocateCredentialReference
  });
  const broker = new HermesConnectorBroker({
    installations: store,
    idempotency: store,
    audit: store,
    preparedActions: store,
    approvals: store,
    accessPolicy: store,
    defaultEnvironment: deploymentEnvironment(),
    vault,
    handlers: createProviderOperationHandlers()
  });
  const publicUrl = process.env.LOOPGRAPH_PUBLIC_URL ?? process.env.LOOPGRAPH_APP_URL;
  const subscriptions = publicUrl
    ? new ProviderSubscriptionService({ store, vault, publicUrl })
    : undefined;
  return { store, vault, clients, oauth, broker, subscriptions, allocateCredentialReference };
}

function deploymentEnvironment(): "development" | "staging" | "production" {
  const value = process.env.LOOPGRAPH_DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV;
  if (value === "production" || value === "staging" || value === "development") return value;
  return "development";
}

function createVault() {
  const type = process.env.LOOPGRAPH_CONNECTOR_VAULT_PROVIDER?.trim();
  if (!type) throw new Error("LOOPGRAPH_CONNECTOR_VAULT_PROVIDER is required");
  if (type === "aws") {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    if (!region) throw new Error("AWS_REGION is required for the AWS connector vault");
    return new CompositeVault([new AwsSecretsManagerAdapter(new AwsWorkloadSecretsManagerClient({ region }))]);
  }
  if (type === "gcp") {
    return new CompositeVault([new GcpSecretManagerAdapter(gcpSecretManagerAccessToken)]);
  }
  if (type === "azure") {
    const ambient = new AmbientWorkloadTokenProvider();
    return new CompositeVault([new AzureKeyVaultAdapter((input) => ambient.getToken({ audience: input.audience }))]);
  }
  if (type === "vault") {
    const baseUrl = process.env.LOOPGRAPH_HASHICORP_VAULT_URL;
    if (!baseUrl) throw new Error("LOOPGRAPH_HASHICORP_VAULT_URL is required");
    const trustedBaseUrl = validateVaultBaseUrl(baseUrl);
    return new CompositeVault([new HashicorpVaultAdapter(trustedBaseUrl, hashicorpVaultAccessToken(trustedBaseUrl))]);
  }
  if (type === "keychain") {
    if (process.env.NODE_ENV === "production") throw new Error("macOS Keychain connector vault is for local deployments only");
    return new CompositeVault([new MacOsKeychainAdapter()]);
  }
  if (type === "env-ref") {
    if (process.env.NODE_ENV === "production") throw new Error("Environment connector credentials are disabled in production");
    return new CompositeVault([new DevelopmentEnvironmentAdapter()]);
  }
  throw new Error(`Unsupported connector vault provider: ${type}`);
}

function parseOAuthClients() {
  const value = process.env.LOOPGRAPH_OAUTH_CLIENTS_JSON;
  const rows = value ? z.array(oauthClientSchema).parse(JSON.parse(value)) : [];
  return new Map<ProviderId, OAuthClientRegistration>(rows.map((row) => [row.providerId, row]));
}

function allocateCredentialReference(input: { namespace: string; providerId: ProviderId; installationId: string }) {
  const template = process.env.LOOPGRAPH_CONNECTOR_CREDENTIAL_TEMPLATE;
  if (!template || (!template.includes("{namespace}") && !template.includes("{namespaceHash}"))) {
    throw new Error("LOOPGRAPH_CONNECTOR_CREDENTIAL_TEMPLATE must include {namespace} or {namespaceHash}");
  }
  const value = template
    .replaceAll("{namespace}", input.namespace)
    .replaceAll("{namespaceHash}", credentialNamespaceFingerprint(input.namespace))
    .replaceAll("{providerId}", input.providerId)
    .replaceAll("{installationId}", input.installationId);
  return credentialReferenceSchema.parse(value) as CredentialReference;
}

const gcpSecretManagerAccessToken: WorkloadAccessTokenProvider = async () => {
  const host = process.env.GCE_METADATA_HOST ?? "metadata.google.internal";
  if (!/^(?:metadata\.google\.internal|169\.254\.169\.254)(?::\d{1,5})?$/.test(host)) {
    throw new Error("GCE_METADATA_HOST is not a trusted metadata endpoint");
  }
  const response = await fetch(`http://${host}/computeMetadata/v1/instance/service-accounts/default/token`, {
    headers: { "metadata-flavor": "Google" },
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error(`GCP access token request failed (${response.status})`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("GCP access token response is invalid");
  return body.access_token;
};

function hashicorpVaultAccessToken(baseUrl: string): WorkloadAccessTokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  return async (input) => {
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    const role = process.env.LOOPGRAPH_HASHICORP_VAULT_ROLE;
    const mount = process.env.LOOPGRAPH_HASHICORP_VAULT_AUTH_MOUNT ?? "jwt";
    if (!role || !/^[A-Za-z0-9._-]+$/.test(mount)) throw new Error("HashiCorp Vault workload role or auth mount is invalid");
    const jwt = await new AmbientWorkloadTokenProvider().getToken({ audience: input.audience });
    const response = await fetch(new URL(`/v1/auth/${mount}/login`, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, jwt })
    });
    if (!response.ok) throw new Error(`HashiCorp Vault workload login failed (${response.status})`);
    const body = await response.json() as { auth?: { client_token?: string; lease_duration?: number } };
    if (!body.auth?.client_token) throw new Error("HashiCorp Vault workload login response is invalid");
    cached = {
      token: body.auth.client_token,
      expiresAt: Date.now() + Math.max(body.auth.lease_duration ?? 300, 60) * 1_000
    };
    return cached.token;
  };
}

function validateVaultBaseUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("HashiCorp Vault URL must not contain credentials, query, or fragment");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Production HashiCorp Vault must use HTTPS");
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("HashiCorp Vault URL protocol is invalid");
  return url.origin;
}
