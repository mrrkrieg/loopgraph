import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { businessProblemSchema } from "loopgraph/core";
import {
  FileRoutingStore,
  initLoopgraphWorkspace
} from "loopgraph/runtime";
import { GET, POST } from "./route";

describe("loop opportunities API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scans the active project and lists explainable opportunities", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-opportunity-api-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "opportunity-api" }));
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    await initLoopgraphWorkspace({ projectRoot });
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    await store.saveBusinessProblem(businessProblemSchema.parse({
      id: "problem_api_feedback",
      workspaceId: "workspace_api",
      companyId: "company_api",
      problemType: "product_feedback_unowned",
      subject: { type: "product_feedback", id: "feedback_api" },
      summary: "Product feedback has no recurring review loop",
      severity: "critical",
      status: "unhandled",
      correlationId: "correlation_api",
      dedupeKey: "dedupe_api",
      evidenceEventIds: [],
      supportingLoopIds: [],
      routeCommitIds: [],
      outcomeRefs: [],
      openedAt: "2026-07-29T18:00:00.000Z",
      updatedAt: "2026-07-29T18:00:00.000Z"
    }));

    const scanResponse = await POST(new Request("https://loopgraph.local/api/opportunities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        autoStartDesign: false,
        projectRoot: "/tmp/ignored"
      })
    }));
    const scan = await scanResponse.json();
    expect(scanResponse.status).toBe(202);
    expect(scan.opportunities).toEqual([
      expect.objectContaining({
        department: "product",
        kind: "create_loop",
        score: expect.objectContaining({
          coverageGap: 25
        })
      })
    ]);

    const listResponse = await GET(new Request(
      "https://loopgraph.local/api/opportunities?department=product&minimumScore=45"
    ));
    await expect(listResponse.json()).resolves.toEqual({
      opportunities: [
        expect.objectContaining({ id: scan.opportunities[0].id })
      ]
    });
  });
});
