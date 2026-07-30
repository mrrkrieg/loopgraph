import { describe, expect, it } from "vitest";
import path from "node:path";
import { repoRoot } from "../test-repo-root";
import { loadLoopSpecFromPath } from "./loader";
import { simulateLoop } from "./simulator";
import { applyReviewDecision, ReviewServiceError } from "./review-service";
import { FileStorageAdapter } from "../sdk/storage";
import { contentHash } from "../core/hash";


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
        approvedFingerprints: ["bad_fingerprint"],
        reviewerId: "reviewer_security",
        role: "approver"
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
      approvedFingerprints: fingerprints,
      reviewerId: "reviewer_security",
      role: "approver"
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
        approvedFingerprints: [originalFingerprint],
        reviewerId: "reviewer_security",
        role: "approver"
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
      approvedFingerprints: [internal!.fingerprint],
      reviewerId: "reviewer_internal",
      role: "approver"
    });

    expect(decision.trace.status).toBe("WAITING_FOR_REVIEW");
    expect(decision.review.approvedFingerprints).toEqual([internal!.fingerprint]);
  });

  it("rejects a combined internal and customer-facing approval decision", async () => {
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

    await expect(applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [internal!.fingerprint, customer!.fingerprint],
      reviewerId: "reviewer_combined",
      role: "approver"
    })).rejects.toThrow(/separate durable review decisions/);
  });

  it("enforces the recorded allowed roles instead of accepting a caller-selected role", async () => {
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

    await expect(applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: fingerprints,
      reviewerId: "reviewer_untrusted",
      role: "executor"
    })).rejects.toThrow(/not allowed by this run's approval policy/);
  });

  it("completes run when customer-facing approval follows a separate internal approval", async () => {
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

    await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [internal!.fingerprint],
      reviewerId: "reviewer_internal",
      role: "approver"
    });

    const decision = await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [customer!.fingerprint],
      reviewerId: "reviewer_customer",
      role: "approver"
    });

    expect(decision.trace.status).toBe("COMPLETED");
    expect(decision.review.approvedFingerprints).toEqual([customer!.fingerprint]);
    expect(decision.trace.humanReviews).toHaveLength(2);
  });

  it("requires a different reviewer identity for customer-facing approval", async () => {
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
    await applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [internal!.fingerprint],
      reviewerId: "reviewer_same",
      role: "approver"
    });

    await expect(applyReviewDecision(storage, {
      runId: result.trace.id,
      status: "approved",
      approvedFingerprints: [customer!.fingerprint],
      reviewerId: "reviewer_same",
      role: "approver"
    })).rejects.toThrow(/different reviewer identity/);
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
      reviewerId: "reviewer_security",
      role: "approver",
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
