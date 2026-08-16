import {
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import {
  createPrivateKey,
  createPublicKey,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signDigest
} from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import {
  APP_INSTALL_SCHEMA_VERSION,
  LOOP_PACK_SIGNATURE_SCHEMA_VERSION,
  MARKETPLACE_SCHEMA_VERSION,
  DepartmentTypeSchema,
  appEvalSuiteSchema,
  appIdSchema,
  appSetupDefinitionSchema,
  loopPackManifestSchema,
  loopPackSignatureSchema,
  type DepartmentType,
  type LoopPackSignature,
  type PublisherTrustKey,
  type WorkspaceAppInstallation
} from "../core";
import { loadConnectorRecipes } from "./app-connector-service";
import { compileLoopPack } from "./app-pack-compiler";
import {
  LOOP_PACK_SIGNATURE_FILE,
  createLoopPackArchive,
  loadLoopPackDirectory,
  type LoopPackValidationIssue
} from "./app-pack-loader";
import { FileAppInstallationStore } from "./app-installation-store";
import { LocalAppMarketplace, catalogSnapshotDigestFromRecords } from "./app-marketplace";
import {
  PUBLISHED_CATALOG_FILE,
  PUBLISHED_CATALOG_SCHEMA_VERSION,
  publishedCatalogSchema,
  publishedReleaseKey,
  readPublishedCatalog,
  type PublishedCatalog,
  type PublishedCatalogRelease
} from "./app-publisher-catalog";
import { runAppSyntheticConformance } from "./app-quality-engine";

const PUBLISHER_KEY_SCHEMA_VERSION = "loopgraph-publisher-key/v1alpha1" as const;
const PUBLISHER_REGISTRY_SCHEMA_VERSION = "loopgraph-publisher-registry/v1alpha1" as const;

const publisherKeyRecordSchema = z.object({
  schemaVersion: z.literal(PUBLISHER_KEY_SCHEMA_VERSION),
  publisherId: appIdSchema,
  keyId: appIdSchema,
  algorithm: z.literal("ed25519"),
  publicKey: z.string().min(32),
  privateKeyPath: z.string().min(1),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional()
}).strict();

const publisherRegistrySchema = z.object({
  schemaVersion: z.literal(PUBLISHER_REGISTRY_SCHEMA_VERSION),
  keys: z.array(publisherKeyRecordSchema).default([]),
  updatedAt: z.string().datetime()
}).strict();

type PublisherKeyRecord = z.infer<typeof publisherKeyRecordSchema>;

export type AppPublisherValidationReport = {
  ok: boolean;
  packRoot: string;
  appId?: string;
  version?: string;
  digest?: string;
  signature?: {
    present: boolean;
    publisherId?: string;
    keyId?: string;
    trusted?: boolean;
  };
  checks: Array<{ id: string; status: "passed" | "failed"; summary: string }>;
  issues: LoopPackValidationIssue[];
  failedScenarios: Array<{ id: string; reason?: string }>;
};

export class LoopgraphAppPublisher {
  private readonly publisherRoot: string;
  private readonly keyRoot: string;
  private readonly keyRegistryPath: string;
  private readonly catalogsRoot: string;
  private readonly marketplace: LocalAppMarketplace;

  constructor(private readonly projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.publisherRoot = path.join(this.projectRoot, ".loopgraph", "apps", "publisher");
    this.keyRoot = path.join(this.publisherRoot, "keys");
    this.keyRegistryPath = path.join(this.publisherRoot, "keys.json");
    this.catalogsRoot = path.join(this.projectRoot, ".loopgraph", "apps", "catalogs");
    this.marketplace = new LocalAppMarketplace(path.join(this.projectRoot, ".loopgraph", "apps", "marketplace"));
  }

  async generatePublisherKey(input: { publisherId: string; keyId?: string; now?: Date }): Promise<{
    publisherId: string;
    keyId: string;
    algorithm: "ed25519";
    publicKey: string;
    fingerprint: string;
    createdAt: string;
    privateKeyStored: true;
  }> {
    const publisherId = appIdSchema.parse(input.publisherId);
    const keyId = appIdSchema.parse(input.keyId ?? `${publisherId}.${formatDate(input.now ?? new Date())}.${randomBytes(4).toString("hex")}`);
    const registry = await this.readKeyRegistry();
    if (registry.keys.some((key) => key.keyId === keyId)) throw new Error(`Publisher key already exists: ${keyId}`);
    const pair = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const privateKeyPath = path.join(this.keyRoot, `${keyId}.private.pem`);
    const createdAt = (input.now ?? new Date()).toISOString();
    const record = publisherKeyRecordSchema.parse({
      schemaVersion: PUBLISHER_KEY_SCHEMA_VERSION,
      publisherId,
      keyId,
      algorithm: "ed25519",
      publicKey: pair.publicKey,
      privateKeyPath: path.relative(this.projectRoot, privateKeyPath).split(path.sep).join("/"),
      fingerprint: publicKeyFingerprint(pair.publicKey),
      createdAt
    });
    await mkdir(this.keyRoot, { recursive: true, mode: 0o700 });
    await writeFile(privateKeyPath, pair.privateKey, { flag: "wx", mode: 0o600 });
    await this.writeKeyRegistry({
      schemaVersion: PUBLISHER_REGISTRY_SCHEMA_VERSION,
      keys: [...registry.keys, record].sort((left, right) => left.keyId.localeCompare(right.keyId)),
      updatedAt: createdAt
    });
    return {
      publisherId,
      keyId,
      algorithm: "ed25519",
      publicKey: pair.publicKey,
      fingerprint: record.fingerprint,
      createdAt,
      privateKeyStored: true
    };
  }

  async listPublisherKeys(): Promise<Array<Omit<PublisherKeyRecord, "privateKeyPath"> & { privateKeyStored: boolean }>> {
    const registry = await this.readKeyRegistry();
    return Promise.all(registry.keys.map(async ({ privateKeyPath, ...key }) => ({
      ...key,
      privateKeyStored: await exists(this.resolveProjectConfined(privateKeyPath))
    })));
  }

  async initializeApp(input: {
    destination: string;
    appId: string;
    name: string;
    department: DepartmentType;
    publisherId: string;
    publisherName?: string;
    summary?: string;
  }): Promise<{ packRoot: string; appId: string; filesCreated: number; nextSteps: string[] }> {
    const packRoot = this.resolveProjectConfined(input.destination, { rejectProjectRoot: true });
    if (await exists(packRoot)) throw new Error(`App destination already exists: ${packRoot}`);
    const appId = appIdSchema.parse(input.appId);
    const department = DepartmentTypeSchema.parse(input.department);
    const publisherId = appIdSchema.parse(input.publisherId);
    const documents = createStarterDocuments({
      appId,
      name: input.name,
      department,
      publisherId,
      publisherName: input.publisherName ?? publisherId,
      summary: input.summary ?? `Route one recurring ${department.replaceAll("_", " ")} problem through Hermes with governed actions and measurable outcomes.`
    });
    for (const [relativePath, content] of Object.entries(documents)) {
      const target = path.resolve(packRoot, relativePath);
      if (!isWithin(packRoot, target)) throw new Error(`Starter path escapes destination: ${relativePath}`);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { flag: "wx", mode: 0o600 });
    }
    const report = await this.validateApp(packRoot);
    if (!report.ok) throw new Error(`Generated starter app failed validation: ${report.issues.map((issue) => issue.message).join("; ")}`);
    return {
      packRoot,
      appId,
      filesCreated: Object.keys(documents).length,
      nextSteps: [
        "Edit the routing contract, setup questions, fixtures, and outcome metrics for the real business problem.",
        "Run app validate after every change.",
        "Generate a publisher key, sign the immutable version, and publish it to a trusted private catalog."
      ]
    };
  }

  async captureInstallation(input: {
    installationId: string;
    derivedAppId: string;
    name: string;
    publisherId: string;
    publisherName?: string;
    destination: string;
    workspaceId?: string;
    version?: string;
  }): Promise<{
    packRoot: string;
    source: { installationId: string; appId: string; version: string; digest: string };
    derivedAppId: string;
    parameterizedConfigurationKeys: string[];
    sensitiveConfigurationKeys: string[];
    overlayPathsRequiringReview: string[];
    copiedCredentialValues: 0;
  }> {
    await this.marketplace.refreshAllCatalogSources();
    const workspaceId = input.workspaceId ?? await FileAppInstallationStore.discoverWorkspaceId(path.join(this.projectRoot, ".loopgraph", "apps"));
    if (!workspaceId) throw new Error("No installed app workspace was found; pass workspaceId explicitly");
    const store = new FileAppInstallationStore(path.join(this.projectRoot, ".loopgraph", "apps"), workspaceId);
    const registry = await store.read();
    const installation = registry.installations.find((candidate) => candidate.id === input.installationId);
    if (!installation) throw new Error(`App installation not found: ${input.installationId}`);
    const loaded = await this.marketplace.getAppArtifact(installation.appId, installation.version, installation.artifactDigest);
    const destination = this.resolveProjectConfined(input.destination, { rejectProjectRoot: true });
    if (await exists(destination)) throw new Error(`Pack archive destination already exists: ${destination}`);
    if (await exists(destination)) throw new Error(`Capture destination already exists: ${destination}`);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await cp(loaded.root, destination, { recursive: true, errorOnExist: true, force: false });
    await rm(path.join(destination, LOOP_PACK_SIGNATURE_FILE), { force: true });

    const derivedAppId = appIdSchema.parse(input.derivedAppId);
    const publisherId = appIdSchema.parse(input.publisherId);
    const manifestPath = path.join(destination, "loopgraph.pack.yaml");
    const manifest = loopPackManifestSchema.parse(YAML.parse(await readFile(manifestPath, "utf8")));
    const nextManifest = loopPackManifestSchema.parse({
      ...manifest,
      metadata: {
        ...manifest.metadata,
        id: derivedAppId,
        name: input.name,
        version: input.version ?? "0.1.0",
        publisher: { id: publisherId, name: input.publisherName ?? publisherId, verified: false },
        visibility: "private",
        homepage: undefined,
        repository: undefined
      }
    });
    await atomicWriteText(manifestPath, YAML.stringify(nextManifest));
    await rewriteCapturedIdentifiers(destination, nextManifest.entrypoints.loops, nextManifest.entrypoints.skills, nextManifest.entrypoints.evals, derivedAppId);
    const report = await this.validateApp(destination);
    if (!report.ok) throw new Error(`Captured app failed validation: ${report.issues.map((issue) => issue.message).join("; ")}`);
    const configurationKeys = Object.keys(installation.configuration.values).sort();
    return {
      packRoot: destination,
      source: {
        installationId: installation.id,
        appId: installation.appId,
        version: installation.version,
        digest: installation.artifactDigest
      },
      derivedAppId,
      parameterizedConfigurationKeys: configurationKeys,
      sensitiveConfigurationKeys: configurationKeys.filter(isSensitiveConfigurationKey),
      overlayPathsRequiringReview: installation.overlay?.operations.map((operation) =>
        "path" in operation ? operation.path : `/modules/${operation.moduleId}`).sort() ?? [],
      copiedCredentialValues: 0
    };
  }

  async validateApp(packRootInput: string): Promise<AppPublisherValidationReport> {
    const packRoot = this.resolveProjectConfined(packRootInput);
    const checks: AppPublisherValidationReport["checks"] = [];
    const issues: LoopPackValidationIssue[] = [];
    const failedScenarios: AppPublisherValidationReport["failedScenarios"] = [];
    try {
      const loaded = await loadLoopPackDirectory(packRoot);
      checks.push({ id: "pack-contract", status: "passed", summary: "Manifest, declared content, path confinement, digest, and secret scanning passed." });
      if (loaded.manifest.metadata.publisher.id !== "loopgraph" && loaded.manifest.metadata.publisher.verified) {
        issues.push({ severity: "error", code: "publisher_self_verification", message: "Third-party publishers cannot mark themselves verified" });
      }
      if (loaded.manifest.metadata.publisher.id !== "loopgraph" && loaded.manifest.metadata.id.startsWith("loopgraph.")) {
        issues.push({ severity: "error", code: "publisher_namespace_reserved", message: "The loopgraph. app namespace is reserved for bundled official apps" });
      }
      if (loaded.manifest.metadata.publisher.id !== "loopgraph" && !loaded.manifest.metadata.id.startsWith(`${loaded.manifest.metadata.publisher.id}.`)) {
        issues.push({ severity: "error", code: "publisher_namespace_mismatch", message: `Third-party app IDs must begin with ${loaded.manifest.metadata.publisher.id}.` });
      }
      if (loaded.manifest.metadata.publisher.id !== "loopgraph" && loaded.manifest.metadata.visibility === "official") {
        issues.push({ severity: "error", code: "official_visibility_reserved", message: "Official visibility is reserved for the Loopgraph publisher" });
      }
      const requiredFiles = ["README.md", "CHANGELOG.md"];
      for (const requiredFile of requiredFiles) {
        if (!await exists(path.join(packRoot, requiredFile))) {
          issues.push({ severity: "error", code: "publisher_file_missing", path: requiredFile, message: `${requiredFile} is required for publishing` });
        }
      }
      if (loaded.manifest.entrypoints.fixtures.length === 0 || loaded.manifest.entrypoints.evals.length === 0) {
        issues.push({ severity: "error", code: "quality_assets_missing", message: "Publishing requires deterministic fixtures and at least one evaluation suite" });
      }
      const compiled = await compileLoopPack(loaded);
      checks.push({ id: "compile", status: "passed", summary: `${compiled.loopSpecs.length} loop(s) compiled into Hermes routing contracts and graph assets.` });
      await Promise.all(loaded.manifest.entrypoints.setup.map(async (entry) =>
        appSetupDefinitionSchema.parse(await readDocument(packRoot, entry))));
      await Promise.all(loaded.manifest.entrypoints.evals.map(async (entry) =>
        appEvalSuiteSchema.parse(await readDocument(packRoot, entry))));
      await loadConnectorRecipes(loaded);
      checks.push({ id: "supporting-assets", status: "passed", summary: "Setup, connector, and evaluation documents passed their contracts." });
      const installation = validationInstallation(loaded.manifest.metadata.id, loaded.manifest.metadata.version, loaded.artifact.digest, loaded.manifest.permissions);
      const evaluation = await runAppSyntheticConformance({ loaded, compiled, installation, actor: "app-publisher", now: new Date(0) });
      failedScenarios.push(...evaluation.scenarios.filter((scenario) => scenario.status === "failed").map((scenario) => ({ id: scenario.id, reason: scenario.reason })));
      checks.push({
        id: "synthetic-conformance",
        status: evaluation.status === "passed" ? "passed" : "failed",
        summary: evaluation.status === "passed"
          ? `${evaluation.scenarios.length} safety and routing scenarios passed with provider writes blocked.`
          : `${failedScenarios.length} conformance scenario(s) failed.`
      });
      if (failedScenarios.length > 0) {
        issues.push({ severity: "error", code: "conformance_failed", message: `${failedScenarios.length} deterministic conformance scenario(s) failed` });
      }
      const signature = loaded.artifact.provenance.signature;
      const key = signature ? (await this.readKeyRegistry()).keys.find((candidate) =>
        candidate.publisherId === signature.publisherId && candidate.keyId === signature.keyId && candidate.publicKey.trim() === signature.publicKey.trim()) : undefined;
      return {
        ok: issues.every((issue) => issue.severity !== "error"),
        packRoot,
        appId: loaded.manifest.metadata.id,
        version: loaded.manifest.metadata.version,
        digest: loaded.artifact.digest,
        signature: { present: Boolean(signature), publisherId: signature?.publisherId, keyId: signature?.keyId, trusted: Boolean(key && !key.revokedAt) },
        checks,
        issues: [...loaded.issues, ...issues],
        failedScenarios
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ id: "pack-contract", status: "failed", summary: message });
      issues.push({ severity: "error", code: "publisher_validation_failed", message });
      return { ok: false, packRoot, checks, issues, failedScenarios };
    }
  }

  async signApp(input: { packRoot: string; keyId: string; now?: Date }): Promise<{
    appId: string;
    version: string;
    digest: string;
    signature: LoopPackSignature;
    trustKey: PublisherTrustKey;
  }> {
    const packRoot = this.resolveProjectConfined(input.packRoot);
    const key = await this.requireActiveKey(input.keyId);
    await rm(path.join(packRoot, LOOP_PACK_SIGNATURE_FILE), { force: true });
    const loaded = await loadLoopPackDirectory(packRoot);
    if (loaded.manifest.metadata.publisher.id !== key.publisherId) {
      throw new Error(`Publisher key ${key.keyId} belongs to ${key.publisherId}, not ${loaded.manifest.metadata.publisher.id}`);
    }
    const privateKeyPath = this.resolveProjectConfined(key.privateKeyPath);
    const privateKey = createPrivateKey(await readFile(privateKeyPath, "utf8"));
    const signature = loopPackSignatureSchema.parse({
      schemaVersion: LOOP_PACK_SIGNATURE_SCHEMA_VERSION,
      publisherId: key.publisherId,
      digest: loaded.artifact.digest,
      algorithm: key.algorithm,
      keyId: key.keyId,
      publicKey: key.publicKey,
      value: signDigest(null, Buffer.from(loaded.artifact.digest, "utf8"), privateKey).toString("base64url"),
      signedAt: (input.now ?? new Date()).toISOString()
    });
    await atomicWriteText(path.join(packRoot, LOOP_PACK_SIGNATURE_FILE), `${JSON.stringify(signature, null, 2)}\n`);
    const trustKey = publisherTrustKey(key);
    const verified = await loadLoopPackDirectory(packRoot, { requireSignature: true, trustedPublisherKeys: [trustKey] });
    return {
      appId: verified.manifest.metadata.id,
      version: verified.manifest.metadata.version,
      digest: verified.artifact.digest,
      signature,
      trustKey
    };
  }

  async packApp(input: { packRoot: string; destination: string }): Promise<{
    archivePath: string;
    appId: string;
    version: string;
    digest: string;
    signed: boolean;
  }> {
    const packRoot = this.resolveProjectConfined(input.packRoot);
    const destination = this.resolveProjectConfined(input.destination, { rejectProjectRoot: true });
    const report = await this.validateApp(packRoot);
    if (!report.ok) throw new Error(`App cannot be packed: ${report.issues.map((issue) => issue.message).join("; ")}`);
    const artifact = await createLoopPackArchive(packRoot, destination);
    return {
      archivePath: destination,
      appId: artifact.manifest.metadata.id,
      version: artifact.manifest.metadata.version,
      digest: artifact.digest,
      signed: Boolean(artifact.provenance.signature)
    };
  }

  async publishApp(input: { packRoot: string; catalogId: string; now?: Date }): Promise<{
    catalogId: string;
    catalogRoot: string;
    release: PublishedCatalogRelease;
    snapshotDigest: string;
    sourceId: string;
    idempotent: boolean;
  }> {
    const packRoot = this.resolveProjectConfined(input.packRoot);
    const catalogId = appIdSchema.parse(input.catalogId);
    const report = await this.validateApp(packRoot);
    if (!report.ok) throw new Error(`App cannot be published: ${report.issues.map((issue) => issue.message).join("; ")}`);
    const loaded = await loadLoopPackDirectory(packRoot, { requireSignature: true });
    const signature = loaded.artifact.provenance.signature;
    if (!signature) throw new Error("Published packs require a valid detached publisher signature");
    const key = await this.requireActiveKey(signature.keyId);
    const trustKey = publisherTrustKey(key);
    await loadLoopPackDirectory(packRoot, { requireSignature: true, trustedPublisherKeys: [trustKey] });
    const catalogRoot = path.join(this.catalogsRoot, catalogId);
    await mkdir(catalogRoot, { recursive: true, mode: 0o700 });
    const lockPath = path.join(catalogRoot, ".publish.lock");
    const lock = await acquireFileLock(lockPath);
    try {
      const destination = path.join(catalogRoot, signature.publisherId, loaded.manifest.metadata.id, loaded.manifest.metadata.version);
      let idempotent = false;
      if (await exists(destination)) {
        const existing = await loadLoopPackDirectory(destination, { requireSignature: true, trustedPublisherKeys: [trustKey] });
        if (existing.artifact.digest !== loaded.artifact.digest) {
          throw new Error(`Immutable release conflict: ${loaded.manifest.metadata.id}@${loaded.manifest.metadata.version} already has another digest`);
        }
        idempotent = true;
      } else {
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await cp(packRoot, destination, { recursive: true, errorOnExist: true, force: false });
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      const current = await readPublishedCatalog(catalogRoot);
      const release = current?.releases.find((candidate) =>
        publishedReleaseKey(candidate.appId, candidate.version, candidate.digest) ===
        publishedReleaseKey(loaded.manifest.metadata.id, loaded.manifest.metadata.version, loaded.artifact.digest)) ?? {
        appId: loaded.manifest.metadata.id,
        version: loaded.manifest.metadata.version,
        digest: loaded.artifact.digest,
        publisherId: signature.publisherId,
        keyId: signature.keyId,
        status: "active" as const,
        publishedAt: timestamp,
        updatedAt: timestamp
      };
      const catalog = publishedCatalogSchema.parse({
        schemaVersion: PUBLISHED_CATALOG_SCHEMA_VERSION,
        catalogId,
        releases: [
          ...(current?.releases ?? []).filter((candidate) => publishedReleaseKey(candidate.appId, candidate.version, candidate.digest) !== publishedReleaseKey(release.appId, release.version, release.digest)),
          release
        ].sort(comparePublishedReleases),
        updatedAt: timestamp
      });
      await atomicWriteJson(path.join(catalogRoot, PUBLISHED_CATALOG_FILE), catalog);
      const snapshotDigest = catalogSnapshotDigestFromRecords({
        artifacts: catalog.releases.map(({ appId, version, digest }) => ({ appId, version, digest })),
        publishedCatalog: catalog
      });
      const sourceId = `catalog.${catalogId}`;
      const sources = await this.marketplace.listCatalogSources();
      const existingSource = sources.find((source) => source.id === sourceId);
      const trustedPublisherKeys = uniqueTrustKeys([...(existingSource?.trustedPublisherKeys ?? []), trustKey]);
      await this.marketplace.addCatalogSource({
        schemaVersion: MARKETPLACE_SCHEMA_VERSION,
        id: sourceId,
        type: "filesystem",
        uri: `file://${catalogRoot}`,
        enabled: true,
        trustPolicy: "signed",
        trustedPublisherKeys
      });
      await this.marketplace.refreshCatalogSource(sourceId);
      return { catalogId, catalogRoot, release, snapshotDigest, sourceId, idempotent };
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  async setReleaseStatus(input: {
    catalogId: string;
    appId: string;
    version: string;
    status: "deprecated" | "revoked";
    message: string;
    now?: Date;
  }): Promise<{ catalog: PublishedCatalog; release: PublishedCatalogRelease }> {
    const catalogId = appIdSchema.parse(input.catalogId);
    const appId = appIdSchema.parse(input.appId);
    const catalogRoot = path.join(this.catalogsRoot, catalogId);
    const lockPath = path.join(catalogRoot, ".publish.lock");
    const lock = await acquireFileLock(lockPath);
    try {
      const catalog = await readPublishedCatalog(catalogRoot);
      if (!catalog) throw new Error(`Published catalog not found: ${catalogId}`);
      const matches = catalog.releases.filter((candidate) => candidate.appId === appId && candidate.version === input.version);
      if (matches.length !== 1) throw new Error(`Expected one published release for ${appId}@${input.version}, found ${matches.length}`);
      const timestamp = (input.now ?? new Date()).toISOString();
      const release = { ...matches[0], status: input.status, message: input.message, updatedAt: timestamp };
      const next = publishedCatalogSchema.parse({
        ...catalog,
        releases: catalog.releases.map((candidate) =>
          publishedReleaseKey(candidate.appId, candidate.version, candidate.digest) === publishedReleaseKey(release.appId, release.version, release.digest)
            ? release
            : candidate),
        updatedAt: timestamp
      });
      await atomicWriteJson(path.join(catalogRoot, PUBLISHED_CATALOG_FILE), next);
      const sourceId = `catalog.${catalogId}`;
      if ((await this.marketplace.listCatalogSources()).some((source) => source.id === sourceId)) {
        await this.marketplace.refreshCatalogSource(sourceId);
      }
      return { catalog: next, release };
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  private async requireActiveKey(keyId: string): Promise<PublisherKeyRecord> {
    const key = (await this.readKeyRegistry()).keys.find((candidate) => candidate.keyId === keyId);
    if (!key) throw new Error(`Publisher key not found: ${keyId}`);
    if (key.revokedAt) throw new Error(`Publisher key is revoked: ${keyId}`);
    if (!await exists(this.resolveProjectConfined(key.privateKeyPath))) throw new Error(`Publisher private key is unavailable: ${keyId}`);
    return key;
  }

  private async readKeyRegistry(): Promise<z.infer<typeof publisherRegistrySchema>> {
    try {
      return publisherRegistrySchema.parse(JSON.parse(await readFile(this.keyRegistryPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { schemaVersion: PUBLISHER_REGISTRY_SCHEMA_VERSION, keys: [], updatedAt: new Date(0).toISOString() };
    }
  }

  private async writeKeyRegistry(registry: z.infer<typeof publisherRegistrySchema>): Promise<void> {
    await atomicWriteJson(this.keyRegistryPath, publisherRegistrySchema.parse(registry), 0o600);
  }

  private resolveProjectConfined(candidate: string, options: { rejectProjectRoot?: boolean } = {}): string {
    const resolved = path.resolve(this.projectRoot, candidate);
    if (!isWithin(this.projectRoot, resolved) || (options.rejectProjectRoot && resolved === this.projectRoot)) {
      throw new Error(`App publisher path must stay inside the project root: ${candidate}`);
    }
    return resolved;
  }
}

function validationInstallation(
  appId: string,
  version: string,
  artifactDigest: string,
  permissions: Array<{ capability: string; authority: "read" | "draft" | "approve" | "execute"; defaultPolicy: "allowed" | "approval_required" | "forbidden" }>
): WorkspaceAppInstallation {
  return {
    schemaVersion: APP_INSTALL_SCHEMA_VERSION,
    id: `validation.${appId}`,
    workspaceId: "publisher-validation",
    appId,
    version,
    artifactDigest,
    state: "ready_to_test",
    mode: "simulation",
    selectedModules: [],
    presetId: "validation",
    configuration: {
      schemaVersion: "loopgraph-app-configuration/v1alpha1",
      appId,
      version,
      fields: [],
      values: {},
      provenance: {},
      completedAt: new Date(0).toISOString()
    },
    connectionBindings: {},
    fieldMappingIds: [],
    permissions: permissions.map((permission) => ({
      capability: permission.capability,
      authority: permission.authority,
      decision: permission.defaultPolicy === "allowed" ? "allow" : permission.defaultPolicy === "forbidden" ? "forbid" : "approval_required",
      reason: "Publisher conformance keeps provider execution blocked.",
      changedFromInstalled: false
    })),
    ownedAssets: [],
    history: [],
    installedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    installedBy: "app-publisher"
  };
}

async function rewriteCapturedIdentifiers(
  root: string,
  loopPaths: string[],
  skillPaths: string[],
  evalPaths: string[],
  derivedAppId: string
): Promise<void> {
  const loopIds = new Map<string, string>();
  const skillIds = new Map<string, string>();
  for (const relativePath of skillPaths) {
    const document = await readDocument(root, relativePath) as Record<string, unknown>;
    if (typeof document.id !== "string") continue;
    const nextId = `${derivedAppId}.${document.id}`;
    skillIds.set(document.id, nextId);
    document.id = nextId;
    await atomicWriteText(path.join(root, relativePath), YAML.stringify(document));
  }
  for (const relativePath of loopPaths) {
    const document = await readDocument(root, relativePath) as Record<string, unknown>;
    if (document.schemaVersion !== "loopgraph-app-loop/v1alpha1") continue;
    const metadata = document.metadata as Record<string, unknown>;
    const oldId = String(metadata.id);
    const nextId = `${derivedAppId}.${oldId}`;
    loopIds.set(oldId, nextId);
    metadata.id = nextId;
    if (Array.isArray(document.skills)) document.skills = document.skills.map((id) => typeof id === "string" ? skillIds.get(id) ?? id : id);
    await atomicWriteText(path.join(root, relativePath), YAML.stringify(document));
  }
  const manifestPath = path.join(root, "loopgraph.pack.yaml");
  const manifest = await readDocument(root, "loopgraph.pack.yaml") as Record<string, unknown>;
  if (isRecord(manifest.topology) && Array.isArray(manifest.topology.flows)) {
    manifest.topology.flows = manifest.topology.flows.map((flow) => {
      if (!isRecord(flow)) return flow;
      return {
        ...flow,
        source: rewriteTopologyLoopEndpoint(flow.source, loopIds),
        target: rewriteTopologyLoopEndpoint(flow.target, loopIds)
      };
    });
    await atomicWriteText(manifestPath, YAML.stringify(manifest));
  }
  for (const relativePath of evalPaths) {
    const document = await readDocument(root, relativePath) as Record<string, unknown>;
    document.appId = derivedAppId;
    if (Array.isArray(document.scenarios)) {
      document.scenarios = document.scenarios.map((scenario) => {
        if (!isRecord(scenario) || typeof scenario.expectedLoopId !== "string") return scenario;
        return { ...scenario, expectedLoopId: loopIds.get(scenario.expectedLoopId) ?? scenario.expectedLoopId };
      });
    }
    await atomicWriteText(path.join(root, relativePath), YAML.stringify(document));
  }
}

function rewriteTopologyLoopEndpoint(endpoint: unknown, loopIds: Map<string, string>): unknown {
  if (!isRecord(endpoint) || endpoint.kind !== "loop" || typeof endpoint.id !== "string") return endpoint;
  return { ...endpoint, id: loopIds.get(endpoint.id) ?? endpoint.id };
}

function publisherTrustKey(key: PublisherKeyRecord): PublisherTrustKey {
  return {
    publisherId: key.publisherId,
    keyId: key.keyId,
    algorithm: key.algorithm,
    publicKey: key.publicKey
  };
}

function uniqueTrustKeys(keys: PublisherTrustKey[]): PublisherTrustKey[] {
  const unique = new Map(keys.map((key) => [`${key.publisherId}/${key.keyId}/${publicKeyFingerprint(key.publicKey)}`, key]));
  return [...unique.values()].sort((left, right) => left.keyId.localeCompare(right.keyId));
}

function publicKeyFingerprint(publicKey: string): string {
  const der = createPublicKey(publicKey).export({ type: "spki", format: "der" });
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

function comparePublishedReleases(left: PublishedCatalogRelease, right: PublishedCatalogRelease): number {
  return left.appId.localeCompare(right.appId) || left.version.localeCompare(right.version) || left.digest.localeCompare(right.digest);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function isSensitiveConfigurationKey(key: string): boolean {
  return /(?:token|secret|password|credential|private[_-]?key|api[_-]?key|client[_-]?secret)/i.test(key);
}

async function readDocument(root: string, relativePath: string): Promise<unknown> {
  const target = path.resolve(root, relativePath);
  if (!isWithin(root, target)) throw new Error(`Pack document escapes root: ${relativePath}`);
  const raw = await readFile(target, "utf8");
  return relativePath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
}

async function atomicWriteJson(filePath: string, value: unknown, mode = 0o600): Promise<void> {
  await atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

async function atomicWriteText(filePath: string, value: string, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode });
  await rename(temporary, filePath);
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function acquireFileLock(lockPath: string) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, 5 + attempt * 2)));
    }
  }
  throw new Error(`Timed out waiting for catalog publisher lock: ${lockPath}`);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createStarterDocuments(input: {
  appId: string;
  name: string;
  department: DepartmentType;
  publisherId: string;
  publisherName: string;
  summary: string;
}): Record<string, string> {
  const loopId = `${input.appId}.primary-loop`;
  const skillId = `${input.appId}.operating-skill`;
  const manifest = {
    schemaVersion: "loopgraph-pack/v1alpha1",
    kind: "LoopPack",
    metadata: {
      id: input.appId,
      name: input.name,
      version: "0.1.0",
      summary: input.summary,
      description: `${input.summary} This private starter includes a bounded routing contract, explicit abstention, approval-gated provider changes, deterministic safety cases, and outcome evidence.`,
      department: input.department,
      publisher: { id: input.publisherId, name: input.publisherName, verified: false },
      license: "Proprietary",
      visibility: "private",
      tags: [input.department, "hermes", "governed-loop"]
    },
    compatibility: { loopgraph: ">=0.2.0 <1.0.0", hermes: ">=1.0.0", platforms: ["darwin", "linux", "win32"] },
    dependencies: [],
    modules: [],
    presets: [{ id: "custom-provider", name: "Custom provider", description: "Bind a company system to the provider-neutral record contract.", path: "presets/custom-provider.yaml", providerFamily: "custom" }],
    permissions: [
      { capability: "company.record.read", authority: "read", mode: "required", risk: "low", purpose: "Read the affected business record and the evidence needed to route it.", customerFacing: false, defaultPolicy: "allowed", dataClasses: ["business_record"] },
      { capability: "company.record.update", authority: "approve", mode: "optional", risk: "high", purpose: "Apply an exact reviewed change to the affected record.", customerFacing: false, defaultPolicy: "approval_required", dataClasses: ["business_record"] }
    ],
    requiredCapabilities: ["company.record.read"],
    optionalCapabilities: ["company.record.update"],
    entrypoints: {
      loops: ["loops/primary-loop.yaml"],
      skills: ["skills/operating-skill.yaml"],
      connectors: ["connectors/custom-provider.yaml"],
      setup: ["setup/questions.yaml"],
      policies: ["policies/default.yaml"],
      fixtures: ["fixtures/happy.json", "fixtures/missing-context.json", "fixtures/exclusion.json", "fixtures/duplicate.json", "fixtures/ambiguous.json", "fixtures/low-confidence.json", "fixtures/permission-change.json"],
      evals: ["evals/conformance.yaml"],
      dashboards: ["dashboards/outcomes.yaml"],
      assets: []
    },
    ownership: { defaultOwnerRole: `${input.department}_owner`, reviewRoles: [`${input.department}_reviewer`] },
    defaultRolloutMode: "shadow"
  };
  const loop = {
    schemaVersion: "loopgraph-app-loop/v1alpha1",
    kind: "AppLoop",
    metadata: { id: loopId, name: `${input.name} Primary Loop`, version: "0.1.0", description: input.summary, department: input.department, ownerRole: `${input.department}_owner`, tags: ["starter", "governed"] },
    trigger: { type: "event", source: "*", event: "company.record_changed" },
    input: { requiredFields: ["normalizedPayload.recordId", "normalizedPayload.changeType"], subjectTypes: ["company_record"], fixtures: [{ id: "happy", path: "fixtures/happy.json" }] },
    routine: [
      { id: "observe", name: "Normalize the event", actor: "system", type: "observe", description: "Resolve a durable record identity and assemble trusted evidence." },
      { id: "assess", name: "Assess the problem", actor: "agent", type: "assess", description: "Determine what happened, whether this is new work, and whether context is sufficient." },
      { id: "decide", name: "Choose a bounded route", actor: "agent", type: "decide", description: "Claim one clear route or abstain when identity, evidence, or policy is ambiguous." },
      { id: "prepare", name: "Prepare reviewed work", actor: "system", type: "prepare", description: "Prepare an exact provider change without executing it." },
      { id: "learn", name: "Return outcome evidence", actor: "system", type: "learn", description: "Measure the business result and return corrections to Hermes." }
    ],
    capabilities: [
      { key: "company.record.read", authority: "read", risk: "low", required: true, purpose: "Read the affected business record.", customerFacing: false },
      { key: "company.record.update", authority: "approve", risk: "high", required: false, purpose: "Apply the exact approved record change.", customerFacing: false }
    ],
    skills: [skillId],
    outcomes: [
      { metric: "problem_resolution_latency_minutes", description: "Time from a qualifying event to an accountable decision.", direction: "decrease", sourceCapability: "company.record.read" },
      { metric: "routing_correction_rate", description: "Fraction of Hermes decisions corrected by a reviewer.", direction: "decrease", sourceCapability: "company.record.read" }
    ],
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: [`${input.department}.record_change`],
      accepts: [{ sourcePattern: "*", eventTypePattern: "company.record_changed", subjectTypes: ["company_record"], requiredFields: ["normalizedPayload.recordId", "normalizedPayload.changeType"], reason: "A company record changed with the minimum evidence required for this loop." }],
      excludes: [{ sourcePattern: "*", eventTypePattern: "loopgraph.lifecycle.*", subjectTypes: [], fields: [], reason: "Lifecycle evidence updates existing work and cannot create a new problem." }],
      inputMapping: { recordId: "normalizedPayload.recordId", changeType: "normalizedPayload.changeType" },
      priority: 50,
      minimumConfidence: 0.8,
      ambiguityPolicy: "request_human",
      noMatchPolicy: "unhandled",
      fanoutPolicy: { mode: "none", maxRoutes: 1, requiresIndependentProblems: true },
      cooldown: { seconds: 0, dedupeWindowSeconds: 86400 },
      concurrency: { maxActive: 25, strategy: "append_evidence" },
      activationMode: "shadow",
      lifecycleEvents: ["loopgraph.run.completed", "loopgraph.outcome.observed"],
      requiredConnections: ["company.record.read"],
      examples: { shouldRoute: ["A verified record change includes an ID and change type."], shouldNotRoute: ["The record is ambiguous.", "Required evidence is missing."] }
    },
    policy: { forbiddenActions: [{ capability: "company.record.update", reason: "Provider changes require exact prepared-action approval." }], escalationOwner: `${input.department}_owner`, escalationSla: "4h", separateCustomerFacingApproval: true }
  };
  const skill = {
    schemaVersion: "loopgraph-app-skill/v1alpha1",
    kind: "HermesSkill",
    id: skillId,
    name: `${input.name} Operating Skill`,
    description: "Helps Hermes assess, route, prepare, and learn from this recurring business problem.",
    department: input.department,
    goal: "Resolve qualifying business problems safely and return useful outcome evidence.",
    inputs: ["normalized company event", "resolved company object", "approved company context", "active routing candidates"],
    outputs: ["route decision", "missing-context request", "prepared action", "outcome evidence request"],
    instructions: ["Determine whether the event creates a new problem or adds evidence to existing work.", "Route only when one active loop has the required context.", "Abstain on ambiguity and name the smallest missing fact.", "Never execute provider changes without the required approval receipt."],
    boundaries: ["Do not invent company policy or missing provider data.", "Do not expose credentials or private provider payloads.", "Do not treat activity as business value without an observed outcome."],
    requiredCapabilities: ["company.record.read"]
  };
  const setup = {
    schemaVersion: "loopgraph-app-setup/v1alpha1",
    kind: "AppSetup",
    questions: [
      { key: "problemBoundary", prompt: "Which recurring business problem should this app own?", why: "Hermes needs a precise ownership boundary.", valueType: "string", requirement: "required", inferFromContext: `${input.department}.problemBoundary`, confirmWhenInferred: true },
      { key: "affectedObjects", prompt: "Which company objects can be affected?", why: "Durable entity identity prevents duplicate and conflicting work.", valueType: "string_list", requirement: "required", inferFromContext: `${input.department}.affectedObjects`, confirmWhenInferred: true },
      { key: "requiredEvidence", prompt: "What evidence must be present before Hermes may route?", why: "Missing context must produce an explicit abstention.", valueType: "object", requirement: "required", inferFromContext: `${input.department}.requiredEvidence`, confirmWhenInferred: true },
      { key: "owner", prompt: "Who owns the problem and who reviews risky actions?", why: "Every route and escalation needs accountable humans.", valueType: "object", requirement: "required", inferFromContext: `${input.department}.ownership`, confirmWhenInferred: true },
      { key: "exclusions", prompt: "Which events or records must never enter this loop?", why: "Explicit exclusions reduce false-positive work.", valueType: "object", requirement: "required", inferFromContext: `${input.department}.exclusions`, confirmWhenInferred: true },
      { key: "successMetrics", prompt: "Which business outcomes prove the loop created value?", why: "Hermes learns from outcomes rather than task completion alone.", valueType: "object", requirement: "required", inferFromContext: `${input.department}.successMetrics`, confirmWhenInferred: true }
    ]
  };
  const fixtures = {
    "happy.json": { id: "record-happy", eventType: "company.record_changed", subject: { type: "company_record", id: "record-101" }, normalizedPayload: { recordId: "101", changeType: "updated", confidence: 0.96 }, evidenceRefs: ["company:record:101"] },
    "missing-context.json": { id: "record-missing", eventType: "company.record_changed", subject: { type: "company_record", id: "record-102" }, normalizedPayload: { recordId: "102", confidence: 0.94 }, evidenceRefs: ["company:record:102"] },
    "exclusion.json": { id: "record-excluded", eventType: "company.record_changed", subject: { type: "company_record", id: "record-103" }, normalizedPayload: { recordId: "103", changeType: "test", excluded: true, confidence: 1 }, evidenceRefs: ["policy:test-traffic"] },
    "duplicate.json": { id: "record-duplicate", eventType: "company.record_changed", subject: { type: "company_record", id: "record-104" }, normalizedPayload: { recordId: "104", changeType: "updated", matchedProblemId: "problem-44", confidence: 0.98 }, evidenceRefs: ["problem:44"] },
    "ambiguous.json": { id: "record-ambiguous", eventType: "company.record_changed", subject: { type: "company_record", id: "record-105" }, normalizedPayload: { recordId: "105", changeType: "updated", candidateSubjectIds: ["record-a", "record-b"], confidence: 0.93 }, evidenceRefs: ["company:record:105"] },
    "low-confidence.json": { id: "record-low-confidence", eventType: "company.record_changed", subject: { type: "company_record", id: "record-106" }, normalizedPayload: { recordId: "106", changeType: "updated", confidence: 0.3 }, evidenceRefs: ["company:record:106"] },
    "permission-change.json": { id: "record-permission-change", eventType: "company.record_changed", subject: { type: "company_record", id: "record-107" }, normalizedPayload: { recordId: "107", changeType: "updated", permissionChange: "company.record.update: approve -> execute", confidence: 1 }, evidenceRefs: ["fixture:permission-review"] }
  };
  const scenario = (id: string, fixture: string, expectedAction: string, expectedApproval: boolean, withLoop = true) => ({ id, fixture: `fixtures/${fixture}`, expectedAction, ...(withLoop ? { expectedLoopId: loopId } : {}), connectorState: "connected", expectedApproval, notes: `Deterministic ${id} publisher conformance case.` });
  const evalSuite = {
    schemaVersion: "loopgraph-app-eval-suite/v1alpha1",
    kind: "AppEvalSuite",
    id: `${input.appId}.conformance`,
    appId: input.appId,
    scenarios: [
      scenario("high-fit", "happy.json", "route", true),
      scenario("missing-context", "missing-context.json", "request_human", false),
      scenario("exclusion", "exclusion.json", "request_human", false, false),
      scenario("duplicate", "duplicate.json", "append_evidence", false),
      scenario("ambiguous-route", "ambiguous.json", "request_human", false),
      scenario("low-confidence", "low-confidence.json", "request_human", false),
      { ...scenario("connector-unavailable", "happy.json", "defer", false), connectorState: "unavailable" },
      scenario("missing-field", "missing-context.json", "request_human", false),
      scenario("human-approval", "happy.json", "route", true),
      scenario("customer-facing-action", "happy.json", "route", true),
      scenario("missing-outcome", "happy.json", "route", true),
      scenario("retry-idempotency", "duplicate.json", "append_evidence", false),
      scenario("upgrade-rollback", "permission-change.json", "request_human", true, false)
    ]
  };
  return {
    "loopgraph.pack.yaml": YAML.stringify(manifest),
    "README.md": `# ${input.name}\n\n${input.summary}\n\nThis private Loopgraph App routes normalized events through Hermes, abstains when evidence is incomplete, keeps provider writes approval-bound, and records outcomes for shared learning.\n`,
    "CHANGELOG.md": `# Changelog\n\n## 0.1.0\n\n- Created a private, write-blocked Loopgraph App starter.\n`,
    "loops/primary-loop.yaml": YAML.stringify(loop),
    "skills/operating-skill.yaml": YAML.stringify(skill),
    "connectors/custom-provider.yaml": YAML.stringify({ schemaVersion: "loopgraph-connector-recipe/v1alpha1", id: "custom-provider", providerId: "custom-provider", providerFamily: "custom", displayName: "Custom Provider", capabilities: [{ logicalCapability: "company.record.read", providerOperation: "company.records.read", minimumScopes: ["records:read"], authority: "read", risk: "low" }, { logicalCapability: "company.record.update", providerOperation: "company.records.update", minimumScopes: ["records:write"], authority: "approve", risk: "high" }], eventSources: [{ eventFamily: "company.record_changed", providerEvent: "record.changed", transport: "webhook", normalizationTransformer: "custom.record-change.v1", signatureStrategy: "provider-signature", replayProtection: true }], fieldMappings: [{ objectType: "company_record", requiredLogicalFields: ["record.id", "record.changeType"], optionalLogicalFields: ["record.owner", "record.updatedAt"] }], healthCheck: { capability: "company.record.read", sampleQuery: { limit: 1 }, timeoutMs: 10000 }, supportsBoundedSamples: true }),
    "presets/custom-provider.yaml": YAML.stringify({ id: "custom-provider", providers: { records: "custom" }, recipe: "custom-provider", defaults: { writePolicy: "approval_required" } }),
    "setup/questions.yaml": YAML.stringify(setup),
    "policies/default.yaml": YAML.stringify({ schemaVersion: "loopgraph-app-policy/v1alpha1", initialMode: "shadow", rules: { read: "allowed", update: "approval_required", ambiguous: "request_human" }, approval: { requireExactPreparedActionFingerprint: true, expiresMinutes: 30 } }),
    "evals/conformance.yaml": YAML.stringify(evalSuite),
    "dashboards/outcomes.yaml": YAML.stringify({ schemaVersion: "loopgraph-app-dashboard/v1alpha1", id: `${input.appId}.outcomes`, metrics: [{ id: "problem_resolution_latency_minutes", direction: "decrease", description: "Time to an accountable problem decision." }, { id: "routing_correction_rate", direction: "decrease", description: "Hermes decisions corrected by reviewers." }] }),
    ...Object.fromEntries(Object.entries(fixtures).map(([file, value]) => [`fixtures/${file}`, `${JSON.stringify(value, null, 2)}\n`]))
  };
}
