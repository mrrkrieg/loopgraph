import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import {
  appEvalSuiteSchema,
  appSetupDefinitionSchema,
  type WorkspaceAppInstallation
} from "../core";
import { loadConnectorRecipes } from "./app-connector-service";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { runAppSyntheticConformance } from "./app-quality-engine";

const packRoot = path.resolve(
  process.cwd(),
  "packs/official/product/turn-feedback-into-product-problems"
);

describe("official Turn Customer Feedback Into Validated Product Problems app", () => {
  it("compiles the complete five-loop Product topology", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, {
      loopgraphVersion: "0.2.0",
      hermesVersion: "1.0.0"
    });
    const compiled = await compileLoopPack(loaded);
    const connectors = await loadConnectorRecipes(loaded);

    expect(compiled.appId).toBe("loopgraph.product.turn-feedback-into-product-problems");
    expect(compiled.loopSpecs.map((loop) => loop.metadata.id)).toEqual([
      "product-feedback-clustering",
      "product-problem-validation",
      "product-bug-clustering",
      "product-roadmap-evidence",
      "product-release-learning"
    ]);
    expect(compiled.loopSpecs).toHaveLength(5);
    expect(compiled.skills).toHaveLength(4);
    expect(compiled.routingCards).toHaveLength(5);
    expect(connectors).toHaveLength(2);
    expect(compiled.graph.nodes.filter((node) => node.type === "app")).toHaveLength(1);
    expect(compiled.graph.nodes.filter((node) => node.type === "loop")).toHaveLength(5);
    expect(compiled.graph.nodes.filter((node) => node.type === "company_object")).toHaveLength(4);
    expect(compiled.graph.edges.filter((edge) => edge.type === "evidence_in")).toHaveLength(4);
    expect(compiled.graph.edges.some((edge) => edge.type === "learning_return")).toBe(true);
    expect(compiled.loopSpecs.every((loop) => loop.routing?.activationMode === "shadow")).toBe(true);
  });

  it("provides two stack recipes, guided setup, and complete conformance coverage", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, {
      loopgraphVersion: "0.2.0",
      hermesVersion: "1.0.0"
    });
    const setup = appSetupDefinitionSchema.parse(
      YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.setup[0]), "utf8"))
    );
    const suite = appEvalSuiteSchema.parse(
      YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.evals[0]), "utf8"))
    );
    const connectors = await loadConnectorRecipes(loaded);

    expect(loaded.manifest.presets.map((preset) => preset.id)).toEqual([
      "intercom-posthog-linear",
      "zendesk-amplitude-jira"
    ]);
    expect(connectors.map((recipe) => recipe.id)).toEqual([
      "intercom-posthog-linear",
      "zendesk-amplitude-jira"
    ]);
    expect(setup.questions.length).toBeGreaterThanOrEqual(8);
    expect(suite.scenarios).toHaveLength(13);
  });

  it("passes every routing, safety, replay, and upgrade scenario without provider writes", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, {
      loopgraphVersion: "0.2.0",
      hermesVersion: "1.0.0"
    });
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
      actor: "official-product-pack-test",
      now: new Date("2026-08-09T12:00:00.000Z")
    });
    const failedScenarios = evaluation.scenarios.filter((scenario) => scenario.status === "failed");

    expect(failedScenarios, JSON.stringify(failedScenarios, null, 2)).toEqual([]);
    expect(evaluation).toMatchObject({
      status: "passed",
      writeBlocked: true,
      metrics: { failed: 0, providerWrites: 0 }
    });
    expect(evaluation.scenarios).toHaveLength(13);
  });
});
