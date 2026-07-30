import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessProblemSchema,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  routingCardSchema,
  type EventEnvelope,
  type RoutingDecision,
  type RoutingCard
} from "../core";
import {
  cancelRouteJob,
  FileRoutingStore,
  claimDueRouteJobs,
  failRouteJob,
  ingestRoutingEvent,
  markRouteJobCompleted,
  markRouteJobRunning,
  submitRoutingDecision
} from "./routing-store";

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
    requiredConnections: ["ads.read", "crm.read"],
    currentState: { activeRuns: 0 },
    examples: { shouldRoute: [], shouldNotRoute: [] },
    routingContractVersion: "routing-contract/v1alpha1",
    loopSpecHash: "hash_ads"
  });
}

function adsRouteDecision(event: EventEnvelope, overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
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
    modelMetadata: { hermesTaskId: "task_1" },
    policyVersion: "routing-policy/v1alpha1",
    ...overrides
  };
}

async function tempStore(): Promise<FileRoutingStore> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "loopgraph-routing-store-"));
  return new FileRoutingStore(rootDir);
}

async function tempStoreRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-routing-store-"));
}

describe("routing store", () => {
  it("persists receipts before returning eligible routing cards", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_1");

    const result = await ingestRoutingEvent({
      store,
      event,
      routingCards: [adsRoutingCard()],
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    expect(result.duplicate).toBe(false);
    expect(result.receipt.status).toBe("received");
    expect(result.eligibleRoutes.map((route) => route.card.loopId)).toEqual(["marketing_ads"]);

    const persisted = await store.getEventReceipt(event.id);
    expect(persisted?.eventHash).toBe(result.receipt.eventHash);
  });

  it("dedupes provider retries and does not return routing candidates twice", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_2");

    await ingestRoutingEvent({
      store,
      event,
      routingCards: [adsRoutingCard()],
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const duplicate = await ingestRoutingEvent({
      store,
      event,
      routingCards: [adsRoutingCard()],
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.receipt.status).toBe("duplicate");
    expect(duplicate.eligibleRoutes).toEqual([]);
  });

  it("uses a store-level atomic receipt boundary to suppress concurrent deliveries", async () => {
    const fileStore = await tempStore();
    let primaryReceipt: Awaited<ReturnType<typeof fileStore.getEventReceipt>> = null;
    const store = Object.assign(fileStore, {
      async createEventReceiptAtomically(receipt: NonNullable<typeof primaryReceipt>) {
        if (primaryReceipt) return { receipt: primaryReceipt, created: false };
        primaryReceipt = receipt;
        await fileStore.saveEventReceipt(receipt);
        return { receipt, created: true };
      }
    });
    const event = adsEvent("delivery_atomic");

    const [first, second] = await Promise.all([
      ingestRoutingEvent({
        store,
        event,
        routingCards: [adsRoutingCard()],
        now: new Date("2026-07-21T12:00:02.000Z")
      }),
      ingestRoutingEvent({
        store,
        event,
        routingCards: [adsRoutingCard()],
        now: new Date("2026-07-21T12:00:03.000Z")
      })
    ]);

    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    expect(first.eligibleRoutes.length + second.eligibleRoutes.length).toBe(1);
  });

  it("returns matching open business problems as append-evidence candidates", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_3");
    await store.saveBusinessProblem(businessProblemSchema.parse({
      id: "problem_1",
      workspaceId: event.workspaceId,
      companyId: event.companyId,
      problemType: "paid_acquisition_efficiency_drop",
      subject: event.subject,
      summary: "Campaign efficiency dropped.",
      severity: "medium",
      status: "in_progress",
      correlationId: event.correlationId,
      dedupeKey: "problem_campaign_123",
      evidenceEventIds: ["older_event"],
      routeCommitIds: [],
      openedAt: "2026-07-21T11:00:00.000Z",
      updatedAt: "2026-07-21T11:30:00.000Z"
    }));

    const result = await ingestRoutingEvent({
      store,
      event,
      routingCards: [adsRoutingCard()],
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    expect(result.openProblemCandidates.map((problem) => problem.id)).toEqual(["problem_1"]);
  });

  it("stores explicit replay receipts without replacing the original receipt", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_4");

    await ingestRoutingEvent({
      store,
      event,
      routingCards: [adsRoutingCard()],
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const replay = await ingestRoutingEvent({
      store,
      event,
      routingCards: [adsRoutingCard()],
      replay: true,
      now: new Date("2026-07-21T12:05:00.000Z")
    });

    const receipts = await store.listEventReceipts();

    expect(replay.receipt.status).toBe("replayed");
    expect(receipts.map((receipt) => receipt.status).sort()).toEqual(["received", "replayed"]);
  });

  it("commits a valid Hermes route decision into a durable problem and route binding", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_decision_1");
    const card = adsRoutingCard();
    await ingestRoutingEvent({
      store,
      event,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    const result = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(event),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z"),
      hermesMetadata: { route: "google_ads_detector" }
    });

    expect(result.valid).toBe(true);
    expect(result.problem?.status).toBe("routed");
    expect(result.problem?.primaryLoopId).toBe("marketing_ads");
    expect(result.routeCommits).toHaveLength(1);
    expect(result.routeCommits[0]).toMatchObject({
      eventId: event.id,
      loopId: "marketing_ads",
      loopSpecHash: "hash_ads",
      status: "shadow",
      inputMapping: { campaignId: "campaign_123" }
    });

    const commits = await store.listRouteCommits(result.problem?.id);
    expect(commits.map((commit) => commit.id)).toEqual([result.routeCommits[0].id]);
  });

  it("rejects Hermes route decisions that try to inject or contradict loop inputs", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_mapping_1");
    const card = adsRoutingCard();
    await ingestRoutingEvent({
      store,
      event,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    const result = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(event, {
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.91,
          reasonSummary: "The event contains campaign anomaly evidence and qualified-cost deterioration.",
          evidenceRefs: [],
          inputMapping: {
            campaignId: "campaign_999",
            approveBudgetIncrease: true
          },
          priority: 10
        }]
      }),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(result.valid).toBe(false);
    expect(result.validationErrors).toEqual(expect.arrayContaining([
      "Selected loop \"marketing_ads\" inputMapping for \"campaignId\" does not match the deterministic event mapping",
      "Selected loop \"marketing_ads\" inputMapping contains undeclared target \"approveBudgetIncrease\""
    ]));
    expect(await store.listRouteCommits()).toEqual([]);
    expect(await store.listRouteJobs()).toEqual([]);
  });

  it("creates restart-safe route jobs for accepted non-shadow routes without duplicating work", async () => {
    const rootDir = await tempStoreRoot();
    const store = new FileRoutingStore(rootDir);
    const event = adsEvent("delivery_job_1");
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

    const result = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(event),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(result.valid).toBe(true);
    expect(result.routeCommits).toHaveLength(1);
    expect(result.routeCommits[0]).toMatchObject({
      status: "queued",
      runId: expect.stringMatching(/^run_/)
    });
    expect(result.routeJobs).toEqual([
      expect.objectContaining({
        schemaVersion: "route-job/v1alpha1",
        eventId: event.id,
        problemId: result.problem?.id,
        routeCommitId: result.routeCommits[0].id,
        loopId: "marketing_ads",
        loopSpecHash: "hash_ads",
        runId: result.routeCommits[0].runId,
        activationMode: "simulate",
        status: "queued",
        correlationId: event.correlationId,
        attemptCount: 0,
        maxAttempts: 3,
        nextRunAt: "2026-07-21T12:00:03.000Z"
      })
    ]);

    const restartedStore = new FileRoutingStore(rootDir);
    expect(await restartedStore.listRouteJobs({ routeCommitId: result.routeCommits[0].id })).toEqual(result.routeJobs);

    const repeated = await submitRoutingDecision({
      store: restartedStore,
      decision: adsRouteDecision(event),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:04.000Z")
    });

    expect(repeated.valid).toBe(true);
    expect(repeated.routeCommits[0].id).toBe(result.routeCommits[0].id);
    expect(repeated.routeJobs[0].id).toBe(result.routeJobs[0].id);
    expect(await restartedStore.listRouteJobs({ eventId: event.id })).toHaveLength(1);
  });

  it("claims, runs, completes, retries, and dead-letters durable route jobs with leases", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_job_2");
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
    const result = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(event),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });
    const jobId = result.routeJobs[0].id;

    const claimed = await claimDueRouteJobs({
      store,
      claimedBy: "worker_1",
      leaseSeconds: 60,
      now: new Date("2026-07-21T12:00:04.000Z")
    });
    expect(claimed).toEqual([
      expect.objectContaining({
        id: jobId,
        status: "claimed",
        attemptCount: 1,
        lease: expect.objectContaining({
          claimedBy: "worker_1",
          claimedAt: "2026-07-21T12:00:04.000Z",
          expiresAt: "2026-07-21T12:01:04.000Z"
        })
      })
    ]);
    await expect(claimDueRouteJobs({
      store,
      claimedBy: "worker_2",
      now: new Date("2026-07-21T12:00:30.000Z")
    })).resolves.toEqual([]);
    await expect(cancelRouteJob({
      store,
      jobId,
      cancelledBy: "operator_1",
      reason: "Stop the job while another worker owns it",
      now: new Date("2026-07-21T12:00:30.000Z")
    })).rejects.toThrow(/actively leased by worker_1/);

    const running = await markRouteJobRunning({
      store,
      jobId,
      now: new Date("2026-07-21T12:00:05.000Z")
    });
    expect(running.status).toBe("running");
    const completed = await markRouteJobCompleted({
      store,
      jobId,
      now: new Date("2026-07-21T12:00:06.000Z")
    });
    expect(completed).toMatchObject({ status: "completed", lease: undefined });

    const secondEvent = eventEnvelopeSchema.parse({
      ...adsEvent("delivery_job_3"),
      subject: { type: "campaign", id: "campaign_456" },
      correlationId: "corr_campaign_456"
    });
    await ingestRoutingEvent({
      store,
      event: secondEvent,
      routingCards: [card],
      now: new Date("2026-07-21T12:10:02.000Z")
    });
    const secondResult = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(secondEvent, {
        problem: {
          summary: "A separate campaign efficiency drop.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: { type: "campaign", id: "campaign_456" },
          severity: "medium",
          dedupeKeyInputs: ["campaign_456"]
        },
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.91,
          reasonSummary: "A second campaign anomaly needs its own job.",
          evidenceRefs: [],
          inputMapping: { campaignId: "campaign_456" },
          priority: 10
        }]
      }),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:10:03.000Z")
    });
    const retryJobId = secondResult.routeJobs[0].id;
    await claimDueRouteJobs({
      store,
      claimedBy: "worker_1",
      now: new Date("2026-07-21T12:10:04.000Z")
    });
    const firstFailure = await failRouteJob({
      store,
      jobId: retryJobId,
      error: { code: "SIM_FAILED", message: "Simulation failed." },
      now: new Date("2026-07-21T12:10:05.000Z")
    });
    expect(firstFailure).toMatchObject({
      status: "failed",
      attemptCount: 1,
      nextRunAt: "2026-07-21T12:10:35.000Z",
      lastError: {
        code: "SIM_FAILED",
        message: "Simulation failed.",
        at: "2026-07-21T12:10:05.000Z"
      }
    });
    await claimDueRouteJobs({
      store,
      claimedBy: "worker_1",
      now: new Date("2026-07-21T12:10:35.000Z")
    });
    const secondFailure = await failRouteJob({
      store,
      jobId: retryJobId,
      error: { message: "Still failing." },
      now: new Date("2026-07-21T12:10:36.000Z")
    });
    expect(secondFailure).toMatchObject({
      status: "failed",
      attemptCount: 2,
      nextRunAt: "2026-07-21T12:11:36.000Z"
    });
    await claimDueRouteJobs({
      store,
      claimedBy: "worker_1",
      now: new Date("2026-07-21T12:11:36.000Z")
    });
    const deadLetter = await failRouteJob({
      store,
      jobId: retryJobId,
      error: { message: "Maximum retries reached." },
      now: new Date("2026-07-21T12:11:37.000Z")
    });

    expect(deadLetter).toMatchObject({
      status: "dead_letter",
      attemptCount: 3,
      deadLetterReason: "Maximum retries reached."
    });
  });

  it("rejects forged and stale Hermes route decisions before creating commits", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_decision_2");
    const card = adsRoutingCard();
    await ingestRoutingEvent({
      store,
      event,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    const result = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(event, {
        catalogVersion: "catalog_old",
        selectedRoutes: [{
          loopId: "unknown_loop",
          role: "primary",
          confidence: 0.99,
          reasonSummary: "A forged loop ID.",
          evidenceRefs: [],
          inputMapping: {},
          priority: 0
        }]
      }),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(result.valid).toBe(false);
    expect(result.validationErrors).toEqual(expect.arrayContaining([
      "Routing decision catalogVersion is stale",
      "Selected loop \"unknown_loop\" is not in the routing catalog"
    ]));
    expect(await store.listRouteCommits()).toEqual([]);
    expect(await store.listBusinessProblems()).toEqual([]);
  });

  it("requires repeated evidence for an open routed problem to append instead of creating duplicate work", async () => {
    const store = await tempStore();
    const card = adsRoutingCard();
    const firstEvent = adsEvent("delivery_repeat_1");
    const secondEvent = adsEvent("delivery_repeat_2");

    await ingestRoutingEvent({
      store,
      event: firstEvent,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const firstDecision = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(firstEvent),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    await ingestRoutingEvent({
      store,
      event: secondEvent,
      routingCards: [card],
      now: new Date("2026-07-21T12:05:02.000Z")
    });
    const duplicateWork = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(secondEvent),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:05:03.000Z")
    });

    expect(duplicateWork.valid).toBe(false);
    expect(duplicateWork.validationErrors[0]).toContain("append evidence instead");

    const appended = await submitRoutingDecision({
      store,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: secondEvent.id,
        catalogVersion: "catalog_v1",
        action: "append_evidence",
        existingProblemId: firstDecision.problem?.id,
        selectedRoutes: [],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_2" },
        policyVersion: "routing-policy/v1alpha1"
      },
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:05:04.000Z")
    });

    expect(appended.valid).toBe(true);
    expect(appended.routeCommits).toEqual([]);
    expect(appended.problem?.evidenceEventIds).toEqual([firstEvent.id, secondEvent.id]);
    expect(await store.listRouteCommits(firstDecision.problem?.id)).toHaveLength(1);
  });

  it("rejects appending evidence to an open problem for a different subject", async () => {
    const store = await tempStore();
    const card = adsRoutingCard();
    const firstEvent = adsEvent("delivery_subject_1");
    const otherSubjectEvent = eventEnvelopeSchema.parse({
      ...adsEvent("delivery_subject_2"),
      subject: { type: "campaign", id: "campaign_999" },
      correlationId: "corr_campaign_999"
    });

    await ingestRoutingEvent({
      store,
      event: firstEvent,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const firstDecision = await submitRoutingDecision({
      store,
      decision: adsRouteDecision(firstEvent),
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    await ingestRoutingEvent({
      store,
      event: otherSubjectEvent,
      routingCards: [card],
      now: new Date("2026-07-21T12:10:02.000Z")
    });
    const appended = await submitRoutingDecision({
      store,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: otherSubjectEvent.id,
        catalogVersion: "catalog_v1",
        action: "append_evidence",
        existingProblemId: firstDecision.problem?.id,
        selectedRoutes: [],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_wrong_subject_append" },
        policyVersion: "routing-policy/v1alpha1"
      },
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:10:03.000Z")
    });

    expect(appended.valid).toBe(false);
    expect(appended.validationErrors).toContain(`Existing problem "${firstDecision.problem?.id}" does not match this event subject`);
    expect(await store.listRouteCommits(firstDecision.problem?.id)).toHaveLength(1);
    const problem = firstDecision.problem?.id ? await store.getBusinessProblem(firstDecision.problem.id) : undefined;
    expect(problem?.evidenceEventIds).toEqual([firstEvent.id]);
  });

  it("persists human-choice routing decisions as needs-human business problems", async () => {
    const store = await tempStore();
    const event = adsEvent("delivery_human_1");
    const card = adsRoutingCard();
    await ingestRoutingEvent({
      store,
      event,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    const result = await submitRoutingDecision({
      store,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: "catalog_v1",
        action: "request_human",
        problem: {
          summary: "Campaign performance changed, but the correct owner is ambiguous.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: event.subject,
          severity: "medium",
          dedupeKeyInputs: [event.subject.id]
        },
        selectedRoutes: [],
        alternatives: [{
          loopId: "marketing_ads",
          confidence: 0.62,
          reasonSummary: "Likely ads, but confidence is below the routing threshold."
        }],
        modelMetadata: { hermesTaskId: "task_3" },
        policyVersion: "routing-policy/v1alpha1"
      },
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(result.valid).toBe(true);
    expect(result.problem?.status).toBe("needs_human");
    expect(result.humanChoiceAlternatives.map((alternative) => alternative.loopId)).toEqual(["marketing_ads"]);
    expect(result.routeCommits).toEqual([]);
  });
});
