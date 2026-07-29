import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { businessProblemSchema } from "../core";
import { FileRoutingStore } from "./routing-store";
import { initLoopgraphWorkspace } from "./workspace";
import {
  callLoopgraphOpportunityTool,
  loopgraphOpportunityToolDefinitions
} from "./loop-opportunity-tools";

describe("loop opportunity tools", () => {
  it("exposes scan/read/dismiss/change-set tools with safe annotations", () => {
    expect(loopgraphOpportunityToolDefinitions.map((tool) => tool.name)).toEqual([
      "loopgraph_opportunities_scan",
      "loopgraph_opportunities_get",
      "loopgraph_opportunity_dismiss",
      "loopgraph_graph_changes_get"
    ]);
    expect(loopgraphOpportunityToolDefinitions.find((tool) =>
      tool.name === "loopgraph_opportunity_dismiss"
    )).toMatchObject({
      readOnly: false,
      idempotent: false
    });
  });

  it("scans stored evidence and returns the associated graph change through tool calls", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-opportunity-tools-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "opportunity-tools" }));
    await initLoopgraphWorkspace({ projectRoot });
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    await store.saveBusinessProblem(businessProblemSchema.parse({
      id: "problem_product_feedback",
      workspaceId: "workspace_tools",
      companyId: "company_tools",
      problemType: "product_feedback_unowned",
      subject: { type: "product_feedback", id: "feedback_1" },
      summary: "Product feedback repeatedly has no owner",
      severity: "critical",
      status: "unhandled",
      correlationId: "correlation_tools",
      dedupeKey: "dedupe_tools",
      evidenceEventIds: ["event_tools"],
      supportingLoopIds: [],
      routeCommitIds: [],
      outcomeRefs: [],
      openedAt: "2026-07-29T17:00:00.000Z",
      updatedAt: "2026-07-29T17:00:00.000Z"
    }));

    const scanned = await callLoopgraphOpportunityTool("loopgraph_opportunities_scan", {
      projectRoot,
      autoStartDesign: false,
      qualifyThreshold: 45,
      autoDesignThreshold: 65
    }, {
      now: new Date("2026-07-29T17:01:00.000Z")
    });
    const opportunityId = scanned.opportunities[0]?.id;
    const read = await callLoopgraphOpportunityTool("loopgraph_opportunities_get", {
      projectRoot,
      opportunityId
    });
    const changes = await callLoopgraphOpportunityTool("loopgraph_graph_changes_get", {
      projectRoot,
      opportunityId
    });

    expect(read.opportunity).toMatchObject({
      id: opportunityId,
      kind: "create_loop",
      department: "product"
    });
    expect(changes.changeSets).toEqual([
      expect.objectContaining({
        opportunityId,
        changes: [expect.objectContaining({ operation: "add" })]
      })
    ]);
  });
});
