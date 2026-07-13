import { describe, expect, it } from "vitest";
import path from "node:path";
import { repoRoot } from "../test-repo-root";
import { loadLoopSpecFromPath } from "../runtime/loader";
import { simulateLoop } from "../runtime/simulator";
import { FileStorageAdapter } from "../sdk/storage";
import { consumeEscalationCase } from "../runtime/management-consumer";


describe("strategic account escalation simulator", () => {
  it("validates hero template", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    expect(loaded.ok).toBe(true);
  });

  it("enterprise outage creates P1 case", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"),
      storage
    });
    expect(result.escalationCase?.severity).toBe("P1");
    expect(result.trace.status).toBe("WAITING_FOR_REVIEW");
    const plan = consumeEscalationCase(result.escalationCase!);
    expect(plan.crossFunctionalDependencies.length).toBeGreaterThan(0);
  });

  it("low risk does not escalate cross-functionally", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/low-risk-product-question.json"),
      storage
    });
    expect(result.escalationCase).toBeUndefined();
  });
});
