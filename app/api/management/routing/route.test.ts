import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEventEnvelopeId,
  eventEnvelopeSchema,
  routingCardSchema,
  type EventEnvelope,
  type RoutingCard
} from "loopgraph/core";
import {
  FileRoutingStore,
  ingestRoutingEvent,
  submitRoutingDecision
} from "loopgraph/runtime";
import { GET } from "./route";

describe("browser Hermes routing operations API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a filtered Hermes routing inbox without trusting URL project roots", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-browser-routing-api-"));
    await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_browser_routing_api_1");
    const card = adsRoutingCard();
    await ingestRoutingEvent({
      store,
      event,
      routingCards: [card],
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    await submitRoutingDecision({
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
          confidence: 0.92,
          reasonSummary: "Campaign anomaly contains qualified-cost deterioration.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 10
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_browser_routing_api_1" },
        policyVersion: "routing-policy/v1alpha1"
      },
      routingCards: [card],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    const response = await GET(new Request(
      "https://loopgraph.local/api/management/routing?source=google_ads_detector&action=route&loopId=marketing_ads&projectRoot=/tmp/ignored"
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      model: {
        projectRoot,
        filters: {
          source: "google_ads_detector",
          action: "route",
          loopId: "marketing_ads"
        },
        summary: {
          eventCount: 1,
          routedEventCount: 1,
          problemCount: 1
        },
        rows: [expect.objectContaining({
          eventId: event.id,
          source: "google_ads_detector",
          action: "route",
          selectedLoopIds: ["marketing_ads"]
        })]
      }
    });

    const emptyResponse = await GET(new Request("https://loopgraph.local/api/management/routing?source=notion"));
    const emptyBody = await emptyResponse.json();
    expect(emptyBody).toMatchObject({
      ok: true,
      model: {
        filters: { source: "notion" },
        summary: { eventCount: 0 },
        rows: []
      }
    });
  });
});

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
    activationMode: "simulate",
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
