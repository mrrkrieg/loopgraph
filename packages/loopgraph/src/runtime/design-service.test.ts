import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loopDesignProposalSetSchema } from "../core";
import {
  buildLoopDesignContext,
  DeterministicLoopDesignProvider,
  editLoopDesignProposal,
  generateDeterministicLoopDesign,
  generateLoopDesignWithProvider,
  readLoopDesignProposalSet,
  submitLoopDesignProposalSet,
  type LoopDesignProvider,
  validateLoopDesignProposalSet
} from "./design-service";
import {
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-design-"));
}

describe("Loop design service", () => {
  it("builds a bounded marketing design context and deterministic Ads + Content Creation proposals", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();

    const context = await buildLoopDesignContext({ projectRoot, sessionId: "session_design" });

    expect(context).toMatchObject({
      schemaVersion: "loop-design-context/v1alpha1",
      sessionId: "session_design",
      departmentType: "marketing",
      readiness: "ready_for_design",
      blockers: []
    });
    expect(context.confirmedAnswers.length).toBeGreaterThanOrEqual(20);
    expect(context.confirmedAnswers).toContainEqual(expect.objectContaining({
      questionId: "biggest_recurring_problem.problem_signal",
      value: "Campaign spend rises while qualified customer conversion drops."
    }));
    expect(context.departmentBranchQuestions).toContainEqual(expect.stringContaining("paid ads"));
    expect(context.deterministicCandidates.map((candidate) => candidate.name)).toEqual(["Ads", "Content Creation"]);
    expect(context.projectInspection).toMatchObject({
      schemaVersion: "project-inspection/v1alpha1",
      policy: {
        secretsRead: false,
        allowlistedManifestOnly: true
      }
    });
    expect(JSON.stringify(context).toLowerCase()).not.toContain("api_key");
    expect(JSON.stringify(context).toLowerCase()).not.toContain("do-not-read");

    const result = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: "session_design",
      reasoningProfile: "high",
      now: new Date("2026-07-21T12:10:00.000Z")
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.proposalSet?.proposals.map((proposal) => proposal.shortName)).toEqual(["Ads", "Content Creation"]);
    expect(result.proposalSet?.proposals.map((proposal) => proposal.loopSpecId)).toEqual(["marketing_ads", "marketing_content_creation"]);
    expect(result.proposalSet?.proposals[0].routing).toMatchObject({
      problemTypes: ["paid_acquisition_efficiency_drop"],
      activationMode: "shadow",
      minimumConfidence: 0.8,
      ambiguityPolicy: "request_human",
      fanoutPolicy: {
        mode: "independent_only",
        maxRoutes: 2
      },
      cooldown: {
        dedupeWindowSeconds: 3600
      },
      concurrency: {
        strategy: "append_evidence"
      },
      examples: {
        shouldNotRoute: expect.arrayContaining(["test campaigns and already-resolved anomalies"])
      }
    });
    expect(result.proposalSet?.proposals[0].routing.lifecycleEvents).toEqual(expect.arrayContaining([
      "loop.run.completed",
      "loop.review.required",
      "loop.run.failed",
      "loop.outcome.recorded"
    ]));
    expect(result.proposalSet?.proposals[0].assumptions).toEqual(expect.arrayContaining([
      expect.stringContaining("Routing problem signal"),
      expect.stringContaining("Repeat policy")
    ]));
    expect(result.proposalSet?.proposals[1].topologyPreview.edges).toContainEqual(expect.objectContaining({
      source: "company_brain",
      label: "structural",
      executable: false
    }));
    await access(result.designRunPath);
    await access(result.proposalSetPath);
  });

  it("runs an embedded loop design provider through the shared validation and persistence path", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();
    const deterministicProvider = new DeterministicLoopDesignProvider();
    let capturedContextHash: string | undefined;
    let capturedOptions: Parameters<LoopDesignProvider["design"]>[1] | undefined;
    const embeddedProvider: LoopDesignProvider = {
      id: "embedded-loop-designer-test",
      mode: "embedded",
      async design(context, options) {
        capturedContextHash = context.contextHash;
        capturedOptions = options;
        const fallback = await deterministicProvider.design(context, options);
        const proposalSet = loopDesignProposalSetSchema.parse({
          ...(fallback.proposalSet as Record<string, unknown>),
          providerMode: "embedded",
          globalAssumptions: [
            "Embedded provider fixture reused deterministic candidates so this test can focus on provider contract behavior."
          ]
        });
        return {
          proposalSet,
          metadata: {
            providerName: "embedded-openai-test",
            modelIdentifier: "gpt-high-reasoning-test",
            requestedReasoningProfile: options.reasoningProfile,
            actualReasoningProfile: "high",
            adapterConfig: {
              reasoningEffort: "high"
            }
          }
        };
      }
    };

    const result = await generateLoopDesignWithProvider({
      projectRoot,
      sessionId: "session_design",
      provider: embeddedProvider,
      maxProposals: 1,
      reasoningProfile: "high",
      allowNovelDesigns: true,
      redactionPolicy: "bounded_context_without_secrets",
      timeoutMs: 5_000,
      repairAttemptLimit: 3,
      now: new Date("2026-07-21T12:30:00.000Z")
    });

    expect(result.valid).toBe(true);
    expect(capturedContextHash).toBe(result.designRun.inputHash);
    expect(capturedOptions).toMatchObject({
      providerMode: "embedded",
      reasoningProfile: "high",
      maxProposals: 1,
      allowNovelDesigns: true,
      redactionPolicy: "bounded_context_without_secrets",
      timeoutMs: 5_000,
      repairAttemptLimit: 1
    });
    expect(result.designRun).toMatchObject({
      providerMode: "embedded",
      providerName: "embedded-openai-test",
      modelIdentifier: "gpt-high-reasoning-test",
      reasoningProfile: "high",
      finalProposalIds: ["proposal_marketing_ads"]
    });
    expect(result.designRun.metadata).toMatchObject({
      provider: {
        id: "embedded-loop-designer-test",
        mode: "embedded",
        requestedReasoningProfile: "high",
        actualReasoningProfile: "high",
        maxProposals: 1,
        allowNovelDesigns: true,
        redactionPolicy: "bounded_context_without_secrets",
        timeoutMs: 5_000,
        repairAttemptLimit: 1
      },
      providerMetadata: {
        modelIdentifier: "gpt-high-reasoning-test",
        adapterConfig: {
          reasoningEffort: "high"
        }
      },
      proposalCount: 1
    });
    expect(result.proposalSet?.providerMode).toBe("embedded");
    expect(result.proposalSet?.proposals.map((proposal) => proposal.shortName)).toEqual(["Ads"]);
  });

  it("rejects unsafe Hermes-hosted proposal submissions with actionable validation errors", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();
    const context = await buildLoopDesignContext({ projectRoot, sessionId: "session_design" });
    const generated = await generateDeterministicLoopDesign({ projectRoot, sessionId: "session_design" });
    const unsafeProposalSet = loopDesignProposalSetSchema.parse({
      ...generated.proposalSet!,
      proposals: [{
        ...generated.proposalSet!.proposals[1],
        proposalId: "proposal_unsafe_content",
        proposedActions: [{
          key: "publish_content",
          label: "Publish content",
          riskLevel: "high",
          requiresApproval: false,
          customerFacing: true
        }]
      }]
    });

    const validationErrors = validateLoopDesignProposalSet(unsafeProposalSet, context);
    expect(validationErrors).toContain("Proposal proposal_unsafe_content action publish_content requires explicit approval");

    const submitted = await submitLoopDesignProposalSet({
      projectRoot,
      sessionId: "session_design",
      proposalSet: unsafeProposalSet,
      providerName: "hermes",
      modelIdentifier: "high-reasoning-test"
    });

    expect(submitted.valid).toBe(false);
    expect(submitted.errors).toContain("Proposal proposal_unsafe_content action publish_content requires explicit approval");
    expect(submitted.proposalSet).toBeUndefined();
    await access(submitted.designRunPath);
    await access(submitted.proposalSetPath);
  });

  it("edits a proposal as a new validated design run with preserved history", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();
    const generated = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: "session_design",
      now: new Date("2026-07-21T12:10:00.000Z")
    });

    const edited = await editLoopDesignProposal({
      projectRoot,
      designRunId: generated.designRun.id,
      proposalId: "proposal_marketing_content_creation",
      expectedOutputHash: generated.designRun.outputHash,
      editedBy: "browser",
      now: new Date("2026-07-21T12:20:00.000Z"),
      updates: {
        shortName: "Content Engine",
        reviewerRoles: ["Content lead", "Legal reviewer"],
        connectorRequirements: [
          { capability: "content_repository.read", reason: "Read approved briefs and evidence.", requiredFor: "routing" },
          { capability: "content_repository.draft_write", reason: "Write drafts for review without publishing.", requiredFor: "simulation" },
          { capability: "brand_policy.read", reason: "Verify edited claims against the approved brand policy.", requiredFor: "execution" }
        ]
      }
    });

    expect(edited.valid).toBe(true);
    expect(edited.designRun.id).not.toBe(generated.designRun.id);
    expect(edited.designRun.metadata).toMatchObject({
      editOfDesignRunId: generated.designRun.id,
      editedProposalId: "proposal_marketing_content_creation",
      editedFields: ["connectorRequirements", "reviewerRoles", "shortName"]
    });

    const editedProposalSet = await readLoopDesignProposalSet(projectRoot, edited.designRun.id);
    const proposal = editedProposalSet?.proposals.find((item) => item.proposalId === "proposal_marketing_content_creation");
    expect(proposal).toMatchObject({
      shortName: "Content Engine",
      reviewerRoles: ["Content lead", "Legal reviewer"]
    });
    expect(proposal?.routing.requiredConnections).toEqual(expect.arrayContaining([
      "brand_policy.read"
    ]));
    expect(proposal?.topologyPreview.nodes).toContainEqual(expect.objectContaining({
      id: "loop:marketing_content_creation",
      label: "Content Engine"
    }));
  });
});

async function createCompletedMarketingDiscoverySession(): Promise<string> {
  const projectRoot = await temporaryProjectRoot();
  const started = await startHermesDiscoverySession({
    projectRoot,
    sessionId: "session_design",
    companyId: "company_1",
    companyName: "Acme"
  });
  let session = await selectDiscoveryDepartments({
    projectRoot,
    sessionId: started.id,
    departments: ["marketing"],
    expectedRevision: 0
  });

  for (const item of [
    {
      bundleId: "current_stack_sources",
      answers: {
        systems: ["Google Ads", "HubSpot", "Notion"],
        source_of_truth: "HubSpot defines qualified leads and customers.",
        event_sources_subjects: "Hermes receives Google Ads campaign anomaly events keyed by campaign ID.",
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
        problem_signal: "Campaign spend rises while qualified customer conversion drops.",
        required_evidence: ["spend delta", "cost per qualified customer delta", "qualified conversion delta"],
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
        forbidden_actions: ["no unapproved budget changes", "no unapproved publishing", "no unsupported claims"],
        ignore_conditions: ["test campaigns and already-resolved anomalies"],
        ambiguity_policy: "request_human",
        fanout_policy: "independent_only"
      }
    },
    {
      bundleId: "ideal_outcome_proof",
      answers: {
        primary_outcome_metric: "cost per qualified customer",
        leading_indicator: "qualified lead rate",
        guardrail_metric: "lead quality and brand safety must not decline",
        baseline_target: "Reduce review prep from 6 hours to 2 hours per week.",
        verification_rules: ["recommendations cite source metrics", "draft claims cite approved evidence"],
        completion_signal: ["approved recommendation recorded", "draft accepted by reviewer"],
        failure_signal: ["review rejected", "required evidence missing after timeout"]
      }
    },
    {
      bundleId: "ownership_rollout",
      answers: {
        loop_owner_role: "Growth lead",
        reviewer_roles: ["Marketing lead", "Finance reviewer"],
        escalation_conditions: ["spend change above threshold", "unsupported content claim", "low confidence"],
        initial_autonomy_level: "shadow",
        repeat_policy: "append_evidence",
        urgency_priority: "Campaign spend anomalies above threshold win over routine content work.",
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
      expectedRevision: session.revision
    });
  }

  return projectRoot;
}
