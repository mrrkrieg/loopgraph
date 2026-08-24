import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  loopSpecHash,
  validateLoopSpec,
  type EventEnvelope
} from "../core";
import { FileRoutingStore } from "./routing-store";
import {
  callLoopgraphRoutingTool,
  loopgraph_events_replay,
  loopgraph_events_ingest,
  loopgraph_route_commit_simulate,
  loopgraph_routing_catalog_get,
  loopgraph_routing_decision_submit,
  loopgraph_routing_human_choice_submit
} from "./routing-tools";
import { FileStorageAdapter } from "../sdk/storage";
import { listLoopgraphLifecycleDeliveries } from "./lifecycle-events";
import { loopgraph_graph_get } from "./routing-ops-tools";
import {
  createStoredLoopSpecArtifact,
  type LoopSpecRegistryStore
} from "./loop-spec-store";
import type { OutcomeStore } from "./outcome-store";

async function createProjectWithRoutingSpec(
  spec = marketingAdsSpec()
): Promise<{ projectRoot: string; specPath: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-routing-tools-"));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
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

  return { projectRoot, specPath };
}

function marketingAdsSpec(input: { activationMode?: "shadow" | "simulate"; escalatesInternalEvents?: boolean } = {}) {
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
      escalationRules: input.escalatesInternalEvents
        ? [{
            id: "internal_ads_event_requires_review",
            when: { "event.sensitivity ==": "internal" },
            createEscalationCase: {
              category: "operational_blocker",
              severity: "P1"
            },
            routeTo: {
              primaryOwner: "growth_lead",
              reviewers: ["finance"],
              responseSla: "1h"
            },
            requiresApproval: ["growth_lead"],
            decisionsRequired: ["Approve or reject the proposed ad operations action."]
          }]
        : []
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
      activationMode: input.activationMode ?? "shadow"
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

function supportTicketEvent(sourceDeliveryId: string): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "support_inbox",
    sourceDeliveryId,
    eventType: "ticket.created"
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.support_inbox",
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "ticket", id: "ticket_123" },
    correlationId: "corr_ticket_123",
    normalizedPayload: {
      ticket: {
        priority: "high"
      }
    },
    trust: { signatureVerified: true, signer: "support", untrustedFields: [] }
  });
}

describe("routing tool surface", () => {
  it("loads a routing catalog from a project workspace registry", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();

    const catalog = await loopgraph_routing_catalog_get({ projectRoot });

    expect(catalog.count).toBe(1);
    expect(catalog.routingCards[0]).toMatchObject({
      loopId: "marketing_ads",
      loopName: "Ads",
      catalogVersion: catalog.catalogVersion
    });
  });

  it("loads the routing catalog from the active distributed LoopSpec registry", async () => {
    const projectRoot = await mkdtemp(
      path.join(tmpdir(), "loopgraph-routing-registry-")
    );
    const spec = validateLoopSpec(marketingAdsSpec());
    const artifact = createStoredLoopSpecArtifact({
      spec,
      entry: {
        id: spec.metadata.id,
        name: spec.metadata.name,
        path: "registry://marketing_ads",
        templateId: "hermes-design",
        department: "marketing",
        addedAt: "2026-07-21T12:00:00.000Z"
      },
      source: "hermes_design",
      createdAt: "2026-07-21T12:00:00.000Z"
    });
    const loopSpecStore = loopSpecStoreWithArtifact(artifact);

    const catalog = await loopgraph_routing_catalog_get(
      { projectRoot },
      { loopSpecStore }
    );

    expect(catalog.count).toBe(1);
    expect(catalog.routingCards[0]).toMatchObject({
      loopId: "marketing_ads",
      loopSpecHash: loopSpecHash(spec)
    });
  });

  it("ingests events through the Hermes-facing tool and returns eligible cards", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_1");

    const result = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    expect(result.duplicate).toBe(false);
    expect(result.eligibleRoutes.map((route) => route.card.loopId)).toEqual(["marketing_ads"]);
    expect(result.learningContext).toMatchObject({
      schemaVersion: "routing-learning-context/v1alpha1",
      status: "available",
      authority: "advisory",
      eligibleLoopIds: ["marketing_ads"],
      loopEvidence: [expect.objectContaining({
        loopId: "marketing_ads",
        relation: "eligible_candidate",
        eligibleForCurrentEvent: true
      })]
    });
    expect(result.learningContextDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await store.getEventReceipt(event.id)).toBeTruthy();
    expect(result.controllerTrigger).toMatchObject({
      enqueued: true,
      duplicate: false,
      triggerRecordId: expect.stringMatching(/^controller_trigger_/)
    });
  });

  it("does not make Hermes reason again for a duplicate delivery", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_duplicate_1");
    await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    const duplicate = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(duplicate).toMatchObject({
      duplicate: true,
      eligibleRoutes: [],
      learningContext: {
        status: "not_applicable",
        authority: "advisory",
        eligibleLoopIds: [],
        loopEvidence: []
      }
    });
  });

  it("keeps current routing available while marking historical evidence unavailable", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_learning_unavailable_1");
    const unavailableOutcomeStore = {
      listObservedOutcomes: async () => {
        throw new Error("database details must not escape");
      },
      listValueLedgerEntries: async () => []
    } as unknown as OutcomeStore;

    const result = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      outcomeStore: unavailableOutcomeStore,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    expect(result.eligibleRoutes.map((route) => route.card.loopId)).toEqual(["marketing_ads"]);
    expect(result.learningContext).toMatchObject({
      status: "unavailable",
      authority: "advisory",
      loopEvidence: [],
      warnings: ["Shared learning evidence is unavailable; do not infer historical performance or value."]
    });
    expect(JSON.stringify(result.learningContext)).not.toContain("database details");
  });

  it("ignores caller-supplied routing cards on Hermes-facing ingest calls", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const catalog = await loopgraph_routing_catalog_get({ projectRoot });
    const registeredCard = catalog.routingCards[0];
    expect(registeredCard).toBeTruthy();
    const forgedCard = {
      ...registeredCard!,
      loopId: "forged_support_loop",
      loopName: "Forged Support Loop",
      problemTypes: ["support_escalation"],
      accepts: [{
        sourcePattern: "support*",
        eventTypePattern: "ticket.*",
        subjectTypes: ["ticket"],
        requiredFields: []
      }],
      loopSpecHash: "forged_hash"
    };
    const event = supportTicketEvent("delivery_tool_forged_catalog_1");
    const result = await loopgraph_events_ingest({
      projectRoot,
      event,
      routingCards: [forgedCard],
      catalogVersion: "catalog_forged"
    } as unknown as Parameters<typeof loopgraph_events_ingest>[0], {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    expect(result.catalogVersion).not.toBe("catalog_forged");
    expect(result.eligibleRoutes).toEqual([]);
    expect(await store.getEventReceipt(event.id)).toBeTruthy();
  });

  it("submits decisions through the Hermes-facing tool and persists commits", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_2");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    const result = await loopgraph_routing_decision_submit({
      projectRoot,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: ingest.catalogVersion,
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
          reasonSummary: "Campaign anomaly includes qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_tool_1" },
        policyVersion: "routing-policy/v1alpha1"
      },
      learningContextDigest: ingest.learningContextDigest,
      hermesMetadata: { route: "google_ads_detector" }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(result.valid).toBe(true);
    expect(result.attempt.learningContextBinding).toMatchObject({
      contextDigest: ingest.learningContextDigest,
      acknowledgedDigest: ingest.learningContextDigest,
      acknowledged: true,
      context: {
        status: "available",
        eligibleLoopIds: ["marketing_ads"]
      }
    });
    expect(result.problem?.primaryLoopId).toBe("marketing_ads");
    expect(result.routeCommits).toHaveLength(1);
    expect(result.lifecycleDeliveries).toEqual([
      expect.objectContaining({
        emitted: true,
        eventType: "loop.route.accepted",
        routeKey: "loopgraph-lifecycle-events",
        status: "pending",
        notificationOnly: true
      })
    ]);
    expect(await store.listRouteCommits(result.problem?.id)).toHaveLength(1);
    const lifecycleDeliveries = await listLoopgraphLifecycleDeliveries(projectRoot);
    expect(lifecycleDeliveries).toHaveLength(1);
    expect(lifecycleDeliveries[0]).toMatchObject({
      event: {
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        eventType: "loop.route.accepted",
        causationId: event.id,
        parentEventId: event.id,
        correlationId: event.correlationId,
        normalizedPayload: {
          notificationOnly: true,
          routeCommitId: result.routeCommits[0].id,
          problemId: result.problem?.id,
          loopId: "marketing_ads",
          routeCommitStatus: "shadow"
        }
      },
      notificationOnly: true,
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events"
      }
    });
  });

  it("rejects a stale Hermes learning-context digest before committing a route", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_stale_learning_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    const result = await loopgraph_routing_decision_submit({
      projectRoot,
      learningContextDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: ingest.catalogVersion,
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
          reasonSummary: "Campaign anomaly includes qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_tool_stale_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    expect(result.valid).toBe(false);
    expect(result.validationErrors).toContain(
      "Hermes learning-context digest is stale; re-ingest the event before routing"
    );
    expect(result.attempt.learningContextBinding).toMatchObject({
      contextDigest: ingest.learningContextDigest,
      acknowledgedDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      acknowledged: false
    });
    expect(await store.listRouteCommits()).toHaveLength(0);
  });

  it("simulates a validated route commit locally and links the run back to the commit", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_route_commit_sim_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const routed = await loopgraph_routing_decision_submit({
      projectRoot,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: ingest.catalogVersion,
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
          reasonSummary: "Campaign anomaly includes qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_tool_route_commit_sim_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });
    const routeCommitId = routed.routeCommits[0].id;

    const simulation = await loopgraph_route_commit_simulate({
      projectRoot,
      routeCommitId,
      simulatedBy: "Growth lead"
    }, {
      store,
      now: new Date("2026-07-21T12:03:00.000Z")
    });

    expect(simulation).toMatchObject({
      schemaVersion: "route-commit-simulation/v1alpha1",
      valid: true,
      routeCommit: {
        id: routeCommitId,
        loopId: "marketing_ads",
        status: "completed"
      },
      run: {
        loopId: "marketing_ads",
        status: "COMPLETED",
        reviewRequired: false
      },
      problem: {
        id: routed.problem?.id,
        status: "routed"
      },
      lifecycleDelivery: {
        emitted: true,
        eventType: "loop.run.completed",
        routeKey: "loopgraph-lifecycle-events",
        status: "pending",
        notificationOnly: true
      },
      lifecycleDeliveries: [
        expect.objectContaining({
          emitted: true,
          eventType: "loop.run.started",
          routeKey: "loopgraph-lifecycle-events",
          status: "pending",
          notificationOnly: true
        }),
        expect.objectContaining({
          emitted: true,
          eventType: "loop.run.completed",
          routeKey: "loopgraph-lifecycle-events",
          status: "pending",
          notificationOnly: true
        })
      ]
    });
    if (!simulation.valid || !simulation.routeCommit || !simulation.run) {
      throw new Error("Expected route commit simulation to succeed");
    }
    expect(simulation.routeCommit.runId).toBe(simulation.run.runId);

    const persistedCommit = (await store.listRouteCommits(routed.problem?.id))[0];
    expect(persistedCommit).toMatchObject({
      id: routeCommitId,
      runId: simulation.run.runId,
      status: "completed"
    });

    const trace = await new FileStorageAdapter(path.join(projectRoot, ".loopgraph")).getRun(simulation.run.runId);
    expect(trace).toMatchObject({
      id: simulation.run.runId,
      loopId: "marketing_ads",
      trigger: {
        eventId: event.id
      },
      inputs: expect.arrayContaining([
        expect.objectContaining({
          key: "routing",
          value: expect.objectContaining({
            routeCommitId,
            correlationId: event.correlationId
          })
        })
      ])
    });

    const lifecycleDeliveries = await listLoopgraphLifecycleDeliveries(projectRoot);
    expect(lifecycleDeliveries).toHaveLength(3);
    const completedLifecycleDelivery = lifecycleDeliveries.find((delivery) =>
      delivery.event.eventType === "loop.run.completed"
    );
    const startedLifecycleDelivery = lifecycleDeliveries.find((delivery) =>
      delivery.event.eventType === "loop.run.started"
    );
    const acceptedLifecycleDelivery = lifecycleDeliveries.find((delivery) =>
      delivery.event.eventType === "loop.route.accepted"
    );
    expect(completedLifecycleDelivery).toMatchObject({
      event: {
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        eventType: "loop.run.completed",
        causationId: event.id,
        parentEventId: event.id,
        correlationId: event.correlationId,
        normalizedPayload: {
          notificationOnly: true,
          routeCommitId,
          problemId: routed.problem?.id,
          loopId: "marketing_ads",
          runId: simulation.run.runId
        }
      },
      notificationOnly: true,
      signature: {
        algorithm: "hmac-sha256",
        headerName: "x-loopgraph-signature",
        keyRef: "project:.loopgraph/hermes/lifecycle-signing.key"
      },
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events"
      }
    });
    expect(startedLifecycleDelivery).toMatchObject({
      event: {
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        eventType: "loop.run.started",
        causationId: event.id,
        parentEventId: event.id,
        correlationId: event.correlationId,
        normalizedPayload: {
          notificationOnly: true,
          routeCommitId,
          problemId: routed.problem?.id,
          loopId: "marketing_ads",
          runId: simulation.run.runId,
          runStatus: "STARTED"
        }
      },
      notificationOnly: true,
      signature: {
        algorithm: "hmac-sha256",
        headerName: "x-loopgraph-signature",
        keyRef: "project:.loopgraph/hermes/lifecycle-signing.key"
      },
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events"
      }
    });
    expect(acceptedLifecycleDelivery).toMatchObject({
      event: {
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        eventType: "loop.route.accepted",
        causationId: event.id,
        parentEventId: event.id,
        correlationId: event.correlationId,
        normalizedPayload: {
          notificationOnly: true,
          routeCommitId,
          problemId: routed.problem?.id,
          loopId: "marketing_ads",
          routeCommitStatus: "shadow"
        }
      },
      notificationOnly: true,
      signature: {
        algorithm: "hmac-sha256",
        headerName: "x-loopgraph-signature",
        keyRef: "project:.loopgraph/hermes/lifecycle-signing.key"
      },
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events"
      }
    });
    expect(completedLifecycleDelivery?.signature.value).toMatch(/^sha256=/);
    expect(startedLifecycleDelivery?.signature.value).toMatch(/^sha256=/);
    expect(acceptedLifecycleDelivery?.signature.value).toMatch(/^sha256=/);
    expect(JSON.stringify(lifecycleDeliveries)).not.toContain("loopgraph-local-development-lifecycle-secret");

    const graph = await loopgraph_graph_get({
      projectRoot,
      projection: "event_routing",
      eventId: event.id
    }, {
      store,
      now: new Date("2026-07-21T12:04:00.000Z")
    });

    expect(graph).toMatchObject({
      schemaVersion: "graph-projection/v1alpha1",
      projection: "event_routing",
      summary: {
        eventCount: 5,
        problemCount: 1,
        routeCommitCount: 1
      }
    });
    expect(graph.graphProjection.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "company_brain", label: "Hermes Brain", type: "company_brain" }),
      expect.objectContaining({ id: "source:google_ads_detector", label: "google_ads_detector", type: "event" }),
      expect.objectContaining({ id: `event:${event.id}`, label: event.eventType, type: "event" }),
      expect.objectContaining({ id: `problem:${routed.problem?.id}`, type: "problem" }),
      expect.objectContaining({ id: `attempt:${routed.attempt.id}`, label: "route · committed", type: "loop" }),
      expect.objectContaining({ id: `commit:${routeCommitId}`, label: "completed", type: "route_commit" }),
      expect.objectContaining({ id: "loop:marketing_ads", label: "marketing_ads", type: "loop" }),
      expect.objectContaining({ id: `run:${simulation.run.runId}`, label: simulation.run.runId, type: "loop" }),
      expect.objectContaining({ id: `lifecycle:${completedLifecycleDelivery?.event.id}`, label: "loop.run.completed", type: "event" })
    ]));
    expect(graph.graphProjection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "source:google_ads_detector", target: "company_brain", label: "webhook to Hermes", executable: true }),
      expect.objectContaining({ source: "company_brain", target: `event:${event.id}`, label: "received", executable: false }),
      expect.objectContaining({ source: `event:${event.id}`, target: `problem:${routed.problem?.id}`, label: "evidence", executable: false }),
      expect.objectContaining({ source: `event:${event.id}`, target: `attempt:${routed.attempt.id}`, label: "Hermes decision", executable: true }),
      expect.objectContaining({ source: `attempt:${routed.attempt.id}`, target: `commit:${routeCommitId}`, label: "validated route", executable: true }),
      expect.objectContaining({ source: `commit:${routeCommitId}`, target: "loop:marketing_ads", label: "selected loop", executable: true }),
      expect.objectContaining({ source: "loop:marketing_ads", target: `run:${simulation.run.runId}`, label: "run", executable: true }),
      expect.objectContaining({ source: `run:${simulation.run.runId}`, target: `lifecycle:${completedLifecycleDelivery?.event.id}`, label: "emits", executable: false }),
      expect.objectContaining({ source: `lifecycle:${completedLifecycleDelivery?.event.id}`, target: "company_brain", label: "signed lifecycle webhook", executable: false })
    ]));
  });

  it("emits an escalation-created lifecycle callback when a routed loop creates a review case", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec(marketingAdsSpec({ escalatesInternalEvents: true }));
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_route_commit_escalation_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const routed = await loopgraph_routing_decision_submit({
      projectRoot,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: ingest.catalogVersion,
        action: "route",
        problem: {
          summary: "Campaign efficiency dropped and needs review.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: event.subject,
          severity: "high",
          dedupeKeyInputs: [event.subject.id]
        },
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.92,
          reasonSummary: "Campaign anomaly includes qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_tool_route_commit_escalation_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });
    const routeCommitId = routed.routeCommits[0].id;

    const simulation = await loopgraph_route_commit_simulate({
      projectRoot,
      routeCommitId,
      simulatedBy: "Growth lead"
    }, {
      store,
      now: new Date("2026-07-21T12:03:00.000Z")
    });

    expect(simulation).toMatchObject({
      valid: true,
      routeCommit: {
        id: routeCommitId,
        loopId: "marketing_ads",
        status: "waiting_review"
      },
      run: {
        loopId: "marketing_ads",
        status: "WAITING_FOR_REVIEW",
        reviewRequired: true,
        escalationCaseId: expect.stringMatching(/^case_/)
      },
      problem: {
        id: routed.problem?.id,
        status: "waiting"
      },
      lifecycleDelivery: {
        emitted: true,
        eventType: "loop.review.required",
        routeKey: "loopgraph-lifecycle-events",
        status: "pending",
        notificationOnly: true
      },
      lifecycleDeliveries: [
        expect.objectContaining({
          emitted: true,
          eventType: "loop.run.started",
          routeKey: "loopgraph-lifecycle-events",
          notificationOnly: true
        }),
        expect.objectContaining({
          emitted: true,
          eventType: "loop.escalation.created",
          routeKey: "loopgraph-lifecycle-events",
          notificationOnly: true
        }),
        expect.objectContaining({
          emitted: true,
          eventType: "loop.review.required",
          routeKey: "loopgraph-lifecycle-events",
          notificationOnly: true
        })
      ]
    });
    if (!simulation.valid || !simulation.run) {
      throw new Error("Expected route commit simulation with escalation to succeed");
    }

    const lifecycleDeliveries = await listLoopgraphLifecycleDeliveries(projectRoot);
    expect(lifecycleDeliveries).toHaveLength(4);
    const escalationLifecycleDelivery = lifecycleDeliveries.find((delivery) =>
      delivery.event.eventType === "loop.escalation.created"
    );
    expect(escalationLifecycleDelivery).toMatchObject({
      event: {
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        eventType: "loop.escalation.created",
        causationId: event.id,
        parentEventId: event.id,
        correlationId: event.correlationId,
        normalizedPayload: {
          notificationOnly: true,
          routeCommitId,
          problemId: routed.problem?.id,
          loopId: "marketing_ads",
          runId: simulation.run.runId,
          runStatus: "WAITING_FOR_REVIEW",
          routeCommitStatus: "waiting_review",
          problemStatus: "waiting",
          escalationCaseId: simulation.run.escalationCaseId,
          escalationStatus: "open",
          escalationSeverity: "P1",
          escalationCategory: "operational_blocker",
          primaryOwnerRole: "growth_lead",
          reviewerRoles: ["finance"],
          decisionCount: 1
        }
      },
      notificationOnly: true,
      signature: {
        algorithm: "hmac-sha256",
        headerName: "x-loopgraph-signature",
        keyRef: "project:.loopgraph/hermes/lifecycle-signing.key"
      },
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events"
      }
    });
    expect(escalationLifecycleDelivery?.signature.value).toMatch(/^sha256=/);
  });

  it("updates the durable route job when simulating a queued Hermes route commit", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec(marketingAdsSpec({ activationMode: "simulate" }));
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_route_commit_job_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const routed = await loopgraph_routing_decision_submit({
      projectRoot,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: ingest.catalogVersion,
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
          reasonSummary: "Campaign anomaly includes qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_tool_route_commit_job_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });
    expect(routed.routeCommits[0]).toMatchObject({ status: "queued" });
    expect(routed.routeJobs).toEqual([
      expect.objectContaining({
        routeCommitId: routed.routeCommits[0].id,
        status: "queued",
        runId: routed.routeCommits[0].runId
      })
    ]);

    const simulation = await loopgraph_route_commit_simulate({
      projectRoot,
      routeCommitId: routed.routeCommits[0].id,
      simulatedBy: "Growth lead"
    }, {
      store,
      now: new Date("2026-07-21T12:03:00.000Z")
    });
    if (!simulation.valid || !simulation.run) {
      throw new Error("Expected queued route commit simulation to succeed");
    }

    expect(simulation).toMatchObject({
      valid: true,
      routeCommit: {
        id: routed.routeCommits[0].id,
        status: "completed"
      },
      routeJobs: [expect.objectContaining({
        id: routed.routeJobs[0].id,
        routeCommitId: routed.routeCommits[0].id,
        runId: simulation.run.runId,
        status: "completed"
      })]
    });
    expect(await store.listRouteJobs({ routeCommitId: routed.routeCommits[0].id })).toEqual([
      expect.objectContaining({
        id: routed.routeJobs[0].id,
        runId: simulation.run.runId,
        status: "completed"
      })
    ]);
  });

  it("replays stored Hermes events without touching raw payloads or duplicating route commits", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_replay_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const routed = await loopgraph_routing_decision_submit({
      projectRoot,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: ingest.catalogVersion,
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
          reasonSummary: "Campaign anomaly includes qualified-cost evidence.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 0
        }],
        alternatives: [],
        modelMetadata: { hermesTaskId: "task_tool_replay_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    const replay = await loopgraph_events_replay({
      projectRoot,
      eventId: event.id
    }, {
      store,
      now: new Date("2026-07-21T12:05:00.000Z")
    });

    expect(routed.routeCommits).toHaveLength(1);
    expect(replay.receipt.status).toBe("replayed");
    expect(replay.eligibleRoutes.map((route) => route.card.loopId)).toEqual(["marketing_ads"]);
    expect((await store.listEventReceipts()).map((receipt) => receipt.status).sort()).toEqual(["received", "replayed"]);
    expect(await store.listRouteCommits(routed.problem?.id)).toHaveLength(1);
  });

  it("persists human routing corrections and commits the reviewed route through validation", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_tool_human_1");
    const ingest = await loopgraph_events_ingest({ projectRoot, event }, {
      store,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const humanRequest = await loopgraph_routing_decision_submit({
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
        modelMetadata: { hermesTaskId: "task_tool_human_1" },
        policyVersion: "routing-policy/v1alpha1"
      }
    }, {
      store,
      now: new Date("2026-07-21T12:00:03.000Z")
    });

    const reviewed = await loopgraph_routing_human_choice_submit({
      projectRoot,
      eventId: event.id,
      problemId: humanRequest.problem?.id,
      action: "route",
      selectedLoopIds: ["marketing_ads"],
      confidence: 0.98,
      reason: "Growth lead confirmed this is an Ads efficiency problem.",
      correctedBy: "Growth lead"
    }, {
      store,
      now: new Date("2026-07-21T12:02:00.000Z")
    });

    expect(reviewed.correction).toMatchObject({
      eventId: event.id,
      routeAttemptId: humanRequest.attempt.id,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      correctedBy: "Growth lead"
    });
    expect(reviewed.submission.valid).toBe(true);
    expect(reviewed.submission.problem?.status).toBe("routed");
    expect(reviewed.submission.problem?.primaryLoopId).toBe("marketing_ads");
    expect(reviewed.submission.routeCommits).toHaveLength(1);
    expect(reviewed.submission.lifecycleDeliveries).toEqual([
      expect.objectContaining({
        emitted: true,
        eventType: "loop.route.accepted",
        routeKey: "loopgraph-lifecycle-events",
        status: "pending",
        notificationOnly: true
      })
    ]);
    expect((await store.listRoutingCorrections(event.id)).map((correction) => correction.id)).toEqual([
      reviewed.correction.id
    ]);
  });

  it("dispatches known routing tools by name", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();

    const result = await callLoopgraphRoutingTool("loopgraph_routing_catalog_get", { projectRoot });

    expect(result).toMatchObject({ count: 1 });
  });

  it("rejects oversized normalized event payloads before persistence", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = {
      ...adsEvent("delivery_oversized"),
      normalizedPayload: {
        signal: "x".repeat(256 * 1024 + 1)
      }
    };

    await expect(loopgraph_events_ingest({ projectRoot, event }, { store }))
      .rejects.toThrow(/normalizedPayload exceeds|EventEnvelope exceeds|string is too large/);
    await expect(store.listEventReceipts()).resolves.toHaveLength(0);
  });

  it("rejects nested secret-like fields before persistence", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = {
      ...adsEvent("delivery_secret"),
      normalizedPayload: {
        campaign: {
          credentials: {
            accessToken: "must-not-be-stored"
          }
        }
      }
    };

    await expect(loopgraph_events_ingest({ projectRoot, event }, { store }))
      .rejects.toThrow(/forbidden secret-like field: campaign.credentials.accessToken/);
    await expect(store.listEventReceipts()).resolves.toHaveLength(0);
  });

  it("rejects registered routing specs that escape the selected project root", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const outsidePath = path.join(path.dirname(projectRoot), `${path.basename(projectRoot)}-outside.json`);
    await writeFile(outsidePath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
    await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
      version: 1,
      demoCatalogEnabled: false,
      registeredSpecs: [{
        id: "marketing_ads",
        name: "Ads",
        path: path.relative(projectRoot, outsidePath),
        department: "marketing",
        addedAt: "2026-07-21T12:00:00.000Z"
      }]
    }, null, 2)}\n`);

    await expect(loopgraph_routing_catalog_get({ projectRoot }))
      .rejects.toThrow(/routing catalog LoopSpec escapes the project root/);
  });

  it("rejects absolute registered routing specs outside the selected project root", async () => {
    const { projectRoot } = await createProjectWithRoutingSpec();
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-routing-outside-"));
    const outsidePath = path.join(outsideRoot, "outside.json");
    await writeFile(outsidePath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
    await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
      version: 1,
      demoCatalogEnabled: false,
      registeredSpecs: [{
        id: "marketing_ads",
        name: "Ads",
        path: outsidePath,
        department: "marketing",
        addedAt: "2026-07-21T12:00:00.000Z"
      }]
    }, null, 2)}\n`);

    await expect(loopgraph_routing_catalog_get({ projectRoot }))
      .rejects.toThrow(/routing catalog LoopSpec escapes the project root/);
  });
});

function loopSpecStoreWithArtifact(
  artifact: ReturnType<typeof createStoredLoopSpecArtifact>
): LoopSpecRegistryStore {
  return {
    persistence: "distributed",
    async getWorkspace(projectRoot) {
      return {
        workspace: {
          version: 1,
          schemaVersion: "workspace/v1alpha1",
          projectRoot,
          projectRootId: "project_registry",
          displayName: "Registry",
          demoCatalogEnabled: false,
          registeredSpecs: [artifact.entry],
          initializedAt: artifact.createdAt,
          updatedAt: artifact.createdAt
        },
        revision: 1
      };
    },
    async listActiveLoopSpecs() {
      return [artifact];
    },
    async getActiveLoopSpec(_projectRoot, loopId) {
      return loopId === artifact.loopId ? artifact : undefined;
    },
    async commitMaterializationAtomically() {
      throw new Error("not used");
    }
  };
}
