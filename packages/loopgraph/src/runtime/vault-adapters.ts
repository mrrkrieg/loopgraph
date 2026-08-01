import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { promisify } from "node:util";
import { credentialReferenceMatchesNamespace, credentialReferenceSchema, type CredentialReference, type CustomerManagedKeyReference } from "../core";

const execFile = promisify(execFileCallback);

export type SecretResolutionContext = {
  organizationId: string;
  projectKey: string;
  expectedNamespace: string;
  customerManagedKeyRef?: CustomerManagedKeyReference;
};

export type SecretMaterial = {
  value: string;
  version?: string;
  expiresAt?: string;
};

export type SecretVersionMetadata = {
  version?: string;
  referenceFingerprint: string;
  createdAt: string;
};

export type SecretMetadata = {
  referenceFingerprint: string;
  backend: string;
  status: "active" | "disabled" | "destroyed" | "unknown";
  version?: string;
};

export type SecretBackendHealth = {
  status: "configured" | "unavailable";
  backends: Array<{ scheme: string; status: "configured" | "unavailable" }>;
};

export class SecretLease {
  readonly version?: string;
  readonly expiresAt: string;
  #bytes: Buffer;
  #disposed = false;

  constructor(material: SecretMaterial, now = Date.now()) {
    this.#bytes = Buffer.from(material.value, "utf8");
    this.version = material.version;
    const backendExpiry = material.expiresAt ? Date.parse(material.expiresAt) : Number.POSITIVE_INFINITY;
    this.expiresAt = new Date(Math.min(backendExpiry, now + 30_000)).toISOString();
  }

  reveal() {
    if (this.#disposed) throw new Error("Secret lease is already disposed");
    if (Date.parse(this.expiresAt) < Date.now()) {
      this.dispose();
      throw new Error("Secret lease has expired");
    }
    return this.#bytes.toString("utf8");
  }

  dispose() {
    if (!this.#disposed) this.#bytes.fill(0);
    this.#disposed = true;
  }

  toJSON(): never {
    throw new Error("Secret leases cannot be serialized");
  }

  toString() {
    return "[REDACTED SecretLease]";
  }

  [inspect.custom]() {
    return "[REDACTED SecretLease]";
  }
}

export interface VaultAdapter {
  readonly schemes: readonly string[];
  resolve(reference: CredentialReference, context: SecretResolutionContext): Promise<SecretMaterial>;
  put?(reference: CredentialReference, value: string, context: SecretResolutionContext): Promise<{ version?: string }>;
  delete?(reference: CredentialReference, context: SecretResolutionContext): Promise<void>;
  disable?(reference: CredentialReference, context: SecretResolutionContext): Promise<void>;
  metadata?(reference: CredentialReference, context: SecretResolutionContext): Promise<Omit<SecretMetadata, "referenceFingerprint" | "backend">>;
  healthCheck?(): Promise<"configured" | "unavailable">;
}

export type WorkloadAccessTokenProvider = (input: {
  audience: string;
  organizationId: string;
  projectKey: string;
}) => Promise<string>;

export class CompositeVault {
  readonly schemes: readonly string[];
  private readonly adapters = new Map<string, VaultAdapter>();

  constructor(adapters: VaultAdapter[]) {
    for (const adapter of adapters) {
      for (const scheme of adapter.schemes) {
        if (this.adapters.has(scheme)) throw new Error(`Duplicate vault adapter for ${scheme}://`);
        this.adapters.set(scheme, adapter);
      }
    }
    this.schemes = [...this.adapters.keys()];
  }

  async resolve(reference: CredentialReference, context: SecretResolutionContext) {
    assertTenantNamespace(reference, context.expectedNamespace);
    return new SecretLease(await this.adapter(reference).resolve(reference, context));
  }

  async accessForExecution(input: { reference: CredentialReference; context: SecretResolutionContext }) {
    return this.resolve(input.reference, input.context);
  }

  async put(reference: CredentialReference, value: string, context: SecretResolutionContext) {
    assertTenantNamespace(reference, context.expectedNamespace);
    const adapter = this.adapter(reference);
    if (!adapter.put) throw new Error(`${schemeOf(reference)} vault adapter is read-only`);
    return adapter.put(reference, value, context);
  }

  async putVersion(input: { reference: CredentialReference; value: string; context: SecretResolutionContext }): Promise<SecretVersionMetadata> {
    const result = await this.put(input.reference, input.value, input.context);
    return {
      ...result,
      referenceFingerprint: referenceFingerprint(input.reference),
      createdAt: new Date().toISOString()
    };
  }

  async disableVersion(input: { reference: CredentialReference; context: SecretResolutionContext }) {
    assertTenantNamespace(input.reference, input.context.expectedNamespace);
    const adapter = this.adapter(input.reference);
    if (!adapter.disable) throw new Error(`${schemeOf(input.reference)} vault adapter cannot disable secret versions`);
    await adapter.disable(input.reference, input.context);
  }

  async destroyVersion(input: { reference: CredentialReference; context: SecretResolutionContext }) {
    await this.delete(input.reference, input.context);
  }

  async listMetadata(input: { references: CredentialReference[]; context: SecretResolutionContext }): Promise<SecretMetadata[]> {
    if (input.references.length > 100) throw new Error("Secret metadata request exceeds 100 exact references");
    return Promise.all(input.references.map(async (reference) => {
      assertTenantNamespace(reference, input.context.expectedNamespace);
      const adapter = this.adapter(reference);
      const metadata = await adapter.metadata?.(reference, input.context) ?? { status: "unknown" as const };
      return { ...metadata, referenceFingerprint: referenceFingerprint(reference), backend: schemeOf(reference) };
    }));
  }

  async healthCheck(): Promise<SecretBackendHealth> {
    const backends = await Promise.all([...this.adapters.entries()].map(async ([scheme, adapter]) => ({
      scheme,
      status: await adapter.healthCheck?.().catch(() => "unavailable" as const) ?? "configured" as const
    })));
    return { status: backends.every((backend) => backend.status === "configured") ? "configured" : "unavailable", backends };
  }

  async delete(reference: CredentialReference, context: SecretResolutionContext) {
    assertTenantNamespace(reference, context.expectedNamespace);
    const adapter = this.adapter(reference);
    if (!adapter.delete) throw new Error(`${schemeOf(reference)} vault adapter cannot delete secrets`);
    await adapter.delete(reference, context);
  }

  private adapter(reference: CredentialReference) {
    const scheme = schemeOf(reference);
    const adapter = this.adapters.get(scheme);
    if (!adapter) throw new Error(`No vault adapter is registered for ${scheme}://`);
    return adapter;
  }
}

export class GcpSecretManagerAdapter implements VaultAdapter {
  readonly schemes = ["gcp-sm"] as const;
  constructor(
    private readonly accessToken: WorkloadAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async resolve(reference: CredentialReference, context: SecretResolutionContext) {
    const baseResource = reference.slice("gcp-sm://".length);
    const resource = baseResource.includes("/versions/") ? baseResource : `${baseResource}/versions/latest`;
    const url = `https://secretmanager.googleapis.com/v1/${resource}:access`;
    const token = await this.accessToken({ audience: "https://secretmanager.googleapis.com/", ...context });
    const response = await this.fetcher(url, { headers: { authorization: `Bearer ${token}` }, signal: vaultTimeout() });
    if (!response.ok) throw new Error(`GCP Secret Manager access failed (${response.status})`);
    const body = await response.json() as { payload?: { data?: string }; name?: string };
    if (!body.payload?.data) throw new Error("GCP Secret Manager returned no secret payload");
    return { value: Buffer.from(body.payload.data, "base64").toString("utf8"), version: body.name };
  }

  async put(reference: CredentialReference, value: string, context: SecretResolutionContext) {
    const resource = reference.slice("gcp-sm://".length).replace(/\/versions\/[^/]+$/, "");
    const token = await this.accessToken({ audience: "https://secretmanager.googleapis.com/", ...context });
    let response = await this.fetcher(`https://secretmanager.googleapis.com/v1/${resource}:addVersion`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ payload: { data: Buffer.from(value).toString("base64") } }),
      signal: vaultTimeout()
    });
    if (response.status === 404) {
      const match = /^(projects\/[^/]+)\/secrets\/([^/]+)$/.exec(resource);
      const kmsKeyName = context.customerManagedKeyRef?.startsWith("gcp-kms://")
        ? context.customerManagedKeyRef.slice("gcp-kms://".length)
        : undefined;
      const location = kmsKeyName ? /\/locations\/([^/]+)\//.exec(kmsKeyName)?.[1] : undefined;
      if (!match || (kmsKeyName && !location)) throw new Error("GCP secret creation requires a valid project, secret, and optional KMS location");
      const createUrl = new URL(`https://secretmanager.googleapis.com/v1/${match[1]}/secrets`);
      createUrl.searchParams.set("secretId", match[2]);
      const created = await this.fetcher(createUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          replication: kmsKeyName
            ? { userManaged: { replicas: [{ location, customerManagedEncryption: { kmsKeyName } }] } }
            : { automatic: {} },
          labels: { managed_by: "loopgraph_connector_broker" }
        }),
        signal: vaultTimeout()
      });
      if (!created.ok && created.status !== 409) throw new Error(`GCP Secret Manager CMK secret creation failed (${created.status})`);
      response = await this.fetcher(`https://secretmanager.googleapis.com/v1/${resource}:addVersion`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ payload: { data: Buffer.from(value).toString("base64") } }),
        signal: vaultTimeout()
      });
    }
    if (!response.ok) throw new Error(`GCP Secret Manager write failed (${response.status})`);
    const body = await response.json() as { name?: string };
    return { version: body.name };
  }

  async delete(reference: CredentialReference, context: SecretResolutionContext) {
    let resource = reference.slice("gcp-sm://".length);
    const token = await this.accessToken({ audience: "https://secretmanager.googleapis.com/", ...context });
    if (!resource.includes("/versions/")) resource = `${resource}/versions/latest`;
    if (!/\/versions\/\d+$/.test(resource)) {
      const response = await this.fetcher(`https://secretmanager.googleapis.com/v1/${resource}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: vaultTimeout()
      });
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`GCP Secret Manager version lookup failed (${response.status})`);
      const body = await response.json() as { name?: string };
      if (!body.name || !/\/versions\/\d+$/.test(body.name)) throw new Error("GCP Secret Manager returned no destroyable version");
      resource = body.name;
    }
    const response = await this.fetcher(`https://secretmanager.googleapis.com/v1/${resource}:destroy`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: vaultTimeout()
    });
    if (!response.ok && response.status !== 404) throw new Error(`GCP Secret Manager destroy failed (${response.status})`);
  }

  async disable(reference: CredentialReference, context: SecretResolutionContext) {
    let resource = reference.slice("gcp-sm://".length);
    const token = await this.accessToken({ audience: "https://secretmanager.googleapis.com/", ...context });
    if (!resource.includes("/versions/")) resource = `${resource}/versions/latest`;
    const response = await this.fetcher(`https://secretmanager.googleapis.com/v1/${resource}:disable`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: vaultTimeout()
    });
    if (!response.ok && response.status !== 404) throw new Error(`GCP Secret Manager disable failed (${response.status})`);
  }
}

export class AzureKeyVaultAdapter implements VaultAdapter {
  readonly schemes = ["azure-kv"] as const;
  constructor(
    private readonly accessToken: WorkloadAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async resolve(reference: CredentialReference, context: SecretResolutionContext) {
    const [vault, ...path] = reference.slice("azure-kv://".length).split("/");
    if (!vault || path.length < 1) throw new Error("azure-kv reference must be azure-kv://<vault>/<secret>[/<version>]");
    const token = await this.accessToken({ audience: "https://vault.azure.net", ...context });
    const response = await this.fetcher(`https://${vault}.vault.azure.net/secrets/${path.join("/")}?api-version=7.4`, {
      headers: { authorization: `Bearer ${token}` },
      signal: vaultTimeout()
    });
    if (!response.ok) throw new Error(`Azure Key Vault access failed (${response.status})`);
    const body = await response.json() as { value?: string; id?: string };
    if (typeof body.value !== "string") throw new Error("Azure Key Vault returned no secret value");
    return { value: body.value, version: body.id };
  }

  async put(reference: CredentialReference, value: string, context: SecretResolutionContext) {
    const [vault, secret] = reference.slice("azure-kv://".length).split("/");
    if (!vault || !secret) throw new Error("azure-kv reference must include vault and secret");
    const token = await this.accessToken({ audience: "https://vault.azure.net", ...context });
    const response = await this.fetcher(`https://${vault}.vault.azure.net/secrets/${secret}?api-version=7.4`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ value, tags: { loopgraphOrganization: context.organizationId, loopgraphProject: context.projectKey } }),
      signal: vaultTimeout()
    });
    if (!response.ok) throw new Error(`Azure Key Vault write failed (${response.status})`);
    const body = await response.json() as { id?: string };
    return { version: body.id };
  }

  async delete(reference: CredentialReference, context: SecretResolutionContext) {
    const [vault, secret] = reference.slice("azure-kv://".length).split("/");
    const token = await this.accessToken({ audience: "https://vault.azure.net", ...context });
    const response = await this.fetcher(`https://${vault}.vault.azure.net/secrets/${secret}?api-version=7.4`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      signal: vaultTimeout()
    });
    if (!response.ok && response.status !== 404) throw new Error(`Azure Key Vault delete failed (${response.status})`);
  }

  async disable(reference: CredentialReference, context: SecretResolutionContext) {
    await this.delete(reference, context);
  }
}

export class HashicorpVaultAdapter implements VaultAdapter {
  readonly schemes = ["vault"] as const;
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: WorkloadAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async resolve(reference: CredentialReference, context: SecretResolutionContext) {
    const path = reference.slice("vault://".length);
    const token = await this.accessToken({ audience: this.baseUrl, ...context });
    const response = await this.fetcher(new URL(`/v1/${path}`, this.baseUrl), {
      headers: { "x-vault-token": token },
      signal: vaultTimeout()
    });
    if (!response.ok) throw new Error(`HashiCorp Vault access failed (${response.status})`);
    const body = await response.json() as { data?: { data?: Record<string, unknown>; metadata?: { version?: number } } | Record<string, unknown> };
    const container = body.data && "data" in body.data ? body.data.data : body.data;
    const value = container && typeof container === "object" ? (container as Record<string, unknown>).value : undefined;
    if (typeof value !== "string") throw new Error("HashiCorp Vault secret must contain a string field named value");
    const version = body.data && "metadata" in body.data
      ? (body.data as { metadata?: { version?: number } }).metadata?.version
      : undefined;
    return { value, version: version === undefined ? undefined : String(version) };
  }

  async put(reference: CredentialReference, value: string, context: SecretResolutionContext) {
    const path = reference.slice("vault://".length);
    const token = await this.accessToken({ audience: this.baseUrl, ...context });
    const response = await this.fetcher(new URL(`/v1/${path}`, this.baseUrl), {
      method: "POST",
      headers: { "x-vault-token": token, "content-type": "application/json" },
      body: JSON.stringify({ data: { value }, options: { cas: 0 } }),
      signal: vaultTimeout()
    });
    if (!response.ok) throw new Error(`HashiCorp Vault write failed (${response.status})`);
    const body = await response.json() as { data?: { version?: number } };
    return { version: body.data?.version === undefined ? undefined : String(body.data.version) };
  }

  async delete(reference: CredentialReference, context: SecretResolutionContext) {
    const token = await this.accessToken({ audience: this.baseUrl, ...context });
    const response = await this.fetcher(new URL(`/v1/${reference.slice("vault://".length)}`, this.baseUrl), {
      method: "DELETE",
      headers: { "x-vault-token": token },
      signal: vaultTimeout()
    });
    if (!response.ok && response.status !== 404) throw new Error(`HashiCorp Vault delete failed (${response.status})`);
  }

  async disable(reference: CredentialReference, context: SecretResolutionContext) {
    await this.delete(reference, context);
  }
}

export interface AwsSecretsManagerClient {
  getSecretValue(input: { secretId: string; organizationId: string; projectKey: string }): Promise<{
    secretString?: string;
    secretBinary?: Uint8Array;
    versionId?: string;
  }>;
  putSecretValue?(input: { secretId: string; secretString: string; organizationId: string; projectKey: string; customerManagedKeyRef?: CustomerManagedKeyReference }): Promise<{ versionId?: string }>;
  deleteSecret?(input: { secretId: string; organizationId: string; projectKey: string }): Promise<void>;
}

export class AwsSecretsManagerAdapter implements VaultAdapter {
  readonly schemes = ["aws-sm"] as const;
  constructor(private readonly client: AwsSecretsManagerClient) {}

  async resolve(reference: CredentialReference, context: SecretResolutionContext) {
    const result = await this.client.getSecretValue({
      secretId: reference.slice("aws-sm://".length),
      organizationId: context.organizationId,
      projectKey: context.projectKey
    });
    const value = result.secretString ?? (result.secretBinary ? Buffer.from(result.secretBinary).toString("utf8") : undefined);
    if (!value) throw new Error("AWS Secrets Manager returned no secret value");
    return { value, version: result.versionId };
  }

  async put(reference: CredentialReference, value: string, context: SecretResolutionContext) {
    if (!this.client.putSecretValue) throw new Error("AWS Secrets Manager client does not implement writes");
    const result = await this.client.putSecretValue({
      secretId: reference.slice("aws-sm://".length),
      secretString: value,
      organizationId: context.organizationId,
      projectKey: context.projectKey,
      customerManagedKeyRef: context.customerManagedKeyRef
    });
    return { version: result.versionId };
  }

  async delete(reference: CredentialReference, context: SecretResolutionContext) {
    if (!this.client.deleteSecret) throw new Error("AWS Secrets Manager client does not implement deletion");
    await this.client.deleteSecret({
      secretId: reference.slice("aws-sm://".length),
      organizationId: context.organizationId,
      projectKey: context.projectKey
    });
  }

  async disable(reference: CredentialReference, context: SecretResolutionContext) {
    await this.delete(reference, context);
  }
}

export class MacOsKeychainAdapter implements VaultAdapter {
  readonly schemes = ["keychain"] as const;

  async resolve(reference: CredentialReference) {
    if (process.platform !== "darwin") throw new Error("keychain:// is available only on macOS");
    const [service, account] = reference.slice("keychain://".length).split("/");
    if (!service || !account || !SAFE_KEYCHAIN_NAME.test(service) || !SAFE_KEYCHAIN_NAME.test(account)) {
      throw new Error("keychain reference must contain safe service and account names");
    }
    const { stdout } = await execFile("/usr/bin/security", ["find-generic-password", "-w", "-s", service, "-a", account], {
      timeout: 5_000,
      maxBuffer: 64 * 1024
    });
    return { value: stdout.replace(/\r?\n$/, "") };
  }

  async put(reference: CredentialReference, value: string) {
    const [service, account] = keychainParts(reference);
    await runSecurityWithPromptedSecret(
      ["add-generic-password", "-U", "-s", service, "-a", account, "-w"],
      value
    );
    return {};
  }

  async delete(reference: CredentialReference) {
    const [service, account] = keychainParts(reference);
    try {
      await execFile("/usr/bin/security", ["delete-generic-password", "-s", service, "-a", account], {
        timeout: 5_000,
        maxBuffer: 64 * 1024
      });
    } catch (error) {
      if (!String(error).includes("could not be found")) throw error;
    }
  }

  async disable(reference: CredentialReference, context: SecretResolutionContext) {
    void context;
    await this.delete(reference);
  }
}

export class DevelopmentEnvironmentAdapter implements VaultAdapter {
  readonly schemes = ["env-ref"] as const;

  async resolve(reference: CredentialReference) {
    if (process.env.NODE_ENV === "production") throw new Error("env-ref:// is disabled in production");
    const key = reference.slice("env-ref://".length);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(key)) throw new Error("Invalid environment credential reference");
    const value = process.env[key];
    if (!value) throw new Error(`Environment credential ${key} is not configured`);
    return { value };
  }
}

const SAFE_KEYCHAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function schemeOf(reference: string) {
  credentialReferenceSchema.parse(reference);
  return reference.slice(0, reference.indexOf("://"));
}

function assertTenantNamespace(reference: string, expectedNamespace: string) {
  credentialReferenceSchema.parse(reference);
  if (!expectedNamespace || expectedNamespace.includes("..")) throw new Error("Invalid expected credential namespace");
  if (!credentialReferenceMatchesNamespace(reference, expectedNamespace)) {
    throw new Error("Credential reference is outside the installation tenant namespace");
  }
}

function keychainParts(reference: string): [string, string] {
  if (process.platform !== "darwin") throw new Error("keychain:// is available only on macOS");
  const [service, account] = reference.slice("keychain://".length).split("/");
  if (!service || !account || !SAFE_KEYCHAIN_NAME.test(service) || !SAFE_KEYCHAIN_NAME.test(account)) {
    throw new Error("keychain reference must contain safe service and account names");
  }
  return [service, account];
}

function runSecurityWithPromptedSecret(args: string[], secret: string) {
  if (Buffer.byteLength(secret, "utf8") > 256 * 1024) throw new Error("Keychain secret exceeds 256 KiB");
  return new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("macOS Keychain operation timed out"));
    }, 5_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("macOS Keychain operation failed"));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("macOS Keychain operation failed"));
    });
    child.stdin.end(`${secret}\n`);
  });
}

function vaultTimeout() {
  return AbortSignal.timeout(15_000);
}

function referenceFingerprint(reference: string) {
  return createHash("sha256").update(reference).digest("hex").slice(0, 16);
}
