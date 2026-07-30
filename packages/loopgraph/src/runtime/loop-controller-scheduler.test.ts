import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileLoopControllerStore } from "./loop-controller-store";
import { runLoopControllerScheduler } from "./loop-controller-scheduler";
import { enqueueLoopControllerTrigger } from "./loop-controller-triggers";
import { initLoopgraphWorkspace } from "./workspace";

describe("loop controller trigger scheduler", () => {
  it("enqueues idempotently and turns one durable trigger into one controller run", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    const first = await enqueueLoopControllerTrigger({
      projectRoot,
      type: "schedule",
      triggerId: "schedule_1",
      sourceRef: "test:schedule"
    }, { now: new Date("2026-07-29T17:00:00.000Z") });
    const duplicate = await enqueueLoopControllerTrigger({
      projectRoot,
      type: "schedule",
      triggerId: "schedule_1",
      sourceRef: "test:schedule"
    }, { now: new Date("2026-07-29T17:00:01.000Z") });

    const result = await runLoopControllerScheduler({
      projectRoot,
      now: new Date("2026-07-29T17:01:00.000Z")
    });
    const store = new FileLoopControllerStore(path.join(projectRoot, ".loopgraph"));
    const trigger = await store.getTrigger(first.record.id);

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({
      duplicate: true,
      record: { id: first.record.id }
    });
    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      items: [{
        triggerRecordId: first.record.id,
        triggerId: "schedule_1",
        status: "completed",
        controllerRunId: expect.stringMatching(/^controller_run_/)
      }]
    });
    expect(trigger).toMatchObject({
      status: "completed",
      attempts: 1,
      controllerRunId: result.items[0]?.controllerRunId
    });
  });

  it("allows only one concurrent scheduler to claim a pending trigger", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    await enqueueLoopControllerTrigger({
      projectRoot,
      type: "management_cycle",
      triggerId: "management_1",
      sourceRef: "test:management"
    });

    const [left, right] = await Promise.all([
      runLoopControllerScheduler({ projectRoot }),
      runLoopControllerScheduler({ projectRoot })
    ]);

    expect(left.claimed + right.claimed).toBe(1);
    expect(left.completed + right.completed).toBe(1);
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-controller-scheduler-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loop-controller-scheduler-test-project"
  }));
  return projectRoot;
}
