import { connectorInstallationHasExpectedNamespace, deriveCredentialChildReference, type ConnectorInstallationAdmin, type CredentialReference } from "../core";
import type { OAuthLifecycleStore } from "./oauth-lifecycle";
import { getProviderOnboardingProfile } from "./provider-onboarding";
import type { CompositeVault } from "./vault-adapters";

export class ProviderSubscriptionService {
  constructor(private readonly dependencies: {
    store: OAuthLifecycleStore;
    vault: CompositeVault;
    publicUrl: string;
    fetcher?: typeof fetch;
  }) {
    const url = new URL(dependencies.publicUrl);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Connector public URL must use HTTPS");
  }

  async activate(input: {
    organizationId: string;
    projectKey: string;
    installationId: string;
    webhookSecretRef?: CredentialReference;
    providerSubscriptionId?: string;
    providerConfigured?: boolean;
  }) {
    const installation = await this.dependencies.store.getInstallation(input);
    if (!installation) throw new ProviderSubscriptionError("installation_not_found");
    if (!connectorInstallationHasExpectedNamespace(installation)) throw new ProviderSubscriptionError("credential_namespace_invalid");
    if (!["connected", "subscription_pending", "active"].includes(installation.status)) {
      throw new ProviderSubscriptionError("installation_not_connected");
    }
    if (installation.providerId === "stripe") return this.activateStripe(installation);
    const webhookSecretRef = deriveCredentialChildReference(installation.credentialRef, "webhooks/signing");
    if (input.webhookSecretRef && input.webhookSecretRef !== webhookSecretRef) {
      throw new ProviderSubscriptionError("webhook_secret_reference_mismatch");
    }
    const verificationLease = await this.dependencies.vault.resolve(webhookSecretRef, secretContext(installation));
    verificationLease.dispose();
    const profile = getProviderOnboardingProfile(installation.providerId);
    const pendingVerification = !input.providerConfigured;
    const updated: ConnectorInstallationAdmin = {
      ...installation,
      status: pendingVerification ? "subscription_pending" : "active",
      webhookSecretPreviousRef: installation.webhookSecretRef && installation.webhookSecretRef !== webhookSecretRef
        ? installation.webhookSecretRef
        : installation.webhookSecretPreviousRef,
      webhookSecretRef,
      providerSubscriptionId: input.providerSubscriptionId,
      webhookStatus: pendingVerification ? "pending" : "active",
      allowedCapabilities: [...new Set([
        ...installation.allowedCapabilities,
        "provider.webhooks.verify" as const,
        "provider.health.read" as const,
        "provider.data.read" as const
      ])],
      updatedAt: new Date().toISOString()
    };
    await this.dependencies.store.saveInstallation(updated);
    return {
      installation: updated,
      endpointUrl: this.endpoint(updated),
      requiresProviderConfirmation: pendingVerification,
      eventFamilies: profile.ingestion.eventFamilies
    };
  }

  private async activateStripe(installation: ConnectorInstallationAdmin) {
    const credentialLease = await this.dependencies.vault.resolve(installation.credentialRef, secretContext(installation));
    let token: string;
    try {
      token = accessToken(credentialLease.reveal());
    } finally {
      credentialLease.dispose();
    }
    const profile = getProviderOnboardingProfile("stripe");
    const body = new URLSearchParams({
      url: this.endpoint(installation),
      description: `Loopgraph Hermes connector ${installation.id}`
    });
    for (const event of profile.ingestion.eventFamilies) body.append("enabled_events[]", event);
    const response = await (this.dependencies.fetcher ?? fetch)("https://api.stripe.com/v1/webhook_endpoints", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new ProviderSubscriptionError("stripe_subscription_failed");
    const result = await response.json() as { id?: string; secret?: string; status?: string };
    if (!result.id || !result.secret || result.status !== "enabled") throw new ProviderSubscriptionError("stripe_subscription_response_invalid");
    const secretRef = deriveCredentialChildReference(installation.credentialRef, "webhooks/signing");
    await this.dependencies.vault.put(secretRef, result.secret, secretContext(installation));
    const updated: ConnectorInstallationAdmin = {
      ...installation,
      status: "active",
      webhookSecretPreviousRef: installation.webhookSecretRef && installation.webhookSecretRef !== secretRef
        ? installation.webhookSecretRef
        : installation.webhookSecretPreviousRef,
      webhookSecretRef: secretRef,
      providerSubscriptionId: result.id,
      webhookStatus: "active",
      allowedCapabilities: [...new Set([
        ...installation.allowedCapabilities,
        "provider.webhooks.subscribe" as const,
        "provider.webhooks.verify" as const,
        "provider.health.read" as const,
        "provider.data.read" as const
      ])],
      updatedAt: new Date().toISOString()
    };
    await this.dependencies.store.saveInstallation(updated);
    return { installation: updated, endpointUrl: this.endpoint(updated), requiresProviderConfirmation: false, eventFamilies: profile.ingestion.eventFamilies };
  }

  private endpoint(installation: ConnectorInstallationAdmin) {
    return new URL(
      `/api/connector-broker/v1/webhooks/${installation.id}`,
      this.dependencies.publicUrl
    ).toString();
  }
}

export class ProviderSubscriptionError extends Error {
  constructor(readonly code: string) {
    super(`Provider subscription failed: ${code}`);
    this.name = "ProviderSubscriptionError";
  }
}

function accessToken(value: string) {
  try {
    const parsed = JSON.parse(value) as { access_token?: unknown };
    if (typeof parsed.access_token === "string") return parsed.access_token;
  } catch {
    if (value.length > 0) return value;
  }
  throw new ProviderSubscriptionError("provider_token_invalid");
}

function secretContext(installation: ConnectorInstallationAdmin) {
  return {
    ...installation.tenant,
    expectedNamespace: installation.credentialNamespace,
    customerManagedKeyRef: installation.customerManagedKeyRef
  };
}
