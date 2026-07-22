import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BusinessDiscoverySession, LoopDesignProposalSet, LoopSpec } from "../core";
import { buildLoopDesignContext, generateDeterministicLoopDesign } from "./design-service";
import {
  confirmDiscoveryProjectContext,
  getDiscoverySession,
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";
import { loadLoopSpecFromPath } from "./loader";
import {
  listLoopgraphLoops,
  materializeAcceptedLoopDesignProposals,
  type LoopMaterializationResult
} from "./loop-materialization";
import { loopgraph_routing_catalog_get } from "./routing-tools";

type GoldenReferenceFlow = {
  schemaVersion: "golden-marketing-reference-flow/v1alpha1";
  session: {
    sessionId: string;
    companyId: string;
    companyName: string;
    createdByActor: "browser" | "hermes" | "cli" | "api";
  };
  project: {
    displayName: string;
    description: string;
    customerType: string;
    primaryGoal: string;
    northStarMetric: string;
    sourceOfTruth: string;
    additionalTools: string[];
    files: Array<{
      path: string;
      json: unknown;
    }>;
  };
  department: string;
  bundles: Array<{
    bundleId: string;
    answers: Record<string, unknown>;
  }>;
  expected: {
    proposalIds: string[];
    loopSpecIds: string[];
    graphEdges: Array<[string, string]>;
    starterFixtures: string[];
  };
};

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-golden-marketing-"));
}

describe("golden Hermes Marketing reference flow", () => {
  it("captures the reference session, proposal, LoopSpec, topology, and fixture snapshots", async () => {
    const fixture = await loadGoldenReferenceFlow();
    const projectRoot = await temporaryProjectRoot();
    await writeProjectFixtureFiles(projectRoot, fixture);

    const started = await startHermesDiscoverySession({
      projectRoot,
      sessionId: fixture.session.sessionId,
      companyId: fixture.session.companyId,
      companyName: fixture.session.companyName,
      createdByActor: fixture.session.createdByActor,
      now: new Date("2026-07-21T12:00:00.000Z")
    });
    const confirmed = await confirmDiscoveryProjectContext({
      projectRoot,
      sessionId: started.id,
      expectedRevision: started.revision,
      displayName: fixture.project.displayName,
      companyDescription: fixture.project.description,
      customerType: fixture.project.customerType,
      primaryGoal: fixture.project.primaryGoal,
      northStarMetric: fixture.project.northStarMetric,
      sourceOfTruth: fixture.project.sourceOfTruth,
      additionalTools: fixture.project.additionalTools,
      confirmedStack: true,
      actor: "hermes",
      now: new Date("2026-07-21T12:01:00.000Z")
    });
    let session = await selectDiscoveryDepartments({
      projectRoot,
      sessionId: started.id,
      departments: [fixture.department],
      activeDepartment: fixture.department,
      expectedRevision: confirmed.session.revision,
      actor: "hermes",
      now: new Date("2026-07-21T12:02:00.000Z")
    });

    for (const [index, bundle] of fixture.bundles.entries()) {
      session = await submitDiscoveryAnswers({
        projectRoot,
        sessionId: started.id,
        bundleId: bundle.bundleId,
        answers: bundle.answers,
        expectedRevision: session.revision,
        actor: "hermes",
        now: new Date(`2026-07-21T12:0${index + 3}:00.000Z`)
      });
    }

    const completedSession = await getDiscoverySession(started.id, projectRoot);
    expect(completedSession).toBeTruthy();
    expect(snapshotSession(completedSession!)).toMatchInlineSnapshot(`
      {
        "activeDepartmentId": "marketing",
        "activeStage": "design_context",
        "answeredBundles": [
          "current_stack_sources",
          "biggest_recurring_problem",
          "automation_boundaries",
          "ideal_outcome_proof",
          "ownership_rollout",
        ],
        "companyTools": [
          "Google Ads",
          "HubSpot",
          "JavaScript/TypeScript",
          "Next.js",
          "Notion",
          "PostHog",
          "React",
          "Slack",
          "Supabase",
          "Webflow",
        ],
        "createdByActor": "hermes",
        "projectProfile": {
          "confirmedByUser": true,
          "datastores": [
            "Supabase",
          ],
          "detectedIntegrationHints": [
            "PostHog",
            "Supabase",
          ],
          "displayName": "Golden Marketing App",
          "frameworks": [
            "Next.js",
            "React",
          ],
          "languages": [
            "JavaScript/TypeScript",
          ],
          "repoType": "application",
        },
        "revision": 7,
        "selectedDepartmentIds": [
          "marketing",
        ],
      }
    `);

    const designContext = await buildLoopDesignContext({
      projectRoot,
      sessionId: fixture.session.sessionId
    });
    expect(snapshotDesignContext(designContext)).toMatchInlineSnapshot(`
      {
        "blockers": [],
        "confirmedQuestionIds": [
          "project_context.detected_stack",
          "project_context.source_of_truth",
          "current_stack_sources.systems",
          "current_stack_sources.source_of_truth",
          "current_stack_sources.event_sources_subjects",
          "current_stack_sources.safe_reads",
          "current_stack_sources.manual_fallbacks",
          "current_stack_sources.existing_automations",
          "biggest_recurring_problem.processes",
          "biggest_recurring_problem.trigger_or_cadence",
          "biggest_recurring_problem.problem_signal",
          "biggest_recurring_problem.required_evidence",
          "biggest_recurring_problem.weekly_volume",
          "biggest_recurring_problem.current_owner",
          "biggest_recurring_problem.current_steps",
          "biggest_recurring_problem.pain_type_severity",
          "biggest_recurring_problem.baseline",
          "automation_boundaries.desired_automation_mode",
          "automation_boundaries.candidate_outputs_actions",
          "automation_boundaries.read_write_boundary",
          "automation_boundaries.customer_facing_status",
          "automation_boundaries.forbidden_actions",
          "automation_boundaries.ignore_conditions",
          "automation_boundaries.ambiguity_policy",
          "automation_boundaries.fanout_policy",
          "ideal_outcome_proof.primary_outcome_metric",
          "ideal_outcome_proof.leading_indicator",
          "ideal_outcome_proof.guardrail_metric",
          "ideal_outcome_proof.baseline_target",
          "ideal_outcome_proof.verification_rules",
          "ideal_outcome_proof.completion_signal",
          "ideal_outcome_proof.failure_signal",
          "ownership_rollout.loop_owner_role",
          "ownership_rollout.reviewer_roles",
          "ownership_rollout.escalation_conditions",
          "ownership_rollout.initial_autonomy_level",
          "ownership_rollout.repeat_policy",
          "ownership_rollout.urgency_priority",
          "ownership_rollout.pilot_scope",
          "ownership_rollout.management_summary",
        ],
        "departmentType": "marketing",
        "deterministicCandidates": [
          {
            "id": "marketing_ads",
            "name": "Ads",
            "requiredCapabilities": [
              "ads.read",
              "crm.read",
              "analytics.read",
            ],
          },
          {
            "id": "marketing_content_creation",
            "name": "Content Creation",
            "requiredCapabilities": [
              "content_repository.read",
              "content_repository.draft_write",
              "cms.draft",
            ],
          },
        ],
        "readiness": "ready_for_design",
      }
    `);

    const design = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: fixture.session.sessionId,
      maxProposals: 2,
      reasoningProfile: "high",
      now: new Date("2026-07-21T12:10:00.000Z")
    });
    expect(design.valid).toBe(true);
    expect(design.proposalSet).toBeTruthy();
    expect(snapshotProposalSet(design.proposalSet!)).toMatchInlineSnapshot(`
      {
        "proposals": [
          {
            "connectorRequirements": [
              "ads.read:routing",
              "crm.read:execution",
              "analytics.read:execution",
            ],
            "forbiddenActions": [
              "no unapproved budget changes",
              "no unapproved publishing",
              "no unsupported claims",
              "no customer sends",
            ],
            "loopSpecId": "marketing_ads",
            "minimumConfidence": 0.8,
            "problemTypes": [
              "paid_acquisition_efficiency_drop",
            ],
            "proposalId": "proposal_marketing_ads",
            "requiredFromUser": [
              "Connect ads read data or provide fixture export",
              "Connect qualified outcome source or provide manual CSV",
              "Confirm spend-change approval threshold",
            ],
            "routing": {
              "ambiguityPolicy": "request_human",
              "fanoutPolicy": "independent_only",
              "repeatPolicy": "append_evidence",
            },
            "shortName": "Ads",
            "topologyEdges": [
              "company_brain->department:marketing:structural",
              "department:marketing->loop:marketing_ads:workflow",
              "connector:ads_platform->loop:marketing_ads:required data",
              "connector:crm->loop:marketing_ads:required data",
            ],
          },
          {
            "connectorRequirements": [
              "content_repository.read:routing",
              "content_repository.draft_write:simulation",
              "cms.draft:execution",
            ],
            "forbiddenActions": [
              "no unapproved budget changes",
              "no unapproved publishing",
              "no unsupported claims",
              "no customer sends",
            ],
            "loopSpecId": "marketing_content_creation",
            "minimumConfidence": 0.75,
            "problemTypes": [
              "approved_content_work_item",
            ],
            "proposalId": "proposal_marketing_content_creation",
            "requiredFromUser": [
              "Connect content repository or use local Markdown",
              "Confirm claims and brand review rules",
              "Assign reviewer",
            ],
            "routing": {
              "ambiguityPolicy": "request_human",
              "fanoutPolicy": "independent_only",
              "repeatPolicy": "append_evidence",
            },
            "shortName": "Content Creation",
            "topologyEdges": [
              "company_brain->department:marketing:structural",
              "department:marketing->loop:marketing_content_creation:workflow",
              "connector:content_repository->loop:marketing_content_creation:required data",
              "connector:cms_draft->loop:marketing_content_creation:required data",
            ],
          },
        ],
        "providerMode": "deterministic",
        "reasoningProfile": "high",
        "valid": true,
      }
    `);

    expect(design.proposalSet!.proposals.map((proposal) => proposal.proposalId)).toEqual(fixture.expected.proposalIds);
    expect(design.proposalSet!.proposals.map((proposal) => proposal.loopSpecId)).toEqual(fixture.expected.loopSpecIds);

    const materialized = await materializeAcceptedLoopDesignProposals({
      projectRoot,
      designRunId: design.designRun.id,
      acceptedProposalIds: fixture.expected.proposalIds,
      acceptedBy: "hermes",
      now: new Date("2026-07-21T12:20:00.000Z")
    });
    expect(materialized.valid).toBe(true);
    expect(snapshotMaterialization(materialized)).toMatchInlineSnapshot(`
      {
        "graphEdges": [
          "company_brain->department:marketing:structural:false",
          "department:marketing->loop:marketing_ads:workflow:false",
          "connector:ads_platform->loop:marketing_ads:required data:false",
          "connector:crm->loop:marketing_ads:required data:false",
          "department:marketing->loop:marketing_content_creation:workflow:false",
          "connector:content_repository->loop:marketing_content_creation:required data:false",
          "connector:cms_draft->loop:marketing_content_creation:required data:false",
        ],
        "graphNodes": [
          "company_brain:Hermes Brain:company_brain",
          "department:marketing:Marketing:department",
          "loop:marketing_ads:Ads:loop",
          "connector:ads_platform:Ads platform:connector",
          "connector:crm:CRM:connector",
          "loop:marketing_content_creation:Content Creation:loop",
          "connector:content_repository:Content repository:connector",
          "connector:cms_draft:CMS draft:connector",
        ],
        "loops": [
          {
            "loopId": "marketing_ads",
            "relativeSpecPath": ".loopgraph/generated/hermes/marketing/marketing_ads/loopgraph.yaml",
            "routingProblemTypes": [
              "paid_acquisition_efficiency_drop",
            ],
            "starterFixtures": [
              "happy-path",
              "missing-context",
              "risk-escalation",
            ],
            "status": "created",
          },
          {
            "loopId": "marketing_content_creation",
            "relativeSpecPath": ".loopgraph/generated/hermes/marketing/marketing_content_creation/loopgraph.yaml",
            "routingProblemTypes": [
              "approved_content_work_item",
            ],
            "starterFixtures": [
              "happy-path",
              "missing-context",
              "risk-escalation",
            ],
            "status": "created",
          },
        ],
        "workspace": {
          "registeredDepartments": [
            "marketing",
          ],
          "registeredSpecCount": 2,
          "routingReadySpecCount": 2,
        },
      }
    `);

    const loadedSpecs = await Promise.all(materialized.materializedLoops.map(async (loop) => {
      const loaded = await loadLoopSpecFromPath(loop.specPath);
      expect(loaded.ok).toBe(true);
      return (loaded as { ok: true; spec: LoopSpec }).spec;
    }));
    expect(snapshotLoopSpecs(loadedSpecs)).toMatchInlineSnapshot(`
      [
        {
          "approval": {
            "requireFingerprintMatch": true,
            "separateCustomerFacingApproval": true,
          },
          "id": "marketing_ads",
          "name": "Ads",
          "routing": {
            "accepts": [
              "google_ads*|campaign.*|campaign|signals.spendDeltaPct,signals.costPerQualifiedCustomerDeltaPct",
            ],
            "activationMode": "shadow",
            "excludes": [
              "*|content.*|content_brief",
            ],
            "minimumConfidence": 0.8,
            "problemTypes": [
              "paid_acquisition_efficiency_drop",
            ],
            "requiredConnections": [
              "ads.read",
              "crm.read",
              "analytics.read",
            ],
          },
          "trigger": {
            "event": "paid-acquisition-efficiency-drop",
            "source": "hermes",
            "type": "event",
          },
        },
        {
          "approval": {
            "requireFingerprintMatch": true,
            "separateCustomerFacingApproval": true,
          },
          "id": "marketing_content_creation",
          "name": "Content Creation",
          "routing": {
            "accepts": [
              "notion*|content.*|content_brief|approvedEvidenceRefs,reviewer",
            ],
            "activationMode": "shadow",
            "excludes": [
              "google_ads*|campaign.*|campaign",
            ],
            "minimumConfidence": 0.75,
            "problemTypes": [
              "approved_content_work_item",
            ],
            "requiredConnections": [
              "content_repository.read",
              "content_repository.draft_write",
              "cms.draft",
            ],
          },
          "trigger": {
            "event": "approved-content-work-item",
            "source": "hermes",
            "type": "event",
          },
        },
      ]
    `);

    const catalog = await loopgraph_routing_catalog_get({ projectRoot });
    const loops = await listLoopgraphLoops({ projectRoot });
    expect(catalog.routingCards.map((card) => card.loopId)).toEqual(fixture.expected.loopSpecIds);
    expect(loops.graphProjection.edges.map((edge) => [edge.source, edge.target])).toEqual(fixture.expected.graphEdges);
    expect(materialized.materializedLoops.flatMap((loop) =>
      loop.simulation.starterFixtures.map((starter) => starter.id)
    )).toEqual([
      ...fixture.expected.starterFixtures,
      ...fixture.expected.starterFixtures
    ]);
  });
});

async function loadGoldenReferenceFlow(): Promise<GoldenReferenceFlow> {
  return JSON.parse(await readFile(
    new URL("./fixtures/golden-marketing-reference-flow.json", import.meta.url),
    "utf8"
  )) as GoldenReferenceFlow;
}

async function writeProjectFixtureFiles(projectRoot: string, fixture: GoldenReferenceFlow): Promise<void> {
  for (const file of fixture.project.files) {
    const filePath = path.join(projectRoot, file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(file.json, null, 2)}\n`);
  }
}

function snapshotSession(session: BusinessDiscoverySession) {
  return {
    createdByActor: session.createdByActor,
    activeStage: session.activeStage,
    selectedDepartmentIds: session.selectedDepartmentIds,
    activeDepartmentId: session.activeDepartmentId,
    revision: session.revision,
    projectProfile: session.projectProfile ? {
      displayName: session.projectProfile.displayName,
      repoType: session.projectProfile.repoType,
      languages: session.projectProfile.languages,
      frameworks: session.projectProfile.frameworks,
      datastores: session.projectProfile.datastores,
      detectedIntegrationHints: session.projectProfile.detectedIntegrationHints,
      confirmedByUser: session.projectProfile.confirmedByUser
    } : undefined,
    companyTools: [...(session.companyProfile?.tools ?? [])].sort(),
    answeredBundles: session.questionQueue
      .filter((item) => item.status === "answered")
      .map((item) => item.bundleId)
  };
}

function snapshotDesignContext(context: Awaited<ReturnType<typeof buildLoopDesignContext>>) {
  return {
    departmentType: context.departmentType,
    readiness: context.readiness,
    blockers: context.blockers,
    confirmedQuestionIds: context.confirmedAnswers.map((answer) => answer.questionId),
    deterministicCandidates: context.deterministicCandidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      requiredCapabilities: candidate.requiredCapabilities
    }))
  };
}

function snapshotProposalSet(proposalSet: LoopDesignProposalSet) {
  return {
    providerMode: proposalSet.providerMode,
    reasoningProfile: proposalSet.reasoningProfile,
    valid: proposalSet.validationSummary.valid,
    proposals: proposalSet.proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      loopSpecId: proposal.loopSpecId,
      shortName: proposal.shortName,
      problemTypes: proposal.routing.problemTypes,
      minimumConfidence: proposal.routing.minimumConfidence,
      routing: {
        ambiguityPolicy: proposal.routing.ambiguityPolicy,
        fanoutPolicy: proposal.routing.fanoutPolicy.mode,
        repeatPolicy: proposal.routing.concurrency.strategy
      },
      connectorRequirements: proposal.connectorRequirements.map((requirement) =>
        `${requirement.capability}:${requirement.requiredFor}`
      ),
      requiredFromUser: proposal.requiredFromUser.map((item) => item.label),
      forbiddenActions: proposal.forbiddenActions,
      topologyEdges: proposal.topologyPreview.edges.map((edge) =>
        `${edge.source}->${edge.target}:${edge.label}`
      )
    }))
  };
}

function snapshotMaterialization(result: LoopMaterializationResult) {
  return {
    loops: result.materializedLoops.map((loop) => ({
      loopId: loop.loopId,
      status: loop.status,
      relativeSpecPath: loop.relativeSpecPath,
      routingProblemTypes: loop.routingCard.problemTypes,
      starterFixtures: loop.simulation.starterFixtures.map((fixture) => fixture.id)
    })),
    graphNodes: result.graphProjection.nodes.map((node) =>
      `${node.id}:${node.label}:${node.type}`
    ),
    graphEdges: result.graphProjection.edges.map((edge) =>
      `${edge.source}->${edge.target}:${edge.label}:${edge.executable}`
    ),
    workspace: result.workspace
  };
}

function snapshotLoopSpecs(specs: LoopSpec[]) {
  return specs.map((spec) => ({
    id: spec.metadata.id,
    name: spec.metadata.name,
    trigger: spec.trigger,
    approval: {
      requireFingerprintMatch: spec.approval.requireFingerprintMatch,
      separateCustomerFacingApproval: spec.approval.separateCustomerFacingApproval
    },
    routing: spec.routing ? {
      problemTypes: spec.routing.problemTypes,
      accepts: spec.routing.accepts.map((accept) =>
        `${accept.sourcePattern}|${accept.eventTypePattern}|${accept.subjectTypes.join(",")}|${accept.requiredFields.join(",")}`
      ),
      excludes: spec.routing.excludes.map((exclude) =>
        `${exclude.sourcePattern}|${exclude.eventTypePattern}|${exclude.subjectTypes.join(",")}`
      ),
      requiredConnections: spec.routing.requiredConnections,
      minimumConfidence: spec.routing.minimumConfidence,
      activationMode: spec.routing.activationMode
    } : undefined
  }));
}
