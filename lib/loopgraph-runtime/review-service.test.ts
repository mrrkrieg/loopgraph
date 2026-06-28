import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadLoopSpecFromPath } from "./loader";
import { simulateLoop } from "./simulator";
import { applyReviewDecision, ReviewServiceError } from "./review-service";
import { FileStorageAdapter } from "../loopgraph-sdk/storage";
import { contentHash } from "../loopgraph-core/hash";

const repoRoot = path.resolve(__dirname, "../..");

describe("review-service", () => {
  it("rejects unknown fingerprints", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/github-issue-triage/security-issue.json"),
      storage
    });

    await expect(
      applyReviewDecision(storage, {
        runId: result.trace.id,
        status: "approved",
        approvedFingerprints: ["bad_fingerprint"]
      })
    ).rejects.toThrow(ReviewServiceError);
  });

  it("approves selected fingerprints and completes run", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/github-issue-triage/security-issue.json"),
      storage
    });

    const fingerprints = result.trace.preparedActions
      .filter((action) => action.requiresApproval)
      .map((action) => action.fingerprint);

    const decision = await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: fingerprints
    });

    expect(decision.trace.status).toBe("COMPLETED");
    expect(decision.trace.humanReviews.at(-1)?.approvedFingerprints).toEqual(fingerprints);
  });

  it("rejects commit when payload fingerprint no longer matches", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/github-issue-triage/security-issue.json"),
      storage
    });

    const target = result.trace.preparedActions.find((action) => action.requiresApproval);
    if (!target) throw new Error("expected prepared action");

    const originalFingerprint = target.fingerprint;
    target.payload = { ...target.payload, tampered: true };
    target.fingerprint = contentHash(target.payload);
    await storage.saveRun(result.trace);

    await expect(
      applyReviewDecision(storage, {
        runId: result.trace.id,
        status: "approved",
        approvedFingerprints: [originalFingerprint]
      })
    ).rejects.toThrow(ReviewServiceError);
  });

  it("approves internal actions while customer-facing actions remain pending", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"),
      storage
    });

    const internal = result.trace.preparedActions.find((action) => !action.customerFacing && action.requiresApproval);
    const customer = result.trace.preparedActions.find((action) => action.customerFacing && action.requiresApproval);
    expect(internal).toBeDefined();
    expect(customer).toBeDefined();

    const decision = await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [internal!.fingerprint]
    });

    expect(decision.trace.status).toBe("WAITING_FOR_REVIEW");
    expect(decision.review.approvedFingerprints).toEqual([internal!.fingerprint]);
  });

  it("records improvement signal when review is rejected", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/github-issue-triage/security-issue.json"),
      storage
    });

    const decision = await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "rejected",
      comment: "Security response needs more evidence"
    });

    expect(decision.trace.status).toBe("REJECTED");
    expect(
      decision.trace.outputs.some(
        (output) => output.type === "improvement_signal" && output.id.includes("review_")
      )
    ).toBe(true);
  });
});
