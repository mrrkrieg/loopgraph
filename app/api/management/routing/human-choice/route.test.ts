import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  type EventEnvelope
} from "loopgraph/core";
import {
  FileRoutingStore,
  loopgraph_events_ingest,
  loopgraph_routing_decision_submit
} from "loopgraph/runtime";
import { POST } from "./route";

describe("browser human routing correction API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("submits a human route choice through the same Loopgraph validation path Hermes uses", async () => {
    const projectRoot = await createProjectWithRoutingSpec();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_browser_choice_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const requestHuman = await loopgraph_routing_decision_submit({
      projectRoot,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: ingest.catalogVersion,
        action: "request_human",
        problem: {
          summary: "Campaign signal is ambiguous and needs a human route choice.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: event.subject,
          severity: "medium",
          dedupeKeyInputs: [event.subject.id]
        },
        selectedRoutes: [],
        alternatives: [{
          loopId: "marketing_ads",
          confidence: 0.63,
          reasonSummary: "Likely Ads, but under threshold."
        }],
        modelMetadata: { hermesTaskId: "task_browser_choice_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    const response = await POST(new Request("https://loopgraph.local/api/management/routing/human-choice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventId: event.id,
        routeAttemptId: requestHuman.attempt.id,
        problemId: requestHuman.problem?.id,
        action: "route",
        selectedLoopIds: ["marketing_ads"],
        reason: "Growth lead confirmed this is an Ads efficiency problem.",
        correctedBy: "Growth lead",
        projectRoot: "/tmp/ignored-by-browser-route"
      })
    }));

    const body = await response.json();
    expect({ status: response.status, body }).toMatchObject({
      status: 200,
      body: {
        ok: true,
        correction: {
          eventId: event.id,
          routeAttemptId: requestHuman.attempt.id,
          expectedAction: "route",
          expectedLoopIds: ["marketing_ads"],
          correctedBy: "Growth lead"
        },
        submission: {
          valid: true,
          problem: {
            status: "routed",
            primaryLoopId: "marketing_ads"
          },
          routeCommits: [expect.objectContaining({ loopId: "marketing_ads" })]
        }
      }
    });
    const corrections = await store.listRoutingCorrections(event.id);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ correctedBy: "Growth lead" });
  });

  it("rejects incomplete browser route choices before writing corrections", async () => {
    const projectRoot = await createProjectWithRoutingSpec();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    const response = await POST(new Request("https://loopgraph.local/api/management/routing/human-choice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventId: "evt_missing_loop",
        action: "route",
        selectedLoopIds: [],
        reason: "Missing selected loop."
      })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid human routing correction",
      issues: [expect.objectContaining({
        path: "selectedLoopIds"
      })]
    });
  });
});

async function createProjectWithRoutingSpec(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-browser-human-choice-"));
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
  return projectRoot;
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
      activationMode: "shadow"
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
