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
    const campaignEvent = event({
      eventType: "marketing.campaign_window_closed",
      subjectType: "campaign",
      normalizedPayload: {
        campaignId: "campaign-1",
        windowStart: "2026-07-01",
        windowEnd: "2026-07-31",
        spend: 10_000
      }
    });
    const cohortEvent = event({
      eventType: "marketing.campaign_cohort_ready",
      subjectType: "campaign_cohort",
      normalizedPayload: { campaignId: "campaign-1", cohortId: "cohort-1", leadIds: ["lead-1"] }
    });
    const outcomeEvent = event({
      eventType: "marketing.pipeline_outcome_observed",
      subjectType: "pipeline_outcome",
      normalizedPayload: { campaignId: "campaign-1", cohortId: "cohort-1", outcome: "qualified", observedAt: "2026-08-01" }
    });

    expect(eligible("marketing-campaign-learning", campaignEvent).eligible).toBe(true);
    expect(eligible("marketing-campaign-lead-qualification", cohortEvent).eligible).toBe(true);
    expect(eligible("marketing-campaign-pipeline-outcome", outcomeEvent).eligible).toBe(true);
  });

  it("permits the declared incident support sequence through bounded derived events", () => {
    const incidentEvent = event({
      eventType: "engineering.incident_detected",
      subjectType: "incident",
      normalizedPayload: { incidentId: "incident-1", service: "api", detectedAt: "2026-08-01T12:00:00Z" }
    });
    const impactEvent = event({
      eventType: "engineering.customer_impact_ready",
      subjectType: "customer_impact",
      normalizedPayload: { incidentId: "incident-1", impactEvidenceRefs: ["evidence://impact"], owner: "incident-commander" }
    });
    const accountRiskEvent = event({
      eventType: "cs.strategic_account_risk_ready",
      subjectType: "account_risk",
      normalizedPayload: { accountId: "account-1", ownerId: "csm-1", riskEvidenceRefs: ["evidence://impact"] }
    });
    const learningEvent = event({
      eventType: "engineering.incident_resolved",
      subjectType: "incident",
      normalizedPayload: { incidentId: "incident-1", resolvedAt: "2026-08-01T13:00:00Z", resolutionEvidenceRefs: ["evidence://resolution"] }
    });

    expect(eligible("engineering-incident-response", incidentEvent).eligible).toBe(true);
    expect(eligible("engineering-customer-impact", impactEvent).eligible).toBe(true);
    expect(eligible("cs-strategic-account-escalation", accountRiskEvent).eligible).toBe(true);
    expect(eligible("engineering-incident-learning", learningEvent).eligible).toBe(true);
  });

  it("rejects missing context and exclusion matches so Hermes can abstain", () => {
    const missingEvidence = event({
      eventType: "marketing.campaign_window_closed",
      subjectType: "campaign",
      normalizedPayload: { campaignId: "campaign-1", spend: 5_000 }
    });
    missingEvidence.evidenceRefs = [];
    const missingResult = eligible("marketing-campaign-learning", missingEvidence);
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
