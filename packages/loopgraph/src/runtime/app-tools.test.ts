import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callLoopgraphAppTool, LOOPGRAPH_APP_TOOL_NAMES } from "./app-tools";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("shared Loopgraph App tools", () => {
  it("exposes the required marketplace and lifecycle surface", () => {
    expect(LOOPGRAPH_APP_TOOL_NAMES).toEqual([
      "loopgraph_marketplace_search",
      "loopgraph_app_get",
      "loopgraph_app_install_plan",
      "loopgraph_app_install_apply",
      "loopgraph_app_install_status",
      "loopgraph_app_test",
      "loopgraph_app_historical_replay",
      "loopgraph_app_evaluation_label",
      "loopgraph_app_promotion_recommendation",
      "loopgraph_app_activate",
      "loopgraph_app_pause",
      "loopgraph_app_resume"
    ]);
  });

  it("discovers official apps and returns an immutable app detail contract", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-tools-"));
    temporaryDirectories.push(projectRoot);

    const search = await callLoopgraphAppTool("loopgraph_marketplace_search", {
      projectRoot,
      query: "qualify inbound leads"
    }) as { count: number; results: Array<{ app: { id: string } }> };
    expect(search.count).toBeGreaterThan(0);
    expect(search.results[0]?.app.id).toBe("loopgraph.sales.qualify-route-inbound-leads");

    const detail = await callLoopgraphAppTool("loopgraph_app_get", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads"
    }) as {
      selectedVersion: { version: string; digest: string };
      provenance: { verified: boolean };
      manifest: { metadata: { id: string } };
      loops: unknown[];
      skills: unknown[];
      setupQuestions: unknown[];
      evaluationSummary: { scenarios: number };
      graphPreview: { nodes: Array<{ type: string }> };
    };
    expect(detail.manifest.metadata.id).toBe("loopgraph.sales.qualify-route-inbound-leads");
    expect(detail.selectedVersion.version).toBe("1.0.0");
    expect(detail.selectedVersion.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(detail.provenance.verified).toBe(true);
    expect(detail.loops).toHaveLength(6);
    expect(detail.skills).toHaveLength(4);
    expect(detail.setupQuestions).toHaveLength(10);
    expect(detail.evaluationSummary.scenarios).toBe(14);
    expect(detail.graphPreview.nodes.some((node) => node.type === "app")).toBe(true);
  });

  it("keeps a clean local workspace empty until an exact plan is installed", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-tools-"));
    temporaryDirectories.push(projectRoot);

    const status = await callLoopgraphAppTool("loopgraph_app_install_status", { projectRoot }) as {
      installations: unknown[];
      readiness: unknown[];
      lock: unknown;
    };
    expect(status.installations).toEqual([]);
    expect(status.readiness).toEqual([]);
    expect(status.lock).toBeUndefined();

    const plan = await callLoopgraphAppTool("loopgraph_app_install_plan", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack",
      configuration: {},
      fieldMappingIds: []
    }) as {
      missingConfigurationKeys: string[];
      capabilityResolutions: Array<{ required: boolean; status: string }>;
    };
    expect(plan.missingConfigurationKeys.length).toBeGreaterThan(0);
    expect(plan.capabilityResolutions.some((resolution) => resolution.required && resolution.status === "missing")).toBe(true);

    const unchanged = await callLoopgraphAppTool("loopgraph_app_install_status", { projectRoot }) as { installations: unknown[] };
    expect(unchanged.installations).toEqual([]);
  });
});
