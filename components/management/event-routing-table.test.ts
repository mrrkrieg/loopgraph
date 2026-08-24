import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventRoutingOperationsReadModel } from "loopgraph/runtime";
import { EventRoutingTable } from "./event-routing-table";

describe("EventRoutingTable", () => {
  it("labels example routing rows as an empty-state preview", () => {
    const html = renderToStaticMarkup(React.createElement(EventRoutingTable, {
      model: {
        ...baseModel(),
        rows: []
      },
      showExamples: true
    }));

    expect(html).toContain("No Hermes routing events received yet");
    expect(html).toContain("illustrative only");
    expect(html).toContain("feedback.repeated_theme_detected");
    expect(html).toContain("campaign.performance_anomaly");
  });

  it("keeps a fresh local empty state free of preview examples", () => {
    const html = renderToStaticMarkup(React.createElement(EventRoutingTable, {
      model: {
        ...baseModel(),
        rows: []
      }
    }));

    expect(html).toContain("No Hermes routing events received yet");
    expect(html).toContain("start Loopgraph");
    expect(html).not.toContain("illustrative only");
    expect(html).not.toContain("campaign.performance_anomaly");
  });

  it("renders actual Hermes routing rows, problem inbox, catalog, and webhook health", () => {
    const html = renderToStaticMarkup(React.createElement(EventRoutingTable, {
      model: {
        ...baseModel(),
        summary: {
          ...baseModel().summary,
          eventCount: 1,
          problemCount: 1,
          routedEventCount: 1,
          routeJobCount: 1,
          catalogLoopCount: 1,
          hermesRouteCount: 1
        },
        rows: [{
          id: "receipt_1:attempt_1",
          eventId: "evt_ads_1",
          receiptId: "receipt_1",
          routeAttemptId: "attempt_1",
          receivedAt: "2026-07-21T12:00:02.000Z",
          source: "google_ads_detector",
          eventType: "campaign.performance_anomaly",
          subject: "campaign/campaign_123",
          correlationId: "corr_campaign_123",
          receiptStatus: "received",
          action: "route",
          problemId: "problem_1",
          problemSummary: "Campaign efficiency dropped.",
          problemType: "paid_acquisition_efficiency_drop",
          problemStatus: "resolved",
          selectedLoopIds: ["marketing_ads"],
          selectedLoopLabels: ["Ads"],
          alternativeLoopIds: ["marketing_content_creation"],
          confidence: 0.92,
          validationState: "committed",
          validationErrors: [],
          queueStatus: "queued",
          runId: "run_1",
          owner: "Growth lead",
          latencyMs: 120,
          corrections: [],
          evaluation: {
            count: 1,
            passedCount: 1,
            failedCount: 0,
            latestPassed: true,
            latestEvaluatedAt: "2026-07-21T12:01:00.000Z"
          },
          needsHumanChoice: true,
          needsCorrection: false,
          outcome: {
            outcomeRef: "case_outcome:case_1",
            summary: "Budget change approved and efficiency recovered.",
            resolvedAt: "2026-07-21T12:03:00.000Z",
            businessResult: "Cost per qualified customer returned to target.",
            followUpRequired: false
          },
          timeline: ["receipt:received", "Hermes:route", "loop:marketing_ads", "outcome:case_outcome:case_1"],
          decisionDetail: {
            routeAttemptId: "attempt_1",
            action: "route",
            catalogVersion: "catalog_v1",
            policyVersion: "routing-policy/v1alpha1",
            modelMetadata: [{ key: "hermesTaskId", value: "task_ui_1" }],
            selectedRoutes: [{
              loopId: "marketing_ads",
              loopLabel: "Ads",
              role: "primary",
              confidence: 0.92,
              reasonSummary: "Campaign anomaly contains qualified-cost deterioration.",
              evidenceRefs: [],
              priority: 10
            }],
            alternatives: [{
              loopId: "marketing_content_creation",
              loopLabel: "Content Creation",
              confidence: 0.21,
              reasonSummary: "Rejected because this is not an approved content work item."
            }],
            routeCommits: [{
              id: "route_1",
              loopId: "marketing_ads",
              loopLabel: "Ads",
              status: "queued",
              runId: "run_1",
              committedAt: "2026-07-21T12:00:03.000Z"
            }],
            routeJobs: [{
              id: "job_1",
              status: "queued",
              runId: "run_1",
              attemptCount: 0,
              maxAttempts: 3,
              nextRunAt: "2026-07-21T12:00:03.000Z",
              updatedAt: "2026-07-21T12:00:03.000Z"
            }]
          },
          correlationTimeline: [{
            id: "receipt_1",
            at: "2026-07-21T12:00:02.000Z",
            stage: "event_receipt",
            label: "Event receipt persisted",
            detail: "google_ads_detector sent campaign.performance_anomaly for campaign/campaign_123",
            status: "received"
          }, {
            id: "attempt_1",
            at: "2026-07-21T12:00:03.000Z",
            stage: "hermes_decision",
            label: "Hermes decision: route",
            detail: "marketing_ads: Campaign anomaly contains qualified-cost deterioration.",
            status: "committed"
          }, {
            id: "lifecycle_1",
            at: "2026-07-21T12:02:30.000Z",
            stage: "lifecycle_event",
            label: "Loop lifecycle callback prepared for Hermes",
            detail: "loop.run.completed · run_1",
            status: "sent"
          }, {
            id: "lifecycle_outcome_1",
            at: "2026-07-21T12:03:01.000Z",
            stage: "outcome_recorded",
            label: "Verified outcome recorded for Hermes",
            detail: "case_outcome:case_1 · Budget change approved and efficiency recovered.",
            status: "sent"
          }]
        }],
        problemInbox: [{
          problemId: "problem_1",
          summary: "Campaign efficiency dropped.",
          problemType: "paid_acquisition_efficiency_drop",
          status: "routed",
          subject: "campaign/campaign_123",
          evidenceEventCount: 1,
          primaryLoopId: "marketing_ads",
          routeCommitCount: 1,
          updatedAt: "2026-07-21T12:00:03.000Z",
          owner: "Growth lead"
        }],
        routingCatalog: [{
          loopId: "marketing_ads",
          loopName: "Ads",
          department: "marketing",
          activationMode: "shadow",
          currentReadiness: "ready",
          minimumConfidence: 0.8,
          priority: 10,
          ambiguityPolicy: "request_human",
          noMatchPolicy: "unhandled",
          fanoutPolicy: { mode: "independent_only", maxRoutes: 2, requiresIndependentProblems: true },
          cooldown: { seconds: 0, dedupeWindowSeconds: 3600 },
          concurrency: { maxActive: 1, strategy: "append_evidence" },
          acceptedEvents: ["google_ads*:campaign.*"],
          problemTypes: ["paid_acquisition_efficiency_drop"],
          explicitNonGoals: ["Content brief approvals are owned by Content Creation."],
          requiredConnections: ["ads.read"],
          lifecycleEvents: ["loop.route.accepted", "loop.problem.unhandled"],
          examples: {
            shouldRoute: ["Campaign spend rises while qualified customer conversion drops."],
            shouldNotRoute: ["test campaigns and already-resolved anomalies"]
          }
        }],
        webhookHealth: {
          routeCount: 1,
          eventFamilyCount: 1,
          warnings: [],
          activation: {
            exists: true,
            current: true,
            ready: true,
            planDigest: "activation_plan_1",
            routes: [{
              routeId: "hermes_route_google_ads",
              routeName: "loopgraph-google-ads-events",
              routeKind: "provider_event",
              loopIds: ["marketing_ads"],
              state: "shadow",
              subscriptionState: "active",
              signatureVerificationConfigured: true,
              ready: true
            }]
          },
          routes: [{
            routeName: "loopgraph-google-ads-events",
            sourcePattern: "google_ads*",
            eventTypePatterns: ["campaign.performance_anomaly"],
            loopIds: ["marketing_ads"],
            deliveryMode: "log"
          }]
        }
      }
    }));

    expect(html).toContain("campaign.performance_anomaly");
    expect(html).toContain("paid_acquisition_efficiency_drop");
    expect(html).toContain("Ads");
    expect(html).toContain("92%");
    expect(html).toContain("Problem inbox");
    expect(html).toContain("Routing catalog");
    expect(html).toContain("Hermes ready");
    expect(html).toContain("shadow · active");
    expect(html).toContain("confidence ≥ 80%");
    expect(html).toContain("ambiguity request human");
    expect(html).toContain("fan-out independent only");
    expect(html).toContain("repeats: append evidence");
    expect(html).toContain("dedupe 60m");
    expect(html).toContain("Do not route:");
    expect(html).toContain("test campaigns and already-resolved anomalies");
    expect(html).toContain("loopgraph-google-ads-events");
    expect(html).toContain("Filter inbox");
    expect(html).toContain("/api/management/routing");
    expect(html).toContain("/api/management/routing/human-choice");
    expect(html).toContain("Submit correction");
    expect(html).toContain("Routing receipt");
    expect(html).toContain("Full routing receipt");
    expect(html).toContain("Why Hermes made this call");
    expect(html).toContain("Needs human/context review");
    expect(html).toContain("Alternatives Hermes considered");
    expect(html).toContain("Correlation timeline");
    expect(html).toContain("Verified outcome");
    expect(html).toContain("Budget change approved and efficiency recovered.");
    expect(html).toContain("Cost per qualified customer returned to target.");
    expect(html).toContain("task_ui_1");
    expect(html).toContain("loop.run.completed");
    expect(html).toContain("attempt_1");
    expect(html).not.toContain("illustrative only");
  });
});

function baseModel(): EventRoutingOperationsReadModel {
  return {
    schemaVersion: "event-routing-operations/v1alpha1",
    projectRoot: "/tmp/project",
    generatedAt: "2026-07-21T12:00:00.000Z",
    filters: {},
    summary: {
      eventCount: 0,
      problemCount: 0,
      unhandledProblemCount: 0,
      routedEventCount: 0,
      pendingHumanChoiceCount: 0,
      routeJobCount: 0,
      failedEvaluationCount: 0,
      catalogLoopCount: 0,
      hermesRouteCount: 0,
      warningCount: 0
    },
    rows: [],
    problemInbox: [],
    routingCatalog: [],
    webhookHealth: {
      routeCount: 0,
      eventFamilyCount: 0,
      warnings: [],
      activation: {
        exists: false,
        current: false,
        ready: false,
        routes: []
      },
      routes: []
    }
  };
}
