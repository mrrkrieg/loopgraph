import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LoopSpec } from "../core";
import { generateDeterministicLoopDesign } from "./design-service";
import {
  confirmDiscoveryProjectContext,
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";
import { evaluateLiveExecutionGate } from "./executor";
import {
  syncHermesWebhookRoutes,
  testHermesWebhookFixture
} from "./hermes-webhooks";
import { loadLoopSpecFromPath } from "./loader";
import {
  listLoopgraphLoops,
  materializeAcceptedLoopDesignProposals
} from "./loop-materialization";
import { loopgraph_graph_get } from "./routing-ops-tools";
import { loopgraph_routing_catalog_get } from "./routing-tools";

type PublishedExampleFixture = {
  session: {
    sessionId: string;
    companyId: string;
    companyName: string;
    createdByActor: "hermes";
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
    department: string;
    activationMode: string;
    problemTypes: string[];
    sourcePattern: string;
    eventTypePattern: string;
    requiredApprovalActions?: string[];
    blockedActionFragments?: string[];
  };
};

describe("published Hermes example flows", () => {
  it("publishes a sensitive Legal / Compliance example that stays strictly blocked from live execution", async () => {
    const fixture = await loadPublishedExample("sensitive-legal-reference-flow.json");
    const result = await materializePublishedExample(fixture);
    const proposal = result.design.proposalSet!.proposals[0]!;
    const loop = result.materialized.materializedLoops[0]!;
    const spec = await loadMaterializedSpec(loop.specPath);

    expect(proposal).toMatchObject({
      proposalId: "proposal_legal_compliance_evidence_review",
      loopSpecId: "legal_compliance_evidence_review",
      shortName: "Legal / Compliance Evidence Review",
      department: "legal_compliance",
      readinessTarget: "simulation_ready",
      rolloutStage: "shadow",
      routing: {
        problemTypes: ["legal_compliance_review_required"],
        accepts: [
          expect.objectContaining({
            sourcePattern: "vanta*",
            eventTypePattern: "questionnaire.*",
            subjectTypes: ["compliance_request"],
            requiredFields: expect.arrayContaining([
              "approvedSourceRefs",
              "expertReviewer",
              "redactionConfirmed"
            ])
          })
        ],
        ambiguityPolicy: "request_human",
        fanoutPolicy: {
          mode: "none",
          maxRoutes: 1
        },
        concurrency: {
          maxActive: 1,
          strategy: "reject"
        },
        activationMode: "shadow",
        minimumConfidence: 0.9
      }
    });
    expect(proposal.assumptions.join("\n")).toContain("capped at shadow");
    expect(proposal.proposedActions).toEqual([
      expect.objectContaining({
        key: "draft_compliance_evidence_packet",
        riskLevel: "medium",
        requiresApproval: true,
        customerFacing: false
      }),
      expect.objectContaining({
        key: "draft_external_questionnaire_answer",
        riskLevel: "critical",
        requiresApproval: true,
        customerFacing: true
      })
    ]);
    for (const fragment of fixture.expected.blockedActionFragments ?? []) {
      expect(proposal.forbiddenActions.join("\n").toLowerCase()).toContain(fragment.toLowerCase());
    }

    expect(spec).toMatchObject({
      metadata: {
        id: "legal_compliance_evidence_review",
        labels: {
          department: "legal_compliance",
          rolloutStage: "shadow"
        }
      },
      trigger: {
        source: "hermes",
        type: "event",
        event: "legal-compliance-review-required"
      },
      approval: {
        requireFingerprintMatch: true,
        separateCustomerFacingApproval: true
      },
      routing: {
        activationMode: "shadow",
        problemTypes: ["legal_compliance_review_required"],
        requiredConnections: expect.arrayContaining([
          "policy_repository.read",
          "compliance_evidence.read",
          "contract_repository.read"
        ])
      }
    });
    expect(spec.policy.allowedActions).toEqual([
      expect.objectContaining({
        toolKey: "draft_compliance_evidence_packet",
        requiresApproval: true,
        riskLevel: "medium"
      }),
      expect.objectContaining({
        toolKey: "draft_external_questionnaire_answer",
        requiresApproval: true,
        customerFacing: true,
        riskLevel: "critical"
      })
    ]);

    const gate = await evaluateLiveExecutionGate({
      spec,
      projectRoot: result.projectRoot,
      now: new Date("2026-07-21T13:00:00.000Z")
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "activation_mode_not_live",
      "connection_not_ready_for_live_execution"
    ]));
    expect(gate.requiredActions.join("\n")).toContain("Keep routing through Hermes in local simulation");

    await assertPublishedExampleRoutesThroughHermes({
      projectRoot: result.projectRoot,
      loopId: "legal_compliance_evidence_review",
      fixturePath: loop.simulation.starterFixtures[0]!.path,
      sourcePattern: "vanta*",
      expectedRouteName: "loopgraph-vanta-events"
    });
  });

  it("publishes a custom department example with a custom-app Hermes webhook route", async () => {
    const fixture = await loadPublishedExample("custom-ops-reference-flow.json");
    const result = await materializePublishedExample(fixture);
    const proposal = result.design.proposalSet!.proposals[0]!;
    const loop = result.materialized.materializedLoops[0]!;
    const spec = await loadMaterializedSpec(loop.specPath);

    expect(proposal).toMatchObject({
      proposalId: "proposal_custom_operating_loop",
      loopSpecId: "custom_operating_loop",
      department: "custom",
      rolloutStage: "recommend",
      trigger: {
        type: "event"
      },
      routing: {
        problemTypes: ["custom_recurring_work"],
        accepts: [
          expect.objectContaining({
            sourcePattern: "custom_app*",
            eventTypePattern: "custom_work_item.*",
            subjectTypes: ["work_item"],
            requiredFields: ["summary"]
          })
        ],
        activationMode: "recommend"
      }
    });
    expect(spec).toMatchObject({
      metadata: {
        id: "custom_operating_loop",
        labels: {
          department: "custom",
          rolloutStage: "recommend"
        }
      },
      trigger: {
        source: "hermes",
        type: "event",
        event: "custom-recurring-work"
      },
      routing: {
        activationMode: "recommend",
        problemTypes: ["custom_recurring_work"]
      }
    });

    const loops = await listLoopgraphLoops({ projectRoot: result.projectRoot });
    expect(loops.graphProjection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "company_brain",
        target: "department:custom",
        label: "routes business problems"
      }),
      expect.objectContaining({
        source: "department:custom",
        target: "loop:custom_operating_loop",
        label: "workflow loop"
      })
    ]));

    await assertPublishedExampleRoutesThroughHermes({
      projectRoot: result.projectRoot,
      loopId: "custom_operating_loop",
      fixturePath: loop.simulation.starterFixtures[0]!.path,
      sourcePattern: "custom_app*",
      expectedRouteName: "loopgraph-custom-app-events"
    });
  });
});

async function materializePublishedExample(fixture: PublishedExampleFixture) {
  const projectRoot = await temporaryProjectRoot();
  await writeProjectFiles(projectRoot, fixture);

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

  const design = await generateDeterministicLoopDesign({
    projectRoot,
    sessionId: started.id,
    maxProposals: 1,
    reasoningProfile: "high",
    now: new Date("2026-07-21T12:10:00.000Z")
  });
  expect(design.valid).toBe(true);
  expect(design.proposalSet!.proposals.map((proposal) => proposal.proposalId)).toEqual(fixture.expected.proposalIds);
  expect(design.proposalSet!.proposals.map((proposal) => proposal.loopSpecId)).toEqual(fixture.expected.loopSpecIds);

  const materialized = await materializeAcceptedLoopDesignProposals({
    projectRoot,
    designRunId: design.designRun.id,
    acceptedProposalIds: fixture.expected.proposalIds,
    acceptedBy: "hermes",
    now: new Date("2026-07-21T12:20:00.000Z")
  });
  expect(materialized).toMatchObject({
    valid: true,
    workspace: {
      registeredSpecCount: 1,
      registeredDepartments: [fixture.expected.department],
      routingReadySpecCount: 1
    }
  });

  const catalog = await loopgraph_routing_catalog_get({ projectRoot });
  expect(catalog.routingCards).toEqual([
    expect.objectContaining({
      loopId: fixture.expected.loopSpecIds[0],
      department: fixture.expected.department,
      activationMode: fixture.expected.activationMode,
      problemTypes: fixture.expected.problemTypes,
      accepts: [
        expect.objectContaining({
          sourcePattern: fixture.expected.sourcePattern,
          eventTypePattern: fixture.expected.eventTypePattern
        })
      ]
    })
  ]);

  const designGraph = await loopgraph_graph_get({
    projectRoot,
    projection: "design",
    includeConnections: true
  });
  expect(designGraph.graphProjection.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "company_brain", label: "Hermes Brain" }),
    expect.objectContaining({ id: `department:${fixture.expected.department}` }),
    expect.objectContaining({ id: `loop:${fixture.expected.loopSpecIds[0]}` })
  ]));

  return { projectRoot, design, materialized };
}

async function assertPublishedExampleRoutesThroughHermes(input: {
  projectRoot: string;
  loopId: string;
  fixturePath: string;
  sourcePattern: string;
  expectedRouteName: string;
}) {
  const sync = await syncHermesWebhookRoutes({
    projectRoot: input.projectRoot,
    now: new Date("2026-07-21T12:30:00.000Z")
  });
  expect(sync.summary.syncedRouteCount).toBe(2);
  expect(sync.plan.routes.map((route) => route.routeName)).toEqual(expect.arrayContaining([
    input.expectedRouteName,
    "loopgraph-lifecycle-events"
  ]));

  const fixtureTest = await testHermesWebhookFixture({
    projectRoot: input.projectRoot,
    fixture: input.fixturePath,
    sourcePattern: input.sourcePattern,
    expectedAction: "route",
    expectedLoopIds: [input.loopId],
    requireSyncedManifest: true,
    now: new Date("2026-07-21T12:31:00.000Z")
  });
  expect(fixtureTest).toMatchObject({
    valid: true,
    routePlan: {
      manifestRequired: true,
      manifestOk: true,
      matchedRoutes: [
        expect.objectContaining({
          routeName: input.expectedRouteName,
          loopIds: [input.loopId],
          deliveryMode: "log"
        })
      ]
    },
    routing: {
      valid: true,
      comparison: {
        expectedAction: "route",
        expectedLoopIds: [input.loopId],
        actualAction: "route",
        actualLoopIds: [input.loopId],
        passed: true
      },
      submission: expect.objectContaining({
        valid: true,
        routeCommits: [
          expect.objectContaining({
            loopId: input.loopId,
            status: "shadow"
          })
        ],
        routeJobs: []
      })
    }
  });
}

async function loadPublishedExample(fileName: string): Promise<PublishedExampleFixture> {
  return JSON.parse(await readFile(
    new URL(`./fixtures/${fileName}`, import.meta.url),
    "utf8"
  )) as PublishedExampleFixture;
}

async function loadMaterializedSpec(specPath: string): Promise<LoopSpec> {
  const loaded = await loadLoopSpecFromPath(specPath);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
  return loaded.spec;
}

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-hermes-published-examples-"));
}

async function writeProjectFiles(projectRoot: string, fixture: PublishedExampleFixture): Promise<void> {
  const packageJson = fixture.project.files.find((file) => file.path === "package.json");
  if (!packageJson) throw new Error("Published example fixture must include package.json");
  await writeFile(path.join(projectRoot, "package.json"), `${JSON.stringify(packageJson.json, null, 2)}\n`);
}
