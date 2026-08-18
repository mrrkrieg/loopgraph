import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketplaceAppSchema } from "../core";
import { HostedMarketplaceClient } from "./hosted-marketplace-client";
import { LocalCliCredentialStore, profileFromTokens } from "./cli-device-auth";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const digest = `sha256:${"a".repeat(64)}`;
const app = marketplaceAppSchema.parse({
  schemaVersion: "loopgraph-marketplace/v1alpha1",
  id: "acme.product.feedback",
  name: "Feedback loop",
  summary: "Turn feedback into product work.",
  description: "A signed private product feedback application.",
  department: "product",
  publisher: { id: "acme", name: "Acme", verified: false },
  visibility: "private",
  tags: ["feedback"],
  latestVersion: "1.0.0",
  searchTerms: ["feedback"],
  versions: [{
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    appId: "acme.product.feedback",
    version: "1.0.0",
    digest,
    publishedAt: "2026-08-16T00:00:00.000Z",
    compatibility: { loopgraph: "*", hermes: "*", platforms: ["darwin", "linux", "win32"] },
    dependencies: [],
    permissions: [{
      capability: "support.ticket.read",
      authority: "read",
      mode: "required",
      risk: "low",
      purpose: "Read bounded feedback evidence.",
      customerFacing: false,
      defaultPolicy: "allowed",
      dataClasses: []
    }],
    requiredCapabilities: ["support.ticket.read"],
    presets: [{ id: "default", name: "Default", description: "Safe defaults.", path: "presets/default.yaml" }],
    modules: [],
    maturity: "tested",
    deprecated: false,
    artifactUri: "hosted://marketplace/acme.product.feedback/1.0.0",
    source: {
      sourceId: "hosted.tenant",
      sourceType: "hosted",
      sourceUri: "hosted://catalog/tenant",
      sourceRef: "1.0.0",
      snapshotDigest: digest,
      trustPolicy: "signed",
      synchronizedAt: "2026-08-16T00:00:00.000Z"
    },
    provenanceVerified: true
  }]
});

describe("HostedMarketplaceClient", () => {
  it("uses a short-lived workload token and fresh replay metadata for catalog reads", async () => {
    const tokenProvider = { getToken: vi.fn().mockResolvedValue("x".repeat(64)) };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: "hosted-marketplace-machine-search/v1",
      query: {},
      results: [{ app, score: 60, matchedTerms: ["name"] }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new HostedMarketplaceClient({
      baseUrl: "https://loopgraph.example/platform/",
      audience: "https://loopgraph.example/marketplace",
      tokenProvider,
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      projectKey: "main",
      fetcher
    });

    await expect(client.search({ query: "feedback", limit: 10 }))
      .resolves.toMatchObject([{ app: { id: app.id }, score: 60 }]);
    expect(tokenProvider.getToken).toHaveBeenCalledWith({
      audience: "https://loopgraph.example/marketplace"
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("/platform/api/marketplace/client/catalog?q=feedback&limit=10");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${"x".repeat(64)}`);
    expect(headers.get("x-loopgraph-organization-id")).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(headers.get("x-loopgraph-project-key")).toBe("main");
    expect(headers.get("x-loopgraph-request-id")).toMatch(/^marketplace_/);
    expect(Number.isFinite(Date.parse(headers.get("x-loopgraph-timestamp") ?? ""))).toBe(true);
    expect(init.redirect).toBe("error");
  });

  it("downloads only same-endpoint bounded bytes with exact signed identity headers", async () => {
    const bytes = new TextEncoder().encode('{"schemaVersion":"loopgraph-pack-archive/v1alpha1"}');
    const publicKey = "-----BEGIN PUBLIC KEY-----\nacme-test\n-----END PUBLIC KEY-----";
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(bytes.byteLength),
        "x-loopgraph-artifact-digest": digest,
        "x-loopgraph-publisher-id": "acme",
        "x-loopgraph-signature-algorithm": "ed25519",
        "x-loopgraph-key-id": "acme.primary",
        "x-loopgraph-public-key": Buffer.from(publicKey).toString("base64url")
      }
    }));
    const client = new HostedMarketplaceClient({
      baseUrl: "https://loopgraph.example",
      audience: "loopgraph-marketplace",
      tokenProvider: { getToken: vi.fn().mockResolvedValue("y".repeat(64)) },
      fetcher
    });

    await expect(client.downloadArtifact({
      appId: app.id,
      version: "1.0.0",
      artifactDigest: digest
    })).resolves.toEqual({
      bytes,
      artifactDigest: digest,
      publisherKey: {
        publisherId: "acme",
        algorithm: "ed25519",
        keyId: "acme.primary",
        publicKey
      }
    });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      redirect: "error"
    });
  });

  it("fails closed on partial configuration and oversized responses", async () => {
    expect(() => HostedMarketplaceClient.fromEnvironment({
      NODE_ENV: "test",
      LOOPGRAPH_MARKETPLACE_URL: "https://loopgraph.example"
    })).toThrow("configured together");
    const client = new HostedMarketplaceClient({
      baseUrl: "https://loopgraph.example",
      audience: "loopgraph-marketplace",
      tokenProvider: { getToken: vi.fn().mockResolvedValue("z".repeat(64)) },
      fetcher: vi.fn().mockResolvedValue(new Response("{}", {
        status: 200,
        headers: { "content-length": String(5 * 1024 * 1024) }
      }))
    });
    await expect(client.search()).rejects.toThrow("size limit");
  });

  it("discovers a browser-approved CLI profile while keeping ambient workload identity authoritative", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "loopgraph-hosted-client-"));
    temporaryDirectories.push(directory);
    const credentialsFile = path.join(directory, "credentials.json");
    const accessToken = `lgcli_access_${"a".repeat(43)}`;
    await new LocalCliCredentialStore(credentialsFile).saveProfile(profileFromTokens({
      baseUrl: "https://loopgraph.example",
      audience: "https://loopgraph.example/marketplace",
      tokens: {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 900,
        refresh_token: `lgcli_refresh_${"r".repeat(43)}`,
        refresh_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        scope: "marketplace.consume",
        organization_id: "123e4567-e89b-12d3-a456-426614174000",
        project_key: "main"
      }
    }));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: "hosted-marketplace-machine-search/v1",
      query: {},
      results: []
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = HostedMarketplaceClient.fromEnvironment({
      NODE_ENV: "test",
      LOOPGRAPH_CLI_CREDENTIALS_FILE: credentialsFile
    } as NodeJS.ProcessEnv, { fetcher });
    await expect(client?.search()).resolves.toEqual([]);
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get("authorization")).toBe(`Bearer ${accessToken}`);

    const unsafeFile = path.join(directory, "unsafe.json");
    await writeFile(unsafeFile, "not-json", { mode: 0o644 });
    expect(() => HostedMarketplaceClient.fromEnvironment({
      NODE_ENV: "test",
      LOOPGRAPH_MARKETPLACE_URL: "https://loopgraph.example",
      LOOPGRAPH_MARKETPLACE_AUDIENCE: "https://loopgraph.example/marketplace",
      LOOPGRAPH_WORKLOAD_IDENTITY_TOKEN_FILE: "/var/run/secrets/loopgraph/workload.jwt",
      LOOPGRAPH_CLI_CREDENTIALS_FILE: unsafeFile
    } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
