import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  buildCredentialNamespace,
  connectorInstallationHasExpectedNamespace,
  credentialReferenceMatchesNamespace,
  deriveCredentialChildReference,
  type ConnectorInstallationAdmin,
  type ConnectorTenant,
  type CustomerManagedKeyReference,
  type CredentialReference,
  type ProviderId
} from "../core";
import { getProviderOnboardingProfile } from "./provider-onboarding";
import type { CompositeVault, SecretResolutionContext } from "./vault-adapters";

export type OAuthClientRegistration = {
  providerId: ProviderId;
  clientId: string;
  clientSecretRef?: CredentialReference;
  redirectUri: string;
  tokenAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
  revocationUrl?: string;
};

export type OAuthTransaction = {
  id: string;
  installationId: string;
  tenant: ConnectorTenant;
  providerId: ProviderId;
  stateHash: string;
  verifierRef?: CredentialReference;
  requestedScopes: string[];
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
};

export interface OAuthLifecycleStore {
  saveTransaction(transaction: OAuthTransaction): Promise<void>;
  findTransactionByStateHash(input: ConnectorTenant & { stateHash: string }): Promise<OAuthTransaction | undefined>;
  consumeTransaction(input: ConnectorTenant & { transactionId: string; consumedAt: string }): Promise<boolean>;
  saveInstallation(installation: ConnectorInstallationAdmin): Promise<void>;
  getInstallation(input: ConnectorTenant & { installationId: string }): Promise<ConnectorInstallationAdmin | undefined>;
  listRefreshDue(input: { before: string; limit: number }): Promise<ConnectorInstallationAdmin[]>;
  recordCredentialNamespace?(installation: ConnectorInstallationAdmin): Promise<void>;
  recordCredentialVersion?(input: {
    installation: ConnectorInstallationAdmin;
    lifecycleEvent: "connected" | "refreshed" | "rotated" | "recovered";
    actorId: string;
  }): Promise<number>;
  activateCredentialVersion?(input: {
    installation: ConnectorInstallationAdmin;
    lifecycleEvent: "connected" | "refreshed" | "rotated" | "recovered";
    actorId: string;
  }): Promise<number>;
  revokeCredentialVersions?(input: ConnectorTenant & { installationId: string; revokedAt: string }): Promise<void>;
}

export type OAuthLifecycleAudit = (event: {
  eventType: string;
  outcome: "accepted" | "denied" | "error";
  tenant: ConnectorTenant;
  installationId: string;
  providerId: ProviderId;
  actorId: string;
  correlationId: string;
  reasonCode?: string;
}) => Promise<void>;

type StoredOAuthToken = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_at?: string;
  provider_account_id?: string;
  instance_url?: string;
};

export class OAuthLifecycleService {
  constructor(private readonly dependencies: {
    store: OAuthLifecycleStore;
    vault: CompositeVault;
    clients: ReadonlyMap<ProviderId, OAuthClientRegistration>;
    audit: OAuthLifecycleAudit;
    platformSecretNamespace?: string;
    allocateCredentialReference?: (input: { namespace: string; providerId: ProviderId; installationId: string }) => CredentialReference;
    fetcher?: typeof fetch;
    now?: () => Date;
  }) {}

  async begin(input: {
    tenant: ConnectorTenant;
    installationId?: string;
    providerId: ProviderId;
    displayName: string;
    environment?: "development" | "staging" | "production";
    credentialRef?: CredentialReference;
    customerManagedKeyRef?: CustomerManagedKeyReference;
    actorId: string;
    correlationId: string;
  }) {
    const provider = getProviderOnboardingProfile(input.providerId);
    if (provider.authorization.mode !== "oauth2") throw new OAuthLifecycleError("oauth_not_supported");
    const client = this.client(input.providerId);
    const id = input.installationId ?? `provider_${randomUUID()}`;
    const environment = input.environment ?? "development";
    const namespace = buildCredentialNamespace({ ...input.tenant, providerId: input.providerId, installationId: id, environment });
    const credentialRef = input.credentialRef ?? this.dependencies.allocateCredentialReference?.({
      namespace,
      providerId: input.providerId,
      installationId: id
    });
    if (!credentialRef) throw new OAuthLifecycleError("credential_reference_not_allocated");
    if (!credentialReferenceMatchesNamespace(credentialRef, namespace)) throw new OAuthLifecycleError("credential_namespace_mismatch");
    const now = this.now();
    const state = randomBytes(32).toString("base64url");
    const verifier = provider.authorization.pkce ? randomBytes(48).toString("base64url") : undefined;
    const verifierRef = verifier ? deriveCredentialChildReference(credentialRef, `oauth/verifiers/${hash(state)}`) : undefined;
    if (verifier && verifierRef) {
      await this.dependencies.vault.put(verifierRef, verifier, {
        ...input.tenant,
        expectedNamespace: namespace,
        customerManagedKeyRef: input.customerManagedKeyRef
      });
    }
    const transaction: OAuthTransaction = {
      id: `oauth_tx_${randomUUID()}`,
      installationId: id,
      tenant: input.tenant,
      providerId: input.providerId,
      stateHash: hash(state),
      verifierRef,
      requestedScopes: provider.authorization.scopes,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
      createdAt: now.toISOString()
    };
    const installation: ConnectorInstallationAdmin = {
      id,
      tenant: input.tenant,
      providerId: input.providerId,
      displayName: input.displayName,
      environment,
      status: "awaiting_consent",
      credentialRef,
      credentialNamespace: namespace,
      grantedScopes: [],
      allowedCapabilities: ["provider.oauth.exchange", "provider.oauth.revoke", "provider.disconnect"],
      customerManagedKeyRef: input.customerManagedKeyRef,
      webhookStatus: "not_configured",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    await this.dependencies.store.saveInstallation(installation);
    await this.dependencies.store.recordCredentialNamespace?.(installation);
    await Promise.all([
      this.dependencies.store.saveTransaction(transaction),
      this.dependencies.audit({
        eventType: "connector.oauth.consent_started",
        outcome: "accepted",
        tenant: input.tenant,
        installationId: id,
        providerId: input.providerId,
        actorId: input.actorId,
        correlationId: input.correlationId
      })
    ]);
    const authorizationUrl = new URL(provider.authorization.authorizationUrl);
    authorizationUrl.searchParams.set("client_id", client.clientId);
    authorizationUrl.searchParams.set("redirect_uri", client.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", provider.authorization.scopes.join(" "));
    authorizationUrl.searchParams.set("state", state);
    if (verifier) {
      authorizationUrl.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
    }
    for (const [key, value] of Object.entries(provider.authorization.extraAuthorizeParameters)) {
      authorizationUrl.searchParams.set(key, value);
    }
    return { installation, authorizationUrl: authorizationUrl.toString(), expiresAt: transaction.expiresAt };
  }

  async completeCallback(input: {
    tenant: ConnectorTenant;
    state: string;
    authorizationCode: string;
    actorId: string;
    correlationId: string;
  }) {
    const transaction = await this.dependencies.store.findTransactionByStateHash({ ...input.tenant, stateHash: hash(input.state) });
    if (!transaction || transaction.consumedAt || Date.parse(transaction.expiresAt) < this.now().getTime()) {
      throw new OAuthLifecycleError("invalid_or_expired_state");
    }
    const consumed = await this.dependencies.store.consumeTransaction({
      ...input.tenant,
      transactionId: transaction.id,
      consumedAt: this.now().toISOString()
    });
    if (!consumed) throw new OAuthLifecycleError("oauth_state_replayed");
    const installation = await this.requireInstallation({ ...input.tenant, installationId: transaction.installationId });
    const provider = getProviderOnboardingProfile(transaction.providerId);
    if (provider.authorization.mode !== "oauth2") throw new OAuthLifecycleError("oauth_not_supported");
    const client = this.client(transaction.providerId);
    await this.dependencies.store.saveInstallation({ ...installation, status: "exchanging", updatedAt: this.now().toISOString() });
    const verifier = transaction.verifierRef
      ? await this.resolveSecret(transaction.verifierRef, this.secretContext(installation))
      : undefined;
    let token: StoredOAuthToken;
    try {
      token = await this.exchange(provider.authorization.tokenUrl, client, {
        grant_type: "authorization_code",
        code: input.authorizationCode,
        redirect_uri: client.redirectUri,
        ...(verifier ? { code_verifier: verifier } : {})
      });
    } catch (error) {
      await Promise.all([
        this.dependencies.store.saveInstallation({
          ...installation,
          status: "degraded",
          allowedCapabilities: ["provider.oauth.exchange", "provider.oauth.revoke", "provider.disconnect"],
          updatedAt: this.now().toISOString()
        }),
        this.dependencies.audit({
          eventType: "connector.oauth.exchange_failed",
          outcome: "error",
          tenant: input.tenant,
          installationId: installation.id,
          providerId: installation.providerId,
          actorId: input.actorId,
          correlationId: input.correlationId,
          reasonCode: "token_exchange_failed"
        })
      ]);
      throw error;
    }
    const tokenReference = deriveCredentialChildReference(installation.credentialRef, `oauth/tokens/${randomUUID()}`);
    await this.dependencies.vault.put(tokenReference, JSON.stringify(token), this.secretContext(installation));
    if (transaction.verifierRef) {
      await this.dependencies.vault.delete(transaction.verifierRef, this.secretContext(installation)).catch(() => undefined);
    }
    const now = this.now().toISOString();
    const grantedScopes = normalizeScopes(token.scope, transaction.requestedScopes);
    const missingScopes = transaction.requestedScopes.filter((scope) => !grantedScopes.includes(scope));
    const updated: ConnectorInstallationAdmin = {
      ...installation,
      credentialRef: tokenReference,
      status: missingScopes.length > 0 ? "degraded" : "connected",
      grantedScopes,
      allowedCapabilities: [...activeOAuthCapabilities(installation.providerId)],
      connectedBy: input.actorId,
      connectedAt: now,
      tokenExpiresAt: token.expires_at,
      updatedAt: now
    };
    try {
      await this.persistCredentialVersion(updated, "connected", input.actorId);
    } catch (error) {
      await this.dependencies.vault.delete(tokenReference, this.secretContext(updated)).catch(() => undefined);
      await this.dependencies.store.saveInstallation({
        ...installation,
        status: "degraded",
        allowedCapabilities: ["provider.oauth.exchange", "provider.oauth.revoke", "provider.disconnect"],
        updatedAt: this.now().toISOString()
      });
      throw error;
    }
    await this.dependencies.audit({
      eventType: missingScopes.length > 0 ? "connector.oauth.scope_narrowed" : "connector.oauth.connected",
      outcome: missingScopes.length > 0 ? "denied" : "accepted",
      tenant: input.tenant,
      installationId: installation.id,
      providerId: installation.providerId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      reasonCode: missingScopes.length > 0 ? "provider_granted_narrower_scopes" : undefined
    });
    return updated;
  }

  async refreshInstallation(input: ConnectorTenant & {
    installationId: string;
    actorId: string;
    correlationId: string;
    claimedLease?: boolean;
  }) {
    const installation = await this.requireInstallation(input);
    if (!["connected", "active", "degraded"].includes(installation.status) &&
      !(input.claimedLease === true && installation.status === "rotating")) {
      throw new OAuthLifecycleError("installation_not_refreshable");
    }
    const provider = getProviderOnboardingProfile(installation.providerId);
    if (provider.authorization.mode !== "oauth2") throw new OAuthLifecycleError("oauth_not_supported");
    const client = this.client(installation.providerId);
    await this.dependencies.store.saveInstallation({ ...installation, status: "rotating", updatedAt: this.now().toISOString() });
    const current = parseStoredToken(await this.resolveSecret(installation.credentialRef, this.secretContext(installation)));
    if (!current.refresh_token) throw new OAuthLifecycleError("refresh_token_unavailable");
    let refreshed: StoredOAuthToken;
    try {
      refreshed = await this.exchange(provider.authorization.tokenUrl, client, {
        grant_type: "refresh_token",
        refresh_token: current.refresh_token
      });
    } catch (error) {
      await Promise.all([
        this.dependencies.store.saveInstallation({
          ...installation,
          status: "degraded",
          allowedCapabilities: ["provider.oauth.refresh", "provider.oauth.revoke", "provider.disconnect"],
          updatedAt: this.now().toISOString()
        }),
        this.dependencies.audit({
          eventType: "connector.oauth.refresh_failed",
          outcome: "error",
          tenant: input,
          installationId: installation.id,
          providerId: installation.providerId,
          actorId: input.actorId,
          correlationId: input.correlationId,
          reasonCode: "refresh_failed"
        })
      ]);
      throw error;
    }
    const merged = { ...current, ...refreshed, refresh_token: refreshed.refresh_token ?? current.refresh_token };
    const previousReference = installation.credentialRef;
    const nextReference = deriveCredentialChildReference(previousReference, `rotations/${randomUUID()}`);
    await this.dependencies.vault.put(nextReference, JSON.stringify(merged), this.secretContext(installation));
    const refreshedScopes = normalizeScopes(merged.scope, installation.grantedScopes);
    const refreshMissingScopes = installation.grantedScopes.filter((scope) => !refreshedScopes.includes(scope));
    const updated = {
      ...installation,
      credentialRef: nextReference,
      status: refreshMissingScopes.length > 0 ? "degraded" as const : "active" as const,
      grantedScopes: refreshedScopes,
      allowedCapabilities: [...activeOAuthCapabilities(installation.providerId)],
      lastRotatedAt: this.now().toISOString(),
      tokenExpiresAt: merged.expires_at,
      updatedAt: this.now().toISOString()
    };
    try {
      await this.persistCredentialVersion(updated, "refreshed", input.actorId);
    } catch (error) {
      await this.dependencies.vault.delete(nextReference, this.secretContext(updated)).catch(() => undefined);
      await this.dependencies.store.saveInstallation({
        ...installation,
        status: "degraded",
        allowedCapabilities: ["provider.oauth.refresh", "provider.oauth.revoke", "provider.disconnect"],
        updatedAt: this.now().toISOString()
      });
      throw error;
    }
    await this.dependencies.audit({
      eventType: refreshMissingScopes.length > 0 ? "connector.oauth.scope_narrowed" : "connector.oauth.rotated",
      outcome: refreshMissingScopes.length > 0 ? "denied" : "accepted",
      tenant: input,
      installationId: installation.id,
      providerId: installation.providerId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      reasonCode: refreshMissingScopes.length > 0 ? "provider_granted_narrower_scopes" : undefined
    });
    await this.dependencies.vault.delete(previousReference, this.secretContext(installation)).catch(() => undefined);
    return updated;
  }

  async refreshDue(limit = 50) {
    const installations = await this.dependencies.store.listRefreshDue({
      before: new Date(this.now().getTime() + 5 * 60 * 1_000).toISOString(),
      limit: Math.min(Math.max(limit, 1), 100)
    });
    const results = [];
    for (const installation of installations) {
      try {
        results.push(await this.refreshInstallation({
          ...installation.tenant,
          installationId: installation.id,
          actorId: "system:oauth-refresh-worker",
          correlationId: `oauth_refresh_${randomUUID()}`,
          claimedLease: true
        }));
      } catch {
        const updated = {
          ...installation,
          status: "degraded" as const,
          allowedCapabilities: [
            "provider.oauth.refresh" as const,
            "provider.oauth.revoke" as const,
            "provider.disconnect" as const
          ],
          updatedAt: this.now().toISOString()
        };
        await Promise.all([
          this.dependencies.store.saveInstallation(updated),
          this.dependencies.audit({
            eventType: "connector.oauth.refresh_failed",
            outcome: "error",
            tenant: installation.tenant,
            installationId: installation.id,
            providerId: installation.providerId,
            actorId: "system:oauth-refresh-worker",
            correlationId: `oauth_refresh_failed_${randomUUID()}`,
            reasonCode: "refresh_failed"
          })
        ]);
      }
    }
    return { attempted: installations.length, refreshed: results.length };
  }

  async revoke(input: ConnectorTenant & {
    installationId: string;
    actorId: string;
    correlationId: string;
    emergency?: boolean;
  }) {
    const installation = await this.requireInstallation(input);
    const client = this.dependencies.clients.get(installation.providerId);
    const current = await this.resolveSecret(installation.credentialRef, this.secretContext(installation))
      .then(parseStoredToken)
      .catch(() => undefined);
    const revoking = { ...installation, status: "revoking" as const, updatedAt: this.now().toISOString() };
    await this.dependencies.store.saveInstallation(revoking);
    if (installation.providerId === "stripe" && installation.providerSubscriptionId && current?.access_token) {
      const response = await this.fetcher()(
        `https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(installation.providerSubscriptionId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${current.access_token}` },
          signal: AbortSignal.timeout(15_000)
        }
      );
      if (!response.ok && response.status !== 404) throw new OAuthLifecycleError("provider_subscription_revocation_failed");
    }
    if (client?.revocationUrl && current?.access_token) {
      const response = await this.fetcher()(client.revocationUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: current.access_token, client_id: client.clientId }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new OAuthLifecycleError("provider_revocation_failed");
    }
    if (installation.webhookSecretRef) {
      await this.dependencies.vault.delete(installation.webhookSecretRef, this.secretContext(installation));
    }
    await this.dependencies.vault.delete(installation.credentialRef, this.secretContext(installation));
    const revoked = {
      ...installation,
      status: "revoked" as const,
      allowedCapabilities: [],
      webhookStatus: "revoked" as const,
      revokedAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };
    await Promise.all([
      this.dependencies.store.saveInstallation(revoked),
      this.dependencies.store.revokeCredentialVersions?.({
        ...input,
        installationId: installation.id,
        revokedAt: revoked.revokedAt
      }) ?? Promise.resolve(),
      this.dependencies.audit({
        eventType: input.emergency ? "connector.credential.emergency_revoked" : "connector.oauth.revoked",
        outcome: "accepted",
        tenant: input,
        installationId: installation.id,
        providerId: installation.providerId,
        actorId: input.actorId,
        correlationId: input.correlationId
      })
    ]);
    return revoked;
  }

  private async exchange(tokenUrl: string, client: OAuthClientRegistration, parameters: Record<string, string>) {
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    const body = new URLSearchParams({ ...parameters, client_id: client.clientId });
    if (client.clientSecretRef) {
      const namespace = this.dependencies.platformSecretNamespace?.trim();
      if (!namespace || !credentialReferenceMatchesNamespace(client.clientSecretRef, namespace)) {
        throw new OAuthLifecycleError("oauth_client_secret_namespace_invalid");
      }
      const secret = await this.dependencies.vault.resolve(client.clientSecretRef, {
        organizationId: "platform",
        projectKey: "connector-broker",
        expectedNamespace: namespace
      });
      try {
        const clientSecret = secret.reveal();
        if (client.tokenAuthMethod === "client_secret_basic") {
          headers.authorization = `Basic ${Buffer.from(`${client.clientId}:${clientSecret}`).toString("base64")}`;
        } else if (client.tokenAuthMethod === "client_secret_post") {
          body.set("client_secret", clientSecret);
        }
      } finally {
        secret.dispose();
      }
    }
    const response = await this.fetcher()(tokenUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new OAuthLifecycleError("token_exchange_failed");
    const payload = await readBoundedJson(response, 256 * 1024);
    if (typeof payload.access_token !== "string") throw new OAuthLifecycleError("token_response_invalid");
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : undefined;
    return {
      access_token: payload.access_token,
      refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
      token_type: typeof payload.token_type === "string" ? payload.token_type : undefined,
      scope: typeof payload.scope === "string" ? payload.scope : undefined,
      instance_url: typeof payload.instance_url === "string" ? payload.instance_url : undefined,
      expires_at: expiresIn ? new Date(this.now().getTime() + expiresIn * 1_000).toISOString() : undefined
    } satisfies StoredOAuthToken;
  }

  private async persistCredentialVersion(
    installation: ConnectorInstallationAdmin,
    lifecycleEvent: "connected" | "refreshed" | "rotated" | "recovered",
    actorId: string
  ) {
    if (this.dependencies.store.activateCredentialVersion) {
      await this.dependencies.store.activateCredentialVersion({ installation, lifecycleEvent, actorId });
      return;
    }
    await this.dependencies.store.saveInstallation(installation);
    await this.dependencies.store.recordCredentialVersion?.({ installation, lifecycleEvent, actorId });
  }

  private async resolveSecret(reference: CredentialReference, context: SecretResolutionContext) {
    const lease = await this.dependencies.vault.resolve(reference, context);
    try {
      return lease.reveal();
    } finally {
      lease.dispose();
    }
  }

  private client(providerId: ProviderId) {
    const client = this.dependencies.clients.get(providerId);
    if (!client) throw new OAuthLifecycleError("oauth_client_not_configured");
    return client;
  }

  private async requireInstallation(input: ConnectorTenant & { installationId: string }) {
    const installation = await this.dependencies.store.getInstallation(input);
    if (!installation) throw new OAuthLifecycleError("installation_not_found");
    if (!connectorInstallationHasExpectedNamespace(installation)) throw new OAuthLifecycleError("credential_namespace_invalid");
    return installation;
  }

  private secretContext(installation: ConnectorInstallationAdmin) {
    return {
      ...installation.tenant,
      expectedNamespace: installation.credentialNamespace,
      customerManagedKeyRef: installation.customerManagedKeyRef
    };
  }

  private now() {
    return this.dependencies.now?.() ?? new Date();
  }

  private fetcher() {
    return this.dependencies.fetcher ?? fetch;
  }
}

export class OAuthLifecycleError extends Error {
  constructor(readonly code: string) {
    super(`OAuth lifecycle failed: ${code}`);
    this.name = "OAuthLifecycleError";
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeScopes(scope: string | undefined, fallback: string[]) {
  return scope ? [...new Set(scope.split(/[ ,]+/).filter(Boolean))] : fallback;
}

function activeOAuthCapabilities(providerId: ProviderId) {
  const detector = getProviderOnboardingProfile(providerId).ingestion.mode === "scheduled_detector";
  return [
    "provider.oauth.refresh",
    "provider.oauth.revoke",
    ...(detector
      ? ["provider.events.emit" as const]
      : ["provider.webhooks.subscribe" as const, "provider.webhooks.verify" as const]),
    "provider.health.read",
    "provider.data.read",
    "provider.disconnect"
  ] as const;
}

function parseStoredToken(value: string): StoredOAuthToken {
  if (Buffer.byteLength(value, "utf8") > 256 * 1024) throw new OAuthLifecycleError("stored_token_invalid");
  const parsed = JSON.parse(value) as Partial<StoredOAuthToken>;
  if (typeof parsed.access_token !== "string") throw new OAuthLifecycleError("stored_token_invalid");
  return parsed as StoredOAuthToken;
}

async function readBoundedJson(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new OAuthLifecycleError("token_response_too_large");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximum) throw new OAuthLifecycleError("token_response_too_large");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OAuthLifecycleError("token_response_invalid");
  }
}
