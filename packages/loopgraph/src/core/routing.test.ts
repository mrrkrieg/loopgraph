import { describe, expect, it } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "./constants";
import { validateLoopSpec } from "./loop-spec";
import {
  compileRoutingCardFromLoopSpec,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  evaluateRoutingEligibility,
  getEligibleRoutingCards,
  mapRoutingCardInputs,
  validateRoutingDecisionForEvent,
  type EventEnvelope,
  type RoutingCard
} from "./routing";

function loopWithRouting(input: {
  id: string;
  name: string;
  department: string;
  description: string;
  routing: unknown;
}) {
  return validateLoopSpec({
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: input.id,
      name: input.name,
      version: "1.0.0",
      description: input.description
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
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe signals" }]
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
    topology: { department: input.department },
    routing: input.routing
  });
}

function eventEnvelope(input: {
  source: string;
  sourceDeliveryId: string;
  eventType: string;
  subject: EventEnvelope["subject"];
  normalizedPayload: EventEnvelope["normalizedPayload"];
}): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: input.source,
    sourceDeliveryId: input.sourceDeliveryId,
    eventType: input.eventType
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: `${input.source}.route`,
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: input.subject,
    correlationId: "corr_1",
    normalizedPayload: input.normalizedPayload,
    trust: { signatureVerified: true, signer: input.source, untrustedFields: ["normalizedPayload.title"] }
  });
}

function marketingCards(): RoutingCard[] {
  const adsLoop = loopWithRouting({
    id: "marketing_ads",
    name: "Ads",
    department: "marketing",
    description: "Improve qualified acquisition efficiency.",
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
      }],
      excludes: [{
        sourcePattern: "*",
        eventTypePattern: "content.*",
        subjectTypes: ["content_brief"],
        reason: "Content work items are owned by Content Creation."
      }],
      inputMapping: {
        campaignId: "subject.id",
        spendDeltaPct: "signals.spendDeltaPct"
      },
      minimumConfidence: 0.8,
      activationMode: "shadow"
    }
  });

  const contentLoop = loopWithRouting({
    id: "marketing_content",
    name: "Content Creation",
    department: "marketing",
    description: "Create evidence-backed content drafts.",
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["approved_content_work_item"],
      accepts: [{
        sourcePattern: "notion",
        eventTypePattern: "content.brief_approved",
        subjectTypes: ["content_brief"],
        requiredFields: ["approvedEvidenceRefs", "reviewer"]
      }],
      excludes: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        reason: "Campaign efficiency problems are owned by Ads."
      }],
      inputMapping: {
        briefId: "subject.id",
        evidenceRefs: "approvedEvidenceRefs"
      },
      minimumConfidence: 0.75,
      activationMode: "shadow"
    }
  });

  return [
    compileRoutingCardFromLoopSpec(adsLoop, { catalogVersion: "catalog_v1", currentReadiness: "ready" }),
    compileRoutingCardFromLoopSpec(contentLoop, { catalogVersion: "catalog_v1", currentReadiness: "ready" })
  ].filter((card): card is RoutingCard => Boolean(card));
}

describe("Hermes routing core", () => {
  it("compiles routing cards from LoopSpec routing contracts", () => {
    const [adsCard, contentCard] = marketingCards();

    expect(adsCard.loopId).toBe("marketing_ads");
    expect(adsCard.problemTypes).toEqual(["paid_acquisition_efficiency_drop"]);
    expect(adsCard.routingContractVersion).toBe("routing-contract/v1alpha1");
    expect(contentCard.loopName).toBe("Content Creation");
  });

  it("canonicalizes legacy department identifiers on routing cards", () => {
    const loop = loopWithRouting({
      id: "ops_approval",
      name: "Approval Bottleneck",
      department: "operations_finance",
      description: "Detect stuck approvals.",
      routing: {
        schemaVersion: "routing-contract/v1alpha1",
        problemTypes: ["approval_bottleneck"],
        accepts: [{
          sourcePattern: "approval_system",
          eventTypePattern: "approval.stalled",
          subjectTypes: ["approval"],
          requiredFields: ["approval.ageHours"]
        }],
        inputMapping: { approvalId: "subject.id" },
        minimumConfidence: 0.8,
        activationMode: "shadow"
      }
    });

    const card = compileRoutingCardFromLoopSpec(loop);

    expect(card?.department).toBe("ops_finance");
  });

  it("returns only structurally eligible cards for an ads anomaly", () => {
    const event = eventEnvelope({
      source: "google_ads_detector",
      sourceDeliveryId: "delivery_ads_1",
      eventType: "campaign.performance_anomaly",
      subject: { type: "campaign", id: "campaign_123", display: "Campaign 123" },
      normalizedPayload: {
        signals: {
          spendDeltaPct: 18,
          costPerQualifiedCustomerDeltaPct: 31,
          qualifiedConversionDeltaPct: -14
        }
      }
    });

    const eligible = getEligibleRoutingCards(event, marketingCards());

    expect(eligible.map((result) => result.card.loopId)).toEqual(["marketing_ads"]);
  });

  it("keeps content loops out of ads events and reports missing fields", () => {
    const [adsCard, contentCard] = marketingCards();
    const incompleteAdsEvent = eventEnvelope({
      source: "google_ads_detector",
      sourceDeliveryId: "delivery_ads_2",
      eventType: "campaign.performance_anomaly",
      subject: { type: "campaign", id: "campaign_123" },
      normalizedPayload: { signals: { spendDeltaPct: 18 } }
    });

    const adsEligibility = evaluateRoutingEligibility(incompleteAdsEvent, adsCard);
    const contentEligibility = evaluateRoutingEligibility(incompleteAdsEvent, contentCard);

    expect(adsEligibility.eligible).toBe(false);
    expect(adsEligibility.missingFields).toContain("signals.costPerQualifiedCustomerDeltaPct");
    expect(contentEligibility.eligible).toBe(false);
    expect(contentEligibility.reasons).toContain("No accept rule matched the event");
  });

  it("rejects stale, forged, or low-confidence Hermes decisions", () => {
    const event = eventEnvelope({
      source: "google_ads_detector",
      sourceDeliveryId: "delivery_ads_3",
      eventType: "campaign.performance_anomaly",
      subject: { type: "campaign", id: "campaign_123" },
      normalizedPayload: {
        signals: {
          spendDeltaPct: 18,
          costPerQualifiedCustomerDeltaPct: 31
        }
      }
    });
    const cards = marketingCards();

    const valid = validateRoutingDecisionForEvent({
      event,
      routingCards: cards,
      catalogVersion: "catalog_v1",
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
          dedupeKeyInputs: ["campaign_123"]
        },
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.91,
          reasonSummary: "The event is a campaign performance anomaly with qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: "campaign_123" },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesSessionId: "task_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    });

    expect(valid.valid).toBe(true);

    const mismatchedSubject = validateRoutingDecisionForEvent({
      event,
      routingCards: cards,
      catalogVersion: "catalog_v1",
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: "catalog_v1",
        action: "route",
        problem: {
          summary: "Campaign efficiency dropped.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: { type: "campaign", id: "campaign_999" },
          severity: "medium",
          dedupeKeyInputs: ["campaign_999"]
        },
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.91,
          reasonSummary: "The event is a campaign performance anomaly with qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: "campaign_123" },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesSessionId: "task_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    });

    expect(mismatchedSubject.valid).toBe(false);
    expect(mismatchedSubject.errors).toContain("Routing decision problem subject does not match event subject");

    const invalid = validateRoutingDecisionForEvent({
      event,
      routingCards: cards,
      catalogVersion: "catalog_v1",
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: "catalog_old",
        action: "route",
        selectedRoutes: [{
          loopId: "marketing_content",
          role: "primary",
          confidence: 0.5,
          reasonSummary: "Trying the wrong loop.",
          evidenceRefs: [],
          inputMapping: {},
          priority: 0
        }],
        alternatives: [],
        modelMetadata: {},
        policyVersion: "routing-policy/v1alpha1"
      }
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      "Routing decision catalogVersion is stale",
      expect.stringContaining("Selected loop \"marketing_content\" is not eligible")
    ]));
  });

  it("validates Hermes-selected route inputs against deterministic event mapping", () => {
    const event = eventEnvelope({
      source: "google_ads_detector",
      sourceDeliveryId: "delivery_ads_mapping_1",
      eventType: "campaign.performance_anomaly",
      subject: { type: "campaign", id: "campaign_123" },
      normalizedPayload: {
        signals: {
          spendDeltaPct: 18,
          costPerQualifiedCustomerDeltaPct: 31
        }
      }
    });
    const cards = marketingCards();
    const adsCard = cards.find((card) => card.loopId === "marketing_ads");

    expect(adsCard ? mapRoutingCardInputs(event, adsCard) : undefined).toEqual({
      campaignId: "campaign_123",
      spendDeltaPct: 18
    });

    const invalidMapping = validateRoutingDecisionForEvent({
      event,
      routingCards: cards,
      catalogVersion: "catalog_v1",
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
          dedupeKeyInputs: ["campaign_123"]
        },
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.91,
          reasonSummary: "The event is a campaign performance anomaly with qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: {
            campaignId: "campaign_999",
            injectedBudgetChange: true
          },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesSessionId: "task_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    });

    expect(invalidMapping.valid).toBe(false);
    expect(invalidMapping.errors).toEqual(expect.arrayContaining([
      "Selected loop \"marketing_ads\" inputMapping for \"campaignId\" does not match the deterministic event mapping",
      "Selected loop \"marketing_ads\" inputMapping contains undeclared target \"injectedBudgetChange\""
    ]));
  });

  it("rejects Hermes alternatives that are not in the routing catalog", () => {
    const event = eventEnvelope({
      source: "google_ads_detector",
      sourceDeliveryId: "delivery_ads_mapping_2",
      eventType: "campaign.performance_anomaly",
      subject: { type: "campaign", id: "campaign_123" },
      normalizedPayload: {
        signals: {
          spendDeltaPct: 18,
          costPerQualifiedCustomerDeltaPct: 31
        }
      }
    });

    const invalidAlternative = validateRoutingDecisionForEvent({
      event,
      routingCards: marketingCards(),
      catalogVersion: "catalog_v1",
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: "catalog_v1",
        action: "request_human",
        problem: {
          summary: "Campaign performance changed, but the right loop is ambiguous.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: event.subject,
          severity: "medium",
          dedupeKeyInputs: ["campaign_123"]
        },
        selectedRoutes: [],
        alternatives: [{
          loopId: "not_a_registered_loop",
          confidence: 0.5,
          reasonSummary: "Forged alternative."
        }],
        modelMetadata: { hermesSessionId: "task_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    });

    expect(invalidAlternative.valid).toBe(false);
    expect(invalidAlternative.errors).toContain("Alternative loop \"not_a_registered_loop\" is not in the routing catalog");
  });
});
