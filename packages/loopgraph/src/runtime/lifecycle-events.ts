import { createHmac } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  contentHash,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  type BusinessProblem,
  type EventEnvelope,
  type EscalationCase,
  type LoopRunTrace,
  type RouteCommit
} from "../core";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION = "loopgraph-lifecycle/v1alpha1" as const;
export const LOOPGRAPH_LIFECYCLE_ROUTE = "loopgraph.lifecycle" as const;
export const LOOPGRAPH_LIFECYCLE_ROUTE_KEY = "loopgraph-lifecycle-events" as const;
export const MAX_LOOPGRAPH_LIFECYCLE_HOP_COUNT = 3;

export const LOOPGRAPH_LIFECYCLE_EVENT_TYPES = [
  "loop.route.accepted",
  "loop.run.started",
  "loop.run.completed",
  "loop.review.required",
  "loop.run.failed",
  "loop.escalation.created",
  "loop.outcome.recorded",
  "loop.problem.unhandled"
] as const;

export const loopgraphLifecycleEventTypeSchema = z.enum(LOOPGRAPH_LIFECYCLE_EVENT_TYPES);

export const loopgraphLifecycleDeliveryStatusSchema = z.enum([
  "pending",
  "sent",
  "failed"
]);

export const loopgraphLifecycleDeliverySchema = z.object({
  schemaVersion: z.literal(LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION).default(LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION),
  id: z.string().min(1),
  event: eventEnvelopeSchema,
  eventHash: z.string().min(1),
  notificationOnly: z.literal(true).default(true),
  status: loopgraphLifecycleDeliveryStatusSchema.default("pending"),
  signature: z.object({
    algorithm: z.literal("hmac-sha256"),
    headerName: z.literal("x-loopgraph-signature"),
    value: z.string().min(1),
    keyRef: z.string().min(1)
  }),
  target: z.object({
    owner: z.literal("hermes"),
    routeKey: z.literal(LOOPGRAPH_LIFECYCLE_ROUTE_KEY),
    sourceRoute: z.literal(LOOPGRAPH_LIFECYCLE_ROUTE)
  }),
  createdAt: z.string().datetime(),
  warnings: z.array(z.string()).default([])
});

export type LoopgraphLifecycleEventType = z.infer<typeof loopgraphLifecycleEventTypeSchema>;
export type LoopgraphLifecycleDeliveryStatus = z.infer<typeof loopgraphLifecycleDeliveryStatusSchema>;
export type LoopgraphLifecycleDelivery = z.infer<typeof loopgraphLifecycleDeliverySchema>;

export type LoopgraphLifecycleEmitResult =
  | {
      emitted: true;
      delivery: LoopgraphLifecycleDelivery;
      warnings: string[];
    }
  | {
      emitted: false;
      skippedReason: string;
      warnings: string[];
    };

export async function emitLoopRunLifecycleEvent(input: {
  projectRoot: string;
  sourceEvent: EventEnvelope;
  routeCommit: RouteCommit;
  trace: LoopRunTrace;
  problem?: BusinessProblem;
  now?: Date;
  signingSecret?: string;
  keyRef?: string;
}): Promise<LoopgraphLifecycleEmitResult> {
  const cycleGuard = lifecycleCycleGuard(input.sourceEvent);
  if (cycleGuard) {
    return {
      emitted: false,
      skippedReason: cycleGuard,
      warnings: [cycleGuard]
    };
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const eventType = lifecycleEventTypeForTrace(input.trace, input.problem);
  const sourceDeliveryId = `${input.trace.id}:${eventType}`;
  const idBase = {
    workspaceId: input.sourceEvent.workspaceId,
    source: "loopgraph",
    sourceDeliveryId,
    eventType
  };
  const event = eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(idBase),
    schemaVersion: "event-envelope/v1alpha1",
    workspaceId: input.sourceEvent.workspaceId,
    companyId: input.sourceEvent.companyId,
    source: "loopgraph",
    sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE,
    sourceDeliveryId,
    eventType,
    occurredAt: input.trace.completedAt ?? nowIso,
    receivedAt: nowIso,
    subject: {
      type: "loop_run",
      id: input.trace.id,
      display: `${input.trace.loopId} ${input.trace.status}`
    },
    correlationId: input.sourceEvent.correlationId,
    causationId: input.sourceEvent.id,
    parentEventId: input.sourceEvent.id,
    hopCount: input.sourceEvent.hopCount + 1,
    normalizedPayload: {
      notificationOnly: true,
      sourceEventId: input.sourceEvent.id,
      routeCommitId: input.routeCommit.id,
      routeAttemptId: input.routeCommit.routeAttemptId,
      problemId: input.routeCommit.problemId,
      loopId: input.trace.loopId,
      runId: input.trace.id,
      runStatus: input.trace.status,
      routeCommitStatus: input.routeCommit.status,
      reviewRequired: input.trace.status === "WAITING_FOR_REVIEW",
      escalationCaseIds: input.trace.escalationCases,
      problemStatus: input.problem?.status,
      outcomeRefs: input.problem?.outcomeRefs ?? []
    },
    evidenceRefs: [
      `trace:${input.trace.id}`,
      `route_commit:${input.routeCommit.id}`,
      ...(input.problem ? [`problem:${input.problem.id}`] : [])
    ],
    trust: {
      signatureVerified: true,
      signer: "loopgraph",
      untrustedFields: []
    },
    sensitivity: input.sourceEvent.sensitivity
  });
  const signing = resolveLifecycleSigning(input.signingSecret, input.keyRef);
  const eventHash = contentHash(event);
  const delivery = loopgraphLifecycleDeliverySchema.parse({
    schemaVersion: LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION,
    id: `lifecycle_${contentHash({
      eventId: event.id,
      routeCommitId: input.routeCommit.id,
      runId: input.trace.id
    })}`,
    event,
    eventHash,
    notificationOnly: true,
    status: "pending",
    signature: {
      algorithm: "hmac-sha256",
      headerName: "x-loopgraph-signature",
      value: signLifecycleEvent(event, signing.secret),
      keyRef: signing.keyRef
    },
    target: {
      owner: "hermes",
      routeKey: LOOPGRAPH_LIFECYCLE_ROUTE_KEY,
      sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE
    },
    createdAt: nowIso,
    warnings: signing.warning ? [signing.warning] : []
  });

  await saveLoopgraphLifecycleDelivery(input.projectRoot, delivery);

  return {
    emitted: true,
    delivery,
    warnings: delivery.warnings
  };
}

export async function emitLoopRunStartedLifecycleEvent(input: {
  projectRoot: string;
  sourceEvent: EventEnvelope;
  routeCommit: RouteCommit;
  trace: LoopRunTrace;
  problem?: BusinessProblem;
  now?: Date;
  signingSecret?: string;
  keyRef?: string;
}): Promise<LoopgraphLifecycleEmitResult> {
  const cycleGuard = lifecycleCycleGuard(input.sourceEvent);
  if (cycleGuard) {
    return {
      emitted: false,
      skippedReason: cycleGuard,
      warnings: [cycleGuard]
    };
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const eventType = "loop.run.started" satisfies LoopgraphLifecycleEventType;
  const sourceDeliveryId = `${input.trace.id}:${eventType}`;
  const idBase = {
    workspaceId: input.sourceEvent.workspaceId,
    source: "loopgraph",
    sourceDeliveryId,
    eventType
  };
  const event = eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(idBase),
    schemaVersion: "event-envelope/v1alpha1",
    workspaceId: input.sourceEvent.workspaceId,
    companyId: input.sourceEvent.companyId,
    source: "loopgraph",
    sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE,
    sourceDeliveryId,
    eventType,
    occurredAt: input.trace.startedAt,
    receivedAt: nowIso,
    subject: {
      type: "loop_run",
      id: input.trace.id,
      display: `${input.trace.loopId} started`
    },
    correlationId: input.sourceEvent.correlationId,
    causationId: input.sourceEvent.id,
    parentEventId: input.sourceEvent.id,
    hopCount: input.sourceEvent.hopCount + 1,
    normalizedPayload: {
      notificationOnly: true,
      sourceEventId: input.sourceEvent.id,
      routeCommitId: input.routeCommit.id,
      routeAttemptId: input.routeCommit.routeAttemptId,
      problemId: input.routeCommit.problemId,
      loopId: input.trace.loopId,
      loopSpecHash: input.trace.loopSpecHash,
      runId: input.trace.id,
      runStatus: "STARTED",
      routeCommitStatus: input.routeCommit.status,
      problemStatus: input.problem?.status,
      startedAt: input.trace.startedAt
    },
    evidenceRefs: [
      `trace:${input.trace.id}`,
      `route_commit:${input.routeCommit.id}`,
      ...(input.problem ? [`problem:${input.problem.id}`] : [])
    ],
    trust: {
      signatureVerified: true,
      signer: "loopgraph",
      untrustedFields: []
    },
    sensitivity: input.sourceEvent.sensitivity
  });
  const signing = resolveLifecycleSigning(input.signingSecret, input.keyRef);
  const eventHash = contentHash(event);
  const delivery = loopgraphLifecycleDeliverySchema.parse({
    schemaVersion: LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION,
    id: `lifecycle_${contentHash({
      eventId: event.id,
      routeCommitId: input.routeCommit.id,
      runId: input.trace.id,
      eventType
    })}`,
    event,
    eventHash,
    notificationOnly: true,
    status: "pending",
    signature: {
      algorithm: "hmac-sha256",
      headerName: "x-loopgraph-signature",
      value: signLifecycleEvent(event, signing.secret),
      keyRef: signing.keyRef
    },
    target: {
      owner: "hermes",
      routeKey: LOOPGRAPH_LIFECYCLE_ROUTE_KEY,
      sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE
    },
    createdAt: nowIso,
    warnings: signing.warning ? [signing.warning] : []
  });

  await saveLoopgraphLifecycleDelivery(input.projectRoot, delivery);

  return {
    emitted: true,
    delivery,
    warnings: delivery.warnings
  };
}

export async function emitRouteAcceptedLifecycleEvent(input: {
  projectRoot: string;
  sourceEvent: EventEnvelope;
  routeCommit: RouteCommit;
  problem?: BusinessProblem;
  now?: Date;
  signingSecret?: string;
  keyRef?: string;
}): Promise<LoopgraphLifecycleEmitResult> {
  const cycleGuard = lifecycleCycleGuard(input.sourceEvent);
  if (cycleGuard) {
    return {
      emitted: false,
      skippedReason: cycleGuard,
      warnings: [cycleGuard]
    };
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const eventType = "loop.route.accepted" satisfies LoopgraphLifecycleEventType;
  const sourceDeliveryId = `${input.routeCommit.id}:${eventType}`;
  const idBase = {
    workspaceId: input.sourceEvent.workspaceId,
    source: "loopgraph",
    sourceDeliveryId,
    eventType
  };
  const event = eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(idBase),
    schemaVersion: "event-envelope/v1alpha1",
    workspaceId: input.sourceEvent.workspaceId,
    companyId: input.sourceEvent.companyId,
    source: "loopgraph",
    sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE,
    sourceDeliveryId,
    eventType,
    occurredAt: input.routeCommit.committedAt,
    receivedAt: nowIso,
    subject: {
      type: "route_commit",
      id: input.routeCommit.id,
      display: `${input.routeCommit.loopId} route accepted`
    },
    correlationId: input.sourceEvent.correlationId,
    causationId: input.sourceEvent.id,
    parentEventId: input.sourceEvent.id,
    hopCount: input.sourceEvent.hopCount + 1,
    normalizedPayload: {
      notificationOnly: true,
      sourceEventId: input.sourceEvent.id,
      routeCommitId: input.routeCommit.id,
      routeAttemptId: input.routeCommit.routeAttemptId,
      problemId: input.routeCommit.problemId,
      loopId: input.routeCommit.loopId,
      loopSpecHash: input.routeCommit.loopSpecHash,
      runId: input.routeCommit.runId,
      routeCommitStatus: input.routeCommit.status,
      problemStatus: input.problem?.status,
      acceptedAt: input.routeCommit.committedAt,
      outcomeRefs: input.problem?.outcomeRefs ?? []
    },
    evidenceRefs: [
      `event:${input.sourceEvent.id}`,
      `route_commit:${input.routeCommit.id}`,
      ...(input.problem ? [`problem:${input.problem.id}`] : [])
    ],
    trust: {
      signatureVerified: true,
      signer: "loopgraph",
      untrustedFields: []
    },
    sensitivity: input.sourceEvent.sensitivity
  });
  const signing = resolveLifecycleSigning(input.signingSecret, input.keyRef);
  const eventHash = contentHash(event);
  const delivery = loopgraphLifecycleDeliverySchema.parse({
    schemaVersion: LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION,
    id: `lifecycle_${contentHash({
      eventId: event.id,
      routeCommitId: input.routeCommit.id,
      eventType
    })}`,
    event,
    eventHash,
    notificationOnly: true,
    status: "pending",
    signature: {
      algorithm: "hmac-sha256",
      headerName: "x-loopgraph-signature",
      value: signLifecycleEvent(event, signing.secret),
      keyRef: signing.keyRef
    },
    target: {
      owner: "hermes",
      routeKey: LOOPGRAPH_LIFECYCLE_ROUTE_KEY,
      sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE
    },
    createdAt: nowIso,
    warnings: signing.warning ? [signing.warning] : []
  });

  await saveLoopgraphLifecycleDelivery(input.projectRoot, delivery);

  return {
    emitted: true,
    delivery,
    warnings: delivery.warnings
  };
}

export async function emitEscalationCreatedLifecycleEvent(input: {
  projectRoot: string;
  sourceEvent: EventEnvelope;
  routeCommit: RouteCommit;
  trace: LoopRunTrace;
  escalationCase: EscalationCase;
  problem?: BusinessProblem;
  now?: Date;
  signingSecret?: string;
  keyRef?: string;
}): Promise<LoopgraphLifecycleEmitResult> {
  const cycleGuard = lifecycleCycleGuard(input.sourceEvent);
  if (cycleGuard) {
    return {
      emitted: false,
      skippedReason: cycleGuard,
      warnings: [cycleGuard]
    };
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const eventType = "loop.escalation.created" satisfies LoopgraphLifecycleEventType;
  const sourceDeliveryId = `${input.escalationCase.id}:${eventType}`;
  const idBase = {
    workspaceId: input.sourceEvent.workspaceId,
    source: "loopgraph",
    sourceDeliveryId,
    eventType
  };
  const event = eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(idBase),
    schemaVersion: "event-envelope/v1alpha1",
    workspaceId: input.sourceEvent.workspaceId,
    companyId: input.sourceEvent.companyId,
    source: "loopgraph",
    sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE,
    sourceDeliveryId,
    eventType,
    occurredAt: input.escalationCase.createdAt,
    receivedAt: nowIso,
    subject: {
      type: "escalation_case",
      id: input.escalationCase.id,
      display: `${input.escalationCase.severity} ${input.escalationCase.category}`
    },
    correlationId: input.sourceEvent.correlationId,
    causationId: input.sourceEvent.id,
    parentEventId: input.sourceEvent.id,
    hopCount: input.sourceEvent.hopCount + 1,
    normalizedPayload: {
      notificationOnly: true,
      sourceEventId: input.sourceEvent.id,
      routeCommitId: input.routeCommit.id,
      routeAttemptId: input.routeCommit.routeAttemptId,
      problemId: input.routeCommit.problemId,
      loopId: input.trace.loopId,
      loopSpecHash: input.trace.loopSpecHash,
      runId: input.trace.id,
      runStatus: input.trace.status,
      routeCommitStatus: input.routeCommit.status,
      problemStatus: input.problem?.status,
      escalationCaseId: input.escalationCase.id,
      escalationStatus: input.escalationCase.status,
      escalationSeverity: input.escalationCase.severity,
      escalationCategory: input.escalationCase.category,
      escalationConfidence: input.escalationCase.confidence,
      escalationSummary: input.escalationCase.summary,
      primaryOwnerRole: input.escalationCase.routing.primaryOwner.role,
      reviewerRoles: input.escalationCase.routing.reviewers.map((reviewer) => reviewer.role),
      informedRoles: input.escalationCase.routing.informed.map((informed) => informed.role),
      escalationDeadline: input.escalationCase.routing.escalationDeadline,
      decisionCount: input.escalationCase.decisionsRequired.length,
      recommendedActionCount: input.escalationCase.recommendedActions.length,
      createdAt: input.escalationCase.createdAt
    },
    evidenceRefs: [
      `trace:${input.trace.id}`,
      `route_commit:${input.routeCommit.id}`,
      `escalation_case:${input.escalationCase.id}`,
      ...input.escalationCase.evidence.map((evidence) =>
        `${evidence.sourceType}:${evidence.sourceId}#${evidence.id}`
      ),
      ...(input.problem ? [`problem:${input.problem.id}`] : [])
    ],
    trust: {
      signatureVerified: true,
      signer: "loopgraph",
      untrustedFields: []
    },
    sensitivity: input.sourceEvent.sensitivity
  });
  const signing = resolveLifecycleSigning(input.signingSecret, input.keyRef);
  const eventHash = contentHash(event);
  const delivery = loopgraphLifecycleDeliverySchema.parse({
    schemaVersion: LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION,
    id: `lifecycle_${contentHash({
      eventId: event.id,
      routeCommitId: input.routeCommit.id,
      runId: input.trace.id,
      escalationCaseId: input.escalationCase.id,
      eventType
    })}`,
    event,
    eventHash,
    notificationOnly: true,
    status: "pending",
    signature: {
      algorithm: "hmac-sha256",
      headerName: "x-loopgraph-signature",
      value: signLifecycleEvent(event, signing.secret),
      keyRef: signing.keyRef
    },
    target: {
      owner: "hermes",
      routeKey: LOOPGRAPH_LIFECYCLE_ROUTE_KEY,
      sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE
    },
    createdAt: nowIso,
    warnings: signing.warning ? [signing.warning] : []
  });

  await saveLoopgraphLifecycleDelivery(input.projectRoot, delivery);

  return {
    emitted: true,
    delivery,
    warnings: delivery.warnings
  };
}

export async function emitOutcomeRecordedLifecycleEvent(input: {
  projectRoot: string;
  sourceEvent: EventEnvelope;
  routeCommit: RouteCommit;
  trace: LoopRunTrace;
  escalationCase: EscalationCase;
  outcome: NonNullable<EscalationCase["outcome"]>;
  problem?: BusinessProblem;
  now?: Date;
  signingSecret?: string;
  keyRef?: string;
}): Promise<LoopgraphLifecycleEmitResult> {
  const cycleGuard = lifecycleCycleGuard(input.sourceEvent);
  if (cycleGuard) {
    return {
      emitted: false,
      skippedReason: cycleGuard,
      warnings: [cycleGuard]
    };
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const eventType = "loop.outcome.recorded" satisfies LoopgraphLifecycleEventType;
  const outcomeRecordedAt = input.outcome.resolvedAt ?? nowIso;
  const sourceDeliveryId = `${input.escalationCase.id}:${eventType}:${outcomeRecordedAt}`;
  const idBase = {
    workspaceId: input.sourceEvent.workspaceId,
    source: "loopgraph",
    sourceDeliveryId,
    eventType
  };
  const event = eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(idBase),
    schemaVersion: "event-envelope/v1alpha1",
    workspaceId: input.sourceEvent.workspaceId,
    companyId: input.sourceEvent.companyId,
    source: "loopgraph",
    sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE,
    sourceDeliveryId,
    eventType,
    occurredAt: outcomeRecordedAt,
    receivedAt: nowIso,
    subject: {
      type: "case_outcome",
      id: `case_outcome_${input.escalationCase.id}`,
      display: input.outcome.resolutionSummary
    },
    correlationId: input.sourceEvent.correlationId,
    causationId: input.sourceEvent.id,
    parentEventId: input.sourceEvent.id,
    hopCount: input.sourceEvent.hopCount + 1,
    normalizedPayload: {
      notificationOnly: true,
      sourceEventId: input.sourceEvent.id,
      routeCommitId: input.routeCommit.id,
      routeAttemptId: input.routeCommit.routeAttemptId,
      problemId: input.routeCommit.problemId,
      loopId: input.trace.loopId,
      loopSpecHash: input.trace.loopSpecHash,
      runId: input.trace.id,
      runStatus: input.trace.status,
      routeCommitStatus: input.routeCommit.status,
      problemStatus: input.problem?.status,
      escalationCaseId: input.escalationCase.id,
      escalationStatus: input.escalationCase.status,
      escalationSeverity: input.escalationCase.severity,
      escalationCategory: input.escalationCase.category,
      outcomeRef: `case_outcome:${input.escalationCase.id}`,
      outcomeType: "case_resolution",
      resolutionSummary: input.outcome.resolutionSummary,
      resolvedAt: outcomeRecordedAt,
      businessResult: input.outcome.businessResult,
      customerResult: input.outcome.customerResult,
      classificationCorrect: input.outcome.classificationCorrect,
      followUpRequired: input.outcome.followUpRequired
    },
    evidenceRefs: [
      `trace:${input.trace.id}`,
      `route_commit:${input.routeCommit.id}`,
      `escalation_case:${input.escalationCase.id}`,
      `case_outcome:${input.escalationCase.id}`,
      ...(input.problem ? [`problem:${input.problem.id}`] : [])
    ],
    trust: {
      signatureVerified: true,
      signer: "loopgraph",
      untrustedFields: []
    },
    sensitivity: input.sourceEvent.sensitivity
  });
  const signing = resolveLifecycleSigning(input.signingSecret, input.keyRef);
  const eventHash = contentHash(event);
  const delivery = loopgraphLifecycleDeliverySchema.parse({
    schemaVersion: LOOPGRAPH_LIFECYCLE_SCHEMA_VERSION,
    id: `lifecycle_${contentHash({
      eventId: event.id,
      routeCommitId: input.routeCommit.id,
      runId: input.trace.id,
      escalationCaseId: input.escalationCase.id,
      eventType
    })}`,
    event,
    eventHash,
    notificationOnly: true,
    status: "pending",
    signature: {
      algorithm: "hmac-sha256",
      headerName: "x-loopgraph-signature",
      value: signLifecycleEvent(event, signing.secret),
      keyRef: signing.keyRef
    },
    target: {
      owner: "hermes",
      routeKey: LOOPGRAPH_LIFECYCLE_ROUTE_KEY,
      sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE
    },
    createdAt: nowIso,
    warnings: signing.warning ? [signing.warning] : []
  });

  await saveLoopgraphLifecycleDelivery(input.projectRoot, delivery);

  return {
    emitted: true,
    delivery,
    warnings: delivery.warnings
  };
}

export async function saveLoopgraphLifecycleDelivery(
  projectRoot: string,
  delivery: LoopgraphLifecycleDelivery
): Promise<void> {
  const parsed = loopgraphLifecycleDeliverySchema.parse(delivery);
  const root = lifecycleStoreRoot(projectRoot);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, `${safeFileName(parsed.id)}.json`), `${JSON.stringify(parsed, null, 2)}\n`);
}

export async function listLoopgraphLifecycleDeliveries(projectRoot: string): Promise<LoopgraphLifecycleDelivery[]> {
  try {
    const root = lifecycleStoreRoot(projectRoot);
    const files = await readdir(root);
    const deliveries: LoopgraphLifecycleDelivery[] = [];
    for (const file of files.filter((item) => item.endsWith(".json"))) {
      const delivery = await readLifecycleDelivery(path.join(root, file));
      if (delivery) deliveries.push(delivery);
    }
    return deliveries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
}

function lifecycleStoreRoot(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "routing", "lifecycle");
}

async function readLifecycleDelivery(filePath: string): Promise<LoopgraphLifecycleDelivery | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return loopgraphLifecycleDeliverySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function lifecycleCycleGuard(sourceEvent: EventEnvelope): string | null {
  if (sourceEvent.source === "loopgraph" || sourceEvent.sourceRoute === LOOPGRAPH_LIFECYCLE_ROUTE) {
    return "Loopgraph lifecycle events are notification-only and must not re-enter loop execution.";
  }
  if (readBoolean(sourceEvent.normalizedPayload, "notificationOnly")) {
    return "Notification-only events must not emit another lifecycle event.";
  }
  if (sourceEvent.hopCount >= MAX_LOOPGRAPH_LIFECYCLE_HOP_COUNT) {
    return `Lifecycle hop count ${sourceEvent.hopCount} reached the maximum of ${MAX_LOOPGRAPH_LIFECYCLE_HOP_COUNT}.`;
  }
  return null;
}

function lifecycleEventTypeForTrace(
  trace: LoopRunTrace,
  problem?: BusinessProblem
): LoopgraphLifecycleEventType {
  if (problem?.status === "unhandled") return "loop.problem.unhandled";
  if (trace.status === "WAITING_FOR_REVIEW") return "loop.review.required";
  if (trace.status === "COMPLETED") return "loop.run.completed";
  return "loop.run.failed";
}

function resolveLifecycleSigning(signingSecret?: string, keyRef?: string): {
  secret: string;
  keyRef: string;
  warning?: string;
} {
  if (signingSecret && signingSecret.length > 0) {
    return {
      secret: signingSecret,
      keyRef: keyRef ?? "caller-provided"
    };
  }

  const envSecret = process.env.LOOPGRAPH_HERMES_LIFECYCLE_SECRET;
  if (envSecret && envSecret.length > 0) {
    return {
      secret: envSecret,
      keyRef: keyRef ?? "env:LOOPGRAPH_HERMES_LIFECYCLE_SECRET"
    };
  }

  return {
    secret: "loopgraph-local-development-lifecycle-secret",
    keyRef: keyRef ?? "local-development",
    warning: "Using a local development lifecycle signing key; configure LOOPGRAPH_HERMES_LIFECYCLE_SECRET in Hermes before production delivery."
  };
}

function signLifecycleEvent(event: EventEnvelope, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(stableStringify(event)).digest("hex")}`;
}

function readBoolean(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
