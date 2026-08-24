import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketplaceAppSchema } from "loopgraph/core";
import {
  hostedCatalogCacheRoot,
  loadLoopPackDirectory,
  LocalAppMarketplace,
  marketplaceVersionFromArtifact,
  LoopgraphAppPublisher
} from "loopgraph/runtime";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  getVisibleApp: vi.fn(),
  downloadArtifact: vi.fn()
}));

vi.mock("./hosted-marketplace-api", () => ({
  requireHostedMarketplaceContext: mocks.requireContext
}));
vi.mock("@/lib/db/adapters/supabase-marketplace-registry-store", () => ({
  SupabaseMarketplaceRegistryStore: class {
    getVisibleApp = mocks.getVisibleApp;
  }
}));
vi.mock("./hosted-marketplace-artifacts", () => ({
  HostedMarketplaceArtifactService: class {
    downloadVerifiedArtifact = mocks.downloadArtifact;
  }
}));

import { ensureHostedMarketplaceArtifact } from "./hosted-marketplace-cache";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("hosted marketplace cache", () => {
  it("downloads, verifies, reuses, and repairs one immutable hosted release", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-hosted-install-"));
    temporaryDirectories.push(projectRoot);
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const initialized = await publisher.initializeApp({
      destination: "publisher/product-insight",
      appId: "acme.product.insight",
      name: "Product Insight",
      department: "product",
      publisherId: "acme"
    });
    const key = await publisher.generatePublisherKey({
      publisherId: "acme",
      keyId: "acme.hosted.primary"
    });
    const trustKey = {
      publisherId: key.publisherId,
      keyId: key.keyId,
      algorithm: key.algorithm,
      publicKey: key.publicKey
    };
    await publisher.signApp({ packRoot: initialized.packRoot, keyId: key.keyId });
    const archivePath = path.join(projectRoot, "artifacts", "product-insight.loopgraph-pack.json");
    await publisher.packApp({ packRoot: initialized.packRoot, destination: archivePath });
    const loaded = await loadLoopPackDirectory(initialized.packRoot, {
      requireSignature: true,
      trustedPublisherKeys: [trustKey]
    });
    const publishedAt = "2026-08-16T00:00:00.000Z";
    const version = marketplaceVersionFromArtifact(
      loaded.artifact,
      `hosted://marketplace/${loaded.manifest.metadata.id}/${loaded.manifest.metadata.version}`,
      "tested",
      {
        sourceId: "hosted.tenant",
        sourceType: "hosted",
        sourceUri: "hosted://catalog/tenant",
        sourceRef: loaded.manifest.metadata.version,
        snapshotDigest: loaded.artifact.digest,
        trustPolicy: "signed",
        synchronizedAt: publishedAt
      }
    );
    const app = marketplaceAppSchema.parse({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: loaded.manifest.metadata.id,
      name: loaded.manifest.metadata.name,
      summary: loaded.manifest.metadata.summary,
      description: loaded.manifest.metadata.description,
      department: loaded.manifest.metadata.department,
      publisher: loaded.manifest.metadata.publisher,
      visibility: loaded.manifest.metadata.visibility,
      tags: loaded.manifest.metadata.tags,
      latestVersion: version.version,
      versions: [{ ...version, publishedAt, provenanceVerified: true }],
      searchTerms: loaded.manifest.metadata.tags
    });
    const archiveBytes = await readFile(archivePath);
    mocks.requireContext.mockResolvedValue({
      userClient: {},
      adminClient: {},
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      supabaseUrl: "https://example.supabase.co"
    });
    mocks.getVisibleApp.mockResolvedValue(app);
    mocks.downloadArtifact.mockResolvedValue({
      bytes: archiveBytes,
      artifactDigest: loaded.artifact.digest,
      publisherKey: trustKey
    });

    const staged = await ensureHostedMarketplaceArtifact({
      projectRoot,
      appId: app.id,
      versionRange: "^0.1.0"
    });
    expect(staged).toMatchObject({
      appId: app.id,
      version: "0.1.0",
      digest: loaded.artifact.digest,
      provenanceVerified: true,
      source: { sourceType: "hosted", trustPolicy: "signed" }
    });
    expect(mocks.downloadArtifact).toHaveBeenCalledTimes(1);

    await ensureHostedMarketplaceArtifact({
      projectRoot,
      appId: app.id,
      version: "0.1.0",
      artifactDigest: loaded.artifact.digest
    });
    expect(mocks.downloadArtifact).toHaveBeenCalledTimes(1);

    const stateRoot = path.join(projectRoot, ".loopgraph", "apps", "marketplace");
    const marketplace = new LocalAppMarketplace(stateRoot);
    const source = (await marketplace.listCatalogSources()).find((candidate) =>
      candidate.type === "hosted"
    );
    expect(source).toBeDefined();
    const cacheRoot = hostedCatalogCacheRoot(stateRoot, source!);
    await writeFile(path.join(cacheRoot, "README.md"), "tampered cache\n");

    await ensureHostedMarketplaceArtifact({
      projectRoot,
      appId: app.id,
      version: "0.1.0",
      artifactDigest: loaded.artifact.digest
    });
    expect(mocks.downloadArtifact).toHaveBeenCalledTimes(2);
    await expect(loadLoopPackDirectory(cacheRoot, {
      requireSignature: true,
      trustedPublisherKeys: [trustKey]
    })).resolves.toMatchObject({ artifact: { digest: loaded.artifact.digest } });

    mocks.getVisibleApp.mockResolvedValue(undefined);
    await expect(ensureHostedMarketplaceArtifact({
      projectRoot,
      appId: app.id,
      version: "0.1.0",
      artifactDigest: loaded.artifact.digest
    })).rejects.toThrow(/hosted marketplace app not found/i);
    expect((await marketplace.listCatalogSources()).some((candidate) =>
      candidate.type === "hosted"
    )).toBe(false);
  });
});
