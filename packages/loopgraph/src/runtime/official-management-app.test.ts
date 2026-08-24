import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { appEvalSuiteSchema, appSetupDefinitionSchema, type WorkspaceAppInstallation } from "../core";
import { loadConnectorRecipes } from "./app-connector-service";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { runAppSyntheticConformance } from "./app-quality-engine";

const packRoot = path.resolve(process.cwd(), "packs/official/management/run-company-operating-system");

describe("official Run the Company Operating System app", () => {
  it("compiles six management loops and exact supporting-route boundaries", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const compiled = await compileLoopPack(loaded);

    expect(compiled.appId).toBe("loopgraph.management.run-company-operating-system");
    expect(compiled.loopSpecs.map((loop) => loop.metadata.id)).toEqual([
      "management-operating-review",
      "management-company-anomaly-review",
      "management-loop-health-review",
      "management-decision-memo",
      "management-resource-allocation",
      "management-system-improvement"
    ]);
    expect(compiled.skills).toHaveLength(4);
    expect(compiled.routingCards).toHaveLength(6);
    expect(compiled.graph.nodes.filter((node) => node.type === "loop")).toHaveLength(6);
    expect(compiled.graph.nodes.filter((node) => node.type === "company_object")).toHaveLength(8);
    expect(compiled.graph.edges.filter((edge) => edge.type === "supports")).toHaveLength(3);
    expect(compiled.routingCards.find((card) => card.loopId === "management-company-anomaly-review")?.permittedSupportingLoopIds).toEqual([
      "management-decision-memo",
      "management-resource-allocation"
    ]);
    expect(compiled.routingCards.find((card) => card.loopId === "management-loop-health-review")?.permittedSupportingLoopIds).toEqual(["management-system-improvement"]);
    expect(compiled.loopSpecs.every((loop) => loop.routing?.activationMode === "shadow")).toBe(true);
  });

  it("includes two bounded stack recipes, guided setup, and the complete quality contract", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const connectors = await loadConnectorRecipes(loaded);
    const setup = appSetupDefinitionSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.setup[0]), "utf8")));
    const suite = appEvalSuiteSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.evals[0]), "utf8")));

    expect(loaded.manifest.presets.map((preset) => preset.id)).toEqual(["loopgraph-snowflake-slack", "loopgraph-bigquery-teams"]);
    expect(connectors).toHaveLength(2);
    expect(connectors.every((recipe) => recipe.supportsBoundedSamples)).toBe(true);
    expect(setup.questions.length).toBeGreaterThanOrEqual(10);
    expect(suite.scenarios).toHaveLength(13);
  });

  it("passes decision-boundary, abstention, approval, retry, and rollback cases without provider writes", async () => {
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
      actor: "official-management-pack-test",
      now: new Date("2026-08-10T18:00:00.000Z")
    });
    const failed = evaluation.scenarios.filter((scenario) => scenario.status === "failed");

    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(evaluation).toMatchObject({ status: "passed", writeBlocked: true, metrics: { failed: 0, providerWrites: 0 } });
    expect(evaluation.scenarios).toHaveLength(13);
  });
});
