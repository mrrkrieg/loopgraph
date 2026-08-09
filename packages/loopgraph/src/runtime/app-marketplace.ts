import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKETPLACE_SCHEMA_VERSION,
  marketplaceAppSchema,
  marketplaceCatalogSourceSchema,
  type LoopPackArtifact,
  type MarketplaceApp,
  type MarketplaceAppVersion,
  type MarketplaceCatalogSource
} from "../core";
import { loadLoopPackDirectory, marketplaceVersionFromArtifact, satisfiesVersionRange } from "./app-pack-loader";

type MarketplaceIndex = {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION;
  apps: MarketplaceApp[];
  refreshedAt: string;
};

const activeMarketplaceRefreshes = new Map<string, Promise<MarketplaceApp[]>>();

export type MarketplaceSearchInput = {
  query?: string;
  department?: string;
  capability?: string;
  maturity?: MarketplaceAppVersion["maturity"];
  includeDeprecated?: boolean;
  limit?: number;
};

export type MarketplaceSearchResult = {
  app: MarketplaceApp;
  score: number;
  matchedTerms: string[];
};

export class LocalAppMarketplace {
  private readonly sourcesPath: string;
  private readonly indexPath: string;
  private artifactLocations = new Map<string, string>();

  constructor(
    private readonly stateRoot: string,
    private readonly bundledPacksRoot?: string
  ) {
    this.sourcesPath = path.join(stateRoot, "marketplace-sources.json");
    this.indexPath = path.join(stateRoot, "marketplace-index.json");
  }

  async initialize(): Promise<void> {
    await mkdir(this.stateRoot, { recursive: true });
    const sources = await this.listCatalogSources();
    if (!sources.some((source) => source.id === "loopgraph-official")) {
      const officialRoot = this.bundledPacksRoot ?? await resolveBundledPacksRoot();
      await this.addCatalogSource({
        schemaVersion: MARKETPLACE_SCHEMA_VERSION,
        id: "loopgraph-official",
        type: "official",
        uri: officialRoot,
        enabled: true,
        trustPolicy: "official_only"
      });
    }
  }

  async addCatalogSource(sourceInput: MarketplaceCatalogSource): Promise<MarketplaceCatalogSource> {
    const source = marketplaceCatalogSourceSchema.parse(sourceInput);
    if (source.type === "github" && (!source.pinnedRef || !source.expectedDigest)) {
      throw new Error("GitHub catalog sources must pin both a ref and expected digest");
    }
    const sources = await this.listCatalogSources();
    const next = [...sources.filter((candidate) => candidate.id !== source.id), source]
      .sort((left, right) => left.id.localeCompare(right.id));
    await atomicWriteJson(this.sourcesPath, { schemaVersion: MARKETPLACE_SCHEMA_VERSION, sources: next });
    return source;
  }

  async listCatalogSources(): Promise<MarketplaceCatalogSource[]> {
    const parsed = await readJson(this.sourcesPath);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { sources?: unknown }).sources)) return [];
    return (parsed as { sources: unknown[] }).sources.map((source) => marketplaceCatalogSourceSchema.parse(source));
  }

  async refreshCatalogSource(sourceId: string): Promise<MarketplaceApp[]> {
    const sources = await this.listCatalogSources();
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error(`Unknown marketplace source: ${sourceId}`);
    if (!source.enabled) throw new Error(`Marketplace source is disabled: ${sourceId}`);
    if (source.type === "hosted") {
      throw new Error("Hosted marketplace transport is not available in the local-first registry; use a synchronized filesystem cache");
    }

    const sourceRoot = resolveSourceRoot(source);
    const packDirectories = await discoverPackDirectories(sourceRoot);
    const versions: Array<{ artifact: LoopPackArtifact; location: string; marketplaceVersion: MarketplaceAppVersion }> = [];
    for (const directory of packDirectories) {
      const loaded = await loadLoopPackDirectory(directory, { requireSignature: source.trustPolicy === "signed" });
      if (source.expectedDigest && packDirectories.length === 1 && loaded.artifact.digest !== source.expectedDigest) {
        throw new Error(`Catalog source digest mismatch: expected ${source.expectedDigest}, received ${loaded.artifact.digest}`);
      }
      const artifactUri = `file://${directory}`;
      versions.push({
        artifact: loaded.artifact,
        location: directory,
        marketplaceVersion: marketplaceVersionFromArtifact(
          {
            ...loaded.artifact,
            provenance: {
              ...loaded.artifact.provenance,
              sourceType: source.type,
              sourceUri: source.uri,
              sourceRef: source.pinnedRef
            }
          },
          artifactUri,
          "tested"
        )
      });
    }

    const current = await this.readIndex();
    const sourceAppIds = new Set(versions.map((entry) => entry.artifact.manifest.metadata.id));
    const retained = current.apps.filter((app) => !sourceAppIds.has(app.id));
    const grouped = new Map<string, typeof versions>();
    for (const entry of versions) {
      const id = entry.artifact.manifest.metadata.id;
      grouped.set(id, [...(grouped.get(id) ?? []), entry]);
      this.artifactLocations.set(artifactKey(id, entry.artifact.manifest.metadata.version, entry.artifact.digest), entry.location);
    }
    const refreshed = Array.from(grouped.values()).map((entries) => marketplaceAppFromVersions(entries));
    const apps = [...retained, ...refreshed].sort((left, right) => left.name.localeCompare(right.name));
    await this.writeIndex({ schemaVersion: MARKETPLACE_SCHEMA_VERSION, apps, refreshedAt: new Date().toISOString() });
    await this.addCatalogSource({ ...source, refreshedAt: new Date().toISOString() });
    return refreshed;
  }

  async refreshAllCatalogSources(): Promise<MarketplaceApp[]> {
    const refreshKey = path.resolve(this.stateRoot);
    const active = activeMarketplaceRefreshes.get(refreshKey);
    if (active) return active;
    const refresh = this.refreshAllCatalogSourcesUnlocked();
    activeMarketplaceRefreshes.set(refreshKey, refresh);
    try {
      return await refresh;
    } finally {
      if (activeMarketplaceRefreshes.get(refreshKey) === refresh) {
        activeMarketplaceRefreshes.delete(refreshKey);
      }
    }
  }

  private async refreshAllCatalogSourcesUnlocked(): Promise<MarketplaceApp[]> {
    await this.initialize();
    const sources = await this.listCatalogSources();
    for (const source of sources.filter((candidate) => candidate.enabled)) {
      await this.refreshCatalogSource(source.id);
    }
    return (await this.readIndex()).apps;
  }

  async searchApps(input: MarketplaceSearchInput = {}): Promise<MarketplaceSearchResult[]> {
    const index = await this.readIndex();
    const queryTerms = tokenize(input.query ?? "");
    return index.apps.flatMap((app) => {
      const latest = app.versions.find((version) => version.version === app.latestVersion);
      if (!latest) return [];
      if (input.department && app.department !== input.department) return [];
      if (input.capability && !latest.requiredCapabilities.includes(input.capability)) return [];
      if (input.maturity && latest.maturity !== input.maturity) return [];
      if (!input.includeDeprecated && (latest.deprecated || latest.revokedAt)) return [];
      const haystack = tokenize([app.name, app.summary, app.description, app.department, ...app.tags, ...app.searchTerms].join(" "));
      const matchedTerms = queryTerms.filter((term) => haystack.some((word) => word.includes(term)));
      if (queryTerms.length > 0 && matchedTerms.length === 0) return [];
      const score = queryTerms.length === 0 ? 1 : matchedTerms.length / queryTerms.length;
      return [{ app, score, matchedTerms }];
    }).sort((left, right) => right.score - left.score || left.app.name.localeCompare(right.app.name))
      .slice(0, input.limit ?? 50);
  }

  async getApp(appId: string): Promise<MarketplaceApp | undefined> {
    return (await this.readIndex()).apps.find((app) => app.id === appId);
  }

  async listAppVersions(appId: string): Promise<MarketplaceAppVersion[]> {
    return (await this.getApp(appId))?.versions ?? [];
  }

  async resolveAppVersion(appId: string, versionRange = "latest"): Promise<MarketplaceAppVersion> {
    const app = await this.getApp(appId);
    if (!app) throw new Error(`Marketplace app not found: ${appId}`);
    const versions = app.versions
      .filter((version) => !version.revokedAt && !version.deprecated)
      .filter((version) => versionRange === "latest" || satisfiesVersionRange(version.version, versionRange))
      .sort((left, right) => compareVersionStrings(right.version, left.version));
    if (versions.length === 0) throw new Error(`No eligible version of ${appId} satisfies ${versionRange}`);
    return versions[0];
  }

  async getAppArtifact(appId: string, version: string, expectedDigest?: string) {
    const appVersion = (await this.listAppVersions(appId)).find((candidate) => candidate.version === version);
    if (!appVersion) throw new Error(`Marketplace version not found: ${appId}@${version}`);
    if (expectedDigest && appVersion.digest !== expectedDigest) throw new Error("Requested artifact digest does not match marketplace metadata");
    let location = this.artifactLocations.get(artifactKey(appId, version, appVersion.digest));
    if (!location && appVersion.artifactUri.startsWith("file://")) location = appVersion.artifactUri.slice("file://".length);
    if (!location) throw new Error("Artifact is not available in the local marketplace cache");
    const loaded = await loadLoopPackDirectory(location);
    if (loaded.artifact.digest !== appVersion.digest) throw new Error("Cached artifact digest does not match immutable marketplace version");
    return loaded;
  }

  async verifyAppProvenance(appId: string, version: string): Promise<{
    verified: boolean;
    digestMatches: boolean;
    sourceType: string;
    signaturePresent: boolean;
    reasons: string[];
  }> {
    const appVersion = (await this.listAppVersions(appId)).find((candidate) => candidate.version === version);
    if (!appVersion) throw new Error(`Marketplace version not found: ${appId}@${version}`);
    const loaded = await this.getAppArtifact(appId, version, appVersion.digest);
    const digestMatches = loaded.artifact.digest === appVersion.digest;
    const signaturePresent = Boolean(loaded.artifact.provenance.signature);
    const official = loaded.manifest.metadata.publisher.id === "loopgraph" && loaded.manifest.metadata.publisher.verified;
    const reasons = [
      digestMatches ? "Artifact content matches the pinned digest." : "Artifact digest mismatch.",
      signaturePresent ? "Artifact has a publisher signature." : "Artifact has no publisher signature.",
      official ? "Publisher is the bundled verified Loopgraph publisher." : "Publisher is not the bundled Loopgraph publisher."
    ];
    return {
      verified: digestMatches && (signaturePresent || official),
      digestMatches,
      sourceType: loaded.artifact.provenance.sourceType,
      signaturePresent,
      reasons
    };
  }

  private async readIndex(): Promise<MarketplaceIndex> {
    const parsed = await readJson(this.indexPath);
    if (!parsed || typeof parsed !== "object") {
      return { schemaVersion: MARKETPLACE_SCHEMA_VERSION, apps: [], refreshedAt: new Date(0).toISOString() };
    }
    const value = parsed as { schemaVersion?: unknown; apps?: unknown; refreshedAt?: unknown };
    if (value.schemaVersion !== MARKETPLACE_SCHEMA_VERSION || !Array.isArray(value.apps) || typeof value.refreshedAt !== "string") {
      throw new Error("Invalid local marketplace index");
    }
    return {
      schemaVersion: MARKETPLACE_SCHEMA_VERSION,
      apps: value.apps.map((app) => marketplaceAppSchema.parse(app)),
      refreshedAt: value.refreshedAt
    };
  }

  private async writeIndex(index: MarketplaceIndex): Promise<void> {
    await atomicWriteJson(this.indexPath, index);
  }
}

async function resolveBundledPacksRoot(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "packs"),
    path.resolve(moduleDir, "..", "..", "packs"),
    path.resolve(moduleDir, "..", "..", "..", "..", "packs")
  ];
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "official"))) return candidate;
  }
  throw new Error("Bundled Loopgraph packs were not found");
}

function resolveSourceRoot(source: MarketplaceCatalogSource): string {
  if (source.type === "hosted") throw new Error("Hosted sources require synchronization before local use");
  if (source.uri.startsWith("file://")) return path.resolve(source.uri.slice("file://".length));
  return path.resolve(source.uri);
}

async function discoverPackDirectories(root: string): Promise<string[]> {
  const directories: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "loopgraph.pack.yaml")) {
      directories.push(directory);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !entry.name.startsWith(".")) await walk(path.join(directory, entry.name));
    }
  }
  await walk(path.resolve(root));
  return directories.sort();
}

function marketplaceAppFromVersions(
  entries: Array<{ artifact: LoopPackArtifact; marketplaceVersion: MarketplaceAppVersion }>
): MarketplaceApp {
  const versions = entries.map((entry) => entry.marketplaceVersion)
    .sort((left, right) => compareVersionStrings(right.version, left.version));
  const latestEntry = entries.find((entry) => entry.marketplaceVersion.version === versions[0].version) ?? entries[0];
  const metadata = latestEntry.artifact.manifest.metadata;
  return marketplaceAppSchema.parse({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    id: metadata.id,
    name: metadata.name,
    summary: metadata.summary,
    description: metadata.description,
    department: metadata.department,
    publisher: metadata.publisher,
    visibility: metadata.visibility,
    tags: metadata.tags,
    latestVersion: versions[0].version,
    versions,
    searchTerms: [...metadata.tags, metadata.department, ...latestEntry.artifact.manifest.requiredCapabilities],
    readmeUri: `${versions[0].artifactUri}/README.md`
  });
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9._-]+/).filter((term) => term.length > 1)));
}

function artifactKey(appId: string, version: string, digest: string): string {
  return `${appId}@${version}#${digest}`;
}

function compareVersionStrings(left: string, right: string): number {
  const a = left.split(/[.+-]/).slice(0, 3).map(Number);
  const b = right.split(/[.+-]/).slice(0, 3).map(Number);
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await rename(temporaryPath, filePath);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}
