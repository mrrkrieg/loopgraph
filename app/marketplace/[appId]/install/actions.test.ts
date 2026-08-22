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

import { confirmAppFieldMappingsAction, planMarketplaceAppInstallAction, resetMarketplaceAppOnboardingAction } from "./actions";

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

  it("persists browser answers through the shared resumable onboarding tool", async () => {
    const plan = {
      planDigest: "sha256:plan",
      selectedModules: ["qualification"],
      configuration: { values: { exclusions: ["employee"] } },
      fieldMappingIds: [],
      missingConfigurationKeys: [],
      capabilityResolutions: [],
      permissions: [],
      conflicts: [],
      assets: [],
      dependencyResolutions: [],
      graphDiff: { nodesReused: [], nodesAdded: [], edgesAdded: [], edgesRemoved: [] }
    };
    const journey = {
      stage: "review_install",
      headline: "Review the exact plan.",
      progress: { completed: 4, total: 8 },
      steps: [],
      nextAction: { kind: "call_tool", toolName: "loopgraph_app_install_apply", summary: "Install", requiresHumanConfirmation: true },
      draft: { id: "draft.sales", revision: 2, savedAt: "2026-08-21T20:00:00.000Z", savedBy: "installer@example.com", answerKeys: ["exclusions"], resumed: true },
      plan,
      mappingPlan: { requirements: [] },
      questions: []
    };
    mocks.callTool
      .mockResolvedValueOnce({
        selectedVersion: { version: "1.0.0" },
        setupQuestions: [{ key: "exclusions", valueType: "string_list", prompt: "Exclusions", why: "Avoid bad routes", requirement: "required" }],
        graphPreview: { nodes: [], edges: [] },
        sampleOutputs: []
      })
      .mockResolvedValueOnce(journey);
    const previousState = {
      stage: "configure",
      plan: { ...plan, planDigest: "sha256:previous" },
      impact: { additions: [], reusedAssets: [], reusedDependencies: [], conflicts: [], permissions: [], metrics: [], evidenceEdges: [] },
      mappingPlan: { requirements: [] },
      journey: { ...journey, draft: { ...journey.draft, revision: 1 } },
      unresolvedQuestionKeys: ["exclusions"]
    } as never;
    const formData = new FormData();
    formData.set("appId", "loopgraph.sales.qualify-route-inbound-leads");
    formData.set("presetId", "hubspot-gmail-slack");
    formData.set("selectedModule", "qualification");
    formData.set("config:exclusions", "employee\nexisting_customer");

    const result = await planMarketplaceAppInstallAction(previousState, formData);

    expect(mocks.callTool).toHaveBeenNthCalledWith(2, "loopgraph_app_onboarding_save", expect.objectContaining({
      expectedDraftRevision: 1,
      actor: "installer@example.com",
      configuration: { exclusions: ["employee", "existing_customer"] }
    }));
    expect(result.error).toBeUndefined();
    expect(result.journey.draft).toMatchObject({ revision: 2 });
    expect(result.notice).toMatch(/progress was saved/i);
  });

  it("clears only the exact confirmed browser onboarding draft", async () => {
    const formData = new FormData();
    formData.set("appId", "loopgraph.sales.qualify-route-inbound-leads");
    formData.set("presetId", "hubspot-gmail-slack");
    formData.set("expectedDraftId", "draft.12345678");
    formData.set("expectedDraftRevision", "3");
    formData.set("confirmReset", "on");

    await resetMarketplaceAppOnboardingAction(formData);

    expect(mocks.callTool).toHaveBeenCalledWith("loopgraph_app_onboarding_reset", expect.objectContaining({
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      expectedDraftId: "draft.12345678",
      expectedDraftRevision: 3,
      confirmReset: true,
      actor: "installer@example.com"
    }));
    expect(mocks.redirect).toHaveBeenCalledWith("/marketplace/loopgraph.sales.qualify-route-inbound-leads/install?preset=hubspot-gmail-slack");
  });
});
