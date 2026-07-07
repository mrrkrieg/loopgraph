import { describe, expect, it } from "vitest";
import path from "node:path";
import { repoRoot } from "../test-repo-root";
import { loadLoopSpecFromPath } from "./loader";
import { simulateLoop } from "./simulator";
import { FileStorageAdapter } from "../sdk/storage";
import { applyReviewDecision } from "./review-service";
import { loadImprovementsFromStorage } from "./improvement-loader";
import { generateAndPersistManagementRollup, loadLatestManagementRollup } from "./management-rollup";


describe("improvement loader", () => {
  it("loads improvement_signal outputs from persisted traces", async () => {
    const root = path.join(repoRoot, ".loopgraph-test-improvements");
    const storage = new FileStorageAdapter(root);
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");

    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/github-issue-triage/security-issue.json"),
      storage
    });

    await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "rejected",
      comment: "Needs more evidence before public response."
    });

    const improvements = await loadImprovementsFromStorage(storage, loaded.spec.metadata.id);
    expect(improvements.length).toBe(1);
    expect(improvements[0]?.failureMode).toBe("rejected");
    expect(improvements[0]?.sourceRunId).toBe(result.trace.id);
  });
});

describe("management rollup", () => {
  it("persists rollup plans for open cases", async () => {
    const root = path.join(repoRoot, ".loopgraph-test-rollup");
    const storage = new FileStorageAdapter(root);
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");

    await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"),
      storage
    });

    const rollup = await generateAndPersistManagementRollup(storage, root);
    expect(rollup.openCases).toBeGreaterThan(0);
    expect(rollup.plans.length).toBeGreaterThan(0);

    const latest = await loadLatestManagementRollup(root);
    expect(latest?.id).toBe(rollup.id);
  });
});

describe("governance path", () => {
  it("rejects review with fingerprint mismatch when payload changes after approval", async () => {
    const root = path.join(repoRoot, ".loopgraph-test-governance");
    const storage = new FileStorageAdapter(root);
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");

    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"),
      storage
    });

    const internal = result.trace.preparedActions.find((action) => !action.customerFacing);
    expect(internal).toBeTruthy();

    await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [internal!.fingerprint]
    });

    const trace = await storage.getRun(result.trace.id);
    expect(trace?.status).toBe("WAITING_FOR_REVIEW");

    const customer = trace?.preparedActions.find((action) => action.customerFacing);
    expect(customer).toBeTruthy();

    const completed = await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [customer!.fingerprint]
    });

    expect(completed.trace.status).toBe("COMPLETED");
  });
});
