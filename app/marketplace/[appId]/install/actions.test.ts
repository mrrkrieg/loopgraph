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

import { confirmAppFieldMappingsAction } from "./actions";

describe("marketplace App installation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ userId: "user_84", email: "installer@example.com" });
    mocks.callTool.mockResolvedValue({});
  });

  it("records the authenticated installer on reviewed provider mappings", async () => {
    const formData = new FormData();
    formData.set("confirmMappings", "on");
    formData.set("appId", "loopgraph.sales.qualify-route-inbound-leads");
    formData.set("presetId", "hubspot-gmail-slack");
    formData.set("connectionId", "hubspot-production");
    formData.set("objectType", "lead");
    formData.append("logicalField", "lead.email");
    formData.set("providerField:lead.email", "email");
    formData.set("confidence:lead.email", "0.99");
    await confirmAppFieldMappingsAction(formData);
    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_field_mapping_confirm", expect.objectContaining({
      actor: "installer@example.com",
      connectionId: "hubspot-production",
      mappings: [{ logicalField: "lead.email", providerField: "email", direction: "read", confidence: 0.99 }]
    }));
  });
});
