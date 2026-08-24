import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { appEvalSuiteSchema, appSetupDefinitionSchema, type WorkspaceAppInstallation } from "../core";
import { loadConnectorRecipes } from "./app-connector-service";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { runAppSyntheticConformance } from "./app-quality-engine";

const packRoot = path.resolve(process.cwd(), "packs/official/operations-finance/manage-forecast-controls");

describe("official Explain Forecast Variance and Govern Financial Operations app", () => {
  it("compiles six governed Operations & Finance loops and their evidence topology", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const compiled = await compileLoopPack(loaded);

    expect(compiled.appId).toBe("loopgraph.ops-finance.manage-forecast-controls");
    expect(compiled.loopSpecs.map((loop) => loop.metadata.id)).toEqual([
      "ops-finance-forecast-variance",
      "ops-finance-approval-bottleneck",
      "ops-finance-vendor-review",
      "ops-finance-close-readiness",
      "ops-finance-cash-collection",
      "ops-finance-resource-allocation"
    ]);
    expect(compiled.skills).toHaveLength(4);
    expect(compiled.routingCards).toHaveLength(6);
    expect(compiled.graph.nodes.filter((node) => node.type === "loop")).toHaveLength(6);
    expect(compiled.graph.nodes.filter((node) => node.type === "company_object")).toHaveLength(8);
    expect(compiled.graph.edges.filter((edge) => edge.type === "supports")).toHaveLength(2);
    expect(compiled.routingCards.find((card) => card.loopId === "ops-finance-forecast-variance")?.permittedSupportingLoopIds).toEqual([
      "ops-finance-approval-bottleneck",
      "ops-finance-resource-allocation"
    ]);
    expect(compiled.loopSpecs.every((loop) => loop.routing?.activationMode === "shadow")).toBe(true);
  });

  it("includes two stack recipes, guided setup, and the complete quality contract", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const connectors = await loadConnectorRecipes(loaded);
    const setup = appSetupDefinitionSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.setup[0]), "utf8")));
    const suite = appEvalSuiteSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.evals[0]), "utf8")));

    expect(loaded.manifest.presets.map((preset) => preset.id)).toEqual([
      "quickbooks-stripe-snowflake-slack",
      "netsuite-salesforce-warehouse-teams"
    ]);
    expect(connectors).toHaveLength(2);
    expect(connectors.every((recipe) => recipe.supportsBoundedSamples)).toBe(true);
    expect(setup.questions.length).toBeGreaterThanOrEqual(10);
    expect(suite.scenarios).toHaveLength(13);
  });

  it("passes routing, abstention, approval, retry, and rollback cases without provider writes", async () => {
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
      actor: "official-ops-finance-pack-test",
      now: new Date("2026-08-10T12:00:00.000Z")
    });
    const failed = evaluation.scenarios.filter((scenario) => scenario.status === "failed");

    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(evaluation).toMatchObject({ status: "passed", writeBlocked: true, metrics: { failed: 0, providerWrites: 0 } });
    expect(evaluation.scenarios).toHaveLength(13);
  });
});
