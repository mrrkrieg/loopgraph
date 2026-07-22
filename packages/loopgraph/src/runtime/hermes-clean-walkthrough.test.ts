import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOOPGRAPH_MCP_STATIC_RESOURCE_URIS, listLoopgraphMcpTools } from "../mcp/server";
import {
  buildLoopDesignContext,
  generateDeterministicLoopDesign
} from "./design-service";
import {
  confirmDiscoveryProjectContext,
  getDiscoverySession,
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";
import {
  doctorHermesIntegration,
  HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
  installHermesIntegration
} from "./hermes-install";
import {
  doctorHermesWebhookRoutes,
  planHermesWebhookRoutes,
  syncHermesWebhookRoutes,
  testHermesWebhookFixture
} from "./hermes-webhooks";
import {
  listLoopgraphLoops,
  materializeAcceptedLoopDesignProposals
} from "./loop-materialization";
import {
  getLoopRunsForHermes,
  simulateLoopForHermes,
  validateLoopForHermes
} from "./loop-tools";
import { loopgraph_graph_get } from "./routing-ops-tools";
import { loopgraph_routing_catalog_get } from "./routing-tools";
import { prepareLoopgraphStudio } from "./studio";

type CleanWalkthroughFixture = {
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
  };
};

describe("clean local Hermes walkthrough", () => {
  it("starts from a plain project, installs Hermes, creates Marketing loops, syncs webhooks, routes through Hermes, and runs locally", async () => {
    const fixture = await loadCleanWalkthroughFixture();
    const projectRoot = await temporaryProjectRoot();
    await writePlainProjectFiles(projectRoot, fixture);

    const install = await installHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "node_modules", ".bin", "loopgraph"),
      nodeCommand: process.execPath,
      now: new Date("2026-07-21T12:00:00.000Z")
    });
    expect(install.firstPrompt).toBe("/loopgraph design automations for a department");
    expect(install.mcpServer.tools).toEqual(HERMES_LOOPGRAPH_MCP_TOOL_NAMES);

    const doctor = await doctorHermesIntegration({
      projectRoot,
      hermesVersionCheck: async () => "hermes 1.0.0"
    });
    expect(doctor).toMatchObject({
      ok: true,
      installed: true,
      hermesAvailable: true,
      mcp: {
        ok: true,
        tools: HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
        resources: expect.arrayContaining([...LOOPGRAPH_MCP_STATIC_RESOURCE_URIS]),
        workspaceOk: true,
        catalogOk: true
      },
      warnings: []
    });

    const adminToolNames = listLoopgraphMcpTools().map((tool) => tool.name);
    const webhookRouterToolNames = listLoopgraphMcpTools({ exposure: "webhook_router" }).map((tool) => tool.name);
    expect(adminToolNames).toEqual(HERMES_LOOPGRAPH_MCP_TOOL_NAMES);
    expect(webhookRouterToolNames).toEqual([
      "loopgraph_routing_catalog_get",
      "loopgraph_events_ingest",
      "loopgraph_routing_decision_submit",
      "loopgraph_events_get",
      "loopgraph_problems_get",
      "loopgraph_routing_decision_get",
      "loopgraph_graph_get"
    ]);
    expect(webhookRouterToolNames).not.toContain("loopgraph_events_replay");
    expect(webhookRouterToolNames).not.toContain("loopgraph_route_commit_simulate");
    expect(webhookRouterToolNames).not.toContain("loopgraph_loops_simulate");

    const studio = await prepareLoopgraphStudio({
      projectRoot,
      appRoot: process.cwd(),
      host: "127.0.0.1",
      port: 3477,
      now: new Date("2026-07-21T12:00:30.000Z")
    });
    expect(studio).toMatchObject({
      canStart: true,
      url: "http://127.0.0.1:3477/brain",
      start: {
        cwd: process.cwd(),
        env: {
          LOOPGRAPH_PROJECT_ROOT: projectRoot
        }
      }
    });

    const started = await startHermesDiscoverySession({
      projectRoot,
      sessionId: fixture.session.sessionId,
      companyId: fixture.session.companyId,
      companyName: fixture.session.companyName,
      createdByActor: fixture.session.createdByActor,
      now: new Date("2026-07-21T12:01:00.000Z")
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
      now: new Date("2026-07-21T12:02:00.000Z")
    });
    let session = await selectDiscoveryDepartments({
      projectRoot,
      sessionId: started.id,
      departments: [fixture.department],
      activeDepartment: fixture.department,
      expectedRevision: confirmed.session.revision,
      actor: "hermes",
      now: new Date("2026-07-21T12:03:00.000Z")
    });

    for (const [index, bundle] of fixture.bundles.entries()) {
      session = await submitDiscoveryAnswers({
        projectRoot,
        sessionId: started.id,
        bundleId: bundle.bundleId,
        answers: bundle.answers,
        expectedRevision: session.revision,
        actor: "hermes",
        now: new Date(`2026-07-21T12:${String(index + 4).padStart(2, "0")}:00.000Z`)
      });
    }
    expect(session).toMatchObject({
      createdByActor: "hermes",
      activeStage: "design_context",
      selectedDepartmentIds: ["marketing"],
      activeDepartmentId: "marketing",
      status: "recommendations_ready"
    });

    const designContext = await buildLoopDesignContext({
      projectRoot,
      sessionId: started.id
    });
    expect(designContext).toMatchObject({
      readiness: "ready_for_design",
      departmentType: "marketing",
      blockers: [],
      outputSchema: {
        privateReasoningAllowed: false
      }
    });
    expect(designContext.confirmedAnswers.map((answer) => answer.questionId)).toEqual(expect.arrayContaining([
      "current_stack_sources.systems",
      "biggest_recurring_problem.problem_signal",
      "automation_boundaries.ambiguity_policy",
      "ideal_outcome_proof.verification_rules",
      "ownership_rollout.loop_owner_role"
    ]));

    const design = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: started.id,
      maxProposals: 2,
      reasoningProfile: "high",
      now: new Date("2026-07-21T12:10:00.000Z")
    });
    expect(design.valid).toBe(true);
    expect(design.proposalSet).toMatchObject({
      providerMode: "deterministic",
      reasoningProfile: "high",
      validationSummary: {
        valid: true,
        errors: []
      },
      proposals: [
        expect.objectContaining({
          proposalId: "proposal_marketing_ads",
          loopSpecId: "marketing_ads",
          shortName: "Ads",
          topologyPreview: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ id: "company_brain", label: "Hermes Brain" }),
              expect.objectContaining({ id: "department:marketing", label: "Marketing" }),
              expect.objectContaining({ id: "loop:marketing_ads", label: "Ads" })
            ])
          }),
          routing: expect.objectContaining({
            problemTypes: ["paid_acquisition_efficiency_drop"],
            ambiguityPolicy: "request_human",
            minimumConfidence: 0.8,
            activationMode: "shadow"
          })
        }),
        expect.objectContaining({
          proposalId: "proposal_marketing_content_creation",
          loopSpecId: "marketing_content_creation",
          shortName: "Content Creation",
          routing: expect.objectContaining({
            problemTypes: ["approved_content_work_item"],
            ambiguityPolicy: "request_human",
            activationMode: "shadow"
          })
        })
      ]
    });

    const materialized = await materializeAcceptedLoopDesignProposals({
      projectRoot,
      designRunId: design.designRun.id,
      acceptedProposalIds: fixture.expected.proposalIds,
      acceptedBy: "hermes",
      now: new Date("2026-07-21T12:20:00.000Z")
    });
    expect(materialized).toMatchObject({
      valid: true,
      acceptedProposalIds: fixture.expected.proposalIds,
      workspace: {
        registeredSpecCount: 2,
        registeredDepartments: ["marketing"],
        routingReadySpecCount: 2
      }
    });
    expect(materialized.materializedLoops.map((loop) => ({
      loopId: loop.loopId,
      relativeSpecPath: loop.relativeSpecPath,
      starterFixtures: loop.simulation.starterFixtures.map((fixtureRef) => fixtureRef.id)
    }))).toEqual([
      {
        loopId: "marketing_ads",
        relativeSpecPath: ".loopgraph/generated/hermes/marketing/marketing_ads/loopgraph.yaml",
        starterFixtures: ["happy-path", "missing-context", "risk-escalation"]
      },
      {
        loopId: "marketing_content_creation",
        relativeSpecPath: ".loopgraph/generated/hermes/marketing/marketing_content_creation/loopgraph.yaml",
        starterFixtures: ["happy-path", "missing-context", "risk-escalation"]
      }
    ]);

    const loops = await listLoopgraphLoops({ projectRoot });
    expect(loops.graphProjection.nodes.map((node) => `${node.id}:${node.label}`)).toEqual(expect.arrayContaining([
      "company_brain:Hermes Brain",
      "department:marketing:Marketing",
      "loop:marketing_ads:Ads",
      "loop:marketing_content_creation:Content Creation"
    ]));
    expect(loops.graphProjection.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label}`)).toEqual(expect.arrayContaining([
      "company_brain->department:marketing:routes business problems",
      "department:marketing->loop:marketing_ads:workflow loop",
      "department:marketing->loop:marketing_content_creation:workflow loop"
    ]));

    const designGraph = await loopgraph_graph_get({
      projectRoot,
      projection: "design",
      includeConnections: true
    }, {
      now: new Date("2026-07-21T12:21:00.000Z")
    });
    expect(designGraph.summary).toMatchObject({
      loopCount: 2
    });
    expect(designGraph.graphProjection.edges.map((edge) => edge.label)).toEqual(expect.arrayContaining([
      "routes business problems",
      "workflow loop",
      "manual fallback"
    ]));

    const catalog = await loopgraph_routing_catalog_get({ projectRoot });
    expect(catalog.routingCards.map((card) => card.loopId)).toEqual(fixture.expected.loopSpecIds);
    const adsCard = catalog.routingCards.find((card) => card.loopId === "marketing_ads");
    expect(adsCard).toBeTruthy();
    expect(adsCard).toMatchObject({
      loopId: "marketing_ads",
      loopName: "Ads",
      activationMode: "shadow",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [
        expect.objectContaining({
          sourcePattern: "google_ads*"
        })
      ]
    });

    const webhookPlan = await planHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:22:00.000Z")
    });
    expect(webhookPlan.summary).toMatchObject({
      loopCount: 2,
      routeCount: 3
    });
    expect(webhookPlan.routes.map((route) => route.routeName)).toEqual([
      "loopgraph-google-ads-events",
      "loopgraph-lifecycle-events",
      "loopgraph-notion-events"
    ]);
    for (const route of webhookPlan.routes) {
      expect(route.auth).toMatchObject({
        owner: "hermes",
        secretStorage: "hermes"
      });
      expect(route.skills).toEqual(["loopgraph-event-router"]);
      expect(route.deliveryMode).toBe("log");
      expect(route.configPreview.deliver).toBe("log");
      expect(route.restrictedMcpTools).not.toContain("loopgraph_route_commit_simulate");
    }
    expect(JSON.stringify(webhookPlan).toLowerCase()).not.toMatch(/api[_-]?key|secret_value|token/);

    const webhookSync = await syncHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:23:00.000Z")
    });
    expect(webhookSync).toMatchObject({
      dryRun: false,
      summary: {
        plannedRouteCount: 3,
        syncedRouteCount: 3,
        preservedExternalRouteCount: 0
      }
    });
    const webhookDoctor = await doctorHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:24:00.000Z")
    });
    expect(webhookDoctor).toMatchObject({
      ok: true,
      manifestExists: true,
      summary: {
        plannedRouteCount: 3,
        manifestRouteCount: 3,
        missingRouteNames: [],
        staleRouteNames: [],
        unexpectedManagedRouteNames: []
      }
    });

    const adsLoop = materialized.materializedLoops.find((loop) => loop.loopId === "marketing_ads");
    const happyPathFixture = adsLoop?.simulation.starterFixtures.find((fixtureRef) => fixtureRef.id === "happy-path");
    expect(happyPathFixture).toBeTruthy();
    const generatedFixture = JSON.parse(await readFile(happyPathFixture!.path, "utf8")) as Record<string, unknown>;
    expect(generatedFixture).toMatchObject({
      synthetic: true,
      loopId: "marketing_ads",
      trigger: {
        schemaVersion: "event-envelope/v1alpha1",
        sourceRoute: "hermes.google_ads",
        trust: {
          signer: "synthetic-fixture"
        }
      }
    });

    const webhookFixtureTest = await testHermesWebhookFixture({
      projectRoot,
      fixture: happyPathFixture!.path,
      sourcePattern: adsCard!.accepts[0]!.sourcePattern,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      requireSyncedManifest: true,
      now: new Date("2026-07-21T12:25:00.000Z")
    });
    expect(webhookFixtureTest).toMatchObject({
      valid: true,
      routePlan: {
        manifestRequired: true,
        manifestOk: true,
        matchedRoutes: [
          expect.objectContaining({
            routeName: "loopgraph-google-ads-events",
            loopIds: ["marketing_ads"]
          })
        ]
      },
      routing: {
        valid: true,
        comparison: {
          expectedAction: "route",
          expectedLoopIds: ["marketing_ads"],
          actualAction: "route",
          actualLoopIds: ["marketing_ads"],
          passed: true
        },
        decision: expect.objectContaining({
          action: "route",
          modelMetadata: expect.objectContaining({
            hermesRole: "company_brain"
          })
        }),
        submission: expect.objectContaining({
          valid: true,
          routeCommits: [
            expect.objectContaining({
              loopId: "marketing_ads",
              status: "shadow"
            })
          ],
          routeJobs: []
        })
      }
    });

    const eventRoutingGraph = await loopgraph_graph_get({
      projectRoot,
      projection: "event_routing",
      eventId: webhookFixtureTest.event.id
    }, {
      now: new Date("2026-07-21T12:26:00.000Z")
    });
    expect(eventRoutingGraph.graphProjection.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "company_brain",
      `source:${webhookFixtureTest.event.source}`,
      `event:${webhookFixtureTest.event.id}`,
      "loop:marketing_ads"
    ]));
    expect(eventRoutingGraph.graphProjection.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label}`)).toEqual(expect.arrayContaining([
      `source:${webhookFixtureTest.event.source}->company_brain:webhook to Hermes`,
      `company_brain->event:${webhookFixtureTest.event.id}:received`,
      `event:${webhookFixtureTest.event.id}->attempt:${webhookFixtureTest.routing.submission!.attempt.id}:Hermes decision`
    ]));

    const validation = await validateLoopForHermes({
      projectRoot,
      loopId: "marketing_ads"
    });
    expect(validation).toMatchObject({
      valid: true,
      loopId: "marketing_ads",
      routing: {
        ready: true,
        problemTypes: ["paid_acquisition_efficiency_drop"],
        activationMode: "shadow"
      },
      fixtures: [
        { id: "happy-path", path: "fixtures/happy-path.json" },
        { id: "missing-context", path: "fixtures/missing-context.json" },
        { id: "risk-escalation", path: "fixtures/risk-escalation.json" }
      ]
    });

    const simulation = await simulateLoopForHermes({
      projectRoot,
      loopId: "marketing_ads",
      fixturePath: happyPathFixture!.path
    });
    expect(simulation).toMatchObject({
      valid: true,
      loopId: "marketing_ads",
      status: "WAITING_FOR_REVIEW",
      reviewRequired: true
    });
    const runs = await getLoopRunsForHermes({
      projectRoot,
      loopId: "marketing_ads",
      includeReviewPacket: true
    });
    expect(runs).toMatchObject({
      count: 1,
      runs: [
        expect.objectContaining({
          runId: simulation.runId,
          loopId: "marketing_ads",
          trigger: expect.objectContaining({
            source: "hermes"
          }),
          reviewPacket: expect.objectContaining({
            runId: simulation.runId
          })
        })
      ]
    });

    const finalSession = await getDiscoverySession(started.id, projectRoot);
    expect(finalSession?.createdLoopIds).toEqual(["marketing_ads", "marketing_content_creation"]);
  });
});

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-hermes-clean-walkthrough-"));
}

async function loadCleanWalkthroughFixture(): Promise<CleanWalkthroughFixture> {
  return JSON.parse(await readFile(
    new URL("./fixtures/golden-marketing-reference-flow.json", import.meta.url),
    "utf8"
  )) as CleanWalkthroughFixture;
}

async function writePlainProjectFiles(projectRoot: string, fixture: CleanWalkthroughFixture): Promise<void> {
  const packageJson = fixture.project.files.find((file) => file.path === "package.json");
  if (!packageJson) throw new Error("Clean walkthrough fixture must include package.json");
  await writeFile(path.join(projectRoot, "package.json"), `${JSON.stringify(packageJson.json, null, 2)}\n`);
}
