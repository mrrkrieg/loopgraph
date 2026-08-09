import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  createLoopPackArchive,
  extractLoopPackArchive,
  loadLoopPackDirectory,
  readLoopPackArchive,
  satisfiesVersionRange,
  validateLoopPackDirectory
} from "./app-pack-loader";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixturePack(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-pack-"));
  temporaryDirectories.push(root);
  for (const directory of ["loops", "skills", "connectors", "presets", "setup", "policies", "fixtures", "evals", "dashboards", "assets"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  const manifest = {
    schemaVersion: "loopgraph-pack/v1alpha1",
    kind: "LoopPack",
    metadata: {
      id: "loopgraph.sales.test-inbound",
      name: "Test Inbound",
      version: "1.2.3",
      summary: "Safely test inbound qualification.",
      description: "A complete fixture pack used to verify content-bound application loading.",
      department: "sales",
      publisher: { id: "loopgraph", name: "Loopgraph", verified: true },
      license: "MIT",
      visibility: "official",
      tags: ["sales"]
    },
    compatibility: { loopgraph: ">=0.2.0 <1.0.0", hermes: ">=1.0.0", platforms: ["darwin", "linux", "win32"] },
    dependencies: [],
    modules: [],
    presets: [{ id: "test-stack", name: "Test stack", description: "A test provider stack.", path: "presets/test-stack.yaml", providerFamily: "test" }],
    permissions: [{ capability: "crm.lead.read", authority: "read", mode: "required", risk: "low", purpose: "Read leads.", customerFacing: false, defaultPolicy: "allowed", dataClasses: [] }],
    requiredCapabilities: ["crm.lead.read"],
    optionalCapabilities: [],
    entrypoints: {
      loops: ["loops/lead-intake.yaml"],
      skills: ["skills/icp.yaml"],
      connectors: ["connectors/test.yaml"],
      setup: ["setup/questions.yaml"],
      policies: ["policies/default.yaml"],
      fixtures: ["fixtures/high-fit.json"],
      evals: ["evals/conformance.yaml"],
      dashboards: [],
      assets: []
    },
    ownership: { defaultOwnerRole: "sales_operations", reviewRoles: ["sales_manager"] },
    defaultRolloutMode: "shadow"
  };
  await writeFile(path.join(root, "loopgraph.pack.yaml"), YAML.stringify(manifest));
  await writeFile(path.join(root, "loops/lead-intake.yaml"), "apiVersion: loopgraph/v1alpha1\nkind: Loop\n");
  await writeFile(path.join(root, "skills/icp.yaml"), "id: icp-evaluation\n");
  await writeFile(path.join(root, "connectors/test.yaml"), "id: test-crm\n");
  await writeFile(path.join(root, "presets/test-stack.yaml"), "id: test-stack\n");
  await writeFile(path.join(root, "setup/questions.yaml"), "questions: []\n");
  await writeFile(path.join(root, "policies/default.yaml"), "writes: forbidden\n");
  await writeFile(path.join(root, "fixtures/high-fit.json"), JSON.stringify({ fit: "high" }));
  await writeFile(path.join(root, "evals/conformance.yaml"), "scenarios: [high-fit]\n");
  return root;
}

describe("LoopPack loader", () => {
  it("validates, enumerates, and content-addresses a directory", async () => {
    const root = await createFixturePack();
    const loaded = await loadLoopPackDirectory(root, { loopgraphVersion: "0.2.0", hermesVersion: "1.4.0" });
    expect(loaded.manifest.metadata.id).toBe("loopgraph.sales.test-inbound");
    expect(loaded.artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(loaded.artifact.files.map((file) => file.path)).toContain("loops/lead-intake.yaml");
  });

  it("changes the artifact digest when file content changes", async () => {
    const root = await createFixturePack();
    const before = await loadLoopPackDirectory(root);
    await writeFile(path.join(root, "fixtures/high-fit.json"), JSON.stringify({ fit: "very-high" }));
    const after = await loadLoopPackDirectory(root);
    expect(after.artifact.digest).not.toBe(before.artifact.digest);
  });

  it("rejects missing declared files and high-confidence secrets", async () => {
    const root = await createFixturePack();
    await writeFile(path.join(root, "credentials.json"), JSON.stringify({ access_token: "abcdefghijklmnopqrstuvwxyz1234567890" }));
    const report = await validateLoopPackDirectory(root);
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.message).toMatch(/credential|secret|forbidden/i);
  });

  it("rejects incompatible runtime versions", async () => {
    const root = await createFixturePack();
    const report = await validateLoopPackDirectory(root, { loopgraphVersion: "1.5.0", hermesVersion: "1.0.0" });
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.message).toMatch(/does not satisfy/i);
  });

  it("creates, verifies, and safely extracts a deterministic archive", async () => {
    const root = await createFixturePack();
    const archivePath = path.join(root, "..", `${path.basename(root)}.loopgraph-pack`);
    const extracted = await mkdtemp(path.join(os.tmpdir(), "loopgraph-extracted-"));
    temporaryDirectories.push(extracted, archivePath);
    const artifact = await createLoopPackArchive(root, archivePath);
    const archive = await readLoopPackArchive(archivePath);
    expect(archive.artifact.digest).toBe(artifact.digest);
    const extractedArtifact = await extractLoopPackArchive(archivePath, extracted);
    expect(extractedArtifact.digest).toBe(artifact.digest);
    expect(await readFile(path.join(extracted, "skills/icp.yaml"), "utf8")).toContain("icp-evaluation");
  });

  it("supports exact, bounded, caret, tilde, and OR semantic-version ranges", () => {
    expect(satisfiesVersionRange("1.4.2", "1.4.2")).toBe(true);
    expect(satisfiesVersionRange("1.4.2", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesVersionRange("1.4.2", "^1.2.0")).toBe(true);
    expect(satisfiesVersionRange("1.4.2", "~1.4.0")).toBe(true);
    expect(satisfiesVersionRange("2.0.0", "^1.2.0 || >=2.0.0 <3.0.0")).toBe(true);
    expect(satisfiesVersionRange("2.0.0", "<2.0.0")).toBe(false);
  });
});

