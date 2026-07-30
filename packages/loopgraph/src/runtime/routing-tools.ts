import path from "node:path";
import { z } from "zod";
import {
  compileRoutingCardFromLoopSpec,
  contentHash,
  eventEnvelopeSchema,
  loopSpecHash,
  safeEventSubject,
  safeEventSubjectLabel,
  summarizeTrace,
  routingCorrectionSchema,
  routingCardSchema,
  routingDecisionSchema,
  type BusinessProblem,
  type ConnectionPlanItem,
  type EventEnvelope,
  type EventReceipt,
  type RoutingDecision,
  type RouteCommit,
  type RouteJob,
  type RoutingCard
} from "../core";
import type { AgentRunOutput } from "../core/evidence";
import type { LoopSpec } from "../core/loop-spec";
import { FileStorageAdapter } from "../sdk/storage";
import { buildConnectionPlan } from "./connection-plan";
import { enqueueLoopControllerTriggerBestEffort } from "./loop-controller-triggers";
import {
  emitEscalationCreatedLifecycleEvent,
  emitLoopRunLifecycleEvent,
  emitLoopRunStartedLifecycleEvent,
  emitRouteAcceptedLifecycleEvent,
  type LoopgraphLifecycleEmitResult
} from "./lifecycle-events";
import { loadLoopSpecFromPath } from "./loader";
import type { LoopSpecRegistryStore } from "./loop-spec-store";
import { resolveExistingProjectPath } from "./project-paths";
import {
  FileRoutingStore,
  ingestRoutingEvent,
  submitRoutingDecision,
  updateRouteJobStatus,
  type RoutingDecisionSubmissionResult,
  type RoutingStore
} from "./routing-store";
import { simulateLoop } from "./simulator";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace } from "./workspace";

export const LOOPGRAPH_ROUTING_TOOL_NAMES = [
  "loopgraph_routing_catalog_get",
  "loopgraph_events_ingest",
  "loopgraph_events_replay",
  "loopgraph_routing_decision_submit",
  "loopgraph_routing_human_choice_submit",
  "loopgraph_route_commit_simulate"
] as const;

export const MAX_EVENT_ENVELOPE_BYTES = 512 * 1024;
export const MAX_NORMALIZED_PAYLOAD_BYTES = 256 * 1024;
export const MAX_NORMALIZED_PAYLOAD_DEPTH = 12;
export const MAX_NORMALIZED_PAYLOAD_NODES = 5_000;

export type LoopgraphRoutingToolName = (typeof LOOPGRAPH_ROUTING_TOOL_NAMES)[number];

export type LoopgraphRoutingToolRuntimeOptions = {
  projectRoot?: string;
  store?: RoutingStore;
  loopSpecStore?: LoopSpecRegistryStore;
  now?: Date;
  trustedSpecPaths?: string[];
  trustedRoutingCards?: RoutingCard[];
  trustedCatalogVersion?: string;
};

export const routingCatalogGetInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const eventsIngestInputSchema = z.object({
  projectRoot: z.string().optional(),
  event: eventEnvelopeSchema,
  replay: z.boolean().default(false)
});

export const routingDecisionSubmitInputSchema = z.object({
  projectRoot: z.string().optional(),
  decision: routingDecisionSchema,
  hermesMetadata: z.record(z.string(), z.unknown()).default({})
});

export const eventsReplayInputSchema = z.object({
  projectRoot: z.string().optional(),
  eventId: z.string().min(1),
  hermesMetadata: z.record(z.string(), z.unknown()).default({})
});

export const routingHumanChoiceSubmitInputSchema = z.object({
  projectRoot: z.string().optional(),
  eventId: z.string().min(1),
  routeAttemptId: z.string().optional(),
  problemId: z.string().optional(),
  action: z.enum(["route", "unhandled", "defer", "ignore"]).default("route"),
  selectedLoopIds: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).default(1),
  reason: z.string().min(1),
  correctedBy: z.string().min(1),
  hermesMetadata: z.record(z.string(), z.unknown()).default({})
}).superRefine((value, context) => {
  if (value.action === "route" && value.selectedLoopIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedLoopIds"],
      message: "selectedLoopIds is required when action=route"
    });
  }
  if (value.action !== "route" && value.selectedLoopIds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedLoopIds"],
      message: "selectedLoopIds must be empty unless action=route"
    });
  }
});

export const routeCommitSimulateInputSchema = z.object({
  projectRoot: z.string().optional(),
  routeCommitId: z.string().min(1),
  simulatedBy: z.string().optional()
});

export type RoutingCatalogGetInput = z.input<typeof routingCatalogGetInputSchema>;
export type EventsIngestInput = z.input<typeof eventsIngestInputSchema>;
export type EventsReplayInput = z.input<typeof eventsReplayInputSchema>;
export type RoutingDecisionSubmitInput = z.input<typeof routingDecisionSubmitInputSchema>;
export type RoutingHumanChoiceSubmitInput = z.input<typeof routingHumanChoiceSubmitInputSchema>;
export type RouteCommitSimulateInput = z.input<typeof routeCommitSimulateInputSchema>;

export type RoutingCatalogGetResult = {
  catalogVersion: string;
  routingCards: RoutingCard[];
  count: number;
};

type LifecycleDeliveryToolSummary =
  | {
      emitted: true;
      deliveryId: string;
      eventId: string;
      eventType: string;
      routeKey: string;
      status: string;
      notificationOnly: true;
      warnings: string[];
    }
  | {
      emitted: false;
      skippedReason: string;
      warnings: string[];
    };

type RoutingDecisionSubmissionWithLifecycle = RoutingDecisionSubmissionResult & {
  lifecycleDeliveries: LifecycleDeliveryToolSummary[];
  controllerTrigger: Awaited<ReturnType<typeof enqueueLoopControllerTriggerBestEffort>>;
};

export const loopgraphRoutingToolDefinitions = [
  {
    name: "loopgraph_routing_catalog_get",
    description: "Return the active Loopgraph routing catalog as bounded routing cards for Hermes."
  },
  {
    name: "loopgraph_events_ingest",
    description: "Persist a normalized EventEnvelope, dedupe it, and return eligible routing cards before Hermes reasons."
  },
  {
    name: "loopgraph_events_replay",
    description: "Replay a stored normalized EventEnvelope through durable ingest without reusing raw provider payloads."
  },
  {
    name: "loopgraph_routing_decision_submit",
    description: "Validate and commit a Hermes RoutingDecision into durable problems and route commits."
  },
  {
    name: "loopgraph_routing_human_choice_submit",
    description: "Persist a human routing correction and submit the reviewed route, unhandled, defer, or ignore decision through Loopgraph validation."
  },
  {
    name: "loopgraph_route_commit_simulate",
    description: "Run a validated route commit in local simulation mode and link the resulting trace back to the route commit."
  }
] satisfies Array<{ name: LoopgraphRoutingToolName; description: string }>;

export async function loopgraph_routing_catalog_get(
  input: RoutingCatalogGetInput = {},
  options: LoopgraphRoutingToolRuntimeOptions = {}
): Promise<RoutingCatalogGetResult> {
  const parsed = routingCatalogGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const routingCards = options.trustedRoutingCards ?? await loadRoutingCardsFromProject({
    projectRoot,
    specPaths: options.trustedSpecPaths,
    catalogVersion: options.trustedCatalogVersion,
    loopSpecStore: options.loopSpecStore
  });
  const catalogVersion = options.trustedCatalogVersion ?? deriveCatalogVersion(routingCards);
  const normalizedCards = routingCards.map((card) => routingCardSchema.parse({
    ...card,
    catalogVersion
  }));

  return {
    catalogVersion,
    routingCards: normalizedCards,
    count: normalizedCards.length
  };
}

export async function loopgraph_events_ingest(
  input: EventsIngestInput,
  options: LoopgraphRoutingToolRuntimeOptions = {}
) {
  const parsed = eventsIngestInputSchema.parse(input);
  assertSafeEventEnvelope(parsed.event);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const catalog = await loopgraph_routing_catalog_get({
    projectRoot
  }, options);
  const store = options.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const result = await ingestRoutingEvent({
    store,
    event: parsed.event,
    routingCards: catalog.routingCards,
    replay: parsed.replay,
    now: options.now
  });
  const controllerTrigger = await enqueueLoopControllerTriggerBestEffort({
    projectRoot,
    type: "routing_event",
    triggerId: result.receipt.eventId,
    sourceRef: `routing-event:${result.receipt.eventId}`,
    occurredAt: result.receipt.event.receivedAt,
    requestedBy: "loopgraph-event-ingest",
    evidenceRefs: [result.receipt.id, result.receipt.eventId]
  }, { now: options.now });

  return {
    ...result,
    catalogVersion: catalog.catalogVersion,
    controllerTrigger
  };
}

export function assertSafeEventEnvelope(event: EventEnvelope): void {
  const eventBytes = byteLengthOfJson(event, "EventEnvelope");
  if (eventBytes > MAX_EVENT_ENVELOPE_BYTES) {
    throw new Error(
      `EventEnvelope exceeds ${MAX_EVENT_ENVELOPE_BYTES} bytes (${eventBytes} received)`
    );
  }
  const payloadBytes = byteLengthOfJson(event.normalizedPayload, "normalizedPayload");
  if (payloadBytes > MAX_NORMALIZED_PAYLOAD_BYTES) {
    throw new Error(
      `normalizedPayload exceeds ${MAX_NORMALIZED_PAYLOAD_BYTES} bytes (${payloadBytes} received)`
    );
  }

  let nodeCount = 0;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number, trail: string[]): void => {
    nodeCount += 1;
    if (nodeCount > MAX_NORMALIZED_PAYLOAD_NODES) {
      throw new Error(`normalizedPayload exceeds ${MAX_NORMALIZED_PAYLOAD_NODES} values`);
    }
    if (depth > MAX_NORMALIZED_PAYLOAD_DEPTH) {
      throw new Error(`normalizedPayload exceeds maximum depth ${MAX_NORMALIZED_PAYLOAD_DEPTH}`);
    }
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > 16 * 1024) {
      throw new Error(`normalizedPayload string is too large at ${trail.join(".") || "<root>"}`);
    }
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) throw new Error("normalizedPayload must not contain cycles");
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > 1_000) {
        throw new Error(`normalizedPayload array is too large at ${trail.join(".") || "<root>"}`);
      }
      value.forEach((item, index) => visit(item, depth + 1, [...trail, String(index)]));
      return;
    }

    const entries = Object.entries(value);
    if (entries.length > 500) {
      throw new Error(`normalizedPayload object has too many fields at ${trail.join(".") || "<root>"}`);
    }
    for (const [key, child] of entries) {
      if (key.length > 256) {
        throw new Error(`normalizedPayload field name is too long at ${trail.join(".") || "<root>"}`);
      }
      if (isSecretLikePayloadKey(key)) {
        throw new Error(`normalizedPayload contains forbidden secret-like field: ${[...trail, key].join(".")}`);
      }
      visit(child, depth + 1, [...trail, key]);
    }
  };
  visit(event.normalizedPayload, 0, []);
}

function byteLengthOfJson(value: unknown, label: string): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }
}

function isSecretLikePayloadKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
  if ([
    "secret",
    "token",
    "password",
    "passwd",
    "authorization",
    "cookie",
    "set_cookie",
    "api_key",
    "apikey",
    "client_secret",
    "access_token",
    "refresh_token",
    "private_key",
    "signing_key",
    "webhook_secret"
  ].includes(normalized)) return true;
  return /(^|_)(password|passwd|secret|private_key)$/.test(normalized) ||
    /(^|_)(access|refresh|auth|bearer|github|slack|hubspot|api)_?token$/.test(normalized);
}

export async function loopgraph_routing_decision_submit(
  input: RoutingDecisionSubmitInput,
  options: LoopgraphRoutingToolRuntimeOptions = {}
) {
  const parsed = routingDecisionSubmitInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const catalog = await loopgraph_routing_catalog_get({
    projectRoot
  }, options);
  const store = options.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));

  return submitRoutingDecisionWithAcceptedLifecycle({
    projectRoot,
    store,
    decision: parsed.decision,
    routingCards: catalog.routingCards,
    catalogVersion: catalog.catalogVersion,
    now: options.now,
    hermesMetadata: parsed.hermesMetadata
  });
}

export async function loopgraph_events_replay(
  input: EventsReplayInput,
  options: LoopgraphRoutingToolRuntimeOptions = {}
) {
  const parsed = eventsReplayInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const store = options.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const receipt = await findEventReceipt(store, parsed.eventId);
  if (!receipt) throw new Error(`Event receipt not found: ${parsed.eventId}`);

  return loopgraph_events_ingest({
    projectRoot,
    event: receipt.event,
    replay: true
  }, {
    ...options,
    projectRoot,
    store
  });
}

export async function loopgraph_routing_human_choice_submit(
  input: RoutingHumanChoiceSubmitInput,
  options: LoopgraphRoutingToolRuntimeOptions = {}
) {
  const parsed = routingHumanChoiceSubmitInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const store = options.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const receipt = await findEventReceipt(store, parsed.eventId);
  if (!receipt) throw new Error(`Event receipt not found: ${parsed.eventId}`);

  const catalog = await loopgraph_routing_catalog_get({
    projectRoot
  }, options);
  const attempts = (await store.listRoutingAttempts(receipt.eventId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const sourceAttempt = parsed.routeAttemptId
    ? attempts.find((attempt) => attempt.id === parsed.routeAttemptId)
    : attempts.find((attempt) => attempt.action === "request_human") ?? attempts[0];
  if (parsed.routeAttemptId && !sourceAttempt) {
    throw new Error(`Routing attempt not found for event ${receipt.eventId}: ${parsed.routeAttemptId}`);
  }

  const problem = await findHumanChoiceProblem({
    store,
    problemId: parsed.problemId,
    eventId: receipt.eventId
  });
  const selectedCards = parsed.selectedLoopIds.map((loopId) => {
    const card = catalog.routingCards.find((candidate) => candidate.loopId === loopId);
    if (!card) throw new Error(`Selected loop "${loopId}" is not in the routing catalog`);
    return card;
  });
  const problemInput = parsed.action === "ignore"
    ? undefined
    : {
        summary: problem?.summary ?? humanChoiceSummary(parsed.action, receipt, selectedCards),
        problemTypes: selectedCards.length > 0
          ? uniqueStrings(selectedCards.flatMap((card) => card.problemTypes))
          : problem ? [problem.problemType] : ["unhandled_business_problem"],
        subject: problem?.subject ?? safeEventSubject(receipt.event),
        severity: problem?.severity ?? "medium" as const,
        dedupeKeyInputs: [receipt.event.subject.id, receipt.event.eventType]
      };
  const decision = routingDecisionSchema.parse({
    schemaVersion: "routing-decision/v1alpha1",
    eventId: receipt.eventId,
    catalogVersion: catalog.catalogVersion,
    action: parsed.action,
    ...(problem?.id ? { existingProblemId: problem.id } : {}),
    ...(problemInput ? { problem: problemInput } : {}),
    selectedRoutes: selectedCards.map((card) => ({
      loopId: card.loopId,
      role: "primary",
      confidence: Math.max(parsed.confidence, card.minimumConfidence),
      reasonSummary: parsed.reason,
      evidenceRefs: receipt.event.evidenceRefs,
      inputMapping: mapEventInputs(receipt.event, card.inputMapping),
      priority: card.priority
    })),
    alternatives: sourceAttempt?.decision?.alternatives ?? [],
    modelMetadata: {
      router: "human-choice",
      sourceAttemptId: sourceAttempt?.id,
      correctedBy: parsed.correctedBy
    },
    policyVersion: "routing-policy/v1alpha1"
  });
  const nowIso = (options.now ?? new Date()).toISOString();
  const correction = routingCorrectionSchema.parse({
    id: `correction_${contentHash({
      eventId: receipt.eventId,
      action: parsed.action,
      selectedLoopIds: parsed.selectedLoopIds,
      reason: parsed.reason,
      correctedBy: parsed.correctedBy,
      at: nowIso
    })}`,
    eventId: receipt.eventId,
    routeAttemptId: sourceAttempt?.id,
    expectedAction: parsed.action,
    expectedLoopIds: parsed.selectedLoopIds,
    reason: parsed.reason,
    correctedBy: parsed.correctedBy,
    correctedAt: nowIso
  });
  await store.saveRoutingCorrection(correction);
  const submission = await submitRoutingDecisionWithAcceptedLifecycle({
    projectRoot,
    store,
    decision,
    routingCards: catalog.routingCards,
    catalogVersion: catalog.catalogVersion,
    now: options.now,
    hermesMetadata: {
      ...parsed.hermesMetadata,
      humanChoice: true,
      correctionId: correction.id
    }
  });

  return {
    correction,
    submission,
    sourceAttempt,
    selectedCards
  };
}

async function submitRoutingDecisionWithAcceptedLifecycle(input: {
  projectRoot: string;
  store: RoutingStore;
  decision: RoutingDecision;
  routingCards: RoutingCard[];
  catalogVersion: string;
  now?: Date;
  hermesMetadata?: Record<string, unknown>;
}): Promise<RoutingDecisionSubmissionWithLifecycle> {
  const submission = await submitRoutingDecision({
    store: input.store,
    decision: input.decision,
    routingCards: input.routingCards,
    catalogVersion: input.catalogVersion,
    now: input.now,
    hermesMetadata: input.hermesMetadata
  });

  const receipt = submission.valid && submission.routeCommits.length > 0
    ? await findEventReceipt(input.store, input.decision.eventId)
    : null;
  const lifecycleDeliveries = receipt
    ? await Promise.all(submission.routeCommits.map((routeCommit) =>
        emitRouteAcceptedLifecycleEvent({
          projectRoot: input.projectRoot,
          sourceEvent: receipt.event,
          routeCommit,
          problem: submission.problem,
          now: input.now
        })
      ))
    : [];
  const controllerTrigger = await enqueueLoopControllerTriggerBestEffort({
    projectRoot: input.projectRoot,
    type: "routing_event",
    triggerId: submission.attempt.id,
    sourceRef: `routing-decision:${submission.attempt.id}`,
    occurredAt: submission.attempt.createdAt,
    requestedBy: "loopgraph-routing-decision",
    evidenceRefs: [
      submission.attempt.id,
      ...(submission.problem ? [submission.problem.id] : []),
      ...submission.routeJobs.map((job) => job.id)
    ]
  }, { now: input.now });

  return {
    ...submission,
    lifecycleDeliveries: lifecycleDeliveries.map(summarizeLifecycleResult),
    controllerTrigger
  };
}

function summarizeLifecycleResult(lifecycle: LoopgraphLifecycleEmitResult): LifecycleDeliveryToolSummary {
  return lifecycle.emitted
    ? {
        emitted: true,
        deliveryId: lifecycle.delivery.id,
        eventId: lifecycle.delivery.event.id,
        eventType: lifecycle.delivery.event.eventType,
        routeKey: lifecycle.delivery.target.routeKey,
        status: lifecycle.delivery.status,
        notificationOnly: lifecycle.delivery.notificationOnly,
        warnings: lifecycle.warnings
      }
    : lifecycle;
}

export async function loopgraph_route_commit_simulate(
  input: RouteCommitSimulateInput,
  options: LoopgraphRoutingToolRuntimeOptions = {}
) {
  const parsed = routeCommitSimulateInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const store = options.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const commit = await findRouteCommit(store, parsed.routeCommitId);
  if (!commit) throw new Error(`Route commit not found: ${parsed.routeCommitId}`);
  if (commit.status === "cancelled") throw new Error(`Route commit ${commit.id} is cancelled and cannot be simulated`);

  const receipt = await findEventReceipt(store, commit.eventId);
  if (!receipt) throw new Error(`Event receipt not found for route commit ${commit.id}: ${commit.eventId}`);
  const loaded = await loadRegisteredLoopSpec(
    projectRoot,
    commit.loopId,
    options.loopSpecStore
  );
  if (!loaded.ok) {
    return {
      schemaVersion: "route-commit-simulation/v1alpha1",
      valid: false,
      errors: loaded.errors,
      projectRoot,
      routeCommitId: commit.id,
      loopId: commit.loopId
    };
  }

  const specHash = loopSpecHash(loaded.spec);
  if (specHash !== commit.loopSpecHash) {
    return {
      schemaVersion: "route-commit-simulation/v1alpha1",
      valid: false,
      errors: [`Route commit ${commit.id} references LoopSpec hash ${commit.loopSpecHash}, but the registered LoopSpec now hashes to ${specHash}`],
      projectRoot,
      routeCommitId: commit.id,
      loopId: commit.loopId
    };
  }

  const nowIso = (options.now ?? new Date()).toISOString();
  const storage = new FileStorageAdapter(getLoopgraphRoot(projectRoot));
  const simulation = await simulateLoop({
    spec: loaded.spec,
    fixture: buildRouteCommitSimulationFixture({
      spec: loaded.spec,
      receipt,
      commit,
      simulatedAt: nowIso,
      simulatedBy: parsed.simulatedBy
    }),
    storage
  });
  const updatedCommit = {
    ...commit,
    runId: simulation.trace.id,
    status: routeCommitStatusForTraceStatus(simulation.trace.status)
  } satisfies RouteCommit;
  await store.saveRouteCommit(updatedCommit);
  const updatedJobs = await updateRouteJobsAfterSimulation({
    store,
    commit: updatedCommit,
    runId: simulation.trace.id,
    nowIso
  });

  const problem = await store.getBusinessProblem(commit.problemId);
  const updatedProblem = problem
    ? await updateProblemAfterRouteSimulation({
        store,
        problem,
        commit: updatedCommit,
        nowIso
      })
    : undefined;
  const lifecycleStarted = await emitLoopRunStartedLifecycleEvent({
    projectRoot,
    sourceEvent: receipt.event,
    routeCommit: updatedCommit,
    trace: simulation.trace,
    problem: updatedProblem,
    now: options.now
  });
  const escalationLifecycle = simulation.escalationCase
    ? await emitEscalationCreatedLifecycleEvent({
        projectRoot,
        sourceEvent: receipt.event,
        routeCommit: updatedCommit,
        trace: simulation.trace,
        escalationCase: simulation.escalationCase,
        problem: updatedProblem,
        now: options.now
      })
    : undefined;
  const lifecycle = await emitLoopRunLifecycleEvent({
    projectRoot,
    sourceEvent: receipt.event,
    routeCommit: updatedCommit,
    trace: simulation.trace,
    problem: updatedProblem,
    now: options.now
  });

  return {
    schemaVersion: "route-commit-simulation/v1alpha1",
    valid: true,
    errors: [],
    projectRoot,
    routeCommit: updatedCommit,
    routeJobs: updatedJobs,
    problem: updatedProblem,
    run: {
      runId: simulation.trace.id,
      loopId: simulation.trace.loopId,
      status: simulation.trace.status,
      mode: simulation.trace.mode,
      summary: simulation.summary,
      traceSummary: summarizeTrace(simulation.trace, simulation.escalationCase),
      reviewRequired: simulation.trace.status === "WAITING_FOR_REVIEW",
      escalationCaseId: simulation.escalationCase?.id
    },
    lifecycleDelivery: lifecycle.emitted
      ? {
          emitted: true,
          deliveryId: lifecycle.delivery.id,
          eventId: lifecycle.delivery.event.id,
          eventType: lifecycle.delivery.event.eventType,
          routeKey: lifecycle.delivery.target.routeKey,
          status: lifecycle.delivery.status,
          notificationOnly: lifecycle.delivery.notificationOnly,
          warnings: lifecycle.warnings
        }
      : lifecycle,
    lifecycleDeliveries: [lifecycleStarted, escalationLifecycle, lifecycle]
      .filter((delivery): delivery is LoopgraphLifecycleEmitResult => delivery !== undefined)
      .map(summarizeLifecycleResult),
    nextActions: simulation.trace.status === "WAITING_FOR_REVIEW"
      ? [
          "Call loopgraph_runs_get with includeReviewPacket=true, then submit an explicit human decision with loopgraph_review_submit.",
          "Inspect loopgraph_lifecycle_events_get to confirm the signed notification-only lifecycle event prepared for Hermes."
        ]
      : [
          "Inspect the event-routing graph to see the route commit linked to the local simulation run.",
          "Inspect loopgraph_lifecycle_events_get to confirm the signed notification-only lifecycle event prepared for Hermes."
        ]
  };
}

export async function callLoopgraphRoutingTool(
  name: LoopgraphRoutingToolName,
  input: unknown,
  options: LoopgraphRoutingToolRuntimeOptions = {}
) {
  if (name === "loopgraph_routing_catalog_get") {
    return loopgraph_routing_catalog_get(input as RoutingCatalogGetInput, options);
  }
  if (name === "loopgraph_events_ingest") {
    return loopgraph_events_ingest(input as EventsIngestInput, options);
  }
  if (name === "loopgraph_events_replay") {
    return loopgraph_events_replay(input as EventsReplayInput, options);
  }
  if (name === "loopgraph_routing_decision_submit") {
    return loopgraph_routing_decision_submit(input as RoutingDecisionSubmitInput, options);
  }
  if (name === "loopgraph_routing_human_choice_submit") {
    return loopgraph_routing_human_choice_submit(input as RoutingHumanChoiceSubmitInput, options);
  }
  if (name === "loopgraph_route_commit_simulate") {
    return loopgraph_route_commit_simulate(input as RouteCommitSimulateInput, options);
  }
  throw new Error(`Unknown Loopgraph routing tool: ${String(name)}`);
}

export async function loadRoutingCardsFromProject(input: {
  projectRoot: string;
  specPaths?: string[];
  catalogVersion?: string;
  loopSpecStore?: LoopSpecRegistryStore;
}): Promise<RoutingCard[]> {
  const connectionReadinessByCapability = await buildConnectionReadinessIndex(input.projectRoot);
  const compiledCards: RoutingCard[] = [];

  const specs = input.loopSpecStore
    ? (await input.loopSpecStore.listActiveLoopSpecs(input.projectRoot))
        .map((artifact) => artifact.spec)
    : await loadRoutingSpecsFromPaths(
        input.projectRoot,
        input.specPaths ??
          await readRegisteredSpecPaths(input.projectRoot)
      );
  for (const spec of specs) {
    const card = compileRoutingCardFromLoopSpec(spec, {
      catalogVersion: input.catalogVersion ?? "catalog_pending",
      currentReadiness: readinessForRequiredConnections(
        spec.routing?.requiredConnections ?? [],
        connectionReadinessByCapability
      )
    });
    if (card) compiledCards.push(card);
  }

  const catalogVersion = input.catalogVersion ?? deriveCatalogVersion(compiledCards);
  return compiledCards.map((card) => routingCardSchema.parse({
    ...card,
    catalogVersion
  }));
}

async function loadRoutingSpecsFromPaths(
  projectRoot: string,
  specPaths: string[]
): Promise<LoopSpec[]> {
  const specs: LoopSpec[] = [];
  for (const specPath of specPaths) {
    const absolutePath = await resolveExistingProjectPath(
      projectRoot,
      specPath,
      "routing catalog LoopSpec"
    );
    const loaded = await loadLoopSpecFromPath(absolutePath);
    if (loaded.ok) specs.push(loaded.spec);
  }
  return specs;
}

function deriveCatalogVersion(cards: RoutingCard[]): string {
  return `catalog_${contentHash(cards.map((card) => ({
    loopId: card.loopId,
    loopSpecHash: card.loopSpecHash,
    routingContractVersion: card.routingContractVersion
  })))}`;
}

async function readRegisteredSpecPaths(projectRoot: string): Promise<string[]> {
  const workspace = await readLoopgraphWorkspace(projectRoot);
  return workspace.registeredSpecs.map((entry) => entry.path);
}

async function buildConnectionReadinessIndex(projectRoot: string): Promise<Map<string, ConnectionPlanItem>> {
  const plan = await buildConnectionPlan({ projectRoot });
  return new Map(plan.items.map((item) => [item.capability, item]));
}

function readinessForRequiredConnections(
  requiredConnections: string[],
  connectionReadinessByCapability: Map<string, ConnectionPlanItem>
): RoutingCard["currentReadiness"] {
  if (requiredConnections.length === 0) return "ready";

  const statuses = requiredConnections.map((capability) =>
    connectionReadinessByCapability.get(capability)?.status ?? "missing"
  );

  if (statuses.includes("missing")) return "blocked";
  if (statuses.includes("degraded") || statuses.includes("manual_fallback")) return "degraded";
  return "ready";
}

function resolveProjectRoot(inputProjectRoot: string | undefined, optionProjectRoot: string | undefined): string {
  return path.resolve(inputProjectRoot ?? optionProjectRoot ?? process.cwd());
}

async function findEventReceipt(store: RoutingStore, eventIdOrReceiptId: string): Promise<EventReceipt | null> {
  const receipts = await store.listEventReceipts();
  return receipts.find((receipt) => receipt.eventId === eventIdOrReceiptId || receipt.id === eventIdOrReceiptId) ?? null;
}

async function findRouteCommit(store: RoutingStore, routeCommitId: string): Promise<RouteCommit | null> {
  return (await store.listRouteCommits()).find((commit) => commit.id === routeCommitId) ?? null;
}

async function updateRouteJobsAfterSimulation(input: {
  store: RoutingStore;
  commit: RouteCommit;
  runId: string;
  nowIso: string;
}): Promise<RouteJob[]> {
  const jobs = await input.store.listRouteJobs({ routeCommitId: input.commit.id });
  const updatedJobs: RouteJob[] = [];

  for (const job of jobs) {
    const updated = await updateRouteJobStatus({
      store: input.store,
      jobId: job.id,
      runId: input.runId,
      status: routeJobStatusForCommitStatus(input.commit.status),
      clearLease: true,
      now: new Date(input.nowIso)
    });
    updatedJobs.push(updated);
  }

  return updatedJobs;
}

function routeJobStatusForCommitStatus(status: RouteCommit["status"]): RouteJob["status"] {
  if (status === "waiting_review") return "waiting_review";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running") return "running";
  return "queued";
}

async function loadRegisteredLoopSpec(
  projectRoot: string,
  loopId: string,
  loopSpecStore?: LoopSpecRegistryStore
) {
  if (loopSpecStore) {
    const artifact = await loopSpecStore.getActiveLoopSpec(projectRoot, loopId);
    return artifact
      ? {
          ok: true as const,
          spec: artifact.spec,
          sourcePath: artifact.sourceRef ?? artifact.entry.path
        }
      : {
          ok: false as const,
          errors: [`Registered LoopSpec not found for loopId: ${loopId}`],
          sourcePath: projectRoot
        };
  }
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const entry = workspace.registeredSpecs.find((candidate) => candidate.id === loopId);
  if (!entry) {
    return {
      ok: false as const,
      errors: [`Registered LoopSpec not found for loopId: ${loopId}`],
      sourcePath: projectRoot
    };
  }
  const specPath = resolveConfinedProjectPath(projectRoot, entry.path, "Registered LoopSpec path");
  return loadLoopSpecFromPath(specPath);
}

export function buildRouteCommitSimulationFixture(input: {
  spec: LoopSpec;
  receipt: EventReceipt;
  commit: RouteCommit;
  simulatedAt: string;
  simulatedBy?: string;
}) {
  return {
    eventId: input.receipt.eventId,
    simulatedAt: input.simulatedAt,
    trigger: input.receipt.event,
    routing: {
      routeCommitId: input.commit.id,
      routeAttemptId: input.commit.routeAttemptId,
      problemId: input.commit.problemId,
      loopId: input.commit.loopId,
      correlationId: input.receipt.event.correlationId,
      causationId: input.receipt.event.causationId,
      inputMapping: input.commit.inputMapping,
      simulatedBy: input.simulatedBy ?? "operator"
    },
    event: {
      source: input.receipt.event.source,
      sourceRoute: input.receipt.event.sourceRoute,
      eventType: input.receipt.event.eventType,
      subject: input.receipt.event.subject,
      normalizedPayload: input.receipt.event.normalizedPayload,
      evidenceRefs: input.receipt.event.evidenceRefs,
      trust: input.receipt.event.trust,
      sensitivity: input.receipt.event.sensitivity
    },
    expectedAssessment: routeCommitExpectedAssessment(input.spec, input.receipt, input.commit)
  };
}

function routeCommitExpectedAssessment(
  spec: LoopSpec,
  receipt: EventReceipt,
  commit: RouteCommit
): AgentRunOutput {
  const allowed = spec.policy.allowedActions.find((action) => action.allowed) ?? spec.policy.allowedActions[0];
  const tool = allowed ? spec.tools.find((candidate) => candidate.key === allowed.toolKey) : spec.tools[0];
  const proposedActions = tool
    ? [{
        id: "act_route_commit_preview",
        toolKey: tool.key,
        label: `Prepare ${tool.label}`,
        input: {
          routeCommitId: commit.id,
          eventId: receipt.eventId,
          correlationId: receipt.event.correlationId,
          subject: safeEventSubject(receipt.event),
          mappedInputs: commit.inputMapping,
          normalizedPayload: receipt.event.normalizedPayload
        },
        riskLevel: allowed?.riskLevel ?? tool.riskLevel,
        requiresApproval: allowed?.requiresApproval ?? false,
        customerFacing: allowed?.customerFacing ?? false
      }]
    : [];

  return {
    decisionSummary: `Local simulation for Hermes route ${commit.id}: ${spec.metadata.name} is handling ${receipt.event.eventType} for ${safeEventSubjectLabel(receipt.event)}.`,
    assumptions: [{
      id: "assumption_route_commit",
      statement: "Hermes already selected this loop through a validated RoutingDecision; this run uses only the normalized EventEnvelope.",
      confidence: 1
    }],
    proposedActions,
    evidence: [{
      id: "evidence_event",
      sourceId: `event:${receipt.eventId}`,
      sourceType: "event",
      excerpt: `${receipt.event.source}/${receipt.event.eventType} for ${receipt.event.subject.type}:${receipt.event.subject.id}`,
      trusted: receipt.event.trust.signatureVerified
    }],
    policyInputs: [
      { key: "routeCommit.id", value: commit.id, source: "loopgraph-routing-store" },
      { key: "event.correlationId", value: receipt.event.correlationId, source: "event-envelope" },
      { key: "event.sensitivity", value: receipt.event.sensitivity, source: "event-envelope" }
    ],
    verificationRequest: {
      required: proposedActions.some((action) => action.requiresApproval),
      checks: ["evidence", "policy"]
    },
    escalationRequest: { required: false }
  };
}

function routeCommitStatusForTraceStatus(status: string): RouteCommit["status"] {
  if (status === "WAITING_FOR_REVIEW") return "waiting_review";
  if (status === "COMPLETED") return "completed";
  if (status === "BLOCKED_BY_POLICY" || status === "FAILED_VERIFICATION" || status === "REJECTED") return "failed";
  return "running";
}

async function updateProblemAfterRouteSimulation(input: {
  store: RoutingStore;
  problem: BusinessProblem;
  commit: RouteCommit;
  nowIso: string;
}): Promise<BusinessProblem> {
  const status: BusinessProblem["status"] = input.commit.status === "waiting_review"
    ? "waiting"
    : input.commit.status === "failed"
      ? "waiting"
      : "routed";
  const updated = {
    ...input.problem,
    status,
    updatedAt: input.nowIso
  };
  await input.store.saveBusinessProblem(updated);
  return updated;
}

async function findHumanChoiceProblem(input: {
  store: RoutingStore;
  problemId?: string;
  eventId: string;
}) {
  if (input.problemId) {
    const problem = await input.store.getBusinessProblem(input.problemId);
    if (!problem) throw new Error(`Business problem not found: ${input.problemId}`);
    return problem;
  }

  const problems = await input.store.listBusinessProblems();
  return problems
    .filter((problem) => problem.evidenceEventIds.includes(input.eventId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function humanChoiceSummary(
  action: RoutingHumanChoiceSubmitInput["action"],
  receipt: EventReceipt,
  selectedCards: RoutingCard[]
): string {
  if (action === "route" && selectedCards[0]) {
    return `Human selected ${selectedCards[0].loopName} for ${receipt.event.eventType}.`;
  }
  if (action === "unhandled") {
    return `Human marked ${receipt.event.eventType} from ${receipt.event.source} as an unhandled business problem.`;
  }
  if (action === "defer") {
    return `Human deferred routing for ${receipt.event.eventType} from ${receipt.event.source}.`;
  }
  return `Human ignored ${receipt.event.eventType} from ${receipt.event.source}.`;
}

function mapEventInputs(event: EventReceipt["event"], inputMapping: Record<string, string>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [targetKey, sourcePath] of Object.entries(inputMapping)) {
    const value = readEventPath(event, sourcePath);
    if (value !== undefined) mapped[targetKey] = value;
  }
  return mapped;
}

function readEventPath(event: EventReceipt["event"], sourcePath: string): unknown {
  const direct = readPath(event as unknown as Record<string, unknown>, sourcePath);
  if (direct !== undefined) return direct;
  return readPath(event.normalizedPayload, sourcePath);
}

function readPath(input: Record<string, unknown>, dottedPath: string): unknown {
  let cursor: unknown = input;
  for (const segment of dottedPath.split(".").filter(Boolean)) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function resolveConfinedProjectPath(projectRoot: string, candidate: string, label: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} must be inside the selected project root.`);
  }
  return resolved;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
