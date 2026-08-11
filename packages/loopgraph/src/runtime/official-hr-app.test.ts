import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { appEvalSuiteSchema, appSetupDefinitionSchema, type WorkspaceAppInstallation } from "../core";
import { loadConnectorRecipes } from "./app-connector-service";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { runAppSyntheticConformance } from "./app-quality-engine";

const packRoot = path.resolve(process.cwd(), "packs/official/hr-talent/operate-people-workflows");

describe("official Operate Fair and Accountable People Workflows app", () => {
  it("compiles five governed HR loops and a minimum-necessary evidence topology", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const compiled = await compileLoopPack(loaded);

    expect(compiled.appId).toBe("loopgraph.hr-talent.operate-people-workflows");
    expect(compiled.loopSpecs.map((loop) => loop.metadata.id)).toEqual([
      "hr-candidate-pipeline",
      "hr-onboarding-progress",
      "hr-manager-coaching",
      "hr-retention-review",
      "hr-performance-review-preparation"
    ]);
    expect(compiled.skills).toHaveLength(4);
    expect(compiled.routingCards).toHaveLength(5);
    expect(compiled.graph.nodes.filter((node) => node.type === "loop")).toHaveLength(5);
    expect(compiled.graph.nodes.filter((node) => node.type === "company_object")).toHaveLength(6);
    expect(compiled.graph.edges.filter((edge) => edge.type === "supports")).toHaveLength(0);
    expect(compiled.routingCards.every((card) => card.fanoutPolicy.mode === "none")).toBe(true);
    expect(compiled.loopSpecs.every((loop) => loop.routing?.activationMode === "shadow")).toBe(true);
    expect(loaded.manifest.modules.find((module) => module.id === "retention-review")?.defaultEnabled).toBe(false);
  });

  it("includes two bounded stack recipes, guided setup, and the complete quality contract", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const connectors = await loadConnectorRecipes(loaded);
    const setup = appSetupDefinitionSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.setup[0]), "utf8")));
    const suite = appEvalSuiteSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.evals[0]), "utf8")));

    expect(loaded.manifest.presets.map((preset) => preset.id)).toEqual([
      "workday-greenhouse-slack",
      "rippling-ashby-teams"
    ]);
    expect(connectors).toHaveLength(2);
    expect(connectors.every((recipe) => recipe.supportsBoundedSamples)).toBe(true);
    expect(setup.questions.length).toBeGreaterThanOrEqual(10);
    expect(suite.scenarios).toHaveLength(13);
  });

  it("passes privacy, abstention, approval, retry, and rollback cases without provider writes", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const compiled = await compileLoopPack(loaded);
    const installation = {
      id: `install.${loaded.manifest.metadata.id}`,
      appId: loaded.manifest.metadata.id,
      version: loaded.manifest.metadata.version,
      artifactDigest: loaded.artifact.digest,
      permissions: loaded.manifest.permissions.map((permission) => ({
        capability: permission.capability,
        authority: permission.authority,
        decision: permission.defaultPolicy === "allowed" ? "allow" : permission.defaultPolicy
      }))
    } as WorkspaceAppInstallation;
    const evaluation = await runAppSyntheticConformance({
      loaded,
      compiled,
      installation,
      actor: "official-hr-pack-test",
      now: new Date("2026-08-10T16:00:00.000Z")
    });
    const failed = evaluation.scenarios.filter((scenario) => scenario.status === "failed");

    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(evaluation).toMatchObject({ status: "passed", writeBlocked: true, metrics: { failed: 0, providerWrites: 0 } });
    expect(evaluation.scenarios).toHaveLength(13);
  });
});
