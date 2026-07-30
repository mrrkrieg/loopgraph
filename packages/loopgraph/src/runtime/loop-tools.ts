import path from "node:path";
import { z } from "zod";
import {
  compileRoutingCardFromLoopSpec,
  summarizeTrace,
  type ReviewRole,
  type RunStatus,
  type RoutingCard
} from "../core";
import type { EscalationCase } from "../core/escalation";
import type { LoopRunTrace } from "../core/trace";
import { FileStorageAdapter } from "../sdk/storage";
import { loadLoopSpecFromPath } from "./loader";
import { applyReviewDecision } from "./review-service";
import { resolveCaseWithLifecycle } from "./case-service";
import { simulateLoop } from "./simulator";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace, type RegisteredLoopSpec } from "./workspace";
import {
  listLoopgraphLoops,
  materializeAcceptedLoopDesignProposals
} from "./loop-materialization";
import type { LoopgraphLifecycleEmitResult } from "./lifecycle-events";

export const LOOPGRAPH_LOOP_TOOL_NAMES = [
  "loopgraph_loops_list",
  "loopgraph_runs_get",
  "loopgraph_loops_materialize",
  "loopgraph_loops_validate",
  "loopgraph_loops_simulate",
  "loopgraph_review_submit",
  "loopgraph_case_resolve"
] as const;

export type LoopgraphLoopToolName = (typeof LOOPGRAPH_LOOP_TOOL_NAMES)[number];

export type LoopgraphLoopToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

export const loopsListInputSchema = z.object({
  projectRoot: z.string().optional()
});

const runStatusInputSchema = z.enum([
  "DRAFT",
  "VALIDATED",
  "READY",
  "SIMULATING",
  "PROPOSED_ACTIONS",
  "VERIFYING",
  "WAITING_FOR_REVIEW",
  "APPROVED",
  "COMMITTED",
  "COMPLETED",
  "FAILED_VALIDATION",
  "FAILED_VERIFICATION",
  "ESCALATED",
  "REJECTED",
  "BLOCKED_BY_POLICY",
  "CANCELLED"
]);

export const runsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  runId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  status: runStatusInputSchema.optional(),
  includeReviewPacket: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50)
}).default({});

export const loopsMaterializeInputSchema = z.object({
  projectRoot: z.string().optional(),
  designRunId: z.string(),
  acceptedProposalIds: z.array(z.string().min(1)).min(1),
  acceptedBy: z.string().optional(),
  overwriteExisting: z.boolean().default(false)
});

export const loopTargetInputSchema = z.object({
  projectRoot: z.string().optional(),
  loopId: z.string().min(1).optional(),
  specPath: z.string().min(1).optional()
});

export const loopsValidateInputSchema = loopTargetInputSchema;

const simulationFixtureInputSchema = z.object({
  eventId: z.string().min(1),
  simulatedAt: z.string().min(1)
}).passthrough();

export const loopsSimulateInputSchema = loopTargetInputSchema.extend({
  fixturePath: z.string().min(1).optional(),
  fixture: simulationFixtureInputSchema.optional()
});

export const reviewSubmitInputSchema = z.object({
  projectRoot: z.string().optional(),
  runId: z.string().min(1),
  status: z.enum(["approved", "rejected", "needs_changes", "request_evidence", "reassigned"]),
  approvedFingerprints: z.array(z.string().min(1)).default([]),
  reviewerId: z.string().min(1),
  role: z.enum(["approver", "reviewer", "owner", "teacher", "executor", "accountability_holder"]),
  comment: z.string().optional(),
  teacherFeedback: z.string().optional(),
  reassignedTo: z.string().optional(),
  reviewMinutes: z.number().min(0).optional(),
  reworkMinutes: z.number().min(0).optional(),
  botsittingMinutes: z.number().min(0).optional(),
  escalationMinutes: z.number().min(0).optional(),
  governanceMinutes: z.number().min(0).optional()
});

export const caseResolveInputSchema = z.object({
  projectRoot: z.string().optional(),
  caseId: z.string().min(1),
  resolutionSummary: z.string().min(1),
  resolvedAt: z.string().datetime().optional(),
  businessResult: z.string().optional(),
  customerResult: z.string().optional(),
  classificationCorrect: z.boolean().optional(),
  followUpRequired: z.boolean().optional()
});

export type LoopsListInput = z.input<typeof loopsListInputSchema>;
export type RunsGetInput = z.input<typeof runsGetInputSchema>;
export type LoopsMaterializeInput = z.input<typeof loopsMaterializeInputSchema>;
export type LoopsValidateInput = z.input<typeof loopsValidateInputSchema>;
export type LoopsSimulateInput = z.input<typeof loopsSimulateInputSchema>;
export type ReviewSubmitInput = z.input<typeof reviewSubmitInputSchema>;
export type CaseResolveInput = z.input<typeof caseResolveInputSchema>;

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

export type LoopValidationResult = {
  schemaVersion: "loop-validation/v1alpha1";
  valid: boolean;
  errors: string[];
  projectRoot: string;
  specPath: string;
  requestedLoopId?: string;
  loopId?: string;
  metadata?: {
    id: string;
    name: string;
    version: string;
    description?: string;
  };
  topology?: {
    department?: string;
    parentLoopId?: string;
    tags?: string[];
  };
  routing: {
    ready: boolean;
    problemTypes: string[];
    activationMode?: string;
    card?: RoutingCard;
  };
  fixtures: Array<{ id: string; path: string }>;
  nextActions: string[];
};

export type LoopRunsGetResult = {
  schemaVersion: "loop-runs/v1alpha1";
  projectRoot: string;
  count: number;
  runs: HermesSafeRunRecord[];
};

export type HermesSafeRunRecord = {
  runId: string;
  loopId: string;
  loopSpecVersion: string;
  mode: LoopRunTrace["mode"];
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  trigger: LoopRunTrace["trigger"];
  traceSummary: ReturnType<typeof summarizeTrace>;
  decisionSummary?: string;
  preparedActions: Array<{
    id: string;
    toolKey: string;
    label: string;
    fingerprint: string;
    riskLevel: string;
    requiresApproval: boolean;
    customerFacing: boolean;
    payloadPreview: unknown;
  }>;
  policyDecisions: LoopRunTrace["policyDecisions"];
  verificationResults: LoopRunTrace["verificationResults"];
  humanReviews: LoopRunTrace["humanReviews"];
  escalationCases: Array<{
    id: string;
    category: string;
    severity: string;
      status: string;
      summary: string;
      decisionsRequired: EscalationCase["decisionsRequired"];
      routing: EscalationCase["routing"];
      outcome?: EscalationCase["outcome"];
    }>;
  reviewPacket?: {
    runId: string;
    instructions: string[];
    approvableFingerprints: string[];
    customerFacingFingerprints: string[];
  };
};

export const loopgraphLoopToolDefinitions = [
  {
    name: "loopgraph_loops_list",
    description: "List registered local Loopgraph loops and their Hermes routing readiness.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_runs_get",
    description: "Inspect project-local Loopgraph run traces with safe summaries, prepared-action fingerprints, reviews, and escalation context.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_loops_materialize",
    description: "Materialize explicitly accepted Hermes loop design proposals into validated LoopSpecs and register them locally.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_loops_validate",
    description: "Validate a project-bound LoopSpec by registered loop ID or spec path before Hermes simulates or routes to it.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_loops_simulate",
    description: "Run a project-bound LoopSpec in local simulation mode using a fixture object or fixture file.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_review_submit",
    description: "Submit a human review decision for a local Loopgraph simulation trace.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_case_resolve",
    description: "Record an explicit human/operator resolution outcome for a local escalation case and prepare a signed Hermes outcome callback when routing context exists.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphLoopToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphLoopTool(
  name: LoopgraphLoopToolName,
  input: unknown,
  options: LoopgraphLoopToolRuntimeOptions = {}
) {
  if (name === "loopgraph_loops_list") {
    const parsed = loopsListInputSchema.parse(input);
    return listLoopgraphLoops({
      projectRoot: parsed.projectRoot ?? options.projectRoot
    });
  }
  if (name === "loopgraph_runs_get") {
    const parsed = runsGetInputSchema.parse(input);
    return getLoopRunsForHermes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      runId: parsed.runId,
      loopId: parsed.loopId,
      status: parsed.status,
      includeReviewPacket: parsed.includeReviewPacket,
      limit: parsed.limit
    });
  }
  if (name === "loopgraph_loops_materialize") {
    const parsed = loopsMaterializeInputSchema.parse(input);
    return materializeAcceptedLoopDesignProposals({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      designRunId: parsed.designRunId,
      acceptedProposalIds: parsed.acceptedProposalIds,
      acceptedBy: parsed.acceptedBy,
      overwriteExisting: parsed.overwriteExisting
    });
  }
  if (name === "loopgraph_loops_validate") {
    const parsed = loopsValidateInputSchema.parse(input);
    return validateLoopForHermes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      loopId: parsed.loopId,
      specPath: parsed.specPath
    });
  }
  if (name === "loopgraph_loops_simulate") {
    const parsed = loopsSimulateInputSchema.parse(input);
    return simulateLoopForHermes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      loopId: parsed.loopId,
      specPath: parsed.specPath,
      fixturePath: parsed.fixturePath,
      fixture: parsed.fixture
    });
  }
  if (name === "loopgraph_review_submit") {
    const parsed = reviewSubmitInputSchema.parse(input);
    return submitLoopReviewForHermes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      runId: parsed.runId,
      status: parsed.status,
      approvedFingerprints: parsed.approvedFingerprints,
      reviewerId: parsed.reviewerId,
      role: parsed.role,
      comment: parsed.comment,
      teacherFeedback: parsed.teacherFeedback,
      reassignedTo: parsed.reassignedTo,
      reviewMinutes: parsed.reviewMinutes,
      reworkMinutes: parsed.reworkMinutes,
      botsittingMinutes: parsed.botsittingMinutes,
      escalationMinutes: parsed.escalationMinutes,
      governanceMinutes: parsed.governanceMinutes
    });
  }
  if (name === "loopgraph_case_resolve") {
    const parsed = caseResolveInputSchema.parse(input);
    return resolveCaseForHermes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      caseId: parsed.caseId,
      resolutionSummary: parsed.resolutionSummary,
      resolvedAt: parsed.resolvedAt,
      businessResult: parsed.businessResult,
      customerResult: parsed.customerResult,
      classificationCorrect: parsed.classificationCorrect,
      followUpRequired: parsed.followUpRequired,
      now: options.now
    });
  }
  throw new Error(`Unknown Loopgraph loop tool: ${String(name)}`);
}

export async function validateLoopForHermes(input: LoopsValidateInput): Promise<LoopValidationResult> {
  const target = await resolveLoopTarget(input);
  if (!target.loaded.ok) {
    return {
      schemaVersion: "loop-validation/v1alpha1",
      valid: false,
      errors: target.loaded.errors,
      projectRoot: target.projectRoot,
      specPath: target.loaded.sourcePath,
      requestedLoopId: target.loopId,
      routing: { ready: false, problemTypes: [] },
      fixtures: [],
      nextActions: [
        "Fix the LoopSpec validation errors before Hermes can simulate or route events to this loop."
      ]
    };
  }

  const spec = target.loaded.spec;
  const routingCard = compileRoutingCardFromLoopSpec(spec, { catalogVersion: "local-validation" });
  return {
    schemaVersion: "loop-validation/v1alpha1",
    valid: true,
    errors: [],
    projectRoot: target.projectRoot,
    specPath: target.loaded.sourcePath,
    requestedLoopId: target.loopId,
    loopId: spec.metadata.id,
    metadata: {
      id: spec.metadata.id,
      name: spec.metadata.name,
      version: spec.metadata.version,
      ...(spec.metadata.description ? { description: spec.metadata.description } : {})
    },
    topology: {
      ...(spec.topology?.department ? { department: spec.topology.department } : {}),
      ...(spec.topology?.parentLoopId ? { parentLoopId: spec.topology.parentLoopId } : {}),
      ...(spec.topology?.tags ? { tags: spec.topology.tags } : {})
    },
    routing: {
      ready: Boolean(routingCard),
      problemTypes: spec.routing?.problemTypes ?? [],
      ...(spec.routing?.activationMode ? { activationMode: spec.routing.activationMode } : {}),
      ...(routingCard ? { card: routingCard } : {})
    },
    fixtures: spec.input.fixtures ?? [],
    nextActions: routingCard
      ? [
          "Run loopgraph_loops_simulate with a generated starter fixture before promoting this loop beyond shadow routing.",
          "Use loopgraph_connections_plan to confirm the required read/write connections are ready before live execution."
        ]
      : [
          "This LoopSpec validates, but it has no routing contract. Add routing before Hermes can select it from incoming events."
        ]
  };
}

export async function getLoopRunsForHermes(input: RunsGetInput = {}): Promise<LoopRunsGetResult> {
  const parsed = runsGetInputSchema.parse(input);
  const projectRoot = path.resolve(parsed.projectRoot ?? process.cwd());
  const storage = new FileStorageAdapter(getLoopgraphRoot(projectRoot));
  const traces = parsed.runId
    ? [(await storage.getRun(parsed.runId))].filter((trace): trace is LoopRunTrace => trace !== null)
    : await loadRunsFromIndex(storage, parsed.limit);
  const filtered = traces
    .filter((trace) => !parsed.loopId || trace.loopId === parsed.loopId)
    .filter((trace) => !parsed.status || trace.status === parsed.status)
    .slice(0, parsed.limit);

  return {
    schemaVersion: "loop-runs/v1alpha1",
    projectRoot,
    count: filtered.length,
    runs: await Promise.all(filtered.map((trace) =>
      toHermesSafeRunRecord(storage, trace, parsed.includeReviewPacket)
    ))
  };
}

export async function simulateLoopForHermes(input: LoopsSimulateInput) {
  const target = await resolveLoopTarget(input);
  if (!target.loaded.ok) {
    return {
      schemaVersion: "loop-simulation/v1alpha1",
      valid: false,
      errors: target.loaded.errors,
      projectRoot: target.projectRoot,
      specPath: target.loaded.sourcePath
    };
  }

  const fixture = await resolveSimulationFixture({
    projectRoot: target.projectRoot,
    fixturePath: input.fixturePath,
    fixture: input.fixture
  });
  const storage = new FileStorageAdapter(getLoopgraphRoot(target.projectRoot));
  const simulation = await simulateLoop({
    spec: target.loaded.spec,
    fixture,
    storage
  });

  return {
    schemaVersion: "loop-simulation/v1alpha1",
    valid: true,
    errors: [],
    projectRoot: target.projectRoot,
    specPath: target.loaded.sourcePath,
    loopId: target.loaded.spec.metadata.id,
    runId: simulation.trace.id,
    status: simulation.trace.status,
    summary: simulation.summary,
    traceSummary: summarizeTrace(simulation.trace, simulation.escalationCase),
    reviewRequired: simulation.trace.status === "WAITING_FOR_REVIEW",
    escalationCaseId: simulation.escalationCase?.id,
    nextActions: simulation.trace.status === "WAITING_FOR_REVIEW"
      ? [
          "Inspect the prepared action fingerprints, then submit an explicit human decision with loopgraph_review_submit."
        ]
      : [
          "Inspect the persisted trace locally before changing this loop's activation mode."
        ]
  };
}

export async function submitLoopReviewForHermes(input: ReviewSubmitInput) {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const storage = new FileStorageAdapter(getLoopgraphRoot(projectRoot));
  const result = await applyReviewDecision(storage, {
    runId: input.runId,
    status: input.status,
    approvedFingerprints: input.approvedFingerprints ?? [],
    reviewerId: input.reviewerId,
    role: input.role as ReviewRole,
    comment: input.comment,
    teacherFeedback: input.teacherFeedback,
    reassignedTo: input.reassignedTo,
    reviewMinutes: input.reviewMinutes,
    reworkMinutes: input.reworkMinutes,
    botsittingMinutes: input.botsittingMinutes,
    escalationMinutes: input.escalationMinutes,
    governanceMinutes: input.governanceMinutes
  }, {
    projectRoot
  });

  return {
    schemaVersion: "loop-review/v1alpha1",
    valid: true,
    errors: [],
    projectRoot,
    runId: result.trace.id,
    status: result.trace.status,
    review: result.review,
    traceSummary: summarizeTrace(result.trace),
    nextActions: result.trace.status === "COMPLETED"
      ? [
          "The reviewed simulation completed locally. Keep live execution disabled until connectors and approval policy are explicitly enabled."
        ]
      : [
          "Review is recorded. Continue through the governance path before changing activation or execution mode."
        ]
  };
}

export async function resolveCaseForHermes(input: CaseResolveInput & { now?: Date }) {
  const parsed = caseResolveInputSchema.parse(input);
  const projectRoot = path.resolve(parsed.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const storage = new FileStorageAdapter(getLoopgraphRoot(projectRoot));
  const outcome = {
    resolutionSummary: parsed.resolutionSummary,
    resolvedAt: parsed.resolvedAt ?? now.toISOString(),
    ...(parsed.businessResult ? { businessResult: parsed.businessResult } : {}),
    ...(parsed.customerResult ? { customerResult: parsed.customerResult } : {}),
    ...(parsed.classificationCorrect !== undefined ? { classificationCorrect: parsed.classificationCorrect } : {}),
    ...(parsed.followUpRequired !== undefined ? { followUpRequired: parsed.followUpRequired } : {})
  };
  const resolved = await resolveCaseWithLifecycle(storage, parsed.caseId, outcome, {
    projectRoot,
    now
  });

  return {
    schemaVersion: "case-resolution/v1alpha1",
    valid: true,
    errors: [],
    projectRoot,
    case: {
      id: resolved.case.id,
      sourceRunId: resolved.case.sourceRunId,
      sourceLoopId: resolved.case.sourceLoopId,
      status: resolved.case.status,
      category: resolved.case.category,
      severity: resolved.case.severity,
      summary: truncateString(resolved.case.summary),
      outcome: resolved.case.outcome
    },
    ...(resolved.trace ? { traceSummary: summarizeTrace(resolved.trace, resolved.case) } : {}),
    ...(resolved.problem ? {
      problem: {
        id: resolved.problem.id,
        status: resolved.problem.status,
        outcomeRefs: resolved.problem.outcomeRefs,
        resolvedAt: resolved.problem.resolvedAt
      }
    } : {}),
    ...(resolved.lifecycleDelivery ? {
      lifecycleDelivery: summarizeLifecycleResult(resolved.lifecycleDelivery)
    } : {}),
    warnings: resolved.warnings,
    nextActions: resolved.lifecycleDelivery?.emitted
      ? [
          "Inspect loopgraph_lifecycle_events_get to confirm the signed notification-only loop.outcome.recorded callback prepared for Hermes.",
          "Use the event-routing graph to verify the original problem now links through route, run, case, and outcome."
        ]
      : [
          "Outcome recorded locally. If this case came from Hermes routing, inspect warnings and routing history to restore the missing route context."
        ]
  };
}

async function loadRunsFromIndex(storage: FileStorageAdapter, limit: number): Promise<LoopRunTrace[]> {
  const summaries = (await storage.listRuns()).slice(0, limit);
  const traces = await Promise.all(summaries.map((summary) => storage.getRun(summary.id)));
  return traces.filter((trace): trace is LoopRunTrace => trace !== null);
}

async function toHermesSafeRunRecord(
  storage: FileStorageAdapter,
  trace: LoopRunTrace,
  includeReviewPacket: boolean
): Promise<HermesSafeRunRecord> {
  const escalationCases = await Promise.all(trace.escalationCases.map((caseId) => storage.getEscalationCase(caseId)));
  const presentCases = escalationCases.filter((caseItem): caseItem is EscalationCase => caseItem !== null);
  const approvableFingerprints = trace.preparedActions
    .filter((action) => action.requiresApproval)
    .map((action) => action.fingerprint);
  const customerFacingFingerprints = trace.preparedActions
    .filter((action) => action.customerFacing)
    .map((action) => action.fingerprint);

  return {
    runId: trace.id,
    loopId: trace.loopId,
    loopSpecVersion: trace.loopSpecVersion,
    mode: trace.mode,
    status: trace.status,
    startedAt: trace.startedAt,
    ...(trace.completedAt ? { completedAt: trace.completedAt } : {}),
    trigger: trace.trigger,
    traceSummary: summarizeTrace(trace, presentCases[0]),
    ...(trace.agentOutput?.decisionSummary ? {
      decisionSummary: truncateString(trace.agentOutput.decisionSummary)
    } : {}),
    preparedActions: trace.preparedActions.map((action) => ({
      id: action.id,
      toolKey: action.toolKey,
      label: action.label,
      fingerprint: action.fingerprint,
      riskLevel: action.riskLevel,
      requiresApproval: action.requiresApproval,
      customerFacing: action.customerFacing,
      payloadPreview: sanitizeForHermes(action.payload)
    })),
    policyDecisions: trace.policyDecisions.filter((decision) => decision.matched),
    verificationResults: trace.verificationResults,
    humanReviews: trace.humanReviews.map((review) => ({
      ...review,
      ...(review.comment ? { comment: truncateString(review.comment) } : {}),
      ...(review.teacherFeedback ? { teacherFeedback: truncateString(review.teacherFeedback) } : {})
    })),
    escalationCases: presentCases.map((caseItem) => ({
      id: caseItem.id,
      category: caseItem.category,
      severity: caseItem.severity,
      status: caseItem.status,
      summary: truncateString(caseItem.summary),
      decisionsRequired: caseItem.decisionsRequired,
      routing: caseItem.routing,
      ...(caseItem.outcome ? { outcome: caseItem.outcome } : {})
    })),
    ...(includeReviewPacket ? {
      reviewPacket: {
        runId: trace.id,
        instructions: [
          "Review the prepared action fingerprints and payload previews.",
          "Use loopgraph_review_submit only after a human explicitly chooses approve, reject, request_evidence, or reassign.",
          "Approve exact fingerprints; do not approve customer-facing fingerprints as part of an internal-only review."
        ],
        approvableFingerprints,
        customerFacingFingerprints
      }
    } : {})
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

async function resolveLoopTarget(input: LoopsValidateInput): Promise<{
  projectRoot: string;
  loopId?: string;
  registryEntry?: RegisteredLoopSpec;
  loaded: Awaited<ReturnType<typeof loadLoopSpecFromPath>>;
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const hasLoopId = Boolean(input.loopId);
  const hasSpecPath = Boolean(input.specPath);
  if (hasLoopId === hasSpecPath) {
    throw new Error("Provide exactly one of loopId or specPath.");
  }

  if (input.loopId) {
    const workspace = await readLoopgraphWorkspace(projectRoot);
    const entry = workspace.registeredSpecs.find((candidate) => candidate.id === input.loopId);
    if (!entry) {
      throw new Error(`Registered LoopSpec not found for loopId: ${input.loopId}`);
    }
    const specPath = resolveConfinedProjectPath(projectRoot, entry.path, "Registered LoopSpec path");
    return {
      projectRoot,
      loopId: input.loopId,
      registryEntry: entry,
      loaded: await loadLoopSpecFromPath(specPath)
    };
  }

  const specPath = resolveConfinedProjectPath(projectRoot, input.specPath!, "LoopSpec path");
  return {
    projectRoot,
    loaded: await loadLoopSpecFromPath(specPath)
  };
}

async function resolveSimulationFixture(input: {
  projectRoot: string;
  fixturePath?: string;
  fixture?: z.infer<typeof simulationFixtureInputSchema>;
}) {
  const hasFixturePath = Boolean(input.fixturePath);
  const hasFixture = Boolean(input.fixture);
  if (hasFixturePath === hasFixture) {
    throw new Error("Provide exactly one of fixturePath or fixture.");
  }
  if (input.fixturePath) {
    return resolveConfinedProjectPath(input.projectRoot, input.fixturePath, "Fixture path");
  }
  return input.fixture!;
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

function sanitizeForHermes(value: unknown, depth = 0, keyHint = ""): unknown {
  if (isSecretKey(keyHint)) return "[redacted]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateString(value);
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForHermes(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
    return Object.fromEntries(entries.map(([key, item]) => [
      key,
      sanitizeForHermes(item, depth + 1, key)
    ]));
  }
  return String(value);
}

function truncateString(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function isSecretKey(key: string): boolean {
  return /api[_-]?key|auth|authorization|cookie|credential|password|secret|token/i.test(key);
}
