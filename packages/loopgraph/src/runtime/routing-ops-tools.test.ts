import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  routingCardSchema,
  type EventEnvelope,
  type LoopRunTrace,
  type RouteCommit,
  type RoutingCard
} from "../core";
import { emitLoopRunLifecycleEvent } from "./lifecycle-events";
import {
  bindRoutingLearningContext,
  routingLearningContextDigest,
  unavailableRoutingLearningContext
} from "./routing-learning-context";
import { FileRoutingStore, ingestRoutingEvent, submitRoutingDecision } from "./routing-store";
import {
  loopgraph_events_get,
  loopgraph_graph_get,
  loopgraph_lifecycle_events_get,
  loopgraph_problems_get,
  loopgraph_route_jobs_get,
  loopgraph_routing_evaluations_get,
  loopgraph_routing_decision_get
} from "./routing-ops-tools";

async function createProjectWithAdsSpec(): Promise<{ projectRoot: string; specPath: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-routing-ops-"));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
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
  return { projectRoot, specPath };
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
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe campaign signals." }]
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
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow",
      requiredConnections: ["ads.read"]
    },
    studioExtension: {
      hermesDesign: {
        proposalId: "proposal_marketing_ads",
        connectorRequirements: [{
          capability: "ads.read",
          reason: "Read campaign spend, audience, and creative performance.",
          requiredFor: "routing"
        }]
      }
    }
  };
}

function adsEvent(sourceDeliveryId: string): EventEnvelope {
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
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "campaign", id: "campaign_123" },
    correlationId: "corr_campaign_123",
    normalizedPayload: {
      signals: {
        spendDeltaPct: 18,
        costPerQualifiedCustomerDeltaPct: 31
      }
    },
    trust: { signatureVerified: true, signer: "google_ads", untrustedFields: [] }
  });
}

function adsRoutingCard(): RoutingCard {
  return routingCardSchema.parse({
    schemaVersion: "routing-card/v1alpha1",
    catalogVersion: "catalog_v1",
    loopId: "marketing_ads",
    loopName: "Ads",
    department: "marketing",
    goal: "Improve qualified acquisition efficiency.",
    currentReadiness: "ready",
    loopStatus: "active",
    problemTypes: ["paid_acquisition_efficiency_drop"],
    explicitNonGoals: [],
    accepts: [{
      sourcePattern: "google_ads*",
      eventTypePattern: "campaign.*",
      subjectTypes: ["campaign"],
      requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
    }],
    excludes: [],
    activationMode: "shadow",
    minimumConfidence: 0.8,
    priority: 10,
    fanoutPolicy: { mode: "none", maxRoutes: 1, requiresIndependentProblems: true },
    cooldown: { seconds: 0, dedupeWindowSeconds: 0 },
    concurrency: { maxActive: 1, strategy: "append_evidence" },
    inputMapping: { campaignId: "subject.id" },
    requiredConnections: ["ads.read"],
    currentState: { activeRuns: 0 },
    examples: { shouldRoute: [], shouldNotRoute: [] },
    routingContractVersion: "routing-contract/v1alpha1",
    loopSpecHash: "hash_ads"
  });
}

function completedTraceForCommit(commit: RouteCommit): LoopRunTrace {
  const runId = commit.runId ?? "run_ops_1";
  return {
    id: runId,
    loopId: commit.loopId,
    loopSpecVersion: "1.0.0",
    loopSpecHash: commit.loopSpecHash,
    mode: "simulate",
    status: "COMPLETED",
    trigger: {
      type: "event",
      source: "hermes",
      event: "campaign.performance_anomaly",
      eventId: commit.eventId,
      receivedAt: "2026-07-21T12:00:01.000Z"
    },
    idempotencyKey: `idem_${runId}`,
    contextSnapshot: {
      id: `ctx_${runId}`,
      loopId: commit.loopId,
      loopSpecVersion: "1.0.0",
      createdAt: "2026-07-21T12:03:00.000Z",
      contentHash: "ctx_hash",
      tokenEstimate: 0,
      entries: []
    },
    inputs: [],
    proposedActions: [],
    preparedActions: [],
    toolCalls: [],
    policyDecisions: [],
    verificationResults: [],
    escalationCases: [],
    humanReviews: [],
    outputs: [],
    metrics: [],
    errors: [],
    startedAt: "2026-07-21T12:03:00.000Z",
    completedAt: "2026-07-21T12:03:01.000Z"
  };
}

describe("Hermes routing operations tools", () => {
  it("returns durable events, problems, decisions, and an event-routing graph projection", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-routing-history-"));
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_ops_1");
    const card = routingCardSchema.parse({
      ...adsRoutingCard(),
      activationMode: "simulate"
    });
    await ingestRoutingEvent({
      store,
      event,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const learningContext = unavailableRoutingLearningContext({
      event,
      now: new Date("2026-07-21T12:00:02.000Z"),
      warning: "No prior cross-loop evidence exists yet."
    });
    const learningContextDigest = routingLearningContextDigest(learningContext);
    const decision = await submitRoutingDecision({
      store,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: "catalog_v1",
        action: "route",
        problem: {
          summary: "Campaign efficiency dropped.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: event.subject,
          severity: "medium",
          dedupeKeyInputs: [event.subject.id]
        },
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.91,
          reasonSummary: "The event contains campaign anomaly evidence and qualified-cost deterioration.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 10
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_ops_1" },
        policyVersion: "routing-policy/v1alpha1"
      },
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z"),
      hermesMetadata: { route: "google_ads_detector" },
      learningContextBinding: bindRoutingLearningContext({
        context: learningContext,
        acknowledgedDigest: learningContextDigest,
        boundAt: new Date("2026-07-21T12:00:03.000Z")
      })
    });

    const events = await loopgraph_events_get({ projectRoot, eventId: event.id }, { store });
    expect(events.count).toBe(1);
    expect(events.receipts[0]).toMatchObject({ eventId: event.id, status: "received" });

    const problems = await loopgraph_problems_get({ projectRoot, problemId: decision.problem?.id }, { store });
    expect(problems.count).toBe(1);
    expect(problems.problems[0]).toMatchObject({
      problem: { status: "routed", primaryLoopId: "marketing_ads" },
      routeCommits: [expect.objectContaining({ loopId: "marketing_ads", status: "queued" })]
    });

    const decisions = await loopgraph_routing_decision_get({ projectRoot, eventId: event.id }, { store });
    expect(decisions.count).toBe(1);
    expect(decisions.attempts[0]).toMatchObject({
      attempt: { status: "committed", action: "route" },
      receipt: { eventId: event.id },
      problem: { id: decision.problem?.id },
      routeCommits: [expect.objectContaining({ id: decision.routeCommits[0].id })],
      routeJobs: [expect.objectContaining({ routeCommitId: decision.routeCommits[0].id, status: "queued" })]
    });

    const routeJobs = await loopgraph_route_jobs_get({ projectRoot, eventId: event.id }, { store });
    expect(routeJobs).toMatchObject({
      count: 1,
      jobs: [expect.objectContaining({
        eventId: event.id,
        routeCommitId: decision.routeCommits[0].id,
        loopId: "marketing_ads",
        activationMode: "simulate",
        status: "queued"
      })]
    });
    await store.saveRouterEvaluation({
      id: "evaluation_ops_1",
      fixtureId: "ads_happy",
      eventId: event.id,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      actualAction: "route",
      actualLoopIds: ["marketing_ads"],
      passed: true,
      latencyMs: 12,
      evaluatedAt: "2026-07-21T12:01:00.000Z"
    });
    const evaluations = await loopgraph_routing_evaluations_get({
      projectRoot,
      eventId: event.id,
      passed: true
    }, { store });
    expect(evaluations).toMatchObject({
      count: 1,
      evaluations: [expect.objectContaining({
        fixtureId: "ads_happy",
        eventId: event.id,
        expectedAction: "route",
        actualAction: "route",
        passed: true
      })]
    });
    const routeJob = routeJobs.jobs[0];
    const completedCommit = {
      ...decision.routeCommits[0],
      runId: routeJob.runId,
      status: "completed"
    } satisfies RouteCommit;
    await store.saveRouteCommit(completedCommit);
    const lifecycle = await emitLoopRunLifecycleEvent({
      projectRoot,
      sourceEvent: event,
      routeCommit: completedCommit,
      trace: completedTraceForCommit(completedCommit),
      problem: decision.problem,
      now: new Date("2026-07-21T12:03:02.000Z")
    });
    expect(lifecycle.emitted).toBe(true);

    const lifecycleDeliveries = await loopgraph_lifecycle_events_get({
      projectRoot,
      eventId: event.id
    });
    expect(lifecycleDeliveries).toMatchObject({
      count: 1,
      deliveries: [expect.objectContaining({
        event: expect.objectContaining({
          eventType: "loop.run.completed",
          correlationId: event.correlationId
        }),
        notificationOnly: true,
        target: expect.objectContaining({ routeKey: "loopgraph-lifecycle-events" })
      })]
    });

    const graph = await loopgraph_graph_get({
      projectRoot,
      projection: "event_routing",
      eventId: event.id
    }, {
      store,
      now: new Date("2026-07-21T12:00:04.000Z")
    });

    expect(graph.graphProjection.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "company_brain", label: "Hermes Brain" }),
      expect.objectContaining({ id: `event:${event.id}`, type: "event" }),
      expect.objectContaining({ id: `problem:${decision.problem?.id}`, type: "problem" }),
      expect.objectContaining({ id: `learning:${decision.attempt.id}`, type: "learning_context" }),
      expect.objectContaining({ id: `commit:${decision.routeCommits[0].id}`, type: "route_commit" }),
      expect.objectContaining({ id: `job:${routeJob.id}`, type: "route_job" }),
      expect.objectContaining({ id: `run:${completedCommit.runId}`, type: "loop" }),
      expect.objectContaining({ id: `lifecycle:${lifecycleDeliveries.deliveries[0].event.id}`, type: "event" }),
      expect.objectContaining({ id: "loop:marketing_ads", type: "loop" })
    ]));
    expect(graph.graphProjection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "company_brain", target: `event:${event.id}`, label: "received" }),
      expect.objectContaining({ source: `event:${event.id}`, target: `learning:${decision.attempt.id}`, label: "bounded learning evidence", executable: false }),
      expect.objectContaining({ source: `learning:${decision.attempt.id}`, target: `attempt:${decision.attempt.id}`, label: "advisory evidence used", executable: false }),
      expect.objectContaining({ source: `attempt:${decision.attempt.id}`, target: `commit:${decision.routeCommits[0].id}`, label: "validated route" }),
      expect.objectContaining({ source: `commit:${decision.routeCommits[0].id}`, target: `job:${routeJob.id}`, label: "durable queue" }),
      expect.objectContaining({ source: `job:${routeJob.id}`, target: `run:${completedCommit.runId}`, label: "idempotent run" }),
      expect.objectContaining({ source: `run:${completedCommit.runId}`, target: `lifecycle:${lifecycleDeliveries.deliveries[0].event.id}`, label: "emits" }),
      expect.objectContaining({ source: `lifecycle:${lifecycleDeliveries.deliveries[0].event.id}`, target: "company_brain", label: "signed lifecycle webhook" })
    ]));
  });

  it("returns a design graph with required connection nodes for Hermes Brain visualization", async () => {
    const { projectRoot } = await createProjectWithAdsSpec();

    const graph = await loopgraph_graph_get({
      projectRoot,
      projection: "design",
      includeConnections: true
    }, {
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(graph).toMatchObject({
      schemaVersion: "graph-projection/v1alpha1",
      projection: "design",
      summary: { loopCount: 1 }
    });
    expect(graph.graphProjection.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "company_brain", label: "Hermes Brain" }),
      expect.objectContaining({ id: "department:marketing", label: "Marketing" }),
      expect.objectContaining({ id: "loop:marketing_ads", label: "Ads" }),
      expect.objectContaining({ id: "connection:ads.read", label: "ads.read", type: "connector" })
    ]));
    expect(graph.graphProjection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "company_brain", target: "department:marketing" }),
      expect.objectContaining({ source: "department:marketing", target: "loop:marketing_ads" }),
      expect.objectContaining({ source: "connection:ads.read", target: "loop:marketing_ads", label: "missing connection" })
    ]));
  });
});
