import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLISHED_CATALOG_FILE,
  PUBLISHED_CATALOG_SCHEMA_VERSION,
  compileLoopPack,
  createSyntheticMaturityEvidence,
  createSyntheticValidationInstallation,
  loadLoopPackDirectory,
  publishedCatalogSchema,
  publishedReleaseKey,
  readPublishedCatalog,
  runAppSyntheticConformance,
  type PublishedCatalogRelease
} from "../packages/loopgraph/src/runtime";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const officialRoot = path.join(repoRoot, "packs", "official");
// The Marketplace source root is `packs`; App artifacts live one level below
// in `packs/official`, so the source-wide evidence catalog belongs at `packs`.
const catalogRoot = path.join(repoRoot, "packs");
const catalogPath = path.join(catalogRoot, PUBLISHED_CATALOG_FILE);
const check = process.argv.includes("--check");
const generatedAt = new Date().toISOString();
const current = await readPublishedCatalog(catalogRoot);
const existingReleases = new Map((current?.releases ?? []).map((release) => [
  publishedReleaseKey(release.appId, release.version, release.digest),
  release
]));

const releases: PublishedCatalogRelease[] = [];
for (const packRoot of await discoverPackRoots(officialRoot)) {
  const loaded = await loadLoopPackDirectory(packRoot);
  const compiled = await compileLoopPack(loaded);
  const installation = createSyntheticValidationInstallation(loaded, "official-catalog-generator");
  const key = publishedReleaseKey(loaded.manifest.metadata.id, loaded.manifest.metadata.version, loaded.artifact.digest);
  const existing = existingReleases.get(key);
  const evaluatedAt = existing?.validation?.evaluatedAt ?? generatedAt;
  const evaluation = await runAppSyntheticConformance({
    loaded,
    compiled,
    installation,
    actor: "official-catalog-generator",
    now: new Date(evaluatedAt)
  });
  const passedScenarioCount = evaluation.scenarios.filter((scenario) => scenario.status === "passed").length;
  if (evaluation.status !== "passed") {
    const failures = evaluation.scenarios.filter((scenario) => scenario.status === "failed").map((scenario) => scenario.id);
    throw new Error(`${loaded.manifest.metadata.id} failed official conformance: ${failures.join(", ")}`);
  }
  const validation = createSyntheticMaturityEvidence({
    artifactDigest: loaded.artifact.digest,
    status: "passed",
    scenarioCount: evaluation.scenarios.length,
    passedScenarioCount,
    providerWrites: Number(evaluation.metrics.providerWrites ?? 0),
    evidenceRefs: evaluation.evidenceRefs,
    evaluatedAt
  });
  releases.push({
    appId: loaded.manifest.metadata.id,
    version: loaded.manifest.metadata.version,
    digest: loaded.artifact.digest,
    publisherId: "loopgraph",
    keyId: "loopgraph.official.catalog",
    status: existing?.status ?? "active",
    message: existing?.message,
    publishedAt: existing?.publishedAt ?? generatedAt,
    updatedAt: existing?.validation?.evidenceDigest === validation.evidenceDigest ? existing.updatedAt : generatedAt,
    validation
  });
}

releases.sort((left, right) => left.appId.localeCompare(right.appId) || left.version.localeCompare(right.version));
const unchanged = Boolean(current) && current!.releases.length === releases.length && releases.every((release, index) =>
  JSON.stringify(release) === JSON.stringify(current!.releases[index]));
const catalog = publishedCatalogSchema.parse({
  schemaVersion: PUBLISHED_CATALOG_SCHEMA_VERSION,
  catalogId: "loopgraph-official",
  releases,
  updatedAt: unchanged ? current!.updatedAt : generatedAt
});
const output = `${JSON.stringify(catalog, null, 2)}\n`;

if (check) {
  const stored = await readFile(catalogPath, "utf8").catch(() => "");
  if (stored !== output) {
    throw new Error("Official App maturity evidence is stale. Run: npm run generate:app-catalog");
  }
  console.log(`Official maturity evidence is current (${releases.length} Apps).`);
} else {
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, output, "utf8");
  console.log(`Generated official maturity evidence (${releases.length} Apps).`);
}

async function discoverPackRoots(root: string): Promise<string[]> {
  const departments = await readdir(root, { withFileTypes: true });
  const roots: string[] = [];
  for (const department of departments.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const departmentRoot = path.join(root, department.name);
    const apps = await readdir(departmentRoot, { withFileTypes: true });
    for (const app of apps.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const packRoot = path.join(departmentRoot, app.name);
      if (await readFile(path.join(packRoot, "loopgraph.pack.yaml"), "utf8").catch(() => undefined)) roots.push(packRoot);
    }
  }
  return roots;
}
