import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadLoopSpecFromPath } from "./loader";
import { simulateLoop } from "./simulator";
import { resolveCase } from "./case-service";
import { FileStorageAdapter } from "../loopgraph-sdk/storage";

const repoRoot = path.resolve(__dirname, "../..");

describe("case-service", () => {
  it("writes case outcome and improvement signal back to source trace", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-case-service-"));
    const storage = new FileStorageAdapter(storageRoot);
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"),
      storage
    });

    const caseId = result.escalationCase?.id;
    if (!caseId) throw new Error("expected escalation case");

    const resolved = await resolveCase(storage, caseId, {
      resolutionSummary: "Incident mitigated; customer updated before board meeting.",
      resolvedAt: new Date().toISOString(),
      businessResult: "Renewal retained"
    });

    expect(resolved.status).toBe("resolved");

    const trace = await storage.getRun(result.trace.id);
    expect(trace?.outputs.some((output) => output.type === "case_outcome")).toBe(true);
    expect(trace?.outputs.some((output) => output.type === "improvement_signal" && output.id.includes(caseId))).toBe(
      true
    );
  });
});
