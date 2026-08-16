import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLoopPackDirectory } from "./app-pack-loader";
import {
  LocalAppMarketplace,
  catalogSnapshotDigest,
  type GitHubCatalogSynchronizer
} from "./app-marketplace";
import { LoopgraphAppPublisher } from "./app-publisher";
import { readPublishedCatalog } from "./app-publisher-catalog";

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
      provenanceVerified: true,
      artifactUri: expect.stringContaining("/catalog-cache/acme-github/")
    });

    const restarted = new LocalAppMarketplace(stateRoot, packsRoot, {
      githubSynchronizer: { synchronize }
    });
    const cached = await restarted.getAppArtifact("acme.sales.account-review", "0.1.0", loaded.artifact.digest);
    expect(cached.artifact.digest).toBe(loaded.artifact.digest);
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
