import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraphFromRegisteredSpecs } from "./graph";
import {
  createLocalDesignStudioSpec,
  getStudioAnswers,
  getRegisteredLoopSpecs,
  readWorkspaceRegistry,
  registerLoopSpec,
  unregisterLoopSpec
} from "./local-workspace";

describe("Loopgraph local workspace registry", () => {
  it("registers local LoopSpecs and exposes them to graph derivation", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-registry-"));
    const created = await createLocalDesignStudioSpec({
      projectRoot,
      templateId: "sales-follow_up",
      name: "Sales Follow-up Loop"
    });

    const registry = await readWorkspaceRegistry(projectRoot);
    expect(registry.registeredSpecs).toHaveLength(1);
    expect(registry.registeredSpecs[0].id).toBe(created.id);

    const entry = await registerLoopSpec(created.path, projectRoot);
    expect(entry.id).toBe(created.id);

    const registeredSpecs = await getRegisteredLoopSpecs(projectRoot);
    const graph = buildGraphFromRegisteredSpecs({ specs: registeredSpecs });

    expect(registeredSpecs).toHaveLength(1);
    expect(graph.sourceLabel).toBe("Local LoopSpec");
    expect(graph.nodes.some((node) => node.id === `loop:${created.id}`)).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "data_flow")).toBe(true);
  });

  it("stores design-studio question answers and can remove loops from the registry", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-registry-"));
    const created = await createLocalDesignStudioSpec({
      projectRoot,
      templateId: "marketing-campaign_learning",
      name: "Campaign Learning Loop",
      goal: "Improve campaign learning quality."
    });

    const [registeredSpec] = await getRegisteredLoopSpecs(projectRoot);
    const answers = getStudioAnswers(registeredSpec.spec);

    expect(answers.initial_goal_summary).toBe("Improve campaign learning quality.");
    expect(answers.proxy_metrics_to_distrust).toContain("Upstream engagement metrics");
    expect(registeredSpec.spec.studioExtension?.questionGroups).toBeDefined();

    await expect(unregisterLoopSpec(created.id, projectRoot)).resolves.toBe(true);
    await expect(unregisterLoopSpec(created.id, projectRoot)).resolves.toBe(false);

    const registry = await readWorkspaceRegistry(projectRoot);
    expect(registry.registeredSpecs).toHaveLength(0);
  });
});
