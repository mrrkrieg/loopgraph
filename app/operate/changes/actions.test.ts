import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isPublicPreview: vi.fn(() => false),
  getWorkspaceDatabase: vi.fn(),
  review: vi.fn(),
  revalidatePath: vi.fn(),
  getActiveLoopgraphProjectRoot: vi.fn(() => "/tmp/review-project"),
  store: {}
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/hosted-config", () => ({
  isPublicHostedPreviewEnvironment: mocks.isPublicPreview
}));
vi.mock("@/lib/db/workspace-database", () => ({
  getWorkspaceDatabase: mocks.getWorkspaceDatabase
}));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({
  getActiveLoopgraphProjectRoot: mocks.getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore: () => mocks.store,
  getHermesDesignStore: () => mocks.store,
  getLoopOpportunityStore: () => mocks.store,
  getLoopSpecRegistryStore: () => mocks.store,
  getSemanticGraphStore: () => mocks.store
}));
vi.mock("loopgraph/runtime", () => ({
  reviewHermesGraphChangeSet: mocks.review
}));

import {
  decideGraphChangeAction,
  initialGraphChangeDecisionState
} from "./actions";

describe("graph change decision action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPublicPreview.mockReturnValue(false);
    mocks.getWorkspaceDatabase.mockResolvedValue({
      hosted: true,
      userId: "operator_1",
      role: "operator"
    });
    mocks.review.mockResolvedValue({ receipt: { id: "approval_1" } });
  });

  it("derives the hosted actor and records an approval through the governed service", async () => {
    const formData = new FormData();
    formData.set("changeSetId", "graph_change_1");
    formData.set("decision", "approved");
    formData.set("reason", "The exact Hermes design is complete and the expected outcome is measurable.");

    await expect(decideGraphChangeAction(
      initialGraphChangeDecisionState,
      formData
    )).resolves.toEqual({
      status: "success",
      message: expect.stringContaining("content-bound receipt approval_1")
    });
    expect(mocks.getWorkspaceDatabase).toHaveBeenCalledWith("reviews.write");
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: "/tmp/review-project",
      changeSetId: "graph_change_1",
      decision: "approved",
      actorId: "operator_1",
      actorRole: "operator",
      policyVersion: "loopgraph-ui/graph-review/v1"
    }), expect.any(Object));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/brain");
  });

  it("keeps the public preview read-only", async () => {
    mocks.isPublicPreview.mockReturnValue(true);
    const formData = new FormData();
    formData.set("changeSetId", "graph_change_1");
    formData.set("decision", "rejected");
    formData.set("reason", "Preview must remain immutable.");

    await expect(decideGraphChangeAction(
      initialGraphChangeDecisionState,
      formData
    )).resolves.toEqual({
      status: "error",
      message: "The public Loopgraph preview is read-only"
    });
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("rejects malformed decisions before loading reviewer authority", async () => {
    const formData = new FormData();
    formData.set("changeSetId", "graph_change_1");
    formData.set("decision", "apply_now");
    formData.set("reason", "This must not bypass the decision boundary.");

    await expect(decideGraphChangeAction(
      initialGraphChangeDecisionState,
      formData
    )).resolves.toEqual({
      status: "error",
      message: "decision must be approved or rejected"
    });
    expect(mocks.getWorkspaceDatabase).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
