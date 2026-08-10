import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAppMarketplace } from "./app-marketplace";

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
