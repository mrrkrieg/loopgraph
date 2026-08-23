import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

export type WorkloadTokenRequest = {
  audience: string;
};

export interface WorkloadTokenProvider {
  getToken(input: WorkloadTokenRequest): Promise<string>;
}

export class ProjectedFileWorkloadTokenProvider implements WorkloadTokenProvider {
  constructor(private readonly filePath: string) {
    if (!path.isAbsolute(filePath)) {
      throw new Error("Projected workload token path must be absolute");
    }
  }

  async getToken(): Promise<string> {
    let handle;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 32 || metadata.size > 64 * 1024) {
        throw new Error("Projected workload token must be one bounded regular file");
      }
      if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
        throw new Error("Projected workload token must not be accessible by group or other users");
      }
      return boundedToken(await handle.readFile("utf8"));
    } finally {
      await handle?.close();
    }
  }
}

export function hasAmbientWorkloadIdentity(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.LOOPGRAPH_WORKLOAD_IDENTITY_TOKEN_FILE ||
    env.SPIFFE_JWT_SVID_FILE ||
    env.GCE_METADATA_HOST ||
    env.K_SERVICE ||
    env.IDENTITY_ENDPOINT ||
    env.MSI_ENDPOINT ||
    (env.NODE_ENV !== "production" && env.LOOPGRAPH_DEV_WORKLOAD_IDENTITY_TOKEN)
  );
}

export class AmbientWorkloadTokenProvider implements WorkloadTokenProvider {
  constructor(private readonly dependencies: { fetcher?: typeof fetch } = {}) {}

  async getToken(input: WorkloadTokenRequest) {
    const projectedFile = process.env.LOOPGRAPH_WORKLOAD_IDENTITY_TOKEN_FILE ??
      process.env.SPIFFE_JWT_SVID_FILE;
    if (projectedFile) return readProjectedToken(projectedFile);

    if (process.env.GCE_METADATA_HOST || process.env.K_SERVICE) {
      const host = process.env.GCE_METADATA_HOST ?? "metadata.google.internal";
      if (!/^(?:metadata\.google\.internal|169\.254\.169\.254)(?::\d{1,5})?$/.test(host)) {
        throw new Error("GCE_METADATA_HOST is not a trusted metadata endpoint");
      }
      const url = new URL(`http://${host}/computeMetadata/v1/instance/service-accounts/default/identity`);
      url.searchParams.set("audience", input.audience);
      url.searchParams.set("format", "full");
      const response = await this.fetcher()(url, {
        headers: { "metadata-flavor": "Google" },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) throw new Error(`GCP workload identity request failed (${response.status})`);
      return boundedToken(await response.text());
    }

    if (process.env.IDENTITY_ENDPOINT || process.env.MSI_ENDPOINT) {
      const endpoint = process.env.IDENTITY_ENDPOINT ?? process.env.MSI_ENDPOINT!;
      const url = new URL(endpoint);
      assertTrustedAzureIdentityEndpoint(url);
      url.searchParams.set("api-version", "2019-08-01");
      url.searchParams.set("resource", input.audience);
      const response = await this.fetcher()(url, {
        headers: {
          ...(process.env.IDENTITY_HEADER ? { "x-identity-header": process.env.IDENTITY_HEADER } : {}),
          metadata: "true"
        },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) throw new Error(`Azure workload identity request failed (${response.status})`);
      const body = await response.json() as { access_token?: string };
      return boundedToken(body.access_token ?? "");
    }

    if (process.env.NODE_ENV !== "production" && process.env.LOOPGRAPH_DEV_WORKLOAD_IDENTITY_TOKEN) {
      return boundedToken(process.env.LOOPGRAPH_DEV_WORKLOAD_IDENTITY_TOKEN);
    }
    throw new Error("No ambient workload identity is available for the connector broker");
  }

  private fetcher() {
    return this.dependencies.fetcher ?? fetch;
  }
}

async function readProjectedToken(path: string) {
  if (!path.startsWith("/")) throw new Error("Workload identity token file must be an absolute path");
  const token = await readFile(path, { encoding: "utf8" });
  return boundedToken(token);
}

function boundedToken(value: string) {
  const token = value.trim();
  if (token.length < 32 || token.length > 64 * 1024 || /\s/.test(token)) {
    throw new Error("Workload identity token has an invalid shape");
  }
  return token;
}

function assertTrustedAzureIdentityEndpoint(url: URL) {
  const trustedHttpHost = url.protocol === "http:" && [
    "127.0.0.1",
    "localhost",
    "169.254.169.254"
  ].includes(url.hostname);
  if ((!trustedHttpHost && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Azure workload identity endpoint is not trusted");
  }
}
