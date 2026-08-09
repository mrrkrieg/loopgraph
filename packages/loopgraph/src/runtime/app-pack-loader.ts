import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import {
  LOOP_PACK_SCHEMA_VERSION,
  artifactDigestSchema,
  canonicalAppDigest,
  loopPackArtifactSchema,
  loopPackManifestSchema,
  loopPackSignatureSchema,
  packRelativePathSchema,
  type LoopPackArtifact,
  type LoopPackManifest,
  type MarketplaceAppVersion,
  type PublisherTrustKey
} from "../core/app-platform";

export const LOOP_PACK_MANIFEST_FILE = "loopgraph.pack.yaml" as const;
export const LOOP_PACK_SIGNATURE_FILE = "loopgraph.pack.signature.json" as const;
export const LOOP_PACK_ARCHIVE_SCHEMA_VERSION = "loopgraph-pack-archive/v1alpha1" as const;

const forbiddenFileNames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519"
]);

const highConfidenceSecretPatterns: Array<{ id: string; pattern: RegExp }> = [
  { id: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "github_token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { id: "stripe_live_key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { id: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { id: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { id: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}\b/i },
  { id: "assigned_secret", pattern: /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\s*[:=]\s*["']?(?!\$\{|<|example|placeholder|redacted|none|null)[A-Za-z0-9._~+/-]{20,}["']?/i }
];

export type LoopPackValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
};

export type LoopPackValidationOptions = {
  loopgraphVersion?: string;
  hermesVersion?: string;
  dependencyVersions?: Record<string, string>;
  requireSignature?: boolean;
  trustedPublisherKeys?: PublisherTrustKey[];
};

export type LoopPackLoadResult = {
  root: string;
  manifestPath: string;
  manifest: LoopPackManifest;
  artifact: LoopPackArtifact;
  issues: LoopPackValidationIssue[];
};

type EnumeratedFile = {
  absolutePath: string;
  relativePath: string;
  content: Buffer;
};

type LoopPackArchive = {
  schemaVersion: typeof LOOP_PACK_ARCHIVE_SCHEMA_VERSION;
  artifact: LoopPackArtifact;
  files: Array<{
    path: string;
    digest: string;
    contentBase64: string;
  }>;
};

export async function loadLoopPackDirectory(
  packRoot: string,
  options: LoopPackValidationOptions = {}
): Promise<LoopPackLoadResult> {
  const root = path.resolve(packRoot);
  const manifestPath = path.join(root, LOOP_PACK_MANIFEST_FILE);
  const issues: LoopPackValidationIssue[] = [];
  const rootStat = await lstat(root).catch(() => undefined);
  if (!rootStat?.isDirectory()) {
    throw new Error(`LoopPack directory does not exist: ${root}`);
  }

  const rawManifest = await readFile(manifestPath, "utf8").catch((error: unknown) => {
    throw new Error(`Unable to read ${LOOP_PACK_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  });
  let parsedManifest: unknown;
  try {
    parsedManifest = YAML.parse(rawManifest);
  } catch (error) {
    throw new Error(`Invalid LoopPack YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifestResult = loopPackManifestSchema.safeParse(parsedManifest);
  if (!manifestResult.success) {
    const details = manifestResult.error.issues
      .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid LoopPack manifest: ${details}`);
  }

  const manifest = manifestResult.data;
  const files = await enumeratePackFiles(root);
  const filePaths = new Set(files.map((file) => file.relativePath));
  validateDeclaredPaths(manifest, filePaths, issues);
  validateSensitiveContent(files, issues);
  validateCompatibility(manifest, options, issues);
  validateDependencies(manifest, options.dependencyVersions ?? {}, issues);

  const artifactFiles = files.map((file) => ({
    path: file.relativePath,
    digest: canonicalAppDigest(file.content),
    sizeBytes: file.content.byteLength,
    mediaType: inferMediaType(file.relativePath)
  }));
  const digest = canonicalAppDigest({
    manifest,
    files: artifactFiles.filter((file) => file.path !== LOOP_PACK_SIGNATURE_FILE).map(({ path: filePath, digest: fileDigest, sizeBytes }) => ({
      path: filePath,
      digest: fileDigest,
      sizeBytes
    }))
  });
  const signatureFile = files.find((file) => file.relativePath === LOOP_PACK_SIGNATURE_FILE);
  const signature = signatureFile
    ? verifyLoopPackSignature(signatureFile.content, manifest.metadata.publisher.id, digest)
    : undefined;
  const artifact = loopPackArtifactSchema.parse({
    schemaVersion: LOOP_PACK_SCHEMA_VERSION,
    manifest,
    digest,
    files: artifactFiles,
    sizeBytes: artifactFiles.reduce((total, file) => total + file.sizeBytes, 0),
    createdAt: new Date().toISOString(),
    provenance: {
      sourceType: "filesystem",
      sourceUri: root,
      signature: signature ? {
        algorithm: signature.algorithm,
        publisherId: signature.publisherId,
        keyId: signature.keyId,
        publicKey: signature.publicKey,
        value: signature.value
      } : undefined
    }
  });

  if (options.requireSignature && !artifact.provenance.signature) {
    issues.push({ severity: "error", code: "signature_required", message: "This catalog requires a signed LoopPack" });
  }
  if (artifact.provenance.signature && (options.trustedPublisherKeys?.length ?? 0) > 0) {
    const trusted = options.trustedPublisherKeys!.some((key) =>
      key.publisherId === artifact.provenance.signature!.publisherId &&
      key.keyId === artifact.provenance.signature!.keyId &&
      key.algorithm === artifact.provenance.signature!.algorithm &&
      normalizePublicKey(key.publicKey) === normalizePublicKey(artifact.provenance.signature!.publicKey));
    if (!trusted) {
      issues.push({ severity: "error", code: "publisher_key_untrusted", message: `Publisher key ${artifact.provenance.signature.keyId} is not trusted by this catalog source` });
    }
  }
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(`LoopPack validation failed:\n${errors.map((issue) => `- [${issue.code}] ${issue.path ? `${issue.path}: ` : ""}${issue.message}`).join("\n")}`);
  }
  return { root, manifestPath, manifest, artifact, issues };
}

export async function validateLoopPackDirectory(
  packRoot: string,
  options: LoopPackValidationOptions = {}
): Promise<{ ok: boolean; result?: LoopPackLoadResult; issues: LoopPackValidationIssue[] }> {
  try {
    const result = await loadLoopPackDirectory(packRoot, options);
    return { ok: true, result, issues: result.issues };
  } catch (error) {
    return {
      ok: false,
      issues: [{ severity: "error", code: "pack_invalid", message: error instanceof Error ? error.message : String(error) }]
    };
  }
}

export async function createLoopPackArchive(packRoot: string, destination: string): Promise<LoopPackArtifact> {
  const loaded = await loadLoopPackDirectory(packRoot);
  const files = await enumeratePackFiles(loaded.root);
  const archive: LoopPackArchive = {
    schemaVersion: LOOP_PACK_ARCHIVE_SCHEMA_VERSION,
    artifact: loaded.artifact,
    files: files.map((file) => ({
      path: file.relativePath,
      digest: canonicalAppDigest(file.content),
      contentBase64: file.content.toString("base64")
    }))
  };
  const destinationPath = path.resolve(destination);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, JSON.stringify(archive));
  return loaded.artifact;
}

export async function readLoopPackArchive(archivePath: string): Promise<LoopPackArchive> {
  const raw = await readFile(path.resolve(archivePath), "utf8");
  const value = JSON.parse(raw) as Partial<LoopPackArchive>;
  if (value.schemaVersion !== LOOP_PACK_ARCHIVE_SCHEMA_VERSION || !value.artifact || !Array.isArray(value.files)) {
    throw new Error("Invalid LoopPack archive envelope");
  }
  const artifact = loopPackArtifactSchema.parse(value.artifact);
  const expectedFiles = new Map(artifact.files.map((file) => [file.path, file]));
  if (value.files.length !== artifact.files.length) {
    throw new Error("LoopPack archive file count does not match artifact metadata");
  }
  for (const file of value.files) {
    packRelativePathSchema.parse(file.path);
    artifactDigestSchema.parse(file.digest);
    const expected = expectedFiles.get(file.path);
    const content = Buffer.from(file.contentBase64, "base64");
    if (!expected || canonicalAppDigest(content) !== file.digest || expected.digest !== file.digest || expected.sizeBytes !== content.byteLength) {
      throw new Error(`LoopPack archive content verification failed for ${file.path}`);
    }
  }
  const archivedManifest = value.files.find((file) => file.path === LOOP_PACK_MANIFEST_FILE);
  if (!archivedManifest) throw new Error("LoopPack archive is missing its manifest file");
  const parsedManifest = loopPackManifestSchema.parse(YAML.parse(Buffer.from(archivedManifest.contentBase64, "base64").toString("utf8")));
  if (canonicalAppDigest(parsedManifest) !== canonicalAppDigest(artifact.manifest)) {
    throw new Error("LoopPack archive manifest content does not match artifact metadata");
  }
  const computedDigest = canonicalAppDigest({
    manifest: parsedManifest,
    files: artifact.files.filter((file) => file.path !== LOOP_PACK_SIGNATURE_FILE).map(({ path: filePath, digest: fileDigest, sizeBytes }) => ({
      path: filePath,
      digest: fileDigest,
      sizeBytes
    }))
  });
  if (computedDigest !== artifact.digest) {
    throw new Error("LoopPack archive artifact digest does not match the verified manifest and files");
  }
  const signatureFile = value.files.find((file) => file.path === LOOP_PACK_SIGNATURE_FILE);
  if (artifact.provenance.signature) {
    if (!signatureFile) throw new Error("Signed LoopPack archive is missing its detached signature file");
    const signature = verifyLoopPackSignature(
      Buffer.from(signatureFile.contentBase64, "base64"),
      artifact.manifest.metadata.publisher.id,
      artifact.digest
    );
    if (signature.publisherId !== artifact.provenance.signature.publisherId ||
        signature.keyId !== artifact.provenance.signature.keyId ||
        normalizePublicKey(signature.publicKey) !== normalizePublicKey(artifact.provenance.signature.publicKey) ||
        signature.value !== artifact.provenance.signature.value) {
      throw new Error("LoopPack archive provenance does not match its detached signature");
    }
  }
  return { schemaVersion: LOOP_PACK_ARCHIVE_SCHEMA_VERSION, artifact, files: value.files };
}

export async function extractLoopPackArchive(archivePath: string, destinationRoot: string): Promise<LoopPackArtifact> {
  const archive = await readLoopPackArchive(archivePath);
  const destination = path.resolve(destinationRoot);
  await mkdir(destination, { recursive: true });
  const destinationReal = await realpath(destination);
  for (const file of archive.files) {
    const target = path.resolve(destinationReal, file.path);
    if (!isWithin(destinationReal, target)) {
      throw new Error(`Archive path escapes destination: ${file.path}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.contentBase64, "base64"), { flag: "wx" });
  }
  const reloaded = await loadLoopPackDirectory(destination);
  if (reloaded.artifact.digest !== archive.artifact.digest) {
    throw new Error("Extracted LoopPack digest does not match the archive artifact digest");
  }
  return reloaded.artifact;
}

export function marketplaceVersionFromArtifact(
  artifact: LoopPackArtifact,
  artifactUri: string,
  maturity: MarketplaceAppVersion["maturity"] = "concept"
): MarketplaceAppVersion {
  const manifest = artifact.manifest;
  return {
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    appId: manifest.metadata.id,
    version: manifest.metadata.version,
    digest: artifact.digest,
    publishedAt: artifact.createdAt,
    compatibility: manifest.compatibility,
    dependencies: manifest.dependencies,
    permissions: manifest.permissions,
    requiredCapabilities: manifest.requiredCapabilities,
    presets: manifest.presets,
    modules: manifest.modules,
    maturity,
    deprecated: false,
    artifactUri,
    provenanceVerified: Boolean(artifact.provenance.signature) || artifact.provenance.sourceType === "official"
  };
}

export function satisfiesVersionRange(version: string, range: string): boolean {
  const actual = parseSemver(version);
  if (!actual) return false;
  const normalized = range.trim();
  if (normalized === "*" || normalized.toLowerCase() === "latest") return true;
  if (normalized.includes("||")) {
    return normalized.split("||").some((part) => satisfiesVersionRange(version, part));
  }
  const clauses = normalized.split(/\s+/).filter(Boolean);
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(clause);
    if (!match) return false;
    const expected = parseSemver(match[2]);
    if (!expected) return false;
    const comparison = compareSemver(actual, expected);
    switch (match[1] ?? "=") {
      case ">=": return comparison >= 0;
      case "<=": return comparison <= 0;
      case ">": return comparison > 0;
      case "<": return comparison < 0;
      case "^": return actual.major === expected.major && comparison >= 0;
      case "~": return actual.major === expected.major && actual.minor === expected.minor && comparison >= 0;
      default: return comparison === 0;
    }
  });
}

async function enumeratePackFiles(root: string): Promise<EnumeratedFile[]> {
  const rootReal = await realpath(root);
  const files: EnumeratedFile[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(rootReal, absolutePath).split(path.sep).join("/");
      packRelativePathSchema.parse(relativePath);
      if (entry.isSymbolicLink()) {
        throw new Error(`LoopPacks cannot contain symbolic links: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const stat = await lstat(absolutePath);
        if (stat.size > 10 * 1024 * 1024) {
          throw new Error(`LoopPack file exceeds the 10 MiB limit: ${relativePath}`);
        }
        files.push({ absolutePath, relativePath, content: await readFile(absolutePath) });
      } else {
        throw new Error(`Unsupported LoopPack filesystem entry: ${relativePath}`);
      }
    }
  }
  await visit(rootReal);
  if (!files.some((file) => file.relativePath === LOOP_PACK_MANIFEST_FILE)) {
    throw new Error(`LoopPack is missing ${LOOP_PACK_MANIFEST_FILE}`);
  }
  if (files.length > 2_000) {
    throw new Error("LoopPack exceeds the 2,000 file limit");
  }
  return files;
}

function validateDeclaredPaths(
  manifest: LoopPackManifest,
  availablePaths: Set<string>,
  issues: LoopPackValidationIssue[]
): void {
  const entrypointPaths = Object.values(manifest.entrypoints).flat();
  const declaredPaths = [
    ...entrypointPaths,
    ...manifest.presets.map((preset) => preset.path),
    ...manifest.modules.flatMap((module) => module.assets)
  ];
  for (const declaredPath of new Set(declaredPaths)) {
    if (!availablePaths.has(declaredPath)) {
      issues.push({ severity: "error", code: "declared_file_missing", path: declaredPath, message: "Manifest references a file that is not present" });
    }
  }
}

function validateSensitiveContent(files: EnumeratedFile[], issues: LoopPackValidationIssue[]): void {
  for (const file of files) {
    const baseName = path.posix.basename(file.relativePath).toLowerCase();
    if (forbiddenFileNames.has(baseName) || baseName.endsWith(".pem") || baseName.endsWith(".p12") || baseName.endsWith(".key")) {
      issues.push({ severity: "error", code: "forbidden_sensitive_file", path: file.relativePath, message: "Credential and private-key files are forbidden in LoopPacks" });
      continue;
    }
    if (!isTextFile(file.relativePath, file.content)) continue;
    const text = file.content.toString("utf8");
    for (const matcher of highConfidenceSecretPatterns) {
      if (matcher.pattern.test(text)) {
        issues.push({ severity: "error", code: `secret_${matcher.id}`, path: file.relativePath, message: "File appears to contain credential material" });
      }
    }
  }
}

function verifyLoopPackSignature(content: Buffer, publisherId: string, digest: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Invalid ${LOOP_PACK_SIGNATURE_FILE}: expected JSON`);
  }
  const signature = loopPackSignatureSchema.parse(parsed);
  if (signature.publisherId !== publisherId) throw new Error("LoopPack signature publisher does not match the manifest");
  if (signature.digest !== digest) throw new Error("LoopPack signature digest does not match the pack content");
  const publicKey = createPublicKey(signature.publicKey);
  const algorithm = signature.algorithm === "ed25519" ? null : "sha256";
  const verified = verifySignature(algorithm, Buffer.from(signature.digest, "utf8"), publicKey, Buffer.from(signature.value, "base64url"));
  if (!verified) throw new Error("LoopPack publisher signature verification failed");
  return signature;
}

function normalizePublicKey(value: string): string {
  return createPublicKey(value).export({ type: "spki", format: "pem" }).toString().trim();
}

function validateCompatibility(
  manifest: LoopPackManifest,
  options: LoopPackValidationOptions,
  issues: LoopPackValidationIssue[]
): void {
  if (options.loopgraphVersion && !satisfiesVersionRange(options.loopgraphVersion, manifest.compatibility.loopgraph)) {
    issues.push({ severity: "error", code: "loopgraph_incompatible", message: `Loopgraph ${options.loopgraphVersion} does not satisfy ${manifest.compatibility.loopgraph}` });
  }
  if (options.hermesVersion && !satisfiesVersionRange(options.hermesVersion, manifest.compatibility.hermes)) {
    issues.push({ severity: "error", code: "hermes_incompatible", message: `Hermes ${options.hermesVersion} does not satisfy ${manifest.compatibility.hermes}` });
  }
}

function validateDependencies(
  manifest: LoopPackManifest,
  versions: Record<string, string>,
  issues: LoopPackValidationIssue[]
): void {
  for (const dependency of manifest.dependencies) {
    const installedVersion = versions[dependency.appId];
    if (!installedVersion && !dependency.optional) {
      issues.push({ severity: "error", code: "dependency_missing", path: dependency.appId, message: `Required dependency ${dependency.version} is not resolved` });
    } else if (installedVersion && !satisfiesVersionRange(installedVersion, dependency.version)) {
      issues.push({ severity: "error", code: "dependency_incompatible", path: dependency.appId, message: `${installedVersion} does not satisfy ${dependency.version}` });
    }
  }
}

function inferMediaType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".yaml":
    case ".yml": return "application/yaml";
    case ".json": return "application/json";
    case ".md": return "text/markdown";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    default: return "application/octet-stream";
  }
}

function isTextFile(filePath: string, content: Buffer): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if ([".yaml", ".yml", ".json", ".md", ".txt", ".csv", ".svg"].includes(extension)) return true;
  return !content.subarray(0, Math.min(1_024, content.length)).includes(0);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function parseSemver(value: string): { major: number; minor: number; patch: number } | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].*)?$/.exec(value);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemver(
  left: { major: number; minor: number; patch: number },
  right: { major: number; minor: number; patch: number }
): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
