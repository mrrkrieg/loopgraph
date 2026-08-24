import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  projectRoot: vi.fn(() => "/srv/loopgraph/tenant/main")
}));

vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool: mocks.callTool }));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({ getActiveLoopgraphProjectRoot: mocks.projectRoot }));

import { getAppInstallPlanViewData } from "./read-model";

describe("App onboarding browser read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callTool.mockImplementation(async (name: string) => name === "loopgraph_app_get"
      ? appDetail()
      : { stage: "choose_preset", app: { presets: [] }, questions: [] });
  });

  it("does not mask a saved draft with browser defaults on an App-only handoff", async () => {
    const result = await getAppInstallPlanViewData("loopgraph.sales.qualify-route-inbound-leads");

    expect(result.plan).toBeUndefined();
    const onboardingInput = mocks.callTool.mock.calls.find(([name]) => name === "loopgraph_app_onboarding_get")?.[1];
    expect(onboardingInput).toEqual({
      projectRoot: "/srv/loopgraph/tenant/main",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: undefined,
      actor: "loopgraph-browser"
    });
    expect(onboardingInput).not.toHaveProperty("versionRange");
    expect(onboardingInput).not.toHaveProperty("configuration");
  });
});

function appDetail() {
  return {
    app: { id: "loopgraph.sales.qualify-route-inbound-leads", name: "Qualify and Route Inbound Leads" },
    manifest: { presets: [], modules: [] },
    setupQuestions: [],
    graphPreview: { nodes: [], edges: [] },
    sampleOutputs: []
  };
}
