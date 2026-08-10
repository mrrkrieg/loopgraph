import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { appEvalSuiteSchema, appSetupDefinitionSchema, type WorkspaceAppInstallation } from "../core";
import { loadConnectorRecipes } from "./app-connector-service";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { runAppSyntheticConformance } from "./app-quality-engine";

const packRoot = path.resolve(process.cwd(), "packs/official/customer-success/catch-renewal-risk");

describe("official Catch Strategic Account and Renewal Risk app", () => {
  it("compiles five governed customer-success loops", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const compiled = await compileLoopPack(loaded);
    expect(compiled.appId).toBe("loopgraph.customer-success.catch-renewal-risk");
    expect(compiled.loopSpecs.map((loop) => loop.metadata.id)).toEqual([
      "cs-customer-health", "cs-renewal-risk", "cs-support-escalation", "cs-strategic-account-escalation", "cs-qbr-preparation"
    ]);
    expect(compiled.loopSpecs).toHaveLength(5);
    expect(compiled.skills).toHaveLength(4);
    expect(compiled.routingCards).toHaveLength(5);
    expect(await loadConnectorRecipes(loaded)).toHaveLength(2);
    expect(compiled.loopSpecs.every((loop) => loop.routing?.activationMode === "shadow")).toBe(true);
  });

  it("includes both stacks, guided setup, and complete conformance", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const setup = appSetupDefinitionSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.setup[0]), "utf8")));
    const suite = appEvalSuiteSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.evals[0]), "utf8")));
    expect(loaded.manifest.presets.map((preset) => preset.id)).toEqual(["hubspot-intercom-stripe-slack", "salesforce-zendesk-billing-teams"]);
    expect(setup.questions.length).toBeGreaterThanOrEqual(8);
    expect(suite.scenarios).toHaveLength(13);
  });

  it("passes every safety case without provider writes", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const compiled = await compileLoopPack(loaded);
    const installation = {
      id: `install.${loaded.manifest.metadata.id}`,
      appId: loaded.manifest.metadata.id,
      version: loaded.manifest.metadata.version,
      artifactDigest: loaded.artifact.digest,
      permissions: loaded.manifest.permissions.map((permission) => ({ capability: permission.capability, authority: permission.authority, decision: permission.defaultPolicy === "allowed" ? "allow" : permission.defaultPolicy }))
    } as WorkspaceAppInstallation;
    const evaluation = await runAppSyntheticConformance({ loaded, compiled, installation, actor: "official-customer-risk-test", now: new Date("2026-08-09T12:00:00.000Z") });
    const failed = evaluation.scenarios.filter((scenario) => scenario.status === "failed");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(evaluation).toMatchObject({ status: "passed", writeBlocked: true, metrics: { failed: 0, providerWrites: 0 } });
  });
});
