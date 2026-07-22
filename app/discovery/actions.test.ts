import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDiscoverySession,
  getLoopRunsForHermes,
  listLoopgraphLoops,
  loadLoopSpecFromPath,
  readLoopDesignProposalSet,
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "loopgraph/runtime";
import {
  confirmBrowserDiscoveryProjectContextAction,
  editBrowserLoopDesignProposalAction,
  generateBrowserLoopDesignAction,
  materializeBrowserLoopDesignAction,
  selectBrowserDiscoveryDepartmentsAction,
  simulateBrowserMaterializedLoopAction,
  submitBrowserDiscoveryAnswersAction
} from "./actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
}));

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-discovery-actions-"));
}

describe("browser discovery actions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("confirms project context through the shared browser/Hermes discovery path", async () => {
    const projectRoot = await temporaryProjectRoot();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "browser-growth-app",
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0",
        "@supabase/supabase-js": "^2.0.0"
      }
    }, null, 2));
    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_browser_project",
      companyId: "company_browser_project",
      companyName: "Browser Project Co",
      createdByActor: "browser"
    });

    const formData = new FormData();
    formData.set("sessionId", "session_browser_project");
    formData.set("expectedRevision", "0");
    formData.set("displayName", "Browser Growth App");
    formData.set("companyDescription", "A local project for marketing loops.");
    formData.set("sourceOfTruth", "HubSpot defines qualified customers.");
    formData.set("additionalTools", "HubSpot\nNotion");
    formData.set("confirmedStack", "on");

    await expect(confirmBrowserDiscoveryProjectContextAction(formData))
      .rejects.toThrow("NEXT_REDIRECT:/discovery/departments?sessionId=session_browser_project");

    const persisted = await getDiscoverySession("session_browser_project", projectRoot);
    expect(persisted).toMatchObject({
      projectProfileId: expect.stringMatching(/^project_/),
      projectProfile: {
        displayName: "Browser Growth App",
        confirmedByUser: true,
        frameworks: expect.arrayContaining(["Next.js", "React"])
      },
      companyProfile: {
        name: "Browser Growth App",
        description: "A local project for marketing loops.",
        tools: expect.arrayContaining(["Supabase", "HubSpot", "Notion"])
      },
      activeStage: "department_selection",
      revision: 1,
      lastActor: "browser"
    });
    expect(persisted?.answers).toContainEqual(expect.objectContaining({
      questionId: "project_context.source_of_truth",
      value: "HubSpot defines qualified customers."
    }));
  });

  it("selects canonical departments in the shared Hermes discovery session", async () => {
    const projectRoot = await temporaryProjectRoot();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_browser_departments",
      companyId: "company_browser_departments",
      companyName: "Department Co",
      createdByActor: "hermes"
    });

    const formData = new FormData();
    formData.set("sessionId", "session_browser_departments");
    formData.set("expectedRevision", "0");
    formData.append("departments", "marketing");
    formData.append("departments", "sales");
    formData.set("activeDepartment", "marketing");

    await expect(selectBrowserDiscoveryDepartmentsAction(formData))
      .rejects.toThrow("NEXT_REDIRECT:/discovery/questions?sessionId=session_browser_departments");

    const persisted = await getDiscoverySession("session_browser_departments", projectRoot);
    expect(persisted).toMatchObject({
      selectedDepartmentIds: ["marketing", "sales"],
      activeDepartmentId: "marketing",
      activeQuestionBundleId: "current_stack_sources",
      revision: 1,
      lastActor: "browser"
    });
  });

  it("submits typed answers for the active question bundle with revision checks", async () => {
    const projectRoot = await temporaryProjectRoot();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_browser_answers",
      companyId: "company_browser_answers",
      companyName: "Answers Co",
      createdByActor: "browser"
    });

    const selectForm = new FormData();
    selectForm.set("sessionId", "session_browser_answers");
    selectForm.set("expectedRevision", "0");
    selectForm.append("departments", "marketing");
    selectForm.set("activeDepartment", "marketing");
    await expect(selectBrowserDiscoveryDepartmentsAction(selectForm)).rejects.toThrow("NEXT_REDIRECT");

    const answerForm = new FormData();
    answerForm.set("sessionId", "session_browser_answers");
    answerForm.set("bundleId", "current_stack_sources");
    answerForm.set("expectedRevision", "1");
    answerForm.set("systems", "Google Ads\nHubSpot");
    answerForm.set("source_of_truth", "HubSpot defines qualified leads.");
    answerForm.set("safe_reads", "campaign performance\nqualified lead status");
    answerForm.set("manual_fallbacks", "weekly CSV export");

    await expect(submitBrowserDiscoveryAnswersAction(answerForm))
      .rejects.toThrow("NEXT_REDIRECT:/discovery/questions?sessionId=session_browser_answers");

    const persisted = await getDiscoverySession("session_browser_answers", projectRoot);
    expect(persisted).toMatchObject({
      revision: 2,
      activeQuestionBundleId: "biggest_recurring_problem",
      lastActor: "browser"
    });
    expect(persisted?.answers).toContainEqual(expect.objectContaining({
      questionId: "current_stack_sources.systems",
      value: ["Google Ads", "HubSpot"],
      valueType: "string_array"
    }));
  });

  it("generates Hermes proposal sets from completed browser discovery answers", async () => {
    const projectRoot = await createCompletedMarketingSession("session_browser_design");
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const formData = new FormData();
    formData.set("sessionId", "session_browser_design");
    formData.set("department", "marketing");
    formData.set("maxProposals", "2");

    await expect(generateBrowserLoopDesignAction(formData))
      .rejects.toThrow(/NEXT_REDIRECT:\/discovery\/designing\?sessionId=session_browser_design&designRunId=design_/);

    const persisted = await getDiscoverySession("session_browser_design", projectRoot);
    const designRunId = persisted?.designRunIds[0];
    expect(persisted).toMatchObject({
      activeStage: "proposal_review",
      lastActor: "browser"
    });
    expect(designRunId).toMatch(/^design_/);

    const proposalSet = await readLoopDesignProposalSet(projectRoot, designRunId!);
    expect(proposalSet?.proposals.map((proposal) => proposal.loopSpecId)).toEqual([
      "marketing_ads",
      "marketing_content_creation"
    ]);
    expect(proposalSet?.proposals[0].topologyPreview.edges).toContainEqual(expect.objectContaining({
      source: "company_brain",
      target: "department:marketing"
    }));
  });

  it("materializes accepted Hermes proposals into registered local loops", async () => {
    const projectRoot = await createCompletedMarketingSession("session_browser_materialize");
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const designForm = new FormData();
    designForm.set("sessionId", "session_browser_materialize");
    designForm.set("department", "marketing");
    await expect(generateBrowserLoopDesignAction(designForm)).rejects.toThrow("NEXT_REDIRECT");

    const sessionAfterDesign = await getDiscoverySession("session_browser_materialize", projectRoot);
    const designRunId = sessionAfterDesign?.designRunIds[0];
    const formData = new FormData();
    formData.set("sessionId", "session_browser_materialize");
    formData.set("designRunId", designRunId!);
    formData.append("acceptedProposalIds", "proposal_marketing_ads");
    formData.append("acceptedProposalIds", "proposal_marketing_content_creation");

    await expect(materializeBrowserLoopDesignAction(formData))
      .rejects.toThrow(/NEXT_REDIRECT:\/discovery\/create-loops\?designRunId=design_.*&materializationId=materialization_.*&sessionId=session_browser_materialize/);

    const loops = await listLoopgraphLoops({ projectRoot });
    expect(loops.loops.map((loop) => loop.loopId)).toEqual([
      "marketing_ads",
      "marketing_content_creation"
    ]);
    expect(loops.graphProjection.edges).toContainEqual(expect.objectContaining({
      source: "company_brain",
      target: "department:marketing"
    }));

    const persisted = await getDiscoverySession("session_browser_materialize", projectRoot);
    expect(persisted).toMatchObject({
      activeStage: "materialization",
      status: "completed",
      lastActor: "browser",
      createdLoopIds: ["marketing_ads", "marketing_content_creation"]
    });
  });

  it("edits a proposal before materialization and writes the edited LoopSpec", async () => {
    const projectRoot = await createCompletedMarketingSession("session_browser_edit_materialize");
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const designForm = new FormData();
    designForm.set("sessionId", "session_browser_edit_materialize");
    designForm.set("department", "marketing");
    await expect(generateBrowserLoopDesignAction(designForm)).rejects.toThrow("NEXT_REDIRECT");

    const sessionAfterDesign = await getDiscoverySession("session_browser_edit_materialize", projectRoot);
    const baseDesignRunId = sessionAfterDesign?.designRunIds[0];
    const editForm = new FormData();
    editForm.set("sessionId", "session_browser_edit_materialize");
    editForm.set("designRunId", baseDesignRunId!);
    editForm.set("proposalId", "proposal_marketing_content_creation");
    editForm.set("shortName", "Content Engine");
    editForm.set("reviewerRoles", "Content lead\nLegal reviewer");
    editForm.set("connectorRequirementsJson", JSON.stringify([
      { capability: "content_repository.read", reason: "Read approved briefs and evidence.", requiredFor: "routing" },
      { capability: "content_repository.draft_write", reason: "Write drafts for review without publishing.", requiredFor: "simulation" },
      { capability: "brand_policy.read", reason: "Verify edited claims against the approved brand policy.", requiredFor: "execution" }
    ]));

    await expect(editBrowserLoopDesignProposalAction(editForm))
      .rejects.toThrow(/NEXT_REDIRECT:\/discovery\/create-loops\?designRunId=design_.*&sessionId=session_browser_edit_materialize/);

    const sessionAfterEdit = await getDiscoverySession("session_browser_edit_materialize", projectRoot);
    const editedDesignRunId = sessionAfterEdit?.designRunIds.at(-1);
    expect(editedDesignRunId).not.toBe(baseDesignRunId);
    const editedProposalSet = await readLoopDesignProposalSet(projectRoot, editedDesignRunId!);
    const contentProposal = editedProposalSet?.proposals.find((proposal) => proposal.proposalId === "proposal_marketing_content_creation");
    expect(contentProposal).toMatchObject({
      shortName: "Content Engine",
      reviewerRoles: ["Content lead", "Legal reviewer"]
    });

    const materializeForm = new FormData();
    materializeForm.set("sessionId", "session_browser_edit_materialize");
    materializeForm.set("designRunId", editedDesignRunId!);
    materializeForm.append("acceptedProposalIds", "proposal_marketing_content_creation");
    await expect(materializeBrowserLoopDesignAction(materializeForm)).rejects.toThrow("NEXT_REDIRECT");

    const loops = await listLoopgraphLoops({ projectRoot });
    const contentLoop = loops.loops.find((loop) => loop.loopId === "marketing_content_creation");
    expect(contentLoop).toMatchObject({
      name: "Content Engine",
      routingReady: true
    });
    expect(contentLoop?.routingCard?.requiredConnections).toEqual(expect.arrayContaining([
      "brand_policy.read"
    ]));

    const loaded = await loadLoopSpecFromPath(contentLoop!.specPath);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.spec.metadata.name).toBe("Content Engine");
      expect(loaded.spec.policy.escalationRules[0]?.routeTo.reviewers).toEqual([
        "Content lead",
        "Legal reviewer"
      ]);
    }
  });

  it("runs a materialized Hermes loop locally from the generated starter fixture", async () => {
    const projectRoot = await createCompletedMarketingSession("session_browser_simulate");
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const designForm = new FormData();
    designForm.set("sessionId", "session_browser_simulate");
    designForm.set("department", "marketing");
    await expect(generateBrowserLoopDesignAction(designForm)).rejects.toThrow("NEXT_REDIRECT");

    const sessionAfterDesign = await getDiscoverySession("session_browser_simulate", projectRoot);
    const designRunId = sessionAfterDesign?.designRunIds[0];
    const materializeForm = new FormData();
    materializeForm.set("sessionId", "session_browser_simulate");
    materializeForm.set("designRunId", designRunId!);
    materializeForm.append("acceptedProposalIds", "proposal_marketing_ads");
    await expect(materializeBrowserLoopDesignAction(materializeForm)).rejects.toThrow("NEXT_REDIRECT");

    const simulateForm = new FormData();
    simulateForm.set("loopId", "marketing_ads");
    simulateForm.set(
      "fixturePath",
      path.join(projectRoot, ".loopgraph", "generated", "hermes", "marketing", "marketing_ads", "fixtures", "happy-path.json")
    );

    await expect(simulateBrowserMaterializedLoopAction(simulateForm))
      .rejects.toThrow(/NEXT_REDIRECT:\/loops\/marketing_ads\/reviews\?runId=run_/);

    const runs = await getLoopRunsForHermes({
      projectRoot,
      loopId: "marketing_ads"
    });
    expect(runs).toMatchObject({
      schemaVersion: "loop-runs/v1alpha1",
      count: 1,
      runs: [{
        loopId: "marketing_ads",
        status: "WAITING_FOR_REVIEW"
      }]
    });
    expect(runs.runs[0]?.trigger.source).toBe("hermes");
    expect(runs.runs[0]?.traceSummary.humanReviewRequired).toBe(true);
  });
});

async function createCompletedMarketingSession(sessionId: string): Promise<string> {
  const projectRoot = await temporaryProjectRoot();
  const started = await startHermesDiscoverySession({
    projectRoot,
    sessionId,
    companyId: `company_${sessionId}`,
    companyName: "Marketing Co",
    createdByActor: "browser"
  });
  let session = await selectDiscoveryDepartments({
    projectRoot,
    sessionId: started.id,
    departments: ["marketing"],
    activeDepartment: "marketing",
    expectedRevision: 0,
    actor: "browser"
  });

  for (const item of [
    {
      bundleId: "current_stack_sources",
      answers: {
        systems: ["Google Ads", "HubSpot", "Notion"],
        source_of_truth: "HubSpot defines qualified leads and customers.",
        safe_reads: ["campaign performance", "qualified lead status", "approved briefs"],
        manual_fallbacks: ["weekly ads CSV", "approved briefs Markdown folder"],
        existing_automations: []
      }
    },
    {
      bundleId: "biggest_recurring_problem",
      answers: {
        processes: ["paid ads review", "content draft creation"],
        trigger_or_cadence: "Campaign anomalies and approved content briefs.",
        weekly_volume: 12,
        current_owner: "Growth lead",
        current_steps: ["collect campaign metrics", "compare to qualified lead quality", "draft content from approved evidence"],
        pain_type_severity: "Manual context gathering and slow draft review are high severity.",
        baseline: "6 hours per week"
      }
    },
    {
      bundleId: "automation_boundaries",
      answers: {
        desired_automation_mode: "monitor, recommend, and draft",
        candidate_outputs_actions: ["campaign recommendation", "content draft", "review packet"],
        read_write_boundary: "Read data and write drafts only; no publishing or spend changes without approval.",
        customer_facing_status: true,
        forbidden_actions: ["no unapproved budget changes", "no unapproved publishing", "no unsupported claims"]
      }
    },
    {
      bundleId: "ideal_outcome_proof",
      answers: {
        primary_outcome_metric: "cost per qualified customer",
        leading_indicator: "qualified lead rate",
        guardrail_metric: "lead quality and brand safety must not decline",
        baseline_target: "Reduce review prep from 6 hours to 2 hours per week.",
        verification_rules: ["recommendations cite source metrics", "draft claims cite approved evidence"]
      }
    },
    {
      bundleId: "ownership_rollout",
      answers: {
        loop_owner_role: "Growth lead",
        reviewer_roles: ["Marketing lead", "Finance reviewer"],
        escalation_conditions: ["spend change above threshold", "unsupported content claim", "low confidence"],
        initial_autonomy_level: "shadow",
        pilot_scope: "two campaigns and one content channel",
        management_summary: "weekly learning summary"
      }
    }
  ]) {
    session = await submitDiscoveryAnswers({
      projectRoot,
      sessionId: started.id,
      bundleId: item.bundleId,
      answers: item.answers,
      expectedRevision: session.revision,
      actor: "browser"
    });
  }

  return projectRoot;
}
