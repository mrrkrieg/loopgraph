import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileLoopControllerStore } from "./loop-controller-store";
import { callLoopgraphOutcomeTool } from "./outcome-tools";
import { initLoopgraphWorkspace } from "./workspace";

describe("outcome tools", () => {
  it("enqueues an outcome-window controller trigger when evidence arrives", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-outcomes-tool-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "loopgraph-outcomes-tool-test"
    }));
    await initLoopgraphWorkspace({ projectRoot });

    const result = await callLoopgraphOutcomeTool("loopgraph_metric_samples_ingest", {
      companyId: "company_outcomes",
      departmentId: "product",
      loopId: "activation_loop",
      metricDefinitionId: "metric_activation",
      metricKey: "activation_rate",
      value: 61,
      unit: "percent",
      window: {
        start: "2026-07-28T00:00:00.000Z",
        end: "2026-07-29T00:00:00.000Z"
      },
      observedAt: "2026-07-29T00:05:00.000Z",
      source: {
        type: "integration",
        sourceRef: "product-analytics:activation-rate"
      },
      quality: {
        status: "verified"
      },
      evidenceRefs: ["product-analytics:activation-rate:2026-07-28"]
    }, {
      projectRoot,
      now: new Date("2026-07-29T00:06:00.000Z")
    });
    if (!("controllerTrigger" in result)) {
      throw new Error("Expected metric ingestion to return a controller trigger");
    }

    expect(result.controllerTrigger).toMatchObject({
      enqueued: true,
      duplicate: false,
      triggerRecordId: expect.stringMatching(/^controller_trigger_/)
    });

    const triggers = await new FileLoopControllerStore(path.join(projectRoot, ".loopgraph"))
      .listTriggers();
    expect(triggers).toMatchObject([{
      id: result.controllerTrigger.triggerRecordId,
      status: "pending",
      trigger: {
        type: "outcome_window",
        sourceRef: expect.stringMatching(/^metric-sample:/)
      }
    }]);
  });
});
