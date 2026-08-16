import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  MARKETPLACE_SCHEMA_VERSION,
  canonicalAppDigest,
  marketplaceAppSchema,
  marketplaceCatalogSourceSchema,
  type LoopPackArtifact,
  type MarketplaceApp,
  type MarketplaceAppVersion,
  type MarketplaceCatalogSource,
  type PublisherTrustKey
} from "../core";
import { loadLoopPackDirectory, marketplaceVersionFromArtifact, satisfiesVersionRange } from "./app-pack-loader";
import {
  publishedReleaseKey,
  readPublishedCatalog,
  type PublishedCatalog
} from "./app-publisher-catalog";

const execFileAsync = promisify(execFile);

type MarketplaceIndex = {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION;
  apps: MarketplaceApp[];
  refreshedAt: string;
};

const activeMarketplaceRefreshes = new Map<string, Promise<MarketplaceApp[]>>();

export interface GitHubCatalogSynchronizer {
  synchronize(source: MarketplaceCatalogSource, destination: string): Promise<{ resolvedRef: string }>;
}

export type LocalAppMarketplaceOptions = {
  githubSynchronizer?: GitHubCatalogSynchronizer;
  trustedGitHosts?: string[];
};

type PreparedCatalogRoot = {
  root: string;
  finalRoot?: string;
  stagingRoot?: string;
};

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
  private artifactTrust = new Map<string, { requireSignature: boolean; trustedPublisherKeys: PublisherTrustKey[] }>();

  constructor(
    private readonly stateRoot: string,
    private readonly bundledPacksRoot?: string,
    private readonly options: LocalAppMarketplaceOptions = {}
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

  async addCatalogSource(sourceInput: Omit<MarketplaceCatalogSource, "trustedPublisherKeys"> & {
    trustedPublisherKeys?: PublisherTrustKey[];
  }): Promise<MarketplaceCatalogSource> {
    const source = marketplaceCatalogSourceSchema.parse(sourceInput);
    if (source.id === "loopgraph-official" || source.type === "official" || source.trustPolicy === "official_only") {
      const officialRoot = path.resolve(this.bundledPacksRoot ?? await resolveBundledPacksRoot());
      const sourceRoot = source.uri.startsWith("file://") ? path.resolve(source.uri.slice("file://".length)) : path.resolve(source.uri);
      if (source.id !== "loopgraph-official" || source.type !== "official" || source.trustPolicy !== "official_only" || sourceRoot !== officialRoot) {
        throw new Error("The official catalog identity and trust policy are reserved for the bundled Loopgraph packs");
      }
    }
    if (source.type === "github" && (!source.pinnedRef || !source.expectedDigest)) {
      throw new Error("GitHub catalog sources must pin both a ref and expected digest");
    }
    if (source.type === "github") validateGitHubCatalogSource(source, this.options.trustedGitHosts);
    if (source.trustPolicy === "signed" && source.trustedPublisherKeys.length === 0) {
      throw new Error("Signed catalog sources must pin at least one trusted publisher public key");
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
    const synchronizedAt = new Date().toISOString();

    const prepared = source.type === "github"
      ? await this.prepareGitHubCatalogRoot(source)
      : { root: resolveSourceRoot(source) };
    let sourceRoot = prepared.root;
    let packDirectories: string[];
    let publishedCatalog: PublishedCatalog | undefined;
    const loadedPacks: Array<{ artifact: LoopPackArtifact; location: string }> = [];
    try {
      packDirectories = await discoverPackDirectories(sourceRoot);
      publishedCatalog = await readPublishedCatalog(sourceRoot);
      for (const directory of packDirectories) {
        const loaded = await loadLoopPackDirectory(directory, {
          requireSignature: source.trustPolicy === "signed",
          trustedPublisherKeys: source.trustedPublisherKeys
        });
        validateCatalogArtifactOwnership(source, loaded.artifact);
        if (source.type !== "github" && source.expectedDigest && packDirectories.length === 1 && loaded.artifact.digest !== source.expectedDigest) {
          throw new Error(`Catalog source digest mismatch: expected ${source.expectedDigest}, received ${loaded.artifact.digest}`);
        }
        loadedPacks.push({ artifact: loaded.artifact, location: directory });
      }
    } catch (error) {
      await cleanupPreparedCatalogRoot(prepared);
      throw error;
    }
    const releases = new Map((publishedCatalog?.releases ?? []).map((release) => [
      publishedReleaseKey(release.appId, release.version, release.digest),
      release
    ]));
    const snapshotDigest = catalogSnapshotDigest({
      artifacts: loadedPacks.map((entry) => entry.artifact),
      publishedCatalog
    });

    if (source.type === "github") {
      try {
        if (loadedPacks.length === 0) throw new Error("GitHub catalog does not contain any LoopPacks");
        if (snapshotDigest !== source.expectedDigest) {
          throw new Error(`GitHub catalog snapshot digest mismatch: expected ${source.expectedDigest}, received ${snapshotDigest}`);
        }
        sourceRoot = await promotePreparedCatalogRoot(prepared);
      } catch (error) {
        await cleanupPreparedCatalogRoot(prepared);
        throw error;
      }
    }

    const versions: Array<{ artifact: LoopPackArtifact; location: string; marketplaceVersion: MarketplaceAppVersion }> = [];
    for (const entry of loadedPacks) {
      const location = prepared.finalRoot
        ? path.join(sourceRoot, path.relative(prepared.root, entry.location))
        : entry.location;
      const loadedArtifact = entry.artifact;
      const marketplaceVersion = marketplaceVersionFromArtifact(
        {
          ...loadedArtifact,
          provenance: {
            ...loadedArtifact.provenance,
            sourceType: source.type,
            sourceUri: source.uri,
            sourceRef: source.pinnedRef
          }
        },
        `file://${location}`,
        "tested",
        {
          sourceId: source.id,
          sourceType: source.type,
          sourceUri: source.uri,
          sourceRef: source.pinnedRef,
          snapshotDigest,
          trustPolicy: source.trustPolicy,
          synchronizedAt
        }
      );
      marketplaceVersion.provenanceVerified = source.trustPolicy === "signed"
        ? Boolean(loadedArtifact.provenance.signature)
        : source.trustPolicy === "official_only" && loadedArtifact.manifest.metadata.publisher.id === "loopgraph" && loadedArtifact.manifest.metadata.publisher.verified;
      const release = releases.get(publishedReleaseKey(
        loadedArtifact.manifest.metadata.id,
        loadedArtifact.manifest.metadata.version,
        loadedArtifact.digest
      ));
      versions.push({
        artifact: loadedArtifact,
        location,
        marketplaceVersion: {
          ...marketplaceVersion,
          deprecated: release?.status === "deprecated",
          deprecationMessage: release?.status === "deprecated" ? release.message : undefined,
          revokedAt: release?.status === "revoked" ? release.updatedAt : undefined,
          revocationReason: release?.status === "revoked" ? release.message : undefined
        }
      });
    }

    const grouped = new Map<string, typeof versions>();
    for (const entry of versions) {
      const id = entry.artifact.manifest.metadata.id;
      grouped.set(id, [...(grouped.get(id) ?? []), entry]);
    }
    const current = await this.readIndex();
    for (const [appId, entries] of grouped) {
      const publisherIds = new Set(entries.map((entry) => entry.artifact.manifest.metadata.publisher.id));
      if (publisherIds.size !== 1) {
        throw new Error(`Catalog source ${source.id} contains multiple publishers for app ${appId}`);
      }
      const publisherId = entries[0]!.artifact.manifest.metadata.publisher.id;
      const existing = current.apps.find((app) => app.id === appId);
      if (existing && existing.publisher.id !== publisherId) {
        throw new Error(`Marketplace app ${appId} is owned by publisher ${existing.publisher.id} and cannot be replaced by ${publisherId}`);
      }
    }
    for (const entry of versions) {
      const id = entry.artifact.manifest.metadata.id;
      const key = artifactKey(id, entry.artifact.manifest.metadata.version, entry.artifact.digest, source.id);
      this.artifactLocations.set(key, entry.location);
      this.artifactTrust.set(key, {
        requireSignature: source.trustPolicy === "signed",
        trustedPublisherKeys: source.trustedPublisherKeys
      });
    }
    const refreshed = Array.from(grouped.values()).map((entries) => marketplaceAppFromVersions(entries));
    const refreshedById = new Map(refreshed.map((app) => [app.id, app]));
    const currentById = new Map(current.apps.map((app) => [app.id, app]));
    const appIds = new Set([...currentById.keys(), ...refreshedById.keys()]);
    const apps = Array.from(appIds).flatMap((appId) => {
      const existing = currentById.get(appId);
      const incoming = refreshedById.get(appId);
      const incomingVersions = new Set((incoming?.versions ?? []).map((version) => version.version));
      const retainedVersions = (existing?.versions ?? []).filter((version) =>
        version.source.sourceId !== source.id &&
        !(version.source.sourceId.startsWith("legacy-") && incomingVersions.has(version.version))
      );
      const mergedVersions = mergeMarketplaceVersions(appId, [...retainedVersions, ...(incoming?.versions ?? [])]);
      if (mergedVersions.length === 0) return [];
      const latestVersion = mergedVersions[0]!.version;
      const base = incoming?.latestVersion === latestVersion ? incoming : existing ?? incoming;
      if (!base) throw new Error(`Marketplace app metadata is unavailable for ${appId}`);
      return [marketplaceAppSchema.parse({
        ...base,
        latestVersion,
        versions: mergedVersions,
        readmeUri: `${mergedVersions[0]!.artifactUri}/README.md`
      })];
    }).sort((left, right) => left.name.localeCompare(right.name));
    await this.writeIndex({ schemaVersion: MARKETPLACE_SCHEMA_VERSION, apps, refreshedAt: synchronizedAt });
    await this.addCatalogSource({ ...source, refreshedAt: synchronizedAt });
    return refreshed;
  }

  private async prepareGitHubCatalogRoot(source: MarketplaceCatalogSource): Promise<PreparedCatalogRoot> {
    validateGitHubCatalogSource(source, this.options.trustedGitHosts);
    const finalRoot = githubCatalogCacheRoot(this.stateRoot, source);
    if (await pathExists(finalRoot)) return { root: finalRoot };
    const stagingRoot = `${finalRoot}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(finalRoot), { recursive: true });
    const synchronizer = this.options.githubSynchronizer ?? new GitCliHubCatalogSynchronizer(this.options.trustedGitHosts);
    try {
      const result = await synchronizer.synchronize(source, stagingRoot);
      if (result.resolvedRef.toLowerCase() !== source.pinnedRef!.toLowerCase()) {
        throw new Error(`GitHub catalog resolved ${result.resolvedRef}, expected pinned commit ${source.pinnedRef}`);
      }
      return { root: stagingRoot, stagingRoot, finalRoot };
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
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
      .sort(compareMarketplaceVersions);
    if (versions.length === 0) throw new Error(`No eligible version of ${appId} satisfies ${versionRange}`);
    return versions[0];
  }

  async getAppArtifact(appId: string, version: string, expectedDigest?: string) {
    const candidates = (await this.listAppVersions(appId))
      .filter((candidate) => candidate.version === version)
      .sort(compareMarketplaceVersions);
    if (candidates.length === 0) throw new Error(`Marketplace version not found: ${appId}@${version}`);
    const appVersion = expectedDigest
      ? candidates.find((candidate) => candidate.digest === expectedDigest)
      : candidates[0];
    if (!appVersion) throw new Error("Requested artifact digest does not match marketplace metadata");
    const key = artifactKey(appId, version, appVersion.digest, appVersion.source.sourceId);
    let location = this.artifactLocations.get(key);
    if (!location && appVersion.artifactUri.startsWith("file://")) location = appVersion.artifactUri.slice("file://".length);
    if (!location) throw new Error("Artifact is not available in the local marketplace cache");
    let trust = this.artifactTrust.get(key);
    if (!trust) {
      const sources = await this.listCatalogSources();
      const sourceMatchesLocation = (candidate: MarketplaceCatalogSource) => {
        if (candidate.type === "hosted") return false;
        const sourceRoot = candidate.type === "github"
          ? githubCatalogCacheRoot(this.stateRoot, candidate)
          : resolveSourceRoot(candidate);
        return isWithin(sourceRoot, location!);
      };
      const source = sources.find((candidate) => candidate.id === appVersion.source.sourceId && sourceMatchesLocation(candidate)) ??
        sources.find(sourceMatchesLocation);
      if (source) {
        trust = { requireSignature: source.trustPolicy === "signed", trustedPublisherKeys: source.trustedPublisherKeys };
        this.artifactTrust.set(key, trust);
      }
    }
    const loaded = await loadLoopPackDirectory(location, trust);
    if (loaded.artifact.digest !== appVersion.digest) throw new Error("Cached artifact digest does not match immutable marketplace version");
    return loaded;
  }

  async verifyAppProvenance(appId: string, version: string): Promise<{
    verified: boolean;
    digestMatches: boolean;
    sourceId: string;
    sourceType: string;
    sourceUri: string;
    sourceRef?: string;
    snapshotDigest: string;
    trustPolicy: MarketplaceCatalogSource["trustPolicy"];
    signaturePresent: boolean;
    reasons: string[];
  }> {
    const appVersion = (await this.listAppVersions(appId))
      .filter((candidate) => candidate.version === version)
      .sort(compareMarketplaceVersions)[0];
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
      verified: digestMatches && appVersion.provenanceVerified && (signaturePresent || official),
      digestMatches,
      sourceId: appVersion.source.sourceId,
      sourceType: appVersion.source.sourceType,
      sourceUri: appVersion.source.sourceUri,
      sourceRef: appVersion.source.sourceRef,
      snapshotDigest: appVersion.source.snapshotDigest,
      trustPolicy: appVersion.source.trustPolicy,
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
      apps: value.apps.map((app) => marketplaceAppSchema.parse(withLegacyMarketplaceSources(app))),
      refreshedAt: value.refreshedAt
    };
  }

  private async writeIndex(index: MarketplaceIndex): Promise<void> {
    await atomicWriteJson(this.indexPath, index);
  }
}

export class GitCliHubCatalogSynchronizer implements GitHubCatalogSynchronizer {
  constructor(private readonly trustedGitHosts?: string[]) {}

  async synchronize(source: MarketplaceCatalogSource, destination: string): Promise<{ resolvedRef: string }> {
    validateGitHubCatalogSource(source, this.trustedGitHosts);
    await mkdir(destination, { recursive: false, mode: 0o700 });
    await runGit(["init", "--quiet"], destination);
    await runGit(["remote", "add", "origin", source.uri], destination);
    await runGit(["fetch", "--quiet", "--depth", "1", "--no-tags", "origin", source.pinnedRef!], destination);
    await runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], destination);
    const { stdout } = await runGit(["rev-parse", "HEAD"], destination);
    const resolvedRef = stdout.trim();
    await rm(path.join(destination, ".git"), { recursive: true, force: true });
    return { resolvedRef };
  }
}

export function catalogSnapshotDigest(input: {
  artifacts: LoopPackArtifact[];
  publishedCatalog?: PublishedCatalog;
}): string {
  return catalogSnapshotDigestFromRecords({
    artifacts: input.artifacts.map((artifact) => ({
      appId: artifact.manifest.metadata.id,
      version: artifact.manifest.metadata.version,
      digest: artifact.digest
    })),
    publishedCatalog: input.publishedCatalog
  });
}

export function catalogSnapshotDigestFromRecords(input: {
  artifacts: Array<{ appId: string; version: string; digest: string }>;
  publishedCatalog?: PublishedCatalog;
}): string {
  return canonicalAppDigest({
    artifacts: input.artifacts
      .map((artifact) => ({ ...artifact }))
      .sort((left, right) => `${left.appId}@${left.version}`.localeCompare(`${right.appId}@${right.version}`)),
    releases: (input.publishedCatalog?.releases ?? [])
      .slice()
      .sort((left, right) => publishedReleaseKey(left.appId, left.version, left.digest).localeCompare(publishedReleaseKey(right.appId, right.version, right.digest)))
  });
}

function validateGitHubCatalogSource(source: MarketplaceCatalogSource, trustedGitHosts?: string[]): void {
  if (source.type !== "github") throw new Error("GitHub synchronization requires a GitHub catalog source");
  if (source.trustPolicy !== "signed") throw new Error("GitHub catalog sources must use signed publisher trust");
  if (!source.pinnedRef || !/^[a-f0-9]{40,64}$/i.test(source.pinnedRef)) {
    throw new Error("GitHub catalog sources must pin an exact 40- or 64-character commit hash");
  }
  if (!source.expectedDigest) throw new Error("GitHub catalog sources must pin the canonical catalog snapshot digest");
  let url: URL;
  try {
    url = new URL(source.uri);
  } catch {
    throw new Error("GitHub catalog URI must be an absolute HTTPS repository URL");
  }
  const allowedHosts = new Set((trustedGitHosts?.length ? trustedGitHosts : ["github.com"]).map((host) => host.toLowerCase()));
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`GitHub catalog URI must use HTTPS on a trusted Git host (${Array.from(allowedHosts).join(", ")})`);
  }
  if (url.username || url.password || url.search || url.hash || url.port) {
    throw new Error("GitHub catalog URI cannot contain credentials, a custom port, query parameters, or a fragment");
  }
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)) {
    throw new Error("GitHub catalog URI must identify exactly one owner/repository path");
  }
}

function validateCatalogArtifactOwnership(source: MarketplaceCatalogSource, artifact: LoopPackArtifact): void {
  const appId = artifact.manifest.metadata.id;
  const publisher = artifact.manifest.metadata.publisher;
  if (source.type === "github" && (appId.startsWith("loopgraph.") || publisher.id === "loopgraph" || publisher.verified)) {
    throw new Error(`The Loopgraph app and verified publisher namespaces are reserved for the bundled official catalog (${appId})`);
  }
  if (source.type === "github" && !appId.startsWith(`${publisher.id}.`)) {
    throw new Error(`GitHub catalog app ${appId} must use its publisher namespace (${publisher.id}.)`);
  }
}

function githubCatalogCacheRoot(stateRoot: string, source: MarketplaceCatalogSource): string {
  const cacheKey = canonicalAppDigest({ uri: source.uri, pinnedRef: source.pinnedRef })
    .slice("sha256:".length, "sha256:".length + 24);
  return path.join(stateRoot, "catalog-cache", source.id, cacheKey);
}

async function promotePreparedCatalogRoot(prepared: PreparedCatalogRoot): Promise<string> {
  if (!prepared.finalRoot || !prepared.stagingRoot) return prepared.root;
  try {
    await rename(prepared.stagingRoot, prepared.finalRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!(await pathExists(prepared.finalRoot)) || !["EEXIST", "ENOTEMPTY"].includes(code ?? "")) throw error;
    await rm(prepared.stagingRoot, { recursive: true, force: true });
  }
  return prepared.finalRoot;
}

async function cleanupPreparedCatalogRoot(prepared: PreparedCatalogRoot): Promise<void> {
  if (prepared.stagingRoot) await rm(prepared.stagingRoot, { recursive: true, force: true });
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") || key === "SSH_ASKPASS") delete env[key];
  }
  const result = await execFileAsync("git", [
    "-c", "core.hooksPath=/dev/null",
    "-c", "protocol.ext.allow=never",
    "-c", "protocol.file.allow=never",
    "-c", "credential.helper=",
    ...args
  ], {
    cwd,
    env: {
      ...env,
      GIT_ASKPASS: "",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: ""
    },
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
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
    .sort(compareMarketplaceVersions);
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

function mergeMarketplaceVersions(appId: string, versions: MarketplaceAppVersion[]): MarketplaceAppVersion[] {
  const identities = new Map<string, MarketplaceAppVersion>();
  const digestsByVersion = new Map<string, Set<string>>();
  for (const version of versions) {
    const digests = digestsByVersion.get(version.version) ?? new Set<string>();
    digests.add(version.digest);
    digestsByVersion.set(version.version, digests);
    const identity = `${version.source.sourceId}#${version.version}#${version.digest}`;
    identities.set(identity, version);
  }
  for (const [version, digests] of digestsByVersion) {
    if (digests.size > 1) {
      throw new Error(`Immutable marketplace version conflict for ${appId}@${version}: catalogs contain different artifact digests`);
    }
  }
  const mirrors = new Map<string, MarketplaceAppVersion[]>();
  for (const version of identities.values()) {
    const mirrorKey = `${version.version}#${version.digest}`;
    mirrors.set(mirrorKey, [...(mirrors.get(mirrorKey) ?? []), version]);
  }
  return Array.from(mirrors.values())
    .flatMap(normalizeMirroredReleaseStatus)
    .sort(compareMarketplaceVersions);
}

function normalizeMirroredReleaseStatus(versions: MarketplaceAppVersion[]): MarketplaceAppVersion[] {
  const authorityRank = Math.min(...versions.map(marketplaceSourceRank));
  const authorities = versions
    .filter((version) => marketplaceSourceRank(version) === authorityRank)
    .sort((left, right) => left.source.sourceId.localeCompare(right.source.sourceId));
  const revocation = authorities
    .filter((version) => version.revokedAt)
    .sort((left, right) => left.revokedAt!.localeCompare(right.revokedAt!) || left.source.sourceId.localeCompare(right.source.sourceId))[0];
  const deprecation = authorities.find((version) => version.deprecated);

  return versions.map((version) => ({
    ...version,
    deprecated: deprecation ? true : version.deprecated,
    deprecationMessage: deprecation?.deprecationMessage ?? version.deprecationMessage,
    revokedAt: revocation?.revokedAt ?? version.revokedAt,
    revocationReason: revocation?.revocationReason ?? version.revocationReason
  }));
}

function compareMarketplaceVersions(left: MarketplaceAppVersion, right: MarketplaceAppVersion): number {
  return compareVersionStrings(right.version, left.version) ||
    marketplaceSourceRank(left) - marketplaceSourceRank(right) ||
    left.source.sourceId.localeCompare(right.source.sourceId);
}

function marketplaceSourceRank(version: MarketplaceAppVersion): number {
  if (version.source.sourceType === "official") return 0;
  if (version.source.trustPolicy === "signed") return 1;
  if (version.source.sourceType === "filesystem") return 2;
  return 3;
}

function withLegacyMarketplaceSources(app: unknown): unknown {
  if (!isObjectRecord(app) || !Array.isArray(app.versions)) return app;
  return {
    ...app,
    versions: app.versions.map((version) => {
      if (!isObjectRecord(version) || isObjectRecord(version.source)) return version;
      const artifactUri = typeof version.artifactUri === "string" ? version.artifactUri : "legacy://unknown";
      const digest = typeof version.digest === "string" ? version.digest : canonicalAppDigest(version);
      const synchronizedAt = typeof version.publishedAt === "string" ? version.publishedAt : new Date(0).toISOString();
      return {
        ...version,
        source: {
          sourceId: `legacy-${canonicalAppDigest({ artifactUri }).slice("sha256:".length, "sha256:".length + 16)}`,
          sourceType: artifactUri.startsWith("file://") ? "filesystem" : "hosted",
          sourceUri: artifactUri,
          snapshotDigest: digest,
          trustPolicy: "explicit_local",
          synchronizedAt
        }
      };
    })
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9._-]+/).filter((term) => term.length > 1)));
}

function artifactKey(appId: string, version: string, digest: string, sourceId: string): string {
  return `${sourceId}:${appId}@${version}#${digest}`;
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

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
