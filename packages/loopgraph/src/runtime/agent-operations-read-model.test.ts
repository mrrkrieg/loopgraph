import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentOperationsReadModel } from "./agent-operations-read-model";

describe("agent operations read model", () => {
  it("uses a default read limit accepted by the routing operations contract", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-agent-operations-"));

    const model = await loadAgentOperationsReadModel({ projectRoot });

    expect(model.schemaVersion).toBe("agent-operations/v1alpha1");
    expect(model.activity).toEqual([]);
    expect(model.summary.incomingEvents).toBe(0);
  });
});
