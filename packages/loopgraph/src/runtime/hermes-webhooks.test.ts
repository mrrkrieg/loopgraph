import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEventEnvelopeId, eventEnvelopeSchema, LOOPGRAPH_API_VERSION, LOOP_KIND, type EventEnvelope } from "../core";
import {
  doctorHermesWebhookRoutes,
  planHermesWebhookRoutes,
  syncHermesWebhookRoutes,
  testHermesWebhookFixture
} from "./hermes-webhooks";

async function createProjectWithWebhookSpecs(): Promise<{ projectRoot: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-webhooks-"));
  const loopsDir = path.join(projectRoot, "loops");
  await mkdir(loopsDir, { recursive: true });

  const specs = [
    marketingLoopSpec({
      id: "marketing_ads",
      name: "Ads",
      problemType: "paid_acquisition_efficiency_drop",
      sourcePattern: "google_ads*",
      eventTypePattern: "campaign.performance_anomaly",
      subjectType: "campaign",
      requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
    }),
    marketingLoopSpec({
      id: "marketing_ads_budget",
      name: "Ads Budget Watch",
      problemType: "paid_budget_threshold",
      sourcePattern: "google_ads*",
      eventTypePattern: "campaign.budget_alert",
      subjectType: "campaign",
      requiredFields: ["signals.spendDeltaPct"]
    }),
    marketingLoopSpec({
      id: "marketing_content_creation",
      name: "Content Creation",
      problemType: "approved_content_work_item",
      sourcePattern: "notion*",
      eventTypePattern: "content.brief_approved",
      subjectType: "content_brief",
      requiredFields: ["approvedEvidenceRefs", "reviewer"]
    })
  ];

  const registeredSpecs = [];
  for (const spec of specs) {
    const specPath = path.join(loopsDir, `${spec.metadata.id}.loopgraph.json`);
    await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    registeredSpecs.push({
      id: spec.metadata.id,
      name: spec.metadata.name,
      path: path.relative(projectRoot, specPath),
      department: "marketing",
      addedAt: "2026-07-21T12:00:00.000Z"
    });
  }

  await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs
  }, null, 2)}\n`);

  return { projectRoot };
}

function marketingLoopSpec(input: {
  id: string;
  name: string;
  problemType: string;
  sourcePattern: string;
  eventTypePattern: string;
  subjectType: string;
  requiredFields: string[];
}) {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: input.id,
      name: input.name,
      version: "1.0.0",
      description: `${input.name} loop.`
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
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
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe event evidence." }]
    },
    tools: [{ key: "draft_review", adapterId: "manual", label: "Draft review", writeCapable: false, riskLevel: "low" }],
    policy: {
      allowedActions: [{ toolKey: "draft_review", allowed: true, requiresApproval: false, riskLevel: "low" }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["owner"] },
    persistence: { idempotency: { enabled: true } },
    trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
    topology: { department: "marketing" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: [input.problemType],
      accepts: [{
        sourcePattern: input.sourcePattern,
        eventTypePattern: input.eventTypePattern,
        subjectTypes: [input.subjectType],
        requiredFields: input.requiredFields
      }],
      inputMapping: { subjectId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow",
      requiredConnections: []
    }
  };
}

describe("Hermes webhook route planning", () => {
  it("derives one Hermes route per source pattern rather than one route per loop", async () => {
    const { projectRoot } = await createProjectWithWebhookSpecs();

    const plan = await planHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(plan).toMatchObject({
      schemaVersion: "hermes-webhook-plan/v1alpha1",
      summary: {
        routeCount: 3,
        eventFamilyCount: 11,
        loopCount: 3,
        broadRouteCount: 0
      }
    });

    const lifecycleRoute = plan.routes.find((route) => route.routeName === "loopgraph-lifecycle-events");
    expect(lifecycleRoute).toMatchObject({
      routeKind: "loopgraph_lifecycle",
      sourcePattern: "loopgraph",
      eventTypePatterns: [
        "loop.route.accepted",
        "loop.run.started",
        "loop.run.completed",
        "loop.review.required",
        "loop.run.failed",
        "loop.escalation.created",
        "loop.outcome.recorded",
        "loop.problem.unhandled"
      ],
      loopIds: [],
      deliveryMode: "log",
      auth: {
        owner: "hermes",
        secretStorage: "hermes"
      },
      transform: {
        outputSchema: "EventEnvelope",
        dropsRawPayload: true,
        stableDeliveryIdRequired: true
      }
    });
    expect(lifecycleRoute?.restrictedMcpTools).toEqual([
      "loopgraph_events_ingest",
      "loopgraph_events_get",
      "loopgraph_graph_get"
    ]);
    expect(lifecycleRoute?.restrictedMcpTools).not.toContain("loopgraph_routing_decision_submit");

    const googleAdsRoute = plan.routes.find((route) => route.sourcePattern === "google_ads*");
    expect(googleAdsRoute).toMatchObject({
      routeKind: "provider_event",
      routeName: "loopgraph-google-ads-events",
      eventTypePatterns: ["campaign.budget_alert", "campaign.performance_anomaly"],
      loopIds: ["marketing_ads", "marketing_ads_budget"],
      departments: ["marketing"],
      skills: ["loopgraph-event-router"],
      deliveryMode: "log",
      auth: {
        owner: "hermes",
        secretStorage: "hermes"
      },
      transform: {
        outputSchema: "EventEnvelope",
        dropsRawPayload: true,
        stableDeliveryIdRequired: true
      }
    });
    expect(googleAdsRoute?.restrictedMcpTools).toEqual([
      "loopgraph_routing_catalog_get",
      "loopgraph_events_ingest",
      "loopgraph_routing_decision_submit",
      "loopgraph_events_get",
      "loopgraph_problems_get",
      "loopgraph_routing_decision_get",
      "loopgraph_graph_get"
    ]);
    expect(googleAdsRoute?.restrictedMcpTools).not.toContain("loopgraph_loops_materialize");
    expect(googleAdsRoute?.restrictedMcpTools).not.toContain("loopgraph_design_submit");
    expect(googleAdsRoute?.restrictedMcpTools).not.toContain("loopgraph_route_commit_simulate");
    expect(googleAdsRoute?.restrictedMcpTools).not.toContain("loopgraph_route_jobs_get");
    expect(googleAdsRoute?.restrictedMcpTools).not.toContain("loopgraph_routing_evaluations_get");
    expect(googleAdsRoute?.restrictedMcpTools).not.toContain("loopgraph_routing_evaluation_run");
    expect(googleAdsRoute?.restrictedMcpTools).not.toContain("loopgraph_lifecycle_events_get");

    const notionRoute = plan.routes.find((route) => route.sourcePattern === "notion*");
    expect(notionRoute?.eventTypePatterns).toEqual(["content.brief_approved"]);
    expect(plan.nextActions.join(" ")).toContain("do not point providers directly at Loopgraph");
    expect(plan.nextActions.join(" ")).toContain("loopgraph-lifecycle-events");
  });

  it("returns a safe empty plan before routing contracts exist", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-webhooks-empty-"));

    const plan = await planHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(plan.summary.routeCount).toBe(1);
    expect(plan.summary.eventFamilyCount).toBe(8);
    expect(plan.summary.loopCount).toBe(0);
    expect(plan.routes).toEqual([
      expect.objectContaining({
        routeName: "loopgraph-lifecycle-events",
        routeKind: "loopgraph_lifecycle"
      })
    ]);
    expect(plan.nextActions.join(" ")).toContain("loopgraph-lifecycle-events");
    expect(plan.nextActions.join(" ")).toContain("Materialize at least one LoopSpec");
  });

  it("syncs a non-secret Hermes route manifest while preserving unrelated route references", async () => {
    const { projectRoot } = await createProjectWithWebhookSpecs();
    const manifestPath = path.join(projectRoot, ".loopgraph", "hermes-routes.json");
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: "hermes-routes-manifest/v1alpha1",
      managedBy: "loopgraph",
      projectRootHash: "old",
      catalogVersion: "old",
      updatedAt: "2026-07-20T12:00:00.000Z",
      routes: [
        {
          managedBy: "external",
          routeName: "external-slack-alerts",
          routeId: "external_route_1",
          sourcePattern: "slack*",
          eventTypePatterns: ["message.created"],
          token: "should-not-be-preserved"
        },
        {
          managedBy: "loopgraph",
          routeName: "loopgraph-old-provider-events",
          routeId: "old_loopgraph_route",
          sourcePattern: "old_provider*",
          eventTypePatterns: ["old.event"]
        }
      ]
    }, null, 2)}\n`);

    const result = await syncHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:30:00.000Z")
    });

    expect(result).toMatchObject({
      schemaVersion: "hermes-webhook-sync/v1alpha1",
      dryRun: false,
      manifestPath,
      summary: {
        plannedRouteCount: 3,
        syncedRouteCount: 3,
        addedRouteNames: ["loopgraph-google-ads-events", "loopgraph-lifecycle-events", "loopgraph-notion-events"],
        updatedRouteNames: [],
        removedRouteNames: ["loopgraph-old-provider-events"],
        preservedExternalRouteCount: 1
      }
    });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: "hermes-routes-manifest/v1alpha1",
      managedBy: "loopgraph",
      catalogVersion: result.plan.catalogVersion,
      updatedAt: "2026-07-21T12:30:00.000Z"
    });

    const routes = manifest.routes as Array<Record<string, unknown>>;
    expect(routes.map((route) => route.routeName)).toEqual([
      "external-slack-alerts",
      "loopgraph-google-ads-events",
      "loopgraph-lifecycle-events",
      "loopgraph-notion-events"
    ]);
    expect(routes.find((route) => route.routeName === "external-slack-alerts")).toEqual({
      managedBy: "external",
      routeName: "external-slack-alerts",
      routeId: "external_route_1",
      sourcePattern: "slack*",
      eventTypePatterns: ["message.created"]
    });
    expect(routes.find((route) => route.routeName === "loopgraph-google-ads-events")).toMatchObject({
      managedBy: "loopgraph",
      routeKind: "provider_event",
      sourcePattern: "google_ads*",
      loopIds: ["marketing_ads", "marketing_ads_budget"],
      authentication: {
        owner: "hermes",
        secretStoredInLoopgraph: false
      },
      deliveryMode: "log"
    });
    expect(routes.find((route) => route.routeName === "loopgraph-lifecycle-events")).toMatchObject({
      managedBy: "loopgraph",
      routeKind: "loopgraph_lifecycle",
      sourcePattern: "loopgraph",
      eventTypePatterns: [
        "loop.route.accepted",
        "loop.run.started",
        "loop.run.completed",
        "loop.review.required",
        "loop.run.failed",
        "loop.escalation.created",
        "loop.outcome.recorded",
        "loop.problem.unhandled"
      ],
      loopIds: [],
      authentication: {
        owner: "hermes",
        secretStoredInLoopgraph: false
      },
      deliveryMode: "log"
    });
    expect(JSON.stringify(manifest)).not.toContain("should-not-be-preserved");

    const secondSync = await syncHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:31:00.000Z")
    });
    expect(secondSync.summary).toMatchObject({
      plannedRouteCount: 3,
      syncedRouteCount: 3,
      addedRouteNames: [],
      updatedRouteNames: [],
      removedRouteNames: [],
      preservedExternalRouteCount: 1
    });

    const doctor = await doctorHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:32:00.000Z")
    });
    expect(doctor).toMatchObject({
      schemaVersion: "hermes-webhook-doctor/v1alpha1",
      ok: true,
      manifestExists: true,
      summary: {
        plannedRouteCount: 3,
        manifestRouteCount: 3,
        missingRouteNames: [],
        staleRouteNames: [],
        unexpectedManagedRouteNames: [],
        preservedExternalRouteCount: 1
      },
      warnings: []
    });
  });

  it("supports dry-run webhook sync without writing the manifest", async () => {
    const { projectRoot } = await createProjectWithWebhookSpecs();

    const result = await syncHermesWebhookRoutes({
      projectRoot,
      dryRun: true,
      now: new Date("2026-07-21T12:30:00.000Z")
    });

    expect(result.dryRun).toBe(true);
    expect(result.summary.plannedRouteCount).toBe(3);
    await expect(readFile(result.manifestPath, "utf8")).rejects.toThrow();
  });

  it("doctors a missing Hermes route manifest as out of sync", async () => {
    const { projectRoot } = await createProjectWithWebhookSpecs();

    const doctor = await doctorHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:33:00.000Z")
    });

    expect(doctor).toMatchObject({
      ok: false,
      manifestExists: false,
      summary: {
        plannedRouteCount: 3,
        manifestRouteCount: 0,
        missingRouteNames: ["loopgraph-google-ads-events", "loopgraph-lifecycle-events", "loopgraph-notion-events"],
        staleRouteNames: [],
        unexpectedManagedRouteNames: [],
        preservedExternalRouteCount: 0
      }
    });
    expect(doctor.warnings).toEqual(expect.arrayContaining([
      "Hermes route manifest has not been synced yet.",
      "Missing Hermes route manifest entry: loopgraph-google-ads-events.",
      "Missing Hermes route manifest entry: loopgraph-lifecycle-events.",
      "Missing Hermes route manifest entry: loopgraph-notion-events."
    ]));
    expect(doctor.nextActions[0]).toContain("loopgraph hermes webhooks sync");
  });

  it("tests a fixture against the planned Hermes route and local shadow router", async () => {
    const { projectRoot } = await createProjectWithWebhookSpecs();
    await syncHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-21T12:40:00.000Z")
    });
    const fixturePath = path.join(projectRoot, "fixtures", "google-ads-anomaly.json");
    await mkdir(path.dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, `${JSON.stringify(googleAdsAnomalyEvent("delivery_ads_fixture_1"), null, 2)}\n`);

    const result = await testHermesWebhookFixture({
      projectRoot,
      fixture: fixturePath,
      sourcePattern: "google_ads*",
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      requireSyncedManifest: true,
      now: new Date("2026-07-21T12:41:00.000Z")
    });

    expect(result).toMatchObject({
      schemaVersion: "hermes-webhook-fixture-test/v1alpha1",
      valid: true,
      errors: [],
      routePlan: {
        routeCount: 3,
        manifestRequired: true,
        manifestOk: true,
        matchedRoutes: [
          {
            routeName: "loopgraph-google-ads-events",
            sourcePattern: "google_ads*",
            loopIds: ["marketing_ads", "marketing_ads_budget"],
            deliveryMode: "log"
          }
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
        }
      }
    });
    expect(result.nextActions.join(" ")).toContain("passed local Loopgraph shadow routing");
  });

  it("fails fixture testing when a synced manifest is required but missing", async () => {
    const { projectRoot } = await createProjectWithWebhookSpecs();

    const result = await testHermesWebhookFixture({
      projectRoot,
      event: googleAdsAnomalyEvent("delivery_ads_fixture_2"),
      sourcePattern: "google_ads*",
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      requireSyncedManifest: true,
      now: new Date("2026-07-21T12:42:00.000Z")
    });

    expect(result.valid).toBe(false);
    expect(result.routePlan).toMatchObject({
      manifestRequired: true,
      manifestOk: false
    });
    expect(result.errors.join(" ")).toContain("Synced Hermes route manifest is not current");
    expect(result.routing.valid).toBe(true);
  });
});

function googleAdsAnomalyEvent(sourceDeliveryId: string): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "google_ads_detector",
    sourceDeliveryId,
    eventType: "campaign.performance_anomaly"
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.google_ads_detector",
    occurredAt: "2026-07-21T12:39:00.000Z",
    receivedAt: "2026-07-21T12:39:01.000Z",
    subject: { type: "campaign", id: "campaign_123", display: "Campaign 123" },
    correlationId: `corr_${sourceDeliveryId}`,
    normalizedPayload: {
      signals: {
        spendDeltaPct: 18,
        costPerQualifiedCustomerDeltaPct: 31
      }
    },
    trust: { signatureVerified: true, signer: "google_ads", untrustedFields: [] }
  });
}
