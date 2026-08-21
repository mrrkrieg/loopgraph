import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LoopPack compiler installation assets", () => {
  it("compiles schedules, metrics, fixtures, evaluations, and dashboards into immutable owned assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-compiled-assets-"));
    temporaryDirectories.push(root);
    await cp(path.resolve(process.cwd(), "packs/official/sales/qualify-route-inbound-leads"), root, { recursive: true });
    const loopPath = path.join(root, "loops/lead-intake.yaml");
    const loop = YAML.parse(await readFile(loopPath, "utf8")) as Record<string, unknown>;
    loop.trigger = { type: "schedule", source: "loopgraph", event: "sales.daily_intake_review", schedule: "0 9 * * 1-5" };
    await writeFile(loopPath, YAML.stringify(loop), "utf8");

    const loaded = await loadLoopPackDirectory(root);
    const compiled = await compileLoopPack(loaded);
    const kinds = new Set(compiled.installationAssets.map((asset) => asset.kind));

    expect(kinds).toEqual(new Set(["schedule", "metric", "fixture", "evaluation", "dashboard"]));
    expect(compiled.loopSourcePaths["sales-inbound-lead-intake"]).toBe("loops/lead-intake.yaml");
    expect(compiled.skillSourcePaths["sales-account-research"]).toBe("skills/account-research.yaml");
    expect(compiled.installationAssets).toContainEqual(expect.objectContaining({
      id: "schedule.sales-inbound-lead-intake",
      kind: "schedule",
      dependencies: ["loop.sales-inbound-lead-intake"]
    }));
    expect(compiled.installationAssets.filter((asset) => asset.kind === "metric").length).toBeGreaterThan(5);
    expect(compiled.installationAssets.find((asset) => asset.kind === "fixture")).toMatchObject({
      sourcePath: expect.stringMatching(/^fixtures\//),
      digest: expect.stringMatching(/^sha256:/)
    });
    expect(compiled.installationAssets.find((asset) => asset.kind === "evaluation")?.dependencies.length).toBeGreaterThan(5);
    expect(compiled.installationAssets.find((asset) => asset.kind === "dashboard")?.dependencies.length).toBeGreaterThan(5);
  });

  it("compiles only the selected module composition and removes disabled topology", async () => {
    const loaded = await loadLoopPackDirectory(path.resolve(process.cwd(), "packs/official/hr-talent/operate-people-workflows"));
    const compiled = await compileLoopPack(loaded, {
      selectedModules: ["candidate-flow", "manager-support", "onboarding-progress", "performance-review"]
    });

    expect(compiled.loopSpecs.map((spec) => spec.metadata.id)).not.toContain("hr-retention-review");
    expect(compiled.skills.map((skill) => skill.id)).toContain("hr-fairness-and-boundary-review");
    expect(compiled.activeEntrypoints.skills).toContain("skills/fairness-and-boundary-review.yaml");
    expect(compiled.installationAssets.map((asset) => asset.id).join("\n")).not.toContain("hr-retention-review");
    expect(compiled.graph.nodes.map((node) => node.id)).not.toContain("loop.hr-retention-review");
    expect(compiled.graph.nodes.map((node) => node.id)).not.toContain("object.retention-review-case");
    expect(compiled.graph.edges.some((edge) => edge.source.includes("hr-retention-review") || edge.target.includes("hr-retention-review"))).toBe(false);
  });

  it("rejects a selected module when its dependency is absent", async () => {
    const loaded = await loadLoopPackDirectory(path.resolve(process.cwd(), "packs/official/sales/qualify-route-inbound-leads"));
    await expect(compileLoopPack(loaded, { selectedModules: ["governed-follow-up"] })).rejects.toThrow(/requires account-research/i);
  });

  it("rejects an empty composition when every loop belongs to a disabled module", async () => {
    const loaded = await loadLoopPackDirectory(path.resolve(process.cwd(), "packs/official/hr-talent/operate-people-workflows"));
    await expect(compileLoopPack(loaded, { selectedModules: [] })).rejects.toThrow(/at least one LoopSpec/i);
  });
});
