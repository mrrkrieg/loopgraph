import type { EscalationCase } from "./escalation";
import type { LoopRunTrace } from "./trace";

export function summarizeTrace(trace: LoopRunTrace, escalationCase?: EscalationCase) {
  return {
    status: trace.status,
    loopId: trace.loopId,
    idempotencyKey: trace.idempotencyKey,
    contextHash: trace.contextSnapshot.contentHash,
    preparedActionCount: trace.preparedActions.length,
    preparedFingerprints: trace.preparedActions.map((action) => action.fingerprint).sort(),
    escalationCaseIds: [...trace.escalationCases].sort(),
    escalationSeverity: escalationCase?.severity ?? null,
    policyBlocked: trace.policyDecisions.some((decision) => decision.action === "block"),
    verificationFailed: trace.verificationResults.some((result) => !result.passed),
    humanReviewRequired: trace.status === "WAITING_FOR_REVIEW"
  };
}
