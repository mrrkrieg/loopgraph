import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLoopPackDirectory } from "./app-pack-loader";
import {
  LocalAppMarketplace,
  catalogSnapshotDigest,
  type GitHubCatalogSynchronizer,
  type HostedCatalogSynchronizer
} from "./app-marketplace";
import { LoopgraphAppPublisher } from "./app-publisher";
import {
  PUBLISHED_CATALOG_FILE,
  PUBLISHED_CATALOG_SCHEMA_VERSION,
  readPublishedCatalog
} from "./app-publisher-catalog";

const temporaryDirectories: string[] = [];
const packsRoot = path.resolve(process.cwd(), "packs");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local app marketplace", () => {
  it("indexes bundled packs and supports outcome and capability search", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    const apps = await marketplace.refreshAllCatalogSources();
    expect(apps.map((app) => app.id)).toContain("loopgraph.sales.qualify-route-inbound-leads");
    const official = apps.find((app) => app.id === "loopgraph.sales.qualify-route-inbound-leads")?.versions[0];
    expect(official).toMatchObject({
      maturity: "tested",
      maturityEvidence: {
        artifactDigest: official?.digest,
        status: "passed",
        writeBlocked: true,
        providerWrites: 0
      }
    });
    expect(official?.maturityEvidence?.scenarioCount).toBeGreaterThanOrEqual(13);
    expect(official?.maturityEvidence?.passedScenarioCount).toBe(official?.maturityEvidence?.scenarioCount);

    const byOutcome = await marketplace.searchApps({ query: "qualify inbound leads" });
    expect(byOutcome[0]?.app.id).toBe("loopgraph.sales.qualify-route-inbound-leads");
    const byCapability = await marketplace.searchApps({ capability: "crm.lead.read" });
    expect(byCapability.map((result) => result.app.id)).toContain("loopgraph.sales.qualify-route-inbound-leads");

    const byFinanceOutcome = await marketplace.searchApps({ query: "explain forecast variance" });
    expect(byFinanceOutcome[0]?.app.id).toBe("loopgraph.ops-finance.manage-forecast-controls");
    const byFinanceCapability = await marketplace.searchApps({ capability: "finance.forecast.read" });
    expect(byFinanceCapability.map((result) => result.app.id)).toContain("loopgraph.ops-finance.manage-forecast-controls");

    const byHrOutcome = await marketplace.searchApps({ query: "operate fair people workflows" });
    expect(byHrOutcome[0]?.app.id).toBe("loopgraph.hr-talent.operate-people-workflows");
    const byHrCapability = await marketplace.searchApps({ capability: "hris.employee.read" });
    expect(byHrCapability.map((result) => result.app.id)).toContain("loopgraph.hr-talent.operate-people-workflows");

    const byLegalOutcome = await marketplace.searchApps({ query: "govern legal security compliance evidence" });
    expect(byLegalOutcome[0]?.app.id).toBe("loopgraph.legal-compliance.govern-evidence-and-exceptions");
    const byLegalCapability = await marketplace.searchApps({ capability: "policy.control.read" });
    expect(byLegalCapability.map((result) => result.app.id)).toContain("loopgraph.legal-compliance.govern-evidence-and-exceptions");

    const byManagementOutcome = await marketplace.searchApps({ query: "run company operating system" });
    expect(byManagementOutcome[0]?.app.id).toBe("loopgraph.management.run-company-operating-system");
    const byManagementCapability = await marketplace.searchApps({ capability: "loopgraph.topology.read" });
    expect(byManagementCapability.map((result) => result.app.id)).toContain("loopgraph.management.run-company-operating-system");
  });

  it("keeps a discovered local artifact at concept without digest-bound evaluation evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-unproven-catalog-"));
    temporaryDirectories.push(root);
    const sourceRoot = path.join(root, "source");
    await cp(path.join(packsRoot, "official", "sales", "qualify-route-inbound-leads"), path.join(sourceRoot, "sales-app"), { recursive: true });
    const marketplace = new LocalAppMarketplace(path.join(root, "state"), packsRoot);
    await marketplace.addCatalogSource({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "local-unproven",
      type: "filesystem",
      uri: `file://${sourceRoot}`,
      enabled: true,
      trustPolicy: "explicit_local"
    });
    const apps = await marketplace.refreshCatalogSource("local-unproven");
    expect(apps[0]?.versions[0]).toMatchObject({ maturity: "concept", provenanceVerified: false });
    expect(apps[0]?.versions[0].maturityEvidence).toBeUndefined();
  });

  it("resolves immutable versions and verifies the cached artifact", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    await marketplace.refreshAllCatalogSources();
    const version = await marketplace.resolveAppVersion("loopgraph.sales.qualify-route-inbound-leads", "^1.0.0");
    const loaded = await marketplace.getAppArtifact(version.appId, version.version, version.digest);
    expect(loaded.artifact.digest).toBe(version.digest);
    const provenance = await marketplace.verifyAppProvenance(version.appId, version.version);
    expect(provenance.digestMatches).toBe(true);
    expect(provenance.verified).toBe(true);
  });

  it("reads pre-provenance marketplace indexes and replaces the legacy source on refresh", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-legacy-index-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    await marketplace.refreshAllCatalogSources();
    const indexPath = path.join(stateRoot, "marketplace-index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as { apps: Array<{ versions: Array<Record<string, unknown>> }> };
    for (const app of index.apps) for (const version of app.versions) delete version.source;
    const staleVersion = index.apps.flatMap((app) => app.versions).find((version) => version.appId === "loopgraph.sales.qualify-route-inbound-leads");
    if (staleVersion) staleVersion.digest = `sha256:${"a".repeat(64)}`;
    await writeFile(indexPath, JSON.stringify(index, null, 2));

    const restarted = new LocalAppMarketplace(stateRoot, packsRoot);
    const legacy = await restarted.listAppVersions("loopgraph.sales.qualify-route-inbound-leads");
    expect(legacy[0]?.source.sourceId).toMatch(/^legacy-/);
    await restarted.refreshCatalogSource("loopgraph-official");
    const refreshed = await restarted.listAppVersions("loopgraph.sales.qualify-route-inbound-leads");
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.source).toMatchObject({ sourceId: "loopgraph-official", sourceType: "official", trustPolicy: "official_only" });
  });

  it("requires GitHub catalog taps to pin ref and digest", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    await expect(marketplace.addCatalogSource({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "company-github-catalog",
      type: "github",
      uri: "file:///tmp/company-catalog",
      enabled: true,
      trustPolicy: "signed"
    })).rejects.toThrow(/pin/i);
  });

  it("synchronizes a signed GitHub catalog by exact commit and snapshot digest", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-github-catalog-"));
    temporaryDirectories.push(projectRoot);
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const initialized = await publisher.initializeApp({
      destination: "apps/account-review",
      appId: "acme.sales.account-review",
      name: "Account Review",
      department: "sales",
      publisherId: "acme"
    });
    const key = await publisher.generatePublisherKey({ publisherId: "acme", keyId: "acme.github.primary" });
    await publisher.signApp({ packRoot: initialized.packRoot, keyId: key.keyId });
    const published = await publisher.publishApp({ packRoot: initialized.packRoot, catalogId: "acme.github" });
    const catalog = await readPublishedCatalog(published.catalogRoot);
    const loaded = await loadLoopPackDirectory(initialized.packRoot, {
      requireSignature: true,
      trustedPublisherKeys: [{ publisherId: key.publisherId, keyId: key.keyId, algorithm: key.algorithm, publicKey: key.publicKey }]
    });
    const expectedDigest = catalogSnapshotDigest({ artifacts: [loaded.artifact], publishedCatalog: catalog });
    const pinnedRef = "0123456789abcdef0123456789abcdef01234567";
    const synchronize: GitHubCatalogSynchronizer["synchronize"] = async (_source, destination) => {
      await cp(published.catalogRoot, destination, { recursive: true });
      return { resolvedRef: pinnedRef };
    };
    const stateRoot = path.join(projectRoot, "consumer-marketplace");
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot, {
      githubSynchronizer: { synchronize }
    });
    await marketplace.addCatalogSource({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "acme-github",
      type: "github",
      uri: "https://github.com/acme/loopgraph-apps.git",
      pinnedRef,
      expectedDigest,
      enabled: true,
      trustPolicy: "signed",
      trustedPublisherKeys: [{ publisherId: key.publisherId, keyId: key.keyId, algorithm: key.algorithm, publicKey: key.publicKey }]
    });

    const apps = await marketplace.refreshCatalogSource("acme-github");
    expect(apps.map((app) => app.id)).toEqual(["acme.sales.account-review"]);
    expect(apps[0]?.versions[0]).toMatchObject({
      digest: loaded.artifact.digest,
      maturity: "tested",
      maturityEvidence: {
        artifactDigest: loaded.artifact.digest,
        status: "passed",
        scenarioCount: 13,
        passedScenarioCount: 13
      },
      provenanceVerified: true,
      artifactUri: expect.stringContaining("/catalog-cache/acme-github/"),
      source: {
        sourceId: "acme-github",
        sourceType: "github",
        sourceUri: "https://github.com/acme/loopgraph-apps.git",
        sourceRef: pinnedRef,
        snapshotDigest: expectedDigest,
        trustPolicy: "signed",
        synchronizedAt: expect.any(String)
      }
    });

    const restarted = new LocalAppMarketplace(stateRoot, packsRoot, {
      githubSynchronizer: { synchronize }
    });
    const cached = await restarted.getAppArtifact("acme.sales.account-review", "0.1.0", loaded.artifact.digest);
    expect(cached.artifact.digest).toBe(loaded.artifact.digest);
  });

  it("stages one exact signed hosted release and reuses its immutable cache", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-hosted-catalog-"));
    temporaryDirectories.push(projectRoot);
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const initialized = await publisher.initializeApp({
      destination: "apps/product-review",
      appId: "acme.product.review",
      name: "Product Review",
      department: "product",
      publisherId: "acme"
    });
    const key = await publisher.generatePublisherKey({
      publisherId: "acme",
      keyId: "acme.hosted.primary"
    });
    await publisher.signApp({ packRoot: initialized.packRoot, keyId: key.keyId });
    const published = await publisher.publishApp({
      packRoot: initialized.packRoot,
      catalogId: "acme.hosted"
    });
    const loaded = await loadLoopPackDirectory(initialized.packRoot, {
      requireSignature: true,
      trustedPublisherKeys: [{
        publisherId: key.publisherId,
        keyId: key.keyId,
        algorithm: key.algorithm,
        publicKey: key.publicKey
      }]
    });
    let synchronizationCount = 0;
    const synchronize: HostedCatalogSynchronizer["synchronize"] = async (
      _source,
      destination
    ) => {
      synchronizationCount += 1;
      await cp(published.catalogRoot, destination, { recursive: true });
      return { resolvedRef: loaded.manifest.metadata.version };
    };
    const stateRoot = path.join(projectRoot, "consumer-marketplace");
    const source = {
      schemaVersion: "loopgraph-marketplace/v1alpha1" as const,
      id: "hosted.acme-product-review",
      type: "hosted" as const,
      uri:
        `hosted://marketplace/${loaded.manifest.metadata.id}/` +
        `${loaded.manifest.metadata.version}/${loaded.artifact.digest.slice("sha256:".length)}`,
      pinnedRef: loaded.manifest.metadata.version,
      expectedDigest: loaded.artifact.digest,
      enabled: true,
      trustPolicy: "signed" as const,
      trustedPublisherKeys: [{
        publisherId: key.publisherId,
        keyId: key.keyId,
        algorithm: key.algorithm,
        publicKey: key.publicKey
      }]
    };
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot, {
      hostedSynchronizer: { synchronize }
    });
    await marketplace.addCatalogSource(source);
    await marketplace.refreshCatalogSource(source.id);
    const app = await marketplace.getApp(loaded.manifest.metadata.id);
    expect(app?.versions[0]).toMatchObject({
      digest: loaded.artifact.digest,
      provenanceVerified: true,
      source: {
        sourceId: source.id,
        sourceType: "hosted",
        sourceUri: source.uri,
        sourceRef: loaded.manifest.metadata.version,
        trustPolicy: "signed"
      }
    });
    expect(synchronizationCount).toBe(1);

    const restarted = new LocalAppMarketplace(stateRoot, packsRoot);
    await expect(restarted.getAppArtifact(
      loaded.manifest.metadata.id,
      loaded.manifest.metadata.version,
      loaded.artifact.digest
    )).resolves.toMatchObject({ artifact: { digest: loaded.artifact.digest } });
    await restarted.refreshCatalogSource(source.id);
    expect(synchronizationCount).toBe(1);
    await expect(restarted.getAppArtifact(
      loaded.manifest.metadata.id,
      loaded.manifest.metadata.version,
      loaded.artifact.digest
    )).resolves.toMatchObject({ artifact: { digest: loaded.artifact.digest } });

    await writeFile(
      path.join(app!.versions[0]!.artifactUri.slice("file://".length), "README.md"),
      "tampered hosted cache\n"
    );
    await expect(restarted.refreshAllCatalogSources()).resolves.toEqual(
      expect.any(Array)
    );
    await expect(restarted.getAppArtifact(
      loaded.manifest.metadata.id,
      loaded.manifest.metadata.version,
      loaded.artifact.digest
    )).rejects.toThrow(/digest/i);
  });

  it("rejects hosted source metadata whose URI does not match its immutable pins", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-hosted-pins-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    await expect(marketplace.addCatalogSource({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "hosted.invalid-pins",
      type: "hosted",
      uri: `hosted://marketplace/acme.product.review/1.0.0/${"b".repeat(64)}`,
      pinnedRef: "1.0.1",
      expectedDigest: `sha256:${"a".repeat(64)}`,
      enabled: true,
      trustPolicy: "signed",
      trustedPublisherKeys: [{
        publisherId: "acme",
        keyId: "acme.primary",
        algorithm: "ed25519",
        publicKey: "public-key-material-that-is-long-enough"
      }]
    })).rejects.toThrow(/immutable source pins/i);
    await expect(marketplace.addCatalogSource({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "hosted.reserved-publisher",
      type: "hosted",
      uri: `hosted://marketplace/loopgraph.product.lookalike/1.0.0/${"a".repeat(64)}`,
      pinnedRef: "1.0.0",
      expectedDigest: `sha256:${"a".repeat(64)}`,
      enabled: true,
      trustPolicy: "signed",
      trustedPublisherKeys: [{
        publisherId: "loopgraph",
        keyId: "loopgraph.attacker",
        algorithm: "ed25519",
        publicKey: "public-key-material-that-is-long-enough"
      }]
    })).rejects.toThrow(/reserved loopgraph publisher namespace/i);
  });

  it("keeps catalog versions source-owned and rejects immutable cross-source conflicts", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-source-ownership-"));
    temporaryDirectories.push(projectRoot);
    const sourceA = path.join(projectRoot, "catalog-a");
    const sourceB = path.join(projectRoot, "catalog-b");
    const sourceC = path.join(projectRoot, "catalog-conflict");
    const officialPack = path.join(packsRoot, "official", "sales", "qualify-route-inbound-leads");
    await cp(officialPack, path.join(sourceA, "sales-app"), { recursive: true });
    await cp(officialPack, path.join(sourceB, "sales-app"), { recursive: true });
    await cp(officialPack, path.join(sourceC, "sales-app"), { recursive: true });
    const sourceBManifest = path.join(sourceB, "sales-app", "loopgraph.pack.yaml");
    await writeFile(sourceBManifest, (await readFile(sourceBManifest, "utf8")).replace("version: 1.0.0", "version: 1.1.0"));
    await writeFile(path.join(sourceC, "sales-app", "README.md"), "# Conflicting immutable release\n");

    const marketplace = new LocalAppMarketplace(path.join(projectRoot, "marketplace"), packsRoot);
    for (const [id, uri] of [["catalog-a", sourceA], ["catalog-b", sourceB], ["catalog-conflict", sourceC]] as const) {
      await marketplace.addCatalogSource({
        schemaVersion: "loopgraph-marketplace/v1alpha1",
        id,
        type: "filesystem",
        uri,
        enabled: true,
        trustPolicy: "explicit_local"
      });
    }

    await marketplace.refreshCatalogSource("catalog-a");
    await marketplace.refreshCatalogSource("catalog-b");
    expect((await marketplace.listAppVersions("loopgraph.sales.qualify-route-inbound-leads")).map((version) => [version.version, version.source.sourceId])).toEqual([
      ["1.1.0", "catalog-b"],
      ["1.0.0", "catalog-a"]
    ]);
    await expect(marketplace.refreshCatalogSource("catalog-conflict")).rejects.toThrow(/immutable marketplace version conflict/i);

    await rm(path.join(sourceA, "sales-app"), { recursive: true, force: true });
    await marketplace.refreshCatalogSource("catalog-a");
    expect((await marketplace.listAppVersions("loopgraph.sales.qualify-route-inbound-leads")).map((version) => [version.version, version.source.sourceId])).toEqual([
      ["1.1.0", "catalog-b"]
    ]);
  });

  it("propagates revocation across equally trusted mirrors of an immutable release", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-mirrored-revocation-"));
    temporaryDirectories.push(projectRoot);
    const sourceActive = path.join(projectRoot, "catalog-active");
    const sourceRevoked = path.join(projectRoot, "catalog-revoked");
    const officialPack = path.join(packsRoot, "official", "sales", "qualify-route-inbound-leads");
    await cp(officialPack, path.join(sourceActive, "sales-app"), { recursive: true });
    await cp(officialPack, path.join(sourceRevoked, "sales-app"), { recursive: true });
    const loaded = await loadLoopPackDirectory(path.join(sourceRevoked, "sales-app"));
    const revokedAt = "2026-08-16T00:00:00.000Z";
    await writeFile(path.join(sourceRevoked, PUBLISHED_CATALOG_FILE), JSON.stringify({
      schemaVersion: PUBLISHED_CATALOG_SCHEMA_VERSION,
      catalogId: "mirror-revocations",
      releases: [{
        appId: loaded.artifact.manifest.metadata.id,
        version: loaded.artifact.manifest.metadata.version,
        digest: loaded.artifact.digest,
        publisherId: loaded.artifact.manifest.metadata.publisher.id,
        keyId: "loopgraph.release-control",
        status: "revoked",
        message: "Compromised artifact",
        publishedAt: revokedAt,
        updatedAt: revokedAt
      }],
      updatedAt: revokedAt
    }, null, 2));

    const marketplace = new LocalAppMarketplace(path.join(projectRoot, "marketplace"), packsRoot);
    for (const [id, uri] of [["mirror-active", sourceActive], ["mirror-revoked", sourceRevoked]] as const) {
      await marketplace.addCatalogSource({
        schemaVersion: "loopgraph-marketplace/v1alpha1",
        id,
        type: "filesystem",
        uri,
        enabled: true,
        trustPolicy: "explicit_local"
      });
    }
    await marketplace.refreshCatalogSource("mirror-active");
    await marketplace.refreshCatalogSource("mirror-revoked");

    const versions = await marketplace.listAppVersions(loaded.artifact.manifest.metadata.id);
    expect(versions).toHaveLength(2);
    expect(versions.every((version) => version.revokedAt === revokedAt)).toBe(true);
    expect(versions.every((version) => version.revocationReason === "Compromised artifact")).toBe(true);
    await expect(marketplace.resolveAppVersion(loaded.artifact.manifest.metadata.id)).rejects.toThrow(/no eligible version/i);

    await marketplace.refreshCatalogSource("mirror-active");
    expect((await marketplace.listAppVersions(loaded.artifact.manifest.metadata.id)).every((version) => version.revokedAt === revokedAt)).toBe(true);
    await expect(marketplace.resolveAppVersion(loaded.artifact.manifest.metadata.id)).rejects.toThrow(/no eligible version/i);
  });

  it("rejects mutable, credential-bearing, unsigned, and digest-mismatched GitHub sources", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    const base = {
      schemaVersion: "loopgraph-marketplace/v1alpha1" as const,
      id: "company-github-catalog",
      type: "github" as const,
      uri: "https://github.com/acme/catalog.git",
      pinnedRef: "0123456789abcdef0123456789abcdef01234567",
      expectedDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      enabled: true,
      trustPolicy: "signed" as const,
      trustedPublisherKeys: [{
        publisherId: "acme",
        keyId: "acme.primary",
        algorithm: "ed25519" as const,
        publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----"
      }]
    };
    await expect(marketplace.addCatalogSource({ ...base, pinnedRef: "main" })).rejects.toThrow(/commit hash/i);
    await expect(marketplace.addCatalogSource({ ...base, uri: "https://token@github.com/acme/catalog.git" })).rejects.toThrow(/credentials/i);
    await expect(marketplace.addCatalogSource({ ...base, trustPolicy: "explicit_local" })).rejects.toThrow(/signed/i);

    const sourceRoot = path.join(stateRoot, "source");
    await cp(path.join(packsRoot, "official", "sales", "qualify-route-inbound-leads"), sourceRoot, { recursive: true });
    const mismatched = new LocalAppMarketplace(stateRoot, packsRoot, {
      githubSynchronizer: {
        async synchronize(_source, destination) {
          await cp(sourceRoot, destination, { recursive: true });
          return { resolvedRef: base.pinnedRef };
        }
      }
    });
    await mismatched.addCatalogSource(base);
    await expect(mismatched.refreshCatalogSource(base.id)).rejects.toThrow(/signature|digest/i);
  });

  it("requires signed catalogs to pin an exact publisher public key", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    await expect(marketplace.addCatalogSource({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "company-private-catalog",
      type: "filesystem",
      uri: "file:///tmp/company-private-catalog",
      enabled: true,
      trustPolicy: "signed"
    })).rejects.toThrow(/public key/i);
  });

  it("reserves the official source identity for the bundled Loopgraph catalog", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    await expect(marketplace.addCatalogSource({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "malicious-official",
      type: "official",
      uri: "file:///tmp/not-loopgraph",
      enabled: true,
      trustPolicy: "official_only"
    })).rejects.toThrow(/reserved/i);
  });

  it("coalesces concurrent refreshes for the same local marketplace", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-marketplace-"));
    temporaryDirectories.push(stateRoot);
    const first = new LocalAppMarketplace(stateRoot, packsRoot);
    const second = new LocalAppMarketplace(stateRoot, packsRoot);
    const [left, right] = await Promise.all([
      first.refreshAllCatalogSources(),
      second.refreshAllCatalogSources()
    ]);
    expect(left.map((app) => app.id)).toEqual(right.map((app) => app.id));
    expect(left.map((app) => app.id)).toContain("loopgraph.sales.qualify-route-inbound-leads");
  });
});
