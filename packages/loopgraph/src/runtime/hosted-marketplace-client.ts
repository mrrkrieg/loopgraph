import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  artifactDigestSchema,
  marketplaceAppSchema,
  publisherTrustKeySchema,
  type MarketplaceApp,
  type PublisherTrustKey
} from "../core";
import { redactSensitiveString } from "./secret-redaction";
import {
  AmbientWorkloadTokenProvider,
  hasAmbientWorkloadIdentity,
  type WorkloadTokenProvider
} from "./workload-token-provider";
import {
  CliDeviceAuthorizationClient,
  CliSessionTokenProvider,
  LocalCliCredentialStore,
  cliCredentialFileFromEnvironment,
  readConfiguredCliProfile
} from "./cli-device-auth";

const MAX_CATALOG_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_REMOTE_MARKETPLACE_ARTIFACT_BYTES = 100 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const searchResultSchema = z.object({
  app: marketplaceAppSchema,
  score: z.number().finite(),
  matchedTerms: z.array(z.string().min(1).max(64)).max(16)
}).strict();

const searchResponseSchema = z.object({
  schemaVersion: z.literal("hosted-marketplace-machine-search/v1"),
  query: z.unknown(),
  results: z.array(searchResultSchema).max(100)
}).strict();

const appResponseSchema = z.object({
  schemaVersion: z.literal("hosted-marketplace-machine-app/v1"),
  app: marketplaceAppSchema.nullable()
}).strict();

export type HostedMarketplaceSearchResult = z.infer<typeof searchResultSchema>;
export type HostedMarketplaceDownloadedArtifact = {
  bytes: Uint8Array;
  artifactDigest: string;
  publisherKey: PublisherTrustKey;
};

export class HostedMarketplaceClient {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: {
    baseUrl: string;
    audience: string;
    tokenProvider: WorkloadTokenProvider;
    organizationId?: string;
    projectKey?: string;
    fetcher?: typeof fetch;
  }) {
    this.baseUrl = trustedMarketplaceBaseUrl(options.baseUrl);
    if (!options.audience.trim() || options.audience.length > 512) {
      throw new Error("Hosted marketplace audience is invalid");
    }
    if (options.organizationId && !UUID_PATTERN.test(options.organizationId)) {
      throw new Error("Hosted marketplace organization ID is invalid");
    }
    if (options.projectKey && !PROJECT_KEY_PATTERN.test(options.projectKey)) {
      throw new Error("Hosted marketplace project key is invalid");
    }
    this.fetcher = options.fetcher ?? fetch;
  }

  static fromEnvironment(
    env: NodeJS.ProcessEnv = process.env,
    dependencies: { fetcher?: typeof fetch; tokenProvider?: WorkloadTokenProvider } = {}
  ): HostedMarketplaceClient | undefined {
    const ambientWorkloadIdentity = hasAmbientWorkloadIdentity(env);
    const cliProfile = ambientWorkloadIdentity ? undefined : readConfiguredCliProfile(env);
    const baseUrl = env.LOOPGRAPH_MARKETPLACE_URL?.trim() ?? cliProfile?.baseUrl;
    const audience = env.LOOPGRAPH_MARKETPLACE_AUDIENCE?.trim() ?? cliProfile?.audience;
    if (!baseUrl && !audience) return undefined;
    if (!baseUrl || !audience) {
      throw new Error(
        "LOOPGRAPH_MARKETPLACE_URL and LOOPGRAPH_MARKETPLACE_AUDIENCE must be configured together"
      );
    }
    const tokenProvider = dependencies.tokenProvider ?? (
      cliProfile && !ambientWorkloadIdentity
        ? new CliSessionTokenProvider({
            profile: cliProfile,
            store: new LocalCliCredentialStore(cliCredentialFileFromEnvironment(env)),
            client: new CliDeviceAuthorizationClient(baseUrl, { fetcher: dependencies.fetcher })
          })
        : new AmbientWorkloadTokenProvider({ fetcher: dependencies.fetcher })
    );
    return new HostedMarketplaceClient({
      baseUrl,
      audience,
      tokenProvider,
      organizationId: env.LOOPGRAPH_MARKETPLACE_ORGANIZATION_ID?.trim() ?? cliProfile?.organizationId,
      projectKey: env.LOOPGRAPH_MARKETPLACE_PROJECT_KEY?.trim() ?? cliProfile?.projectKey,
      fetcher: dependencies.fetcher
    });
  }

  async search(input: {
    query?: string;
    department?: string;
    capability?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<HostedMarketplaceSearchResult[]> {
    const url = this.endpoint("api/marketplace/client/catalog");
    setOptionalQuery(url, "q", input.query);
    setOptionalQuery(url, "department", input.department);
    setOptionalQuery(url, "capability", input.capability);
    if (input.limit !== undefined) url.searchParams.set("limit", String(input.limit));
    if (input.offset !== undefined) url.searchParams.set("offset", String(input.offset));
    const response = await this.request(url);
    return searchResponseSchema.parse(
      await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES)
    ).results;
  }

  async getApp(
    appId: string,
    input: { includeDeprecated?: boolean } = {}
  ): Promise<MarketplaceApp | undefined> {
    const url = this.endpoint("api/marketplace/client/catalog");
    url.searchParams.set("appId", appId);
    url.searchParams.set(
      "includeDeprecated",
      String(input.includeDeprecated ?? true)
    );
    const response = await this.request(url);
    return appResponseSchema.parse(
      await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES)
    ).app ?? undefined;
  }

  async downloadArtifact(input: {
    appId: string;
    version: string;
    artifactDigest: string;
  }): Promise<HostedMarketplaceDownloadedArtifact> {
    const artifactDigest = artifactDigestSchema.parse(input.artifactDigest);
    const response = await this.request(
      this.endpoint("api/marketplace/client/artifacts"),
      {
        method: "POST",
        body: JSON.stringify({ ...input, artifactDigest }),
        headers: { "content-type": "application/json" }
      }
    );
    const returnedDigest = artifactDigestSchema.parse(
      response.headers.get("x-loopgraph-artifact-digest")
    );
    if (returnedDigest !== artifactDigest) {
      throw new HostedMarketplaceClientError(
        502,
        "Hosted marketplace returned a different artifact digest"
      );
    }
    const encodedKey = response.headers.get("x-loopgraph-public-key") ?? "";
    if (!/^[A-Za-z0-9_-]{32,16384}$/.test(encodedKey)) {
      throw new HostedMarketplaceClientError(
        502,
        "Hosted marketplace omitted the publisher verification key"
      );
    }
    const publisherKey = publisherTrustKeySchema.parse({
      publisherId: response.headers.get("x-loopgraph-publisher-id"),
      algorithm: response.headers.get("x-loopgraph-signature-algorithm"),
      keyId: response.headers.get("x-loopgraph-key-id"),
      publicKey: Buffer.from(encodedKey, "base64url").toString("utf8")
    });
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
    if (mediaType !== "application/json") {
      throw new HostedMarketplaceClientError(
        502,
        "Hosted marketplace artifact has an unexpected media type"
      );
    }
    return {
      bytes: await readBoundedBytes(
        response,
        MAX_REMOTE_MARKETPLACE_ARTIFACT_BYTES
      ),
      artifactDigest,
      publisherKey
    };
  }

  private async request(url: URL, init: RequestInit = {}) {
    const token = await this.options.tokenProvider.getToken({
      audience: this.options.audience
    });
    const requestId = `marketplace_${randomUUID()}`;
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");
    headers.set("x-loopgraph-request-id", requestId);
    headers.set("x-loopgraph-timestamp", new Date().toISOString());
    if (this.options.organizationId) {
      headers.set("x-loopgraph-organization-id", this.options.organizationId);
    }
    if (this.options.projectKey) {
      headers.set("x-loopgraph-project-key", this.options.projectKey);
    }
    const response = await this.fetcher(url, {
      ...init,
      headers,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const message = await safeErrorMessage(response);
      throw new HostedMarketplaceClientError(response.status, message);
    }
    return response;
  }

  private endpoint(relativePath: string) {
    return new URL(relativePath, ensureTrailingSlash(this.baseUrl));
  }
}

export class HostedMarketplaceClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HostedMarketplaceClientError";
  }
}

function trustedMarketplaceBaseUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Hosted marketplace URL must be an HTTP(S) origin without credentials or query state");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production hosted marketplace URLs must use HTTPS");
  }
  return url;
}

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function setOptionalQuery(url: URL, key: string, value?: string) {
  const normalized = value?.trim();
  if (normalized) url.searchParams.set(key, normalized);
}

async function readBoundedJson(response: Response, maximum: number) {
  const bytes = await readBoundedBytes(response, maximum);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new HostedMarketplaceClientError(
      502,
      "Hosted marketplace returned invalid JSON"
    );
  }
}

async function readBoundedBytes(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) {
    throw new HostedMarketplaceClientError(
      502,
      "Hosted marketplace response exceeded its size limit"
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new HostedMarketplaceClientError(
        502,
        "Hosted marketplace response exceeded its size limit"
      );
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function safeErrorMessage(response: Response) {
  try {
    const payload = await readBoundedJson(response, 1024 * 1024);
    const error = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).error
      : undefined;
    if (typeof error === "string") return redactSensitiveString(error);
  } catch {
    // Fall through to a status-only message. Never include untrusted bodies.
  }
  return `Hosted marketplace request failed (${response.status})`;
}
