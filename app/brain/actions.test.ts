import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentHash, LOOPGRAPH_API_VERSION, LOOP_KIND } from "loopgraph/core";
import {
  getLoopRunsForHermes,
  type SubmitGraphEditorTransactionInput
} from "loopgraph/runtime";
import { getSemanticTopology } from "../../lib/loop-engineering-builder/workspace";
import { resetStorageAdapterCache } from "../../lib/loopgraph-runtime/storage-resolver";
import {
  simulateBrainLoopFixtureAction,
  simulateBrainLoopManualEventAction,
  submitBrainGraphEditAction,
  validateBrainLoopAction
} from "./actions";

const getGraphAuthoringContext = vi.hoisted(() => vi.fn());
const startGraphEditorProposalLifecycle = vi.hoisted(() => vi.fn());

vi.mock("../../lib/loopgraph-runtime/graph-authoring-store-resolver", () => ({
  getGraphAuthoringContext
}));

vi.mock("loopgraph/runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("loopgraph/runtime")>(),
  startGraphEditorProposalLifecycle
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
}));

describe("brain graph loop actions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetStorageAdapterCache();
  });

  it("validates a graph-selected Hermes loop by loop ID", async () => {
    const { projectRoot } = await createHermesLoopProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const formData = new FormData();
    formData.set("loopId", "marketing_ads");

    await expect(validateBrainLoopAction(formData))
      .rejects.toThrow("NEXT_REDIRECT:/loops/marketing_ads");
  });

  it("simulates a graph-selected fixture ID and persists the local trace", async () => {
    const { projectRoot } = await createHermesLoopProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const formData = new FormData();
    formData.set("loopId", "marketing_ads");
    formData.set("fixtureId", "happy-path");

    await expect(simulateBrainLoopFixtureAction(formData))
      .rejects.toThrow(/NEXT_REDIRECT:\/loops\/marketing_ads\/runs\/run_/);

    const runs = await getLoopRunsForHermes({
      projectRoot,
      loopId: "marketing_ads"
    });
    expect(runs).toMatchObject({
      count: 1,
      runs: [{
        loopId: "marketing_ads",
        status: "COMPLETED"
      }]
    });

    resetStorageAdapterCache();
    const topology = await getSemanticTopology(undefined, {
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain"
    });
    expect(topology.nodes.find((node) => node.id === "loop:marketing_ads")?.metadata).toMatchObject({
      latestRun: {
        id: runs.runs[0]?.runId,
        status: "COMPLETED",
        mode: "simulate"
      }
    });
  });

  it("simulates a graph-entered manual synthetic event and persists the local trace", async () => {
    const { projectRoot } = await createHermesLoopProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const formData = new FormData();
    formData.set("loopId", "marketing_ads");
    formData.set("fixtureJson", JSON.stringify({
      eventId: "manual_marketing_ads_001",
      simulatedAt: "2026-07-21T12:30:00.000Z",
      expectedAssessment: {
        decisionSummary: "Manual synthetic event uses redacted local evidence.",
        assumptions: [{ id: "assumption_manual", statement: "Synthetic manual input.", confidence: 1 }],
        proposedActions: [],
        evidence: [{
          id: "evidence_manual",
          sourceId: "manual.fixture",
          sourceType: "fixture",
          excerpt: "Redacted campaign trend.",
          trusted: false
        }],
        policyInputs: [{ key: "confidence", value: 0.83, source: "manual-fixture" }],
        verificationRequest: { required: false, checks: ["evidence"] },
        escalationRequest: { required: false }
      }
    }));

    await expect(simulateBrainLoopManualEventAction(formData))
      .rejects.toThrow(/NEXT_REDIRECT:\/loops\/marketing_ads\/runs\/run_/);

    const runs = await getLoopRunsForHermes({
      projectRoot,
      loopId: "marketing_ads"
    });
    expect(runs).toMatchObject({
      count: 1,
      runs: [{
        loopId: "marketing_ads",
        status: "COMPLETED",
        trigger: {
          eventId: "manual_marketing_ads_001"
        }
      }]
    });
  });

  it("rejects manual simulation JSON with secret-like keys before writing a trace", async () => {
    const { projectRoot } = await createHermesLoopProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const formData = new FormData();
    formData.set("loopId", "marketing_ads");
    formData.set("fixtureJson", JSON.stringify({
      eventId: "manual_marketing_ads_secret",
      simulatedAt: "2026-07-21T12:30:00.000Z",
      context: {
        apiToken: "do-not-store"
      }
    }));

    await expect(simulateBrainLoopManualEventAction(formData))
      .rejects.toThrow("secret-like field: context.apiToken");

    const runs = await getLoopRunsForHermes({
      projectRoot,
      loopId: "marketing_ads"
    });
    expect(runs.count).toBe(0);
  });

  it("submits authenticated graph-authoring actions through the resolved backend store", async () => {
    const { projectRoot } = await createHermesLoopProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    const topology = await getSemanticTopology(undefined, {
      includeCatalogLoops: false,
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain"
    });
    const topologyHash = contentHash({ nodes: topology.nodes, edges: topology.edges });
    const submit = vi.fn(async (input: SubmitGraphEditorTransactionInput) => ({
      schemaVersion: "graph-editor-transaction/v1alpha1" as const,
      id: input.transactionId!,
      workspaceId: input.workspaceId,
      companyId: input.companyId,
      actorId: input.actorId,
      expectedTopologyHash: input.expectedTopologyHash,
      operations: input.operations,
      status: "layout_applied" as const,
      createdAt: input.now!.toISOString()
    }));
    getGraphAuthoringContext.mockResolvedValue({
      store: { persistence: "distributed", submit, getLayout: vi.fn(), list: vi.fn() },
      workspaceId: "main",
      companyId: "123e4567-e89b-12d3-a456-426614174000",
      actorId: "123e4567-e89b-12d3-a456-426614174001"
    });
    const formData = new FormData();
    formData.set("operations", JSON.stringify([{ kind: "move_node", nodeId: "brain", x: 0, y: 0 }]));
    formData.set("expectedTopologyHash", topologyHash);

    await expect(submitBrainGraphEditAction(formData)).resolves.toEqual({
      id: expect.stringMatching(/^graph_edit_/),
      status: "layout_applied",
      proposalLifecycle: []
    });
    expect(getGraphAuthoringContext).toHaveBeenCalledWith("loops.write");
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "main",
      companyId: "123e4567-e89b-12d3-a456-426614174000",
      actorId: "123e4567-e89b-12d3-a456-426614174001",
      expectedTopologyHash: topologyHash
    }));
  });

  it("turns a semantic graph proposal into a Hermes design lifecycle", async () => {
    const { projectRoot } = await createHermesLoopProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    const topology = await getSemanticTopology(undefined, {
      includeCatalogLoops: false,
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain"
    });
    const topologyHash = contentHash({ nodes: topology.nodes, edges: topology.edges });
    const operation = {
      kind: "propose_node" as const,
      temporaryId: "draft:new-product-loop",
      nodeType: "workflow_loop" as const,
      label: "Product Signal Review",
      departmentId: "product",
      purpose: "Turn repeated product signals into a governed review loop."
    };
    const workspaceId = "main";
    const companyId = "123e4567-e89b-12d3-a456-426614174000";
    const actorId = "123e4567-e89b-12d3-a456-426614174001";
    const submit = vi.fn(async (input: SubmitGraphEditorTransactionInput) => ({
      schemaVersion: "graph-editor-transaction/v1alpha1" as const,
      id: input.transactionId!,
      workspaceId: input.workspaceId,
      companyId: input.companyId,
      actorId: input.actorId,
      expectedTopologyHash: input.expectedTopologyHash,
      operations: input.operations,
      status: "proposal_pending" as const,
      createdAt: input.now!.toISOString()
    }));
    getGraphAuthoringContext.mockResolvedValue({
      store: {
        persistence: "distributed",
        submit,
        getLayout: vi.fn(),
        list: vi.fn()
      },
      workspaceId,
      companyId,
      actorId
    });
    startGraphEditorProposalLifecycle.mockResolvedValue({
      opportunity: { id: "opportunity_graph_edit_1" },
      graphChangeSet: { id: "graph_change_graph_edit_1" },
      designTask: { id: "hermes_task_graph_edit_1", sessionId: "discovery_graph_edit_1" },
      nextAction: "answer_questions"
    });
    const formData = new FormData();
    formData.set("operations", JSON.stringify([operation]));
    formData.set("expectedTopologyHash", topologyHash);

    const result = await submitBrainGraphEditAction(formData);
    expect(result).toEqual({
      id: expect.stringMatching(/^graph_edit_/),
      status: "proposal_pending",
      proposalLifecycle: [{
        opportunityId: "opportunity_graph_edit_1",
        graphChangeSetId: "graph_change_graph_edit_1",
        designTaskId: "hermes_task_graph_edit_1",
        discoverySessionId: "discovery_graph_edit_1",
        nextAction: "answer_questions"
      }]
    });
    expect(startGraphEditorProposalLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: result.id,
        department: "product",
        kind: "create_loop",
        title: "Design Product Signal Review",
        projectRoot
      }),
      expect.objectContaining({
        designStore: expect.any(Object),
        discoveryStore: expect.any(Object),
        loopSpecStore: expect.any(Object),
        opportunityStore: expect.any(Object)
      })
    );
  });

  it("rejects non-compilable decorative edges before persisting a receipt", async () => {
    const { projectRoot } = await createHermesLoopProject();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    const topology = await getSemanticTopology(undefined, {
      includeCatalogLoops: false,
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain"
    });
    const source = topology.nodes.find((node) => node.type === "company");
    const target = topology.nodes.find((node) => node.type === "department_loop");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    const topologyHash = contentHash({ nodes: topology.nodes, edges: topology.edges });
    const submit = vi.fn();
    getGraphAuthoringContext.mockResolvedValue({
      store: {
        persistence: "distributed",
        submit,
        getLayout: vi.fn(),
        list: vi.fn()
      },
      workspaceId: "main",
      companyId: "123e4567-e89b-12d3-a456-426614174000",
      actorId: "123e4567-e89b-12d3-a456-426614174001"
    });
    const formData = new FormData();
    formData.set("operations", JSON.stringify([{
      kind: "propose_edge",
      sourceId: source!.id,
      targetId: target!.id,
      relation: "brain_routes_to",
      reason: "This edge has no workflow loop to compile."
    }]));
    formData.set("expectedTopologyHash", topologyHash);

    await expect(submitBrainGraphEditAction(formData)).rejects.toThrow(
      "must connect Hermes Brain to a workflow loop"
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("bounds semantic lifecycle fan-out before authorization or persistence", async () => {
    const operations = Array.from({ length: 26 }, (_, index) => ({
      kind: "propose_node" as const,
      temporaryId: `draft_${index}`,
      nodeType: "workflow_loop" as const,
      label: `Product Review ${index}`,
      departmentId: "product",
      purpose: `Review product evidence stream ${index}.`
    }));
    const formData = new FormData();
    formData.set("operations", JSON.stringify(operations));
    formData.set("expectedTopologyHash", "unused");

    await expect(submitBrainGraphEditAction(formData))
      .rejects.toThrow("A graph edit can contain at most 25 semantic proposals");
    expect(getGraphAuthoringContext).not.toHaveBeenCalled();
    expect(startGraphEditorProposalLifecycle).not.toHaveBeenCalled();
  });
});

async function createHermesLoopProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-brain-actions-"));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  const fixturePath = path.join(projectRoot, "loops", "fixtures", "happy-path.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
  await writeFile(fixturePath, `${JSON.stringify(marketingAdsFixture(), null, 2)}\n`);
  await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs: [{
      id: "marketing_ads",
      name: "Ads",
      path: path.relative(projectRoot, specPath),
      department: "marketing",
      addedAt: "2026-07-21T12:00:00.000Z"
    }]
  }, null, 2)}\n`);

  return { projectRoot };
}

function marketingAdsSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "marketing_ads",
      name: "Ads",
      version: "1.0.0",
      description: "Improve qualified acquisition efficiency."
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: {
      schema: { type: "object" },
      fixtures: [{ id: "happy-path", path: "fixtures/happy-path.json" }]
    },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe campaign signals." }]
    },
    tools: [{ key: "draft_review", adapterId: "manual", label: "Draft review", writeCapable: false, riskLevel: "medium" }],
    policy: {
      allowedActions: [{ toolKey: "draft_review", allowed: true, requiresApproval: false, riskLevel: "medium" }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["owner"] },
    persistence: { idempotency: { enabled: true } },
    trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
    topology: { department: "marketing", tags: ["hermes"] },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct"]
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow"
    }
  };
}

function marketingAdsFixture() {
  return {
    eventId: "evt_marketing_ads_happy",
    simulatedAt: "2026-07-21T12:00:00.000Z",
    expectedAssessment: {
      decisionSummary: "Campaign spend is rising faster than qualified pipeline.",
      assumptions: [{ id: "assumption_1", statement: "The fixture is synthetic.", confidence: 1 }],
      proposedActions: [{
        id: "act_draft",
        toolKey: "draft_review",
        label: "Draft campaign review",
        input: {
          recommendation: "Pause the low-quality audience segment."
        },
        riskLevel: "medium",
        requiresApproval: false,
        customerFacing: false
      }],
      evidence: [{
        id: "evidence_1",
        sourceId: "fixture.signals",
        sourceType: "fixture",
        excerpt: "Spend +18%, cost per qualified customer +31%",
        trusted: true
      }],
      policyInputs: [{ key: "confidence", value: 0.91, source: "fixture" }],
      verificationRequest: { required: false, checks: ["evidence"] },
      escalationRequest: { required: false }
    }
  };
}
