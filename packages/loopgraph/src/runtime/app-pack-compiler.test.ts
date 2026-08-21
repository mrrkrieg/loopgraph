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
});
