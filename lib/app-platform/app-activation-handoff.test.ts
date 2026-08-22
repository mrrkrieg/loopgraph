import { describe, expect, it } from "vitest";
import type { AppActivationApprovalReceipt, WorkspaceAppInstallation } from "loopgraph/core";
import { activationEvidenceRefs, currentActivationApproval } from "./app-activation-handoff";

const installation = {
  id: "install.sales",
  appId: "loopgraph.sales.qualify-route-inbound-leads",
  artifactDigest: `sha256:${"a".repeat(64)}`,
  state: "simulation_passed"
} as WorkspaceAppInstallation;

function approval(overrides: Partial<AppActivationApprovalReceipt> = {}): AppActivationApprovalReceipt {
  return {
    schemaVersion: "loopgraph-app-activation-approval/v1alpha1",
    id: "activation-approval.test",
    workspaceId: "default",
    installationId: installation.id,
    appId: installation.appId,
    artifactDigest: installation.artifactDigest,
    fromState: installation.state,
    requestedMode: "shadow",
    approvedBy: "owner@example.com",
    reason: "Synthetic conformance passed and shadow mode cannot write to providers.",
    evidenceRefs: ["evaluation:test"],
    approvedAt: "2026-08-22T12:00:00.000Z",
    expiresAt: "2026-08-22T12:15:00.000Z",
    approvalDigest: `sha256:${"b".repeat(64)}`,
    ...overrides
  };
}

describe("browser App activation handoff", () => {
  it("returns only an unconsumed, unexpired receipt bound to the exact current state and artifact", () => {
    const selected = currentActivationApproval({
      installation,
      approvals: [
        approval({ id: "expired", expiresAt: "2026-08-22T11:59:59.000Z" }),
        approval({ id: "stale", artifactDigest: `sha256:${"c".repeat(64)}` }),
        approval({ id: "consumed", consumedAt: "2026-08-22T12:01:00.000Z", consumedBy: "operator" }),
        approval({ id: "current" })
      ],
      mode: "shadow",
      now: new Date("2026-08-22T12:05:00.000Z")
    });

    expect(selected?.id).toBe("current");
  });

  it("deduplicates and bounds evidence references before the approval mutation", () => {
    expect(activationEvidenceRefs(["evaluation:one", "evaluation:one", "", "x".repeat(1_001), "evaluation:two"]))
      .toEqual(["evaluation:one", "evaluation:two"]);
  });
});
