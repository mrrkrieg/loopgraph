import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  compileRoutingCardFromLoopSpec,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  validateLoopSpec,
  type EventEnvelope,
  type LoopSpec,
  type RoutingDecision
} from "../core";
import { FileStorageAdapter } from "../sdk/storage";
import { FileOutcomeStore } from "./outcome-store";
import { FileHermesOperationsStore } from "./hermes-operations-store";
import { applyReviewDecision } from "./review-service";
import { runRouteJobWorker } from "./route-job-worker";
import {
  FileRoutingStore,
  cancelRouteJob,
  claimDueRouteJobs,
  claimWaitingReviewRouteJobs,
  ingestRoutingEvent,
  markRouteJobCompleted,
  submitRoutingDecision
} from "./routing-store";
import { simulateLoop } from "./simulator";
import { initLoopgraphWorkspace, writeLoopgraphWorkspace } from "./workspace";

describe("route job worker", () => {
  it("dispatches live work to a healthy Hermes agent without executing it inside Loopgraph", async () => {
    const fixture = await createWorkerFixture({ activationMode: "execute_with_approval" });
    const now = new Date("2026-07-29T12:00:10.000Z");
    const operationsStore = new FileHermesOperationsStore(path.join(fixture.projectRoot, ".loopgraph"));
    await operationsStore.saveAgentInstance({
      schemaVersion: "hermes-agent-instance/v1alpha1",
      id: "hermes_worker",
      workspaceId: "workspace_worker",
      name: "Hermes Worker",
      environment: "local",
      status: "online",
      runtimeVersion: "2.4.0",
      capabilities: [],
      assignedLoopIds: [],
      defaultRouter: true,
      labels: {},
      lastHeartbeatAt: now.toISOString(),
      registeredAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    const dispatch = vi.fn().mockResolvedValue({ accepted: true, assignmentRef: "hermes_assignment_1" });
    const execute = vi.fn();
    const result = await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_dispatch",
      now,
      operationsStore,
      hermesTransport: { dispatch },
      execute
    });
    expect(result).toMatchObject({ claimed: 1, dispatched: 1, completed: 0 });
    expect(result.items[0]).toMatchObject({ status: "dispatched", traceStatus: "DISPATCHED" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      agentInstanceId: "hermes_worker",
      routeJobId: fixture.jobId,
      activationMode: "execute_with_approval"
    }));
    expect(execute).not.toHaveBeenCalled();
    await expect(new FileStorageAdapter(path.join(fixture.projectRoot, ".loopgraph")).getRun(result.items[0].runId!)).resolves.toBeNull();
  });

  it("claims a Hermes route, verifies its immutable binding, simulates it, and records lifecycle evidence", async () => {
    const fixture = await createWorkerFixture();

    const result = await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_a",
      now: new Date("2026-07-29T12:00:10.000Z"),
      simulate: async (input) => {
        const simulated = await simulateLoop(input);
        simulated.trace.metrics.push({
          name: "activation_rate",
          value: 61,
          unit: "percent",
          observed: true
        });
        return simulated;
      }
    });

    expect(result.items[0].error).toBeUndefined();
    expect(result).toMatchObject({
      claimed: 1,
      processed: 1,
      completed: 1,
      waitingReview: 0,
      failed: 0,
      controllerTrigger: {
        enqueued: true,
        duplicate: false,
        triggerRecordId: expect.stringMatching(/^controller_trigger_/)
      }
    });
    expect(result.items[0]).toMatchObject({
      status: "completed",
      traceStatus: "COMPLETED",
      duplicate: false
    });
    expect(result.items[0].lifecycleDeliveryIds).toHaveLength(2);
    expect(result.items[0].metricSampleIds).toHaveLength(1);

    const store = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const job = await store.getRouteJob(fixture.jobId);
    const commit = (await store.listRouteCommits())[0];
    const problem = await store.getBusinessProblem(fixture.problemId);
    expect(job).toMatchObject({
      status: "completed",
      result: {
        traceStatus: "COMPLETED",
        lifecycleDeliveryIds: expect.any(Array),
        metricSampleIds: result.items[0].metricSampleIds
      }
    });
    expect(job?.lease).toBeUndefined();
    expect(commit.status).toBe("completed");
    expect(problem?.status).toBe("routed");
    const samples = await new FileOutcomeStore(path.join(fixture.projectRoot, ".loopgraph"))
      .listMetricSamples({ loopId: "product_activation_worker" });
    expect(samples).toMatchObject([{
      metricKey: "activation_rate",
      value: 61,
      truthStatus: "observed",
      source: {
        type: "trace",
        runId: result.items[0].runId
      }
    }]);
  });

  it("uses an atomic file lock so two workers cannot claim the same due job", async () => {
    const fixture = await createWorkerFixture();
    const first = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const second = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));

    const [left, right] = await Promise.all([
      claimDueRouteJobs({
        store: first,
        claimedBy: "worker_left",
        now: new Date("2026-07-29T12:00:10.000Z")
      }),
      claimDueRouteJobs({
        store: second,
        claimedBy: "worker_right",
        now: new Date("2026-07-29T12:00:10.000Z")
      })
    ]);

    expect(left.length + right.length).toBe(1);
    const originalClaim = [...left, ...right][0];
    expect(originalClaim.lease?.leaseToken).toBeTruthy();

    const reclaimed = await claimDueRouteJobs({
      store: second,
      claimedBy: "worker_reclaimer",
      now: new Date("2026-07-29T12:06:00.000Z")
    });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].lease?.leaseToken).not.toBe(originalClaim.lease?.leaseToken);
    await expect(markRouteJobCompleted({
      store: first,
      jobId: originalClaim.id,
      leaseToken: originalClaim.lease!.leaseToken,
      now: new Date("2026-07-29T12:06:01.000Z")
    })).rejects.toThrow(/lease lost/);
  });

  it("pauses on exact prepared-action fingerprints and reconciles after human approval", async () => {
    const fixture = await createWorkerFixture({ requiresApproval: true });
    const first = await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review",
      now: new Date("2026-07-29T12:00:10.000Z")
    });
    expect(first.items[0].error).toBeUndefined();
    expect(first.items[0]).toMatchObject({
      status: "waiting_review",
      traceStatus: "WAITING_FOR_REVIEW"
    });

    const storage = new FileStorageAdapter(path.join(fixture.projectRoot, ".loopgraph"));
    const jobStore = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const waitingJob = await jobStore.getRouteJob(fixture.jobId);
    const trace = await storage.getRun(waitingJob!.runId);
    const fingerprints = trace!.preparedActions.map((action) => action.fingerprint);
    const reviewDecision = await applyReviewDecision(storage, {
      runId: trace!.id,
      status: "approved",
      approvedFingerprints: fingerprints,
      reviewerId: "reviewer_primary",
      role: "approver"
    }, {
      projectRoot: fixture.projectRoot
    });
    expect(reviewDecision.controllerTrigger).toMatchObject({
      enqueued: true,
      duplicate: false,
      triggerRecordId: expect.stringMatching(/^controller_trigger_/)
    });

    const reconciled = await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review",
      now: new Date("2026-07-29T12:01:00.000Z")
    });
    expect(reconciled).toMatchObject({
      claimed: 0,
      reconciledReviews: 1
    });
    expect(reconciled.items[0]).toMatchObject({
      status: "completed",
      traceStatus: "COMPLETED",
      duplicate: true
    });
  });

  it("allows only one concurrent reconciler to finalize an approved review", async () => {
    const fixture = await createWorkerFixture({ requiresApproval: true });
    await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review_prepare",
      now: new Date("2026-07-29T12:00:10.000Z")
    });
    const storage = new FileStorageAdapter(path.join(fixture.projectRoot, ".loopgraph"));
    const store = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const job = await store.getRouteJob(fixture.jobId);
    const trace = await storage.getRun(job!.runId);
    await applyReviewDecision(storage, {
      runId: trace!.id,
      status: "approved",
      approvedFingerprints: trace!.preparedActions.map((action) => action.fingerprint),
      reviewerId: "reviewer_left",
      role: "approver"
    }, {
      projectRoot: fixture.projectRoot
    });

    const [left, right] = await Promise.all([
      runRouteJobWorker({
        projectRoot: fixture.projectRoot,
        workerId: "review_left",
        now: new Date("2026-07-29T12:01:00.000Z")
      }),
      runRouteJobWorker({
        projectRoot: fixture.projectRoot,
        workerId: "review_right",
        now: new Date("2026-07-29T12:01:00.000Z")
      })
    ]);

    expect(left.reconciledReviews + right.reconciledReviews).toBe(1);
    expect((await store.getRouteJob(fixture.jobId))?.status).toBe("completed");
  });

  it("does not reconcile a review after the operator cancels its waiting job", async () => {
    const fixture = await createWorkerFixture({ requiresApproval: true });
    await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review_prepare",
      now: new Date("2026-07-29T12:00:10.000Z")
    });
    const storage = new FileStorageAdapter(path.join(fixture.projectRoot, ".loopgraph"));
    const store = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const job = await store.getRouteJob(fixture.jobId);
    const trace = await storage.getRun(job!.runId);
    await applyReviewDecision(storage, {
      runId: trace!.id,
      status: "approved",
      approvedFingerprints: trace!.preparedActions.map((action) => action.fingerprint),
      reviewerId: "reviewer_cancel",
      role: "approver"
    }, {
      projectRoot: fixture.projectRoot
    });
    await cancelRouteJob({
      store,
      jobId: fixture.jobId,
      cancelledBy: "operator",
      reason: "Stop before reconciliation",
      now: new Date("2026-07-29T12:00:40.000Z")
    });

    const result = await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review_cancelled",
      now: new Date("2026-07-29T12:01:00.000Z")
    });

    expect(result.reconciledReviews).toBe(0);
    expect((await store.getRouteJob(fixture.jobId))?.status).toBe("cancelled");
    expect((await store.listRouteCommits())[0]?.status).toBe("waiting_review");
  });

  it("rejects approval when the bound route job was cancelled", async () => {
    const fixture = await createWorkerFixture({ requiresApproval: true });
    await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review_prepare",
      now: new Date("2026-07-29T12:00:10.000Z")
    });
    const storage = new FileStorageAdapter(path.join(fixture.projectRoot, ".loopgraph"));
    const store = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const job = await store.getRouteJob(fixture.jobId);
    const trace = await storage.getRun(job!.runId);
    await cancelRouteJob({
      store,
      jobId: fixture.jobId,
      cancelledBy: "operator",
      reason: "Cancel before approval",
      now: new Date("2026-07-29T12:00:20.000Z")
    });

    await expect(applyReviewDecision(storage, {
      runId: trace!.id,
      status: "approved",
      approvedFingerprints: trace!.preparedActions.map((action) => action.fingerprint),
      reviewerId: "reviewer_cancelled",
      role: "approver"
    }, {
      projectRoot: fixture.projectRoot
    })).rejects.toThrow(/Route job is cancelled/);
  });

  it("rejects approval when the registered LoopSpec changes after review preparation", async () => {
    const fixture = await createWorkerFixture({ requiresApproval: true });
    await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review_prepare",
      now: new Date("2026-07-29T12:00:10.000Z")
    });
    const storage = new FileStorageAdapter(path.join(fixture.projectRoot, ".loopgraph"));
    const store = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const job = await store.getRouteJob(fixture.jobId);
    const trace = await storage.getRun(job!.runId);
    await writeFile(fixture.specPath, `${JSON.stringify({
      ...fixture.spec,
      metadata: {
        ...fixture.spec.metadata,
        version: "2.0.0"
      }
    }, null, 2)}\n`);

    await expect(applyReviewDecision(storage, {
      runId: trace!.id,
      status: "approved",
      approvedFingerprints: trace!.preparedActions.map((action) => action.fingerprint),
      reviewerId: "reviewer_drift",
      role: "approver"
    }, {
      projectRoot: fixture.projectRoot
    })).rejects.toThrow(/changed after routing commit/);
  });

  it("rejects a stale review-reconciliation lease after another worker reclaims it", async () => {
    const fixture = await createWorkerFixture({ requiresApproval: true });
    await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_review_prepare",
      now: new Date("2026-07-29T12:00:10.000Z")
    });
    const store = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const first = await claimWaitingReviewRouteJobs({
      store,
      claimedBy: "review_first",
      now: new Date("2026-07-29T12:00:20.000Z"),
      leaseSeconds: 30
    });
    const second = await claimWaitingReviewRouteJobs({
      store,
      claimedBy: "review_second",
      now: new Date("2026-07-29T12:01:00.000Z"),
      leaseSeconds: 30
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].lease?.leaseToken).not.toBe(first[0].lease?.leaseToken);
    await expect(markRouteJobCompleted({
      store,
      jobId: fixture.jobId,
      leaseToken: first[0].lease!.leaseToken,
      now: new Date("2026-07-29T12:01:01.000Z")
    })).rejects.toThrow(/lease lost/);
  });

  it("fails closed when the registered LoopSpec changes after Hermes committed the route", async () => {
    const fixture = await createWorkerFixture();
    const changed = {
      ...fixture.spec,
      metadata: {
        ...fixture.spec.metadata,
        version: "2.0.0"
      }
    };
    await writeFile(fixture.specPath, `${JSON.stringify(changed, null, 2)}\n`);
    const store = new FileRoutingStore(path.join(fixture.projectRoot, ".loopgraph"));
    const job = await store.getRouteJob(fixture.jobId);
    await store.saveRouteJob({
      ...job!,
      maxAttempts: 1
    });

    const result = await runRouteJobWorker({
      projectRoot: fixture.projectRoot,
      workerId: "worker_hash_guard",
      now: new Date("2026-07-29T12:00:10.000Z")
    });

    expect(result.items[0]).toMatchObject({
      status: "dead_letter",
      error: {
        code: "LOOP_SPEC_HASH_MISMATCH"
      }
    });
  });
});

async function createWorkerFixture(input: {
  requiresApproval?: boolean;
  activationMode?: "simulate" | "execute_with_approval";
} = {}) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-worker-"));
  const spec = validateLoopSpec(loopSpec(input.requiresApproval ?? false, input.activationMode ?? "simulate"));
  const specPath = path.join(projectRoot, ".loopgraph", "generated", "worker-loop.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  const workspace = await initLoopgraphWorkspace({
    projectRoot,
    now: new Date("2026-07-29T11:59:00.000Z")
  });
  workspace.registeredSpecs = [{
    id: spec.metadata.id,
    name: spec.metadata.name,
    path: path.relative(projectRoot, specPath),
    department: "product",
    addedAt: "2026-07-29T11:59:00.000Z"
  }];
  await writeLoopgraphWorkspace(workspace, projectRoot);
  const metricsDirectory = path.join(projectRoot, ".loopgraph", "metrics");
  await mkdir(metricsDirectory, { recursive: true });
  await writeFile(path.join(metricsDirectory, "activation-rate.json"), `${JSON.stringify({
    id: "metric_activation_rate",
    companyId: "company_worker",
    departmentId: "product",
    loopId: spec.metadata.id,
    key: "activation_rate",
    label: "Activation rate",
    description: "Share of users reaching activation.",
    type: "rate",
    source: "trace",
    baselineRequired: true,
    unit: "percent",
    desiredDirection: "increase",
    displayInDailySummary: true
  }, null, 2)}\n`);

  const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
  const event = productEvent();
  const card = compileRoutingCardFromLoopSpec(spec, {
    catalogVersion: "catalog_worker",
    currentReadiness: "ready"
  })!;
  await ingestRoutingEvent({
    store,
    event,
    routingCards: [card],
    now: new Date("2026-07-29T12:00:01.000Z")
  });
  const routed = await submitRoutingDecision({
    store,
    decision: routeDecision(event),
    routingCards: [card],
    catalogVersion: "catalog_worker",
    now: new Date("2026-07-29T12:00:02.000Z")
  });

  return {
    projectRoot,
    spec,
    specPath,
    jobId: routed.routeJobs[0].id,
    problemId: routed.problem!.id
  };
}

function productEvent(): EventEnvelope {
  const base = {
    workspaceId: "workspace_worker",
    companyId: "company_worker",
    source: "product_analytics",
    sourceDeliveryId: "delivery_activation_drop",
    eventType: "product.activation_drop"
  };
  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.product_analytics",
    occurredAt: "2026-07-29T12:00:00.000Z",
    receivedAt: "2026-07-29T12:00:01.000Z",
    subject: { type: "product_funnel", id: "activation" },
    correlationId: "corr_activation",
    normalizedPayload: {
      signal: "activation dropped",
      deltaPct: -18
    },
    evidenceRefs: ["metric:activation_rate"],
    trust: {
      signatureVerified: true,
      signer: "product_analytics",
      untrustedFields: []
    }
  });
}

function routeDecision(event: EventEnvelope): RoutingDecision {
  return {
    schemaVersion: "routing-decision/v1alpha1",
    eventId: event.id,
    catalogVersion: "catalog_worker",
    action: "route",
    problem: {
      summary: "Activation rate dropped.",
      problemTypes: ["product.activation"],
      subject: event.subject,
      severity: "high",
      dedupeKeyInputs: [event.subject.id]
    },
    selectedRoutes: [{
      loopId: "product_activation_worker",
      role: "primary",
      confidence: 0.94,
      reasonSummary: "The product activation loop owns this anomaly.",
      evidenceRefs: event.evidenceRefs,
      inputMapping: { signal: "activation dropped" },
      priority: 10
    }],
    alternatives: [],
    modelMetadata: { hermes: true },
    policyVersion: "routing-policy/v1alpha1"
  };
}

function loopSpec(requiresApproval: boolean, activationMode: "simulate" | "execute_with_approval" = "simulate"): LoopSpec {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "product_activation_worker",
      name: "Product Activation Worker",
      version: "1.0.0",
      description: "Handles product activation anomalies routed by Hermes."
    },
    trigger: {
      type: "event",
      source: "hermes",
      event: "business_event"
    },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        properties: {
          decisionSummary: { type: "string" },
          assumptions: { type: "array" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: {
      sources: [],
      precedence: [],
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: [{
        id: "assess",
        name: "Assess activation anomaly",
        stepType: "assess",
        actor: "agent",
        description: "Assess the Hermes-normalized activation signal."
      }]
    },
    tools: [{
      key: "write_local_draft",
      adapterId: "manual_file",
      label: "Write local experiment draft",
      writeCapable: true,
      riskLevel: requiresApproval ? "medium" : "low"
    }],
    policy: {
      allowedActions: [{
        toolKey: "write_local_draft",
        allowed: true,
        requiresApproval,
        customerFacing: false,
        riskLevel: requiresApproval ? "medium" : "low"
      }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["approver"]
    },
    persistence: {
      idempotency: { enabled: true }
    },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: false
    },
    topology: {
      department: "product",
      tags: ["hermes", "worker"]
    },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["product.activation"],
      accepts: [{
        sourcePattern: "product_*",
        eventTypePattern: "product.*",
        subjectTypes: ["product_funnel"],
        requiredFields: ["normalizedPayload.signal"],
        optionalConditions: []
      }],
      excludes: [],
      activationMode,
      minimumConfidence: 0.8,
      priority: 10,
      ambiguityPolicy: "request_human",
      noMatchPolicy: "unhandled",
      fanoutPolicy: {
        mode: "none",
        maxRoutes: 1,
        requiresIndependentProblems: true
      },
      cooldown: {
        seconds: 0,
        dedupeWindowSeconds: 0
      },
      concurrency: {
        maxActive: 1,
        strategy: "append_evidence"
      },
      inputMapping: {
        signal: "normalizedPayload.signal"
      },
      requiredConnections: [],
      lifecycleEvents: [],
      examples: {
        shouldRoute: [],
        shouldNotRoute: []
      }
    }
  };
}
