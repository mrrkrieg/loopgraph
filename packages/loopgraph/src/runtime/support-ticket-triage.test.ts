import { describe, expect, it } from "vitest";
import path from "node:path";
import { repoRoot } from "../test-repo-root";
import { loadLoopSpecFromPath } from "./loader";
import { simulateLoop } from "./simulator";
import { FileStorageAdapter } from "../sdk/storage";


describe("support ticket triage simulator", () => {
  it("validates hero template", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/support-ticket-triage"));
    expect(loaded.ok).toBe(true);
  });

  it("angry enterprise customer creates P1 case", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/support-ticket-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/support-ticket-triage/angry-enterprise-customer.json"),
      storage
    });
    expect(result.escalationCase?.severity).toBe("P1");
    expect(result.trace.status).toBe("WAITING_FOR_REVIEW");
  });

  it("low-risk how-to completes without escalation case", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/support-ticket-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/support-ticket-triage/low-risk-how-to.json"),
      storage
    });
    expect(result.escalationCase).toBeUndefined();
  });
});

describe("management review simulator", () => {
  it("simulates weekly open-cases fixture", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/management-review"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/management-review/open-cases-weekly.json"),
      storage
    });
    expect(result.trace.loopId).toBe("management-review");
    expect(result.trace.status).toBe("COMPLETED");
  });
});
