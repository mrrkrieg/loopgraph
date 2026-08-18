import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketplaceAppSchema } from "../core";
import {
  hostedCatalogCacheRoot,
  LocalAppMarketplace
} from "./app-marketplace";
import {
  loadLoopPackDirectory,
  marketplaceVersionFromArtifact
} from "./app-pack-loader";
import { LoopgraphAppPublisher } from "./app-publisher";
import { HostedMarketplaceClient } from "./hosted-marketplace-client";
import { ensureRemoteHostedMarketplaceArtifact } from "./hosted-marketplace-cache";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("remote hosted marketplace cache", () => {
  it("reauthorizes reuse, repairs corruption, and evicts revoked visibility", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-remote-marketplace-"));
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
      keyId: "acme.remote.primary"
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
    const getApp = vi.fn().mockResolvedValue(app);
    const downloadArtifact = vi.fn().mockResolvedValue({
      bytes: await readFile(archivePath),
      artifactDigest: loaded.artifact.digest,
      publisherKey: trustKey
    });
    const client = { getApp, downloadArtifact } as unknown as HostedMarketplaceClient;

    await expect(ensureRemoteHostedMarketplaceArtifact({
      client,
      projectRoot,
      appId: app.id,
      versionRange: "^0.1.0"
    })).resolves.toMatchObject({
      appId: app.id,
      version: "0.1.0",
      provenanceVerified: true,
      source: { sourceType: "hosted", trustPolicy: "signed" }
    });
    await ensureRemoteHostedMarketplaceArtifact({
      client,
      projectRoot,
      appId: app.id,
      version: "0.1.0",
      artifactDigest: loaded.artifact.digest
    });
    expect(getApp).toHaveBeenCalledTimes(2);
    expect(downloadArtifact).toHaveBeenCalledTimes(1);

    const stateRoot = path.join(projectRoot, ".loopgraph", "apps", "marketplace");
    const marketplace = new LocalAppMarketplace(stateRoot);
    const source = (await marketplace.listCatalogSources()).find((candidate) =>
      candidate.type === "hosted"
    );
    expect(source).toBeDefined();
    const cacheRoot = hostedCatalogCacheRoot(stateRoot, source!);
    await writeFile(path.join(cacheRoot, "README.md"), "tampered cache\n");

    await ensureRemoteHostedMarketplaceArtifact({
      client,
      projectRoot,
      appId: app.id,
      version: "0.1.0",
      artifactDigest: loaded.artifact.digest
    });
    expect(downloadArtifact).toHaveBeenCalledTimes(2);

    getApp.mockResolvedValue(undefined);
    await expect(ensureRemoteHostedMarketplaceArtifact({
      client,
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
