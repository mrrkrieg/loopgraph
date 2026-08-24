import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  requireStepUp: vi.fn(),
  callTool: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  projectRoot: vi.fn(() => "/srv/loopgraph/tenant/main")
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/hosted-access", () => ({
  requireHostedPermission: mocks.requirePermission,
  requireHostedStepUp: mocks.requireStepUp
}));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({ getActiveLoopgraphProjectRoot: mocks.projectRoot }));
vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool: mocks.callTool }));

import {
  activateInstalledAppAction,
  approveInstalledAppActivationAction,
  detachInstalledAppAction,
  duplicateInstalledAppAction,
  operateInstalledAppAction
} from "./actions";

describe("installed App browser actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ userId: "user_42", email: "admin@example.com" });
    mocks.callTool.mockResolvedValue({});
  });

  it("derives the lifecycle audit actor from the authenticated session", async () => {
    const formData = new FormData();
    formData.set("installationId", "install.customer-health");
    formData.set("action", "pause");
    await operateInstalledAppAction(formData);
    expect(mocks.requirePermission).toHaveBeenCalledWith("organization.manage");
    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_pause", {
      projectRoot: "/srv/loopgraph/tenant/main",
      installationId: "install.customer-health",
      actor: "admin@example.com"
    });
  });

  it("binds browser repair to the exact source artifact and installation revision", async () => {
    const formData = new FormData();
    formData.set("installationId", "install.customer-health");
    formData.set("action", "repair");
    formData.set("expectedArtifactDigest", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    formData.set("expectedUpdatedAt", "2026-08-22T20:00:00.000Z");

    await operateInstalledAppAction(formData);

    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_repair", {
      projectRoot: "/srv/loopgraph/tenant/main",
      installationId: "install.customer-health",
      actor: "admin@example.com",
      expectedArtifactDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedUpdatedAt: "2026-08-22T20:00:00.000Z"
    });
  });

  it("opens the new private installation after a browser duplicate", async () => {
    mocks.callTool.mockResolvedValue({ installation: { id: "install.private-sales" } });
    const formData = new FormData();
    formData.set("installationId", "install.sales");
    formData.set("derivedAppId", "acme.sales.qualify-leads");
    formData.set("overlay", JSON.stringify({ operations: [] }));
    formData.set("expectedArtifactDigest", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    formData.set("expectedUpdatedAt", "2026-08-22T21:00:00.000Z");

    await duplicateInstalledAppAction(formData);

    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_duplicate", {
      projectRoot: "/srv/loopgraph/tenant/main",
      installationId: "install.sales",
      derivedAppId: "acme.sales.qualify-leads",
      overlayOperations: [],
      expectedArtifactDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expectedUpdatedAt: "2026-08-22T21:00:00.000Z",
      actor: "admin@example.com"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/apps/install.private-sales");
    expect(mocks.redirect).toHaveBeenCalledWith("/apps/install.private-sales?created=duplicate");
  });

  it("fails closed when duplication returns no installation identity", async () => {
    mocks.callTool.mockResolvedValue({});
    const formData = new FormData();
    formData.set("installationId", "install.sales");
    formData.set("derivedAppId", "acme.sales.qualify-leads");
    formData.set("expectedArtifactDigest", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    formData.set("expectedUpdatedAt", "2026-08-22T21:00:00.000Z");

    await expect(duplicateInstalledAppAction(formData)).rejects.toThrow(/did not return the new private App installation identity/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("binds browser detach to the exact source artifact and installation revision", async () => {
    const formData = new FormData();
    formData.set("installationId", "install.private-sales");
    formData.set("expectedArtifactDigest", "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    formData.set("expectedUpdatedAt", "2026-08-22T22:00:00.000Z");

    await detachInstalledAppAction(formData);

    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_detach", {
      projectRoot: "/srv/loopgraph/tenant/main",
      installationId: "install.private-sales",
      expectedArtifactDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      expectedUpdatedAt: "2026-08-22T22:00:00.000Z",
      actor: "admin@example.com"
    });
  });

  it("records an explicit short-lived activation approval without activating", async () => {
    const formData = new FormData();
    formData.set("installationId", "install.sales");
    formData.set("mode", "shadow");
    formData.set("confirmation", "APPROVE");
    formData.set("reason", "Synthetic conformance passed; shadow mode remains write-blocked.");
    formData.append("evidenceRef", "evaluation:synthetic");
    formData.append("evidenceRef", "evaluation:synthetic");

    await approveInstalledAppActivationAction(formData);

    expect(mocks.requireStepUp).toHaveBeenCalled();
    expect(mocks.callTool).toHaveBeenCalledTimes(1);
    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_activation_approve", {
      projectRoot: "/srv/loopgraph/tenant/main",
      installationId: "install.sales",
      mode: "shadow",
      approvedBy: "admin@example.com",
      reason: "Synthetic conformance passed; shadow mode remains write-blocked.",
      evidenceRefs: ["evaluation:synthetic"],
      expiresInSeconds: 900
    });
  });

  it("activates only by consuming the exact approval receipt", async () => {
    const formData = new FormData();
    formData.set("installationId", "install.sales");
    formData.set("mode", "shadow");
    formData.set("approvalReceiptId", "activation-approval.content-bound");

    await activateInstalledAppAction(formData);

    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_activate", {
      projectRoot: "/srv/loopgraph/tenant/main",
      installationId: "install.sales",
      mode: "shadow",
      approvalReceiptId: "activation-approval.content-bound",
      actor: "admin@example.com"
    });
    expect(mocks.requireStepUp).not.toHaveBeenCalled();
  });
});
