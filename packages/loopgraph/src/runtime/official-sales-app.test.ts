import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import {
  appEvalSuiteSchema,
  appSetupDefinitionSchema,
  connectorRecipeSchema,
  validateLoopSpec
} from "../core";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";

const packRoot = path.resolve(process.cwd(), "packs/official/sales/qualify-route-inbound-leads");

describe("official Qualify and Route Inbound Leads app", () => {
  it("loads as an immutable pack and compiles six governed loops", async () => {
    const loaded = await loadLoopPackDirectory(packRoot, {
      loopgraphVersion: "0.2.0",
      hermesVersion: "1.0.0"
    });
    const compiled = await compileLoopPack(loaded);
    expect(compiled.appId).toBe("loopgraph.sales.qualify-route-inbound-leads");
    expect(compiled.loopSpecs).toHaveLength(6);
    expect(compiled.skills).toHaveLength(4);
    expect(compiled.routingCards).toHaveLength(6);
    expect(compiled.loopSpecs.every((spec) => spec.routing?.activationMode === "shadow")).toBe(true);
    expect(compiled.loopSpecs.every((spec) => validateLoopSpec(spec))).toBeTruthy();
    expect(compiled.graph.nodes.filter((node) => node.type === "app")).toHaveLength(1);
    expect(compiled.graph.nodes.filter((node) => node.type === "loop")).toHaveLength(6);
  });

  it("validates both provider recipes against the shared logical-capability contract", async () => {
    for (const file of ["hubspot-gmail-slack.yaml", "salesforce-outlook-teams.yaml"]) {
      const raw = YAML.parse(await readFile(path.join(packRoot, "connectors", file), "utf8"));
      const recipe = connectorRecipeSchema.parse(raw);
      expect(recipe.capabilities.map((capability) => capability.logicalCapability)).toContain("crm.lead.read");
      expect(recipe.capabilities.map((capability) => capability.logicalCapability)).toContain("mail.message.draft");
    }
  });

  it("has guided setup and the complete safety/evidence conformance suite", async () => {
    const setup = appSetupDefinitionSchema.parse(YAML.parse(await readFile(path.join(packRoot, "setup/questions.yaml"), "utf8")));
    const suite = appEvalSuiteSchema.parse(YAML.parse(await readFile(path.join(packRoot, "evals/conformance.yaml"), "utf8")));
    expect(setup.questions.length).toBeGreaterThanOrEqual(8);
    expect(suite.scenarios.map((scenario) => scenario.id)).toEqual(expect.arrayContaining([
      "high-fit",
      "low-fit",
      "duplicate-lead",
      "ambiguous-account",
      "connector-unavailable",
      "approval-required",
      "retry-replay",
      "upgrade-rollback"
    ]));
  });
});

