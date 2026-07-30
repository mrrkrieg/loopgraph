import path from "node:path";
import type { ReviewRole } from "../core/constants";
import { loopSpecHash } from "../core/hash";
import type { HumanReviewTrace } from "../core/review";
import { validateApprovalBinding } from "../core/review";
import type { LoopRunTrace } from "../core/trace";
import type { LoopSpec } from "../core/loop-spec";
import type { StorageAdapter } from "../sdk/adapters";
import { getAdapterById } from "../sdk/adapters/index";
import { evaluateLiveExecutionGate, formatLiveExecutionGateError } from "./executor";
import { buildImprovementItemFromReview } from "./improvement-service";
import { loadLoopSpecFromPath } from "./loader";
import { resolveExistingProjectPath } from "./project-paths";
import { FileRoutingStore, type RoutingStore } from "./routing-store";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace } from "./workspace";

export type ReviewDecisionStatus =
  | "approved"
  | "rejected"
  | "needs_changes"
  | "request_evidence"
  | "reassigned";

export type ApplyReviewDecisionInput = {
  runId: string;
  status: ReviewDecisionStatus;
  approvedFingerprints?: string[];
  reviewerId: string;
  role: ReviewRole;
  comment?: string;
  teacherFeedback?: string;
  reassignedTo?: string;
  reviewMinutes?: number;
  reworkMinutes?: number;
  botsittingMinutes?: number;
  escalationMinutes?: number;
  governanceMinutes?: number;
};

export type ApplyReviewDecisionOptions = {
  projectRoot?: string;
  routingStore?: RoutingStore;
};

export class ReviewServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewServiceError";
  }
}

export async function applyReviewDecision(
  storage: StorageAdapter,
  input: ApplyReviewDecisionInput,
  options: ApplyReviewDecisionOptions = {}
): Promise<{ trace: LoopRunTrace; review: HumanReviewTrace }> {
  if (!input.reviewerId.trim()) {
    throw new ReviewServiceError("reviewerId is required for an auditable review decision");
  }
  const trace = await storage.getRun(input.runId);
  if (!trace) {
    throw new ReviewServiceError(`Trace not found: ${input.runId}`);
  }

  if (trace.status !== "WAITING_FOR_REVIEW" && input.status === "approved") {
    throw new ReviewServiceError(`Run ${input.runId} is not waiting for review (status=${trace.status})`);
  }

  const approvedFingerprints = input.approvedFingerprints ?? [];
  assertReviewerRoleAllowed(trace, input.role);
  if (input.status === "approved") {
    assertValidFingerprintSelection(trace, approvedFingerprints);
    assertSeparatedApprovalDecision(trace, approvedFingerprints, input.reviewerId);
  }
  const currentSpec = input.status === "approved"
    ? await validateCurrentRoutedReviewContext(trace, options)
    : undefined;
  const reviewStatus = mapReviewStatus(input.status);

  const decidedAt = new Date().toISOString();
  const reviewRecord: HumanReviewTrace = {
    id: `review_${input.runId}_${trace.humanReviews.length + 1}`,
    runId: input.runId,
    status: reviewStatus,
    reviewerId: input.reviewerId,
    role: input.role,
    approvedFingerprints,
    rejectedFingerprints:
      input.status === "rejected"
        ? trace.preparedActions.filter((action) => action.requiresApproval).map((action) => action.fingerprint)
        : [],
    comment: input.comment,
    teacherFeedback: input.teacherFeedback,
    reviewMinutes: input.reviewMinutes,
    reworkMinutes: input.reworkMinutes,
    botsittingMinutes: input.botsittingMinutes,
    escalationMinutes: input.escalationMinutes,
    governanceMinutes: input.governanceMinutes,
    reassignedTo: input.reassignedTo,
    createdAt: trace.startedAt,
    decidedAt
  };

  trace.humanReviews = [...trace.humanReviews, reviewRecord];

  if (input.status === "approved") {
    const cumulativeApprovedFingerprints = getCumulativeApprovedFingerprints(trace);
    const pendingCustomerFacing = trace.preparedActions.some(
      (action) =>
        action.requiresApproval &&
        action.customerFacing &&
        !validateApprovalBinding(action, cumulativeApprovedFingerprints)
    );
    const pendingInternal = trace.preparedActions.some(
      (action) =>
        action.requiresApproval &&
        !action.customerFacing &&
        !validateApprovalBinding(action, cumulativeApprovedFingerprints)
    );

    if (pendingInternal && approvedFingerprints.length > 0) {
      throw new ReviewServiceError("Missing approved fingerprints for required internal actions");
    }

    if (approvedFingerprints.length === 0 && trace.preparedActions.some((action) => action.requiresApproval)) {
      throw new ReviewServiceError("Select at least one prepared action fingerprint to approve");
    }

    await commitPreparedActions(trace, cumulativeApprovedFingerprints, currentSpec);

    if (pendingCustomerFacing || pendingInternal) {
      trace.status = "WAITING_FOR_REVIEW";
    } else {
      trace.status = "COMPLETED";
    }
  } else if (input.status === "rejected") {
    trace.status = "REJECTED";
  } else if (input.status === "needs_changes") {
    trace.status = "WAITING_FOR_REVIEW";
  } else if (input.status === "request_evidence") {
    trace.status = "WAITING_FOR_REVIEW";
  } else if (input.status === "reassigned") {
    trace.status = "WAITING_FOR_REVIEW";
  }

  await storage.saveReview(reviewRecord);
  await storage.saveRun(trace);

  const improvement = buildImprovementItemFromReview(trace, reviewRecord);
  if (improvement) {
    trace.outputs = [
      ...trace.outputs,
      { id: `improvement_${reviewRecord.id}`, type: "improvement_signal", content: improvement }
    ];
    await storage.saveRun(trace);
  }

  return { trace, review: reviewRecord };
}

function mapReviewStatus(status: ReviewDecisionStatus): HumanReviewTrace["status"] {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "needs_changes":
      return "needs_changes";
    case "request_evidence":
      return "request_evidence";
    case "reassigned":
      return "reassigned";
  }
}

export function getCumulativeApprovedFingerprints(trace: LoopRunTrace): string[] {
  const fingerprints = new Set<string>();
  for (const review of trace.humanReviews) {
    if (review.status === "approved") {
      for (const fingerprint of review.approvedFingerprints) {
        fingerprints.add(fingerprint);
      }
    }
  }
  return [...fingerprints];
}

function assertValidFingerprintSelection(trace: LoopRunTrace, approvedFingerprints: string[]) {
  for (const fingerprint of approvedFingerprints) {
    const match = trace.preparedActions.some((action) => action.fingerprint === fingerprint);
    if (!match) {
      throw new ReviewServiceError(`Unknown fingerprint: ${fingerprint}`);
    }
  }
}

function assertReviewerRoleAllowed(trace: LoopRunTrace, role: ReviewRole): void {
  const allowedRoles = trace.provenance?.approvalPolicy?.allowedRoles ?? [];
  if (allowedRoles.length === 0) {
    throw new ReviewServiceError("Run does not contain a durable approval-role policy");
  }
  if (!allowedRoles.includes(role)) {
    throw new ReviewServiceError(
      `Role ${role} is not allowed by this run's approval policy (${allowedRoles.join(", ")})`
    );
  }
}

function assertSeparatedApprovalDecision(
  trace: LoopRunTrace,
  approvedFingerprints: string[],
  reviewerId: string
): void {
  if (!trace.provenance?.approvalPolicy?.separateCustomerFacingApproval) return;
  const selected = trace.preparedActions.filter((action) =>
    approvedFingerprints.includes(action.fingerprint)
  );
  const includesCustomerFacing = selected.some((action) => action.customerFacing);
  const includesInternal = selected.some((action) => !action.customerFacing);
  if (includesCustomerFacing && includesInternal) {
    throw new ReviewServiceError(
      "Customer-facing and internal actions require separate durable review decisions"
    );
  }
  if (!includesCustomerFacing) return;

  const previouslyApproved = new Set(
    trace.humanReviews
      .filter((review) => review.status === "approved")
      .flatMap((review) => review.approvedFingerprints)
  );
  const pendingInternal = trace.preparedActions.some((action) =>
    action.requiresApproval &&
    !action.customerFacing &&
    !previouslyApproved.has(action.fingerprint)
  );
  if (pendingInternal) {
    throw new ReviewServiceError(
      "Approve all required internal actions before the separate customer-facing approval"
    );
  }
  const internalReviewers = new Set(
    trace.humanReviews
      .filter((review) =>
        review.status === "approved" &&
        review.approvedFingerprints.some((fingerprint) =>
          trace.preparedActions.some((action) =>
            action.fingerprint === fingerprint && !action.customerFacing
          )
        )
      )
      .map((review) => review.reviewerId)
      .filter((value): value is string => Boolean(value))
  );
  if (internalReviewers.has(reviewerId)) {
    throw new ReviewServiceError(
      "Customer-facing approval must be completed by a different reviewer identity"
    );
  }
}

async function validateCurrentRoutedReviewContext(
  trace: LoopRunTrace,
  options: ApplyReviewDecisionOptions
): Promise<LoopSpec | undefined> {
  const routeCommitId = trace.provenance?.invocation.routeCommitId;
  if (!routeCommitId) return undefined;
  if (!options.projectRoot) {
    throw new ReviewServiceError(
      "projectRoot is required to revalidate a Hermes-routed approval"
    );
  }

  const projectRoot = path.resolve(options.projectRoot);
  const store = options.routingStore ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const commits = await store.listRouteCommits();
  const commit = commits.find((candidate) => candidate.id === routeCommitId);
  if (!commit) throw new ReviewServiceError(`Route commit not found: ${routeCommitId}`);
  if (commit.status === "cancelled") {
    throw new ReviewServiceError(`Route commit is cancelled: ${routeCommitId}`);
  }
  if (commit.status !== "waiting_review") {
    throw new ReviewServiceError(
      `Route commit ${routeCommitId} is not waiting for review (status=${commit.status})`
    );
  }
  if (
    trace.provenance?.invocation.routeAttemptId &&
    trace.provenance.invocation.routeAttemptId !== commit.routeAttemptId
  ) {
    throw new ReviewServiceError(`Route attempt binding changed for ${routeCommitId}`);
  }
  if (trace.loopId !== commit.loopId || trace.loopSpecHash !== commit.loopSpecHash) {
    throw new ReviewServiceError(`Run binding does not match route commit ${routeCommitId}`);
  }

  const jobs = await store.listRouteJobs({ routeCommitId });
  const job = jobs.find((candidate) => candidate.runId === trace.id);
  if (!job) throw new ReviewServiceError(`Route job not found for run ${trace.id}`);
  if (job.status === "cancelled") {
    throw new ReviewServiceError(`Route job is cancelled: ${job.id}`);
  }
  if (job.status !== "waiting_review") {
    throw new ReviewServiceError(
      `Route job ${job.id} is not waiting for review (status=${job.status})`
    );
  }
  if (
    job.eventId !== commit.eventId ||
    job.problemId !== commit.problemId ||
    job.routeAttemptId !== commit.routeAttemptId ||
    job.loopId !== commit.loopId ||
    job.loopSpecHash !== commit.loopSpecHash
  ) {
    throw new ReviewServiceError(`Route job binding changed for ${job.id}`);
  }

  const workspace = await readLoopgraphWorkspace(projectRoot);
  const registered = workspace.registeredSpecs.find((entry) => entry.id === job.loopId);
  if (!registered) throw new ReviewServiceError(`Registered LoopSpec not found: ${job.loopId}`);
  let specPath: string;
  try {
    specPath = await resolveExistingProjectPath(projectRoot, registered.path, "registered LoopSpec");
  } catch (error) {
    throw new ReviewServiceError(error instanceof Error ? error.message : "Registered LoopSpec path is invalid");
  }
  const loaded = await loadLoopSpecFromPath(specPath);
  if (!loaded.ok) throw new ReviewServiceError(loaded.errors.join("; "));
  const currentHash = loopSpecHash(loaded.spec);
  if (currentHash !== job.loopSpecHash || currentHash !== commit.loopSpecHash) {
    throw new ReviewServiceError(
      `Registered LoopSpec changed after routing commit ${routeCommitId}`
    );
  }
  if (loaded.spec.routing?.activationMode !== job.activationMode) {
    throw new ReviewServiceError(
      `Loop activation mode changed after routing commit ${routeCommitId}`
    );
  }

  if (trace.mode === "execute") {
    const gate = await evaluateLiveExecutionGate({
      spec: loaded.spec,
      projectRoot
    });
    if (!gate.allowed) {
      throw new ReviewServiceError(formatLiveExecutionGateError(gate));
    }
  }
  return loaded.spec;
}

export async function commitPreparedActions(
  trace: LoopRunTrace,
  approvedFingerprints: string[],
  spec?: LoopSpec
) {
  trace.status = "APPROVED";
  trace.status = "COMMITTED";

  const updatedCalls = [];
  for (const call of trace.toolCalls) {
    if (call.status === "mock_committed" || call.status === "completed") {
      updatedCalls.push(call);
      continue;
    }

    const prepared = trace.preparedActions.find((action) => action.toolKey === call.toolKey);
    if (!prepared) {
      updatedCalls.push(call);
      continue;
    }

    if (prepared.requiresApproval && !validateApprovalBinding(prepared, approvedFingerprints)) {
      updatedCalls.push({ ...call, status: "failed" as const });
      continue;
    }

    const declaredAdapterId = spec?.tools.find((tool) => tool.key === prepared.toolKey)?.adapterId;
    const adapter = getAdapterById(
      declaredAdapterId ?? (
        prepared.toolKey.includes("github") || prepared.toolKey === "propose_labels" || prepared.toolKey === "draft_response"
          ? trace.mode === "execute"
            ? "github"
            : "mock-github"
          : "mock-github"
      )
    );

    if (adapter) {
      const result = await adapter.commitPreparedAction({
        preparedAction: prepared,
        approvedFingerprints
      });
      updatedCalls.push({
        ...call,
        status: result.status === "mock_committed" ? ("mock_committed" as const) : ("failed" as const),
        output: {
          ...(call.output && typeof call.output === "object" ? (call.output as Record<string, unknown>) : {}),
          commitResult: result
        }
      });
    } else {
      updatedCalls.push({ ...call, status: "mock_committed" as const });
    }
  }

  trace.toolCalls = updatedCalls;
  const failed = updatedCalls.some((call) => call.status === "failed");
  trace.status = failed ? "FAILED_VERIFICATION" : "COMPLETED";
  trace.completedAt = new Date().toISOString();
}

export function mapUiDecisionToReviewStatus(decision: string): ReviewDecisionStatus {
  switch (decision) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "edited":
      return "needs_changes";
    case "escalated":
      return "request_evidence";
    default:
      return "needs_changes";
  }
}
