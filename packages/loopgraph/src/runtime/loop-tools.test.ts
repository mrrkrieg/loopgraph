import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEventEnvelopeId,
  eventEnvelopeSchema,
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  type BusinessProblem,
  type EscalationCase,
  type EventEnvelope,
  type LoopRunTrace,
  type RouteCommit
} from "../core";
import { callLoopgraphLoopTool } from "./loop-tools";
import { FileStorageAdapter } from "../sdk/storage";
import { FileRoutingStore } from "./routing-store";
import { listLoopgraphLifecycleDeliveries } from "./lifecycle-events";

async function createHermesLoopProject(options: { requiresApproval?: boolean } = {}) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-loop-tools-"));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  const fixturePath = path.join(projectRoot, "fixtures", "marketing-ads-happy.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(marketingAdsSpec(options.requiresApproval ?? false), null, 2)}\n`);
  await writeFile(fixturePath, `${JSON.stringify(marketingAdsFixture(options.requiresApproval ?? false), null, 2)}\n`);
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

  return { projectRoot, specPath, fixturePath };
}

function marketingAdsSpec(requiresApproval: boolean) {
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
      fixtures: [{ id: "happy-path", path: "fixtures/marketing-ads-happy.json" }]
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
      allowedActions: [{ toolKey: "draft_review", allowed: true, requiresApproval, riskLevel: "medium" }],
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
        requiredFields: ["signals.spendDeltaPct"]
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow"
    }
  };
}

function marketingAdsFixture(requiresApproval: boolean) {
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
          recommendation: "Pause the low-quality audience segment.",
          apiToken: "secret-token-that-should-not-return-to-hermes"
        },
        riskLevel: "medium",
        requiresApproval,
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

describe("Loopgraph Hermes loop tools", () => {
  it("validates a registered loop by loopId", async () => {
    const { projectRoot } = await createHermesLoopProject();

    const result = await callLoopgraphLoopTool("loopgraph_loops_validate", {
      projectRoot,
      loopId: "marketing_ads"
    });

    expect(result).toMatchObject({
      schemaVersion: "loop-validation/v1alpha1",
      valid: true,
      loopId: "marketing_ads",
      routing: {
        ready: true,
        problemTypes: ["paid_acquisition_efficiency_drop"],
        activationMode: "shadow"
      },
      fixtures: [{ id: "happy-path", path: "fixtures/marketing-ads-happy.json" }]
    });
  });

  it("simulates a registered loop with a project-local fixture", async () => {
    const { projectRoot, fixturePath } = await createHermesLoopProject();

    const result = await callLoopgraphLoopTool("loopgraph_loops_simulate", {
      projectRoot,
      loopId: "marketing_ads",
      fixturePath: path.relative(projectRoot, fixturePath)
    }) as {
      valid: boolean;
      runId: string;
      status: string;
      reviewRequired: boolean;
      traceSummary: { humanReviewRequired: boolean };
    };

    expect(result.valid).toBe(true);
    expect(result.runId).toMatch(/^run_/);
    expect(result.status).toBe("COMPLETED");
    expect(result.reviewRequired).toBe(false);
    expect(result.traceSummary.humanReviewRequired).toBe(false);
  });

  it("returns safe run summaries with review packets and redacted payload previews", async () => {
    const { projectRoot, fixturePath } = await createHermesLoopProject({ requiresApproval: true });
    const simulation = await callLoopgraphLoopTool("loopgraph_loops_simulate", {
      projectRoot,
      loopId: "marketing_ads",
      fixturePath
    }) as {
      runId: string;
      traceSummary: { preparedFingerprints: string[] };
    };

    const result = await callLoopgraphLoopTool("loopgraph_runs_get", {
      projectRoot,
      runId: simulation.runId,
      includeReviewPacket: true
    });

    expect(result).toMatchObject({
      schemaVersion: "loop-runs/v1alpha1",
      projectRoot,
      count: 1,
      runs: [{
        runId: simulation.runId,
        loopId: "marketing_ads",
        status: "WAITING_FOR_REVIEW",
        preparedActions: [{
          fingerprint: simulation.traceSummary.preparedFingerprints[0],
          payloadPreview: {
            recommendation: "Pause the low-quality audience segment.",
            apiToken: "[redacted]"
          }
        }],
        reviewPacket: {
          runId: simulation.runId,
          approvableFingerprints: simulation.traceSummary.preparedFingerprints
        }
      }]
    });
  });

  it("submits a human review through the same local governance path", async () => {
    const { projectRoot, fixturePath } = await createHermesLoopProject({ requiresApproval: true });
    const simulation = await callLoopgraphLoopTool("loopgraph_loops_simulate", {
      projectRoot,
      loopId: "marketing_ads",
      fixturePath
    }) as {
      runId: string;
      status: string;
      reviewRequired: boolean;
      traceSummary: { preparedFingerprints: string[] };
    };

    expect(simulation.status).toBe("WAITING_FOR_REVIEW");
    expect(simulation.reviewRequired).toBe(true);

    const review = await callLoopgraphLoopTool("loopgraph_review_submit", {
      projectRoot,
      runId: simulation.runId,
      status: "approved",
      approvedFingerprints: simulation.traceSummary.preparedFingerprints,
      reviewerId: "marketing_owner",
      role: "owner",
      comment: "Synthetic marketing review approved."
    });

    expect(review).toMatchObject({
      schemaVersion: "loop-review/v1alpha1",
      valid: true,
      runId: simulation.runId,
      status: "COMPLETED",
      review: {
        status: "approved",
        reviewerId: "marketing_owner",
        comment: "Synthetic marketing review approved."
      }
    });
  });

  it("resolves a Hermes-routed escalation case and returns the outcome lifecycle callback", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-loop-case-tool-"));
    const loopgraphRoot = path.join(projectRoot, ".loopgraph");
    const storage = new FileStorageAdapter(loopgraphRoot);
    const routingStore = new FileRoutingStore(loopgraphRoot);
    const event = caseToolEvent();
    const commit = caseToolRouteCommit(event);
    const problem = caseToolProblem(event, commit);
    const trace = caseToolTrace(event, commit);
    const caseItem = caseToolEscalationCase(trace);

    await routingStore.saveEventReceipt({
      id: `receipt_${event.id}`,
      eventId: event.id,
      event,
      eventHash: "event_hash_loop_case_tool",
      status: "received",
      firstSeenAt: event.receivedAt,
      lastSeenAt: event.receivedAt
    });
    await routingStore.saveBusinessProblem(problem);
    await routingStore.saveRouteCommit(commit);
    await storage.saveRun(trace);
    await storage.saveEscalationCase(caseItem);

    const result = await callLoopgraphLoopTool("loopgraph_case_resolve", {
      projectRoot,
      caseId: caseItem.id,
      resolutionSummary: "Campaign risk resolved after budget review.",
      resolvedAt: "2026-07-21T14:00:00.000Z",
      businessResult: "Cost per qualified customer recovered.",
      classificationCorrect: true,
      followUpRequired: false
    }, {
      now: new Date("2026-07-21T14:00:01.000Z")
    }) as {
      schemaVersion: string;
      case: { id: string; status: string; outcome?: EscalationCase["outcome"] };
      problem?: { id: string; status: string; outcomeRefs: string[] };
      lifecycleDelivery?: { emitted: boolean; eventType?: string; routeKey?: string; notificationOnly?: boolean };
      warnings: string[];
    };

    expect(result).toMatchObject({
      schemaVersion: "case-resolution/v1alpha1",
      case: {
        id: caseItem.id,
        status: "resolved",
        outcome: {
          resolutionSummary: "Campaign risk resolved after budget review.",
          businessResult: "Cost per qualified customer recovered.",
          classificationCorrect: true,
          followUpRequired: false
        }
      },
      problem: {
        id: problem.id,
        status: "resolved",
        outcomeRefs: [`case_outcome:${caseItem.id}`]
      },
      lifecycleDelivery: {
        emitted: true,
        eventType: "loop.outcome.recorded",
        routeKey: "loopgraph-lifecycle-events",
        notificationOnly: true
      },
      warnings: []
    });

    const lifecycleDeliveries = await listLoopgraphLifecycleDeliveries(projectRoot);
    expect(lifecycleDeliveries).toHaveLength(1);
    expect(lifecycleDeliveries[0].event.eventType).toBe("loop.outcome.recorded");

    const runs = await callLoopgraphLoopTool("loopgraph_runs_get", {
      projectRoot,
      runId: trace.id
    }) as {
      runs: Array<{ escalationCases: Array<{ id: string; outcome?: EscalationCase["outcome"] }> }>;
    };
    expect(runs.runs[0].escalationCases[0]).toMatchObject({
      id: caseItem.id,
      outcome: {
        resolutionSummary: "Campaign risk resolved after budget review."
      }
    });
  });

  it("confines explicit spec and fixture paths to the selected project root", async () => {
    const { projectRoot } = await createHermesLoopProject();

    await expect(callLoopgraphLoopTool("loopgraph_loops_validate", {
      projectRoot,
      specPath: "../outside/loopgraph.yaml"
    })).rejects.toThrow("must be inside the selected project root");

    await expect(callLoopgraphLoopTool("loopgraph_loops_simulate", {
      projectRoot,
      loopId: "marketing_ads",
      fixturePath: "../outside/fixture.json"
    })).rejects.toThrow("must be inside the selected project root");
  });
});

function caseToolEvent(): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "google_ads_detector",
    sourceDeliveryId: "delivery_loop_case_tool_1",
    eventType: "campaign.performance_anomaly"
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.google_ads_detector",
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "campaign", id: "campaign_123", display: "Brand Search" },
    correlationId: "corr_loop_case_tool",
    normalizedPayload: {
      signals: {
        spendDeltaPct: 18,
        costPerQualifiedCustomerDeltaPct: 31
      }
    },
    trust: { signatureVerified: true, signer: "google_ads", untrustedFields: [] }
  });
}

function caseToolRouteCommit(event: EventEnvelope): RouteCommit {
  return {
    id: "route_loop_case_tool_1",
    eventId: event.id,
    problemId: "problem_loop_case_tool_1",
    loopId: "marketing_ads",
    loopSpecHash: "hash_marketing_ads",
    routeAttemptId: "attempt_loop_case_tool_1",
    runId: "run_loop_case_tool_1",
    status: "waiting_review",
    inputMapping: { campaignId: event.subject.id },
    committedAt: "2026-07-21T12:00:03.000Z"
  };
}

function caseToolProblem(event: EventEnvelope, commit: RouteCommit): BusinessProblem {
  return {
    id: commit.problemId,
    workspaceId: event.workspaceId,
    companyId: event.companyId,
    problemType: "paid_acquisition_efficiency_drop",
    subject: event.subject,
    summary: "Campaign efficiency drop needs approval.",
    severity: "high",
    status: "waiting",
    correlationId: event.correlationId,
    dedupeKey: "problem_loop_case_tool_1",
    evidenceEventIds: [event.id],
    primaryLoopId: commit.loopId,
    supportingLoopIds: [],
    routeCommitIds: [commit.id],
    outcomeRefs: [],
    openedAt: "2026-07-21T12:00:03.000Z",
    updatedAt: "2026-07-21T12:03:00.000Z"
  };
}

function caseToolTrace(event: EventEnvelope, commit: RouteCommit): LoopRunTrace {
  return {
    id: "run_loop_case_tool_1",
    loopId: commit.loopId,
    loopSpecVersion: "1.0.0",
    loopSpecHash: commit.loopSpecHash,
    mode: "simulate",
    status: "WAITING_FOR_REVIEW",
    trigger: {
      type: "event",
      source: "hermes",
      event: event.eventType,
      eventId: event.id,
      receivedAt: "2026-07-21T12:00:01.000Z"
    },
    idempotencyKey: "idem_loop_case_tool_1",
    contextSnapshot: {
      id: "ctx_loop_case_tool_1",
      loopId: commit.loopId,
      loopSpecVersion: "1.0.0",
      createdAt: "2026-07-21T12:03:00.000Z",
      contentHash: "ctx_hash_loop_case_tool",
      tokenEstimate: 0,
      entries: []
    },
    inputs: [{
      key: "routing",
      value: {
        routeCommitId: commit.id,
        correlationId: event.correlationId
      },
      source: "simulate"
    }],
    proposedActions: [],
    preparedActions: [],
    toolCalls: [],
    policyDecisions: [],
    verificationResults: [],
    escalationCases: ["case_loop_case_tool_1"],
    humanReviews: [],
    outputs: [],
    metrics: [],
    errors: [],
    startedAt: "2026-07-21T12:03:00.000Z",
    completedAt: "2026-07-21T12:03:00.000Z"
  };
}

function caseToolEscalationCase(trace: LoopRunTrace): EscalationCase {
  return {
    id: "case_loop_case_tool_1",
    sourceRunId: trace.id,
    sourceLoopId: trace.loopId,
    createdAt: "2026-07-21T12:03:00.000Z",
    category: "operational_blocker",
    severity: "P1",
    confidence: 0.91,
    affectedEntities: {},
    summary: "Campaign efficiency drop needs approval.",
    evidence: [],
    unresolvedQuestions: [],
    recommendedActions: [],
    decisionsRequired: [{
      id: "decision_1",
      question: "Approve campaign budget intervention?",
      requiredRole: "growth_lead",
      blocking: true
    }],
    routing: {
      primaryOwner: { role: "growth_lead" },
      reviewers: [{ role: "finance" }],
      informed: [],
      escalationDeadline: "2026-07-21T13:03:00.000Z"
    },
    responsePlan: {
      internalActions: [],
      successCriteria: ["Campaign risk resolved."]
    },
    status: "open"
  };
}
