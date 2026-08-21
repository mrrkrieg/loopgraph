import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  callTool: vi.fn(),
  revalidatePath: vi.fn(),
  projectRoot: vi.fn(() => "/srv/loopgraph/tenant/main")
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/hosted-access", () => ({ requireHostedPermission: mocks.requirePermission }));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({ getActiveLoopgraphProjectRoot: mocks.projectRoot }));
vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool: mocks.callTool }));

import { operateInstalledAppAction } from "./actions";

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
});
