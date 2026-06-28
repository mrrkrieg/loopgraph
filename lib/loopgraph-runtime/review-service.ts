import type { ReviewRole } from "../loopgraph-core/constants";
import type { HumanReviewTrace } from "../loopgraph-core/review";
import { validateApprovalBinding } from "../loopgraph-core/review";
import type { LoopRunTrace } from "../loopgraph-core/trace";
import type { StorageAdapter } from "../loopgraph-sdk/adapters";
import { getAdapterById } from "../loopgraph-sdk/adapters/index";
import { buildImprovementItemFromReview } from "./improvement-service";

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
  role?: ReviewRole;
  comment?: string;
  teacherFeedback?: string;
  reassignedTo?: string;
  reviewMinutes?: number;
  reworkMinutes?: number;
  botsittingMinutes?: number;
  escalationMinutes?: number;
  governanceMinutes?: number;
};

export class ReviewServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewServiceError";
  }
}

export async function applyReviewDecision(
  storage: StorageAdapter,
  input: ApplyReviewDecisionInput
): Promise<{ trace: LoopRunTrace; review: HumanReviewTrace }> {
  const trace = await storage.getRun(input.runId);
  if (!trace) {
    throw new ReviewServiceError(`Trace not found: ${input.runId}`);
  }

  if (trace.status !== "WAITING_FOR_REVIEW" && input.status === "approved") {
    throw new ReviewServiceError(`Run ${input.runId} is not waiting for review (status=${trace.status})`);
  }

  const approvedFingerprints = input.approvedFingerprints ?? [];
  const reviewStatus = mapReviewStatus(input.status);

  const decidedAt = new Date().toISOString();
  const reviewRecord: HumanReviewTrace = {
    id: `review_${input.runId}_${trace.humanReviews.length + 1}`,
    runId: input.runId,
    status: reviewStatus,
    role: input.role ?? "approver",
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
    assertValidFingerprintSelection(trace, approvedFingerprints);
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

    await commitApprovedActions(trace, cumulativeApprovedFingerprints);

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

function getCumulativeApprovedFingerprints(trace: LoopRunTrace): string[] {
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

async function commitApprovedActions(trace: LoopRunTrace, approvedFingerprints: string[]) {
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

    const adapter = getAdapterById(
      prepared.toolKey.includes("github") || prepared.toolKey === "propose_labels" || prepared.toolKey === "draft_response"
        ? trace.mode === "execute"
          ? "github"
          : "mock-github"
        : "mock-github"
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
