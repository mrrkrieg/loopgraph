import { describe, expect, it } from "vitest";
import {
  EVENT_ENVELOPE_SCHEMA_VERSION,
  compileRoutingCardFromLoopSpec,
  evaluateRoutingEligibility,
  eventEnvelopeSchema,
  type EventEnvelope
} from "loopgraph/core";
import { createSpecFromTemplate } from "./template-spec";

function event(input: {
  eventType: string;
  subjectType: string;
  normalizedPayload: Record<string, unknown>;
}): EventEnvelope {
  return eventEnvelopeSchema.parse({
    id: `event_${input.eventType}`,
    schemaVersion: EVENT_ENVELOPE_SCHEMA_VERSION,
    workspaceId: "workspace_test",
    companyId: "company_test",
    source: "golden_test",
    sourceRoute: "golden_test",
    sourceDeliveryId: `delivery_${input.eventType}`,
    eventType: input.eventType,
    occurredAt: "2026-07-31T12:00:00.000Z",
    receivedAt: "2026-07-31T12:00:01.000Z",
    subject: { type: input.subjectType, id: "object_test" },
    correlationId: `correlation_${input.eventType}`,
    normalizedPayload: input.normalizedPayload,
    evidenceRefs: ["evidence://golden/source"],
    trust: { signatureVerified: true, signer: "golden-test", untrustedFields: [] }
  });
}

function eligible(templateId: string, businessEvent: EventEnvelope) {
  const card = compileRoutingCardFromLoopSpec(createSpecFromTemplate(templateId), {
    currentReadiness: "ready"
  });
  expect(card).toBeTruthy();
  return evaluateRoutingEligibility(businessEvent, card!);
}

describe("prebuilt company routing", () => {
  it("permits the declared campaign to pipeline learning sequence", () => {
    const businessEvent = event({
      eventType: "campaign.cohort_outcome_ready",
      subjectType: "campaign",
      normalizedPayload: {
        spend: 10_000,
        qualifiedOutcome: { customers: 8 },
        fitSignals: ["segment-match"],
        intentSignals: ["demo-request"],
        qualifiedPipeline: 120_000,
        customerOutcome: { retained: 7 }
      }
    });

    expect(eligible("marketing-campaign_learning", businessEvent).eligible).toBe(true);
    // The same normalized event can be re-expressed for the cohort object claimed by Sales.
    const cohortEvent = { ...businessEvent, subject: { type: "campaign_cohort", id: businessEvent.subject.id } };
    expect(eligible("sales-lead_qualification", cohortEvent).eligible).toBe(true);
    expect(eligible("sales-pipeline_outcome", cohortEvent).eligible).toBe(true);
  });

  it("permits only the declared incident support sequence when all context exists", () => {
    const businessEvent = event({
      eventType: "incident.customer_impact_detected",
      subjectType: "incident",
      normalizedPayload: {
        severity: "critical",
        affectedServices: ["api"],
        accountTier: "strategic",
        businessImpact: "checkout unavailable",
        audience: ["affected admins"],
        knownFacts: ["api unavailable"],
        timeline: [{ at: "12:00", event: "alert" }],
        rootCause: "deployment regression"
      }
    });

    for (const templateId of [
      "engineering-incident_response",
      "strategic-account-escalation",
      "customer_success-customer_communication_review",
      "engineering-incident_learning"
    ]) {
      expect(eligible(templateId, businessEvent).eligible).toBe(true);
    }
  });

  it("rejects missing context and exclusion matches so Hermes can abstain", () => {
    const missingEvidence = event({
      eventType: "campaign.performance_anomaly",
      subjectType: "campaign",
      normalizedPayload: { spend: 5_000, qualifiedOutcome: "" }
    });
    missingEvidence.evidenceRefs = [];
    const missingResult = eligible("marketing-campaign_learning", missingEvidence);
    expect(missingResult.eligible).toBe(false);
    expect(missingResult.reasons.join(" ")).toContain("Missing required field");

    const ambiguousLandingPage = event({
      eventType: "landing_page.conversion_dropped",
      subjectType: "landing_page",
      normalizedPayload: {
        pageId: "pricing",
        conversionWindow: "7d",
        missingCampaignMapping: true
      }
    });
    const ambiguousResult = eligible("marketing-landing_page_conversion", ambiguousLandingPage);
    expect(ambiguousResult.eligible).toBe(false);
    expect(ambiguousResult.matchedExcludes).toHaveLength(1);
  });
});
