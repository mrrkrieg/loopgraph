import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  callTool: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  projectRoot: vi.fn(() => "/srv/loopgraph/tenant/main")
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/hosted-access", () => ({ requireHostedPermission: mocks.requirePermission }));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({ getActiveLoopgraphProjectRoot: mocks.projectRoot }));
vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool: mocks.callTool }));

import { duplicateInstalledAppAction, operateInstalledAppAction } from "./actions";

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

  it("opens the new private installation after a browser duplicate", async () => {
    mocks.callTool.mockResolvedValue({ installation: { id: "install.private-sales" } });
    const formData = new FormData();
    formData.set("installationId", "install.sales");
    formData.set("derivedAppId", "acme.sales.qualify-leads");
    formData.set("overlay", JSON.stringify({ operations: [] }));

    await duplicateInstalledAppAction(formData);

    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_duplicate", {
      projectRoot: "/srv/loopgraph/tenant/main",
      installationId: "install.sales",
      derivedAppId: "acme.sales.qualify-leads",
      overlayOperations: [],
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

    await expect(duplicateInstalledAppAction(formData)).rejects.toThrow(/did not return the new private App installation identity/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
