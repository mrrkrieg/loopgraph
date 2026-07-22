import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEventEnvelopeId,
  eventEnvelopeSchema,
  type EventEnvelope,
  type RoutingCard
} from "loopgraph/core";
import {
  getDiscoverySession,
  getLoopRunsForHermes,
  loopgraph_events_ingest,
  loopgraph_routing_catalog_get,
  loopgraph_routing_decision_submit,
  startHermesDiscoverySession
} from "loopgraph/runtime";
import {
  editBrowserLoopDesignProposalAction,
  generateBrowserLoopDesignAction,
  materializeBrowserLoopDesignAction,
  selectBrowserDiscoveryDepartmentsAction,
  submitBrowserDiscoveryAnswersAction
} from "./discovery/actions";
import { getHermesDiscoverySessionsForView } from "./discovery/view-data";
import { simulateBrainLoopFixtureAction } from "./brain/actions";
import { GET as getRoutingOperations } from "./api/management/routing/route";
import { POST as postHumanRoutingChoice } from "./api/management/routing/human-choice/route";
import { buildBrainGraph } from "../components/brain/graph-adapter";
import { getSemanticTopology } from "../lib/loop-engineering-builder/workspace";
import { resetStorageAdapterCache } from "../lib/loopgraph-runtime/storage-resolver";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
}));

describe("Hermes browser end-to-end flow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetStorageAdapterCache();
  });

  it("resumes a Hermes-started session, designs loops, materializes graph nodes, simulates locally, and corrects a routed event", async () => {
    const projectRoot = await temporaryProjectRoot();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "hermes-browser-growth-app",
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0"
      }
    }, null, 2));

    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_hermes_browser_e2e",
      companyId: "company_hermes_browser_e2e",
      companyName: "Hermes Browser Co",
      createdByActor: "hermes"
    });

    const browserSessions = await getHermesDiscoverySessionsForView();
    expect(browserSessions.map((session) => session.id)).toContain("session_hermes_browser_e2e");
    expect(browserSessions.find((session) => session.id === "session_hermes_browser_e2e")).toMatchObject({
      createdByActor: "hermes"
    });

    await selectMarketingInBrowser();
    await submitMarketingAnswersInBrowser(projectRoot);

    const designForm = new FormData();
    designForm.set("sessionId", "session_hermes_browser_e2e");
    designForm.set("department", "marketing");
    designForm.set("maxProposals", "2");
    await expect(generateBrowserLoopDesignAction(designForm))
      .rejects.toThrow(/NEXT_REDIRECT:\/discovery\/designing\?sessionId=session_hermes_browser_e2e&designRunId=design_/);

    const sessionAfterDesign = await getDiscoverySession("session_hermes_browser_e2e", projectRoot);
    const baseDesignRunId = sessionAfterDesign?.designRunIds.at(-1);
    expect(baseDesignRunId).toMatch(/^design_/);

    const editForm = new FormData();
    editForm.set("sessionId", "session_hermes_browser_e2e");
    editForm.set("designRunId", baseDesignRunId!);
    editForm.set("proposalId", "proposal_marketing_content_creation");
    editForm.set("shortName", "Content Engine");
    editForm.set("reviewerRoles", "Marketing lead\nLegal reviewer");
    await expect(editBrowserLoopDesignProposalAction(editForm))
      .rejects.toThrow(/NEXT_REDIRECT:\/discovery\/create-loops\?designRunId=design_.*&sessionId=session_hermes_browser_e2e/);

    const sessionAfterEdit = await getDiscoverySession("session_hermes_browser_e2e", projectRoot);
    const editedDesignRunId = sessionAfterEdit?.designRunIds.at(-1);
    expect(editedDesignRunId).toMatch(/^design_/);
    expect(editedDesignRunId).not.toBe(baseDesignRunId);

    const materializeForm = new FormData();
    materializeForm.set("sessionId", "session_hermes_browser_e2e");
    materializeForm.set("designRunId", editedDesignRunId!);
    materializeForm.append("acceptedProposalIds", "proposal_marketing_ads");
    materializeForm.append("acceptedProposalIds", "proposal_marketing_content_creation");
    await expect(materializeBrowserLoopDesignAction(materializeForm))
      .rejects.toThrow(/NEXT_REDIRECT:\/discovery\/create-loops\?designRunId=design_.*&materializationId=materialization_.*&sessionId=session_hermes_browser_e2e/);

    const graph = buildBrainGraph({
      topology: await getSemanticTopology(undefined, {
        brainLabel: "Hermes Brain",
        hierarchyMode: "hermes_brain"
      }),
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });
    expect(graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      "Hermes Brain",
      "Marketing",
      "Ads",
      "Content Engine"
    ]));
    expect(graph.edges).toContainEqual(expect.objectContaining({
      source: "company:root",
      target: "loop:department:marketing",
      type: "brain_routes_to"
    }));
    expect(graph.edges).toContainEqual(expect.objectContaining({
      source: "loop:department:marketing",
      target: "loop:marketing_ads",
      type: "department_contains_loop"
    }));

    const simulateForm = new FormData();
    simulateForm.set("loopId", "marketing_ads");
    simulateForm.set("fixtureId", "happy-path");
    await expect(simulateBrainLoopFixtureAction(simulateForm))
      .rejects.toThrow(/NEXT_REDIRECT:\/loops\/marketing_ads\/reviews\?runId=run_/);
    const runs = await getLoopRunsForHermes({ projectRoot, loopId: "marketing_ads" });
    expect(runs).toMatchObject({
      count: 1,
      runs: [{
        loopId: "marketing_ads",
        status: "WAITING_FOR_REVIEW",
        trigger: {
          source: "hermes"
        }
      }]
    });

    const catalog = await loopgraph_routing_catalog_get({ projectRoot });
    const adsCard = catalog.routingCards.find((card) => card.loopId === "marketing_ads");
    expect(adsCard).toBeTruthy();
    const event = eventForCard(adsCard!, "delivery_hermes_browser_e2e_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
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
          summary: "Hermes needs confirmation before routing this campaign anomaly.",
          problemTypes: adsCard!.problemTypes,
          subject: event.subject,
          severity: "medium",
          dedupeKeyInputs: [event.subject.id, event.eventType]
        },
        selectedRoutes: [],
        alternatives: [{
          loopId: "marketing_ads",
          confidence: Math.max(0.1, adsCard!.minimumConfidence - 0.1),
          reasonSummary: "Campaign signal resembles Ads, but Hermes asked for operator confirmation."
        }],
        modelMetadata: {
          hermesTaskId: "task_hermes_browser_e2e",
          projectRoot: "/redacted/not-browser-controlled"
        },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    const attentionResponse = await getRoutingOperations(new Request(
      `https://loopgraph.local/api/management/routing?eventId=${encodeURIComponent(event.id)}&needsAttention=true&projectRoot=/tmp/ignored`
    ));
    const attentionBody = await attentionResponse.json();
    expect(attentionBody).toMatchObject({
      ok: true,
      model: {
        projectRoot,
        summary: {
          pendingHumanChoiceCount: 1
        },
        rows: [expect.objectContaining({
          eventId: event.id,
          action: "request_human",
          needsHumanChoice: true,
          alternativeLoopIds: ["marketing_ads"],
          decisionDetail: expect.objectContaining({
            alternatives: [expect.objectContaining({
              loopId: "marketing_ads",
              reasonSummary: expect.stringContaining("operator confirmation")
            })]
          })
        })]
      }
    });

    const correctionResponse = await postHumanRoutingChoice(new Request("https://loopgraph.local/api/management/routing/human-choice", {
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
    const correctionBody = await correctionResponse.json();
    expect({ status: correctionResponse.status, body: correctionBody }).toMatchObject({
      status: 200,
      body: {
        ok: true,
        correction: {
          eventId: event.id,
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
          routeCommits: [expect.objectContaining({
            loopId: "marketing_ads"
          })]
        }
      }
    });

    const correctedResponse = await getRoutingOperations(new Request(
      `https://loopgraph.local/api/management/routing?eventId=${encodeURIComponent(event.id)}`
    ));
    const correctedBody = await correctedResponse.json();
    expect(correctedBody.model.rows[0]).toMatchObject({
      eventId: event.id,
      action: "route",
      selectedLoopIds: ["marketing_ads"],
      corrections: [expect.objectContaining({
        correctedBy: "Growth lead",
        expectedLoopIds: ["marketing_ads"]
      })],
      decisionDetail: {
        selectedRoutes: [expect.objectContaining({
          loopId: "marketing_ads",
          reasonSummary: "Growth lead confirmed this is an Ads efficiency problem."
        })]
      }
    });
    expect(correctedBody.model.rows[0].correlationTimeline.map((entry: { stage: string }) => entry.stage))
      .toEqual(expect.arrayContaining(["event_receipt", "hermes_decision", "human_correction", "route_commit"]));
  });
});

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-hermes-browser-e2e-"));
}

async function selectMarketingInBrowser(): Promise<void> {
  const formData = new FormData();
  formData.set("sessionId", "session_hermes_browser_e2e");
  formData.set("expectedRevision", "0");
  formData.append("departments", "marketing");
  formData.set("activeDepartment", "marketing");
  await expect(selectBrowserDiscoveryDepartmentsAction(formData))
    .rejects.toThrow("NEXT_REDIRECT:/discovery/questions?sessionId=session_hermes_browser_e2e");
}

async function submitMarketingAnswersInBrowser(projectRoot: string): Promise<void> {
  const bundles = [
    {
      bundleId: "current_stack_sources",
      fields: {
        systems: "Google Ads\nHubSpot\nNotion",
        source_of_truth: "HubSpot defines qualified leads and customers.",
        safe_reads: "campaign performance\nqualified lead status\napproved briefs",
        manual_fallbacks: "weekly ads CSV\napproved briefs Markdown folder",
        existing_automations: ""
      }
    },
    {
      bundleId: "biggest_recurring_problem",
      fields: {
        processes: "paid ads review\ncontent draft creation",
        trigger_or_cadence: "Campaign anomalies and approved content briefs.",
        weekly_volume: "12",
        current_owner: "Growth lead",
        current_steps: "collect campaign metrics\ncompare to qualified lead quality\ndraft content from approved evidence",
        pain_type_severity: "Manual context gathering and slow draft review are high severity.",
        baseline: "6 hours per week"
      }
    },
    {
      bundleId: "automation_boundaries",
      fields: {
        desired_automation_mode: "monitor, recommend, and draft",
        candidate_outputs_actions: "campaign recommendation\ncontent draft\nreview packet",
        read_write_boundary: "Read data and write drafts only; no publishing or spend changes without approval.",
        customer_facing_status: "true",
        forbidden_actions: "no unapproved budget changes\nno unapproved publishing\nno unsupported claims"
      }
    },
    {
      bundleId: "ideal_outcome_proof",
      fields: {
        primary_outcome_metric: "cost per qualified customer",
        leading_indicator: "qualified lead rate",
        guardrail_metric: "lead quality and brand safety must not decline",
        baseline_target: "Reduce review prep from 6 hours to 2 hours per week.",
        verification_rules: "recommendations cite source metrics\ndraft claims cite approved evidence"
      }
    },
    {
      bundleId: "ownership_rollout",
      fields: {
        loop_owner_role: "Growth lead",
        reviewer_roles: "Marketing lead\nFinance reviewer",
        escalation_conditions: "spend change above threshold\nunsupported content claim\nlow confidence",
        initial_autonomy_level: "shadow",
        pilot_scope: "two campaigns and one content channel",
        management_summary: "weekly learning summary"
      }
    }
  ];

  for (const bundle of bundles) {
    const session = await getDiscoverySession("session_hermes_browser_e2e", projectRoot);
    const formData = new FormData();
    formData.set("sessionId", "session_hermes_browser_e2e");
    formData.set("bundleId", bundle.bundleId);
    formData.set("expectedRevision", String(session?.revision ?? 0));
    for (const [key, value] of Object.entries(bundle.fields)) {
      formData.set(key, value);
    }
    await expect(submitBrowserDiscoveryAnswersAction(formData)).rejects.toThrow("NEXT_REDIRECT");
  }
}

function eventForCard(card: RoutingCard, sourceDeliveryId: string): EventEnvelope {
  const accept = card.accepts[0];
  if (!accept) throw new Error(`Routing card ${card.loopId} has no accept rules`);
  const source = concretePattern(accept.sourcePattern, "google_ads_detector");
  const eventType = concretePattern(accept.eventTypePattern, "campaign.performance_anomaly");
  const subjectType = accept.subjectTypes[0] ?? "campaign";
  const normalizedPayload: Record<string, unknown> = {
    signal: "qualified acquisition deterioration",
    campaign: {
      id: "campaign_browser_e2e",
      name: "Browser E2E Campaign"
    },
    signals: {
      spendDeltaPct: 18,
      costPerQualifiedCustomerDeltaPct: 31,
      qualifiedLeadRateDeltaPct: -12
    }
  };
  for (const field of accept.requiredFields) {
    setNormalizedPayloadPath(normalizedPayload, field, valueForRequiredField(field));
  }

  const base = {
    workspaceId: "workspace_browser_e2e",
    companyId: "company_hermes_browser_e2e",
    source,
    sourceDeliveryId,
    eventType
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: `hermes.${source}`,
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: subjectType, id: "campaign_browser_e2e", display: "Browser E2E Campaign" },
    correlationId: "corr_browser_e2e_campaign",
    normalizedPayload,
    evidenceRefs: ["fixture:browser-e2e-campaign"],
    trust: { signatureVerified: true, signer: "hermes", untrustedFields: [] }
  });
}

function concretePattern(pattern: string, fallback: string): string {
  if (pattern === "*") return fallback;
  return pattern.replace(/\*/g, "detector");
}

function setNormalizedPayloadPath(payload: Record<string, unknown>, rawPath: string, value: unknown): void {
  const pathWithoutEnvelope = rawPath.replace(/^event\./, "").replace(/^trigger\./, "");
  const pathInsidePayload = pathWithoutEnvelope.startsWith("normalizedPayload.")
    ? pathWithoutEnvelope.slice("normalizedPayload.".length)
    : pathWithoutEnvelope;
  if (pathInsidePayload.startsWith("subject.") || pathInsidePayload.startsWith("source") || pathInsidePayload.startsWith("eventType")) {
    return;
  }

  const parts = pathInsidePayload.split(".").filter(Boolean);
  let current: Record<string, unknown> = payload;
  while (parts.length > 1) {
    const key = parts.shift()!;
    if (!current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  if (parts[0]) current[parts[0]] = value;
}

function valueForRequiredField(field: string): unknown {
  if (/spend|cost|rate|delta|score|confidence|count|volume|amount|budget/i.test(field)) return 42;
  if (/approved|verified|trusted|safe/i.test(field)) return true;
  return `value_for_${field.replace(/[^a-z0-9]+/gi, "_")}`;
}
