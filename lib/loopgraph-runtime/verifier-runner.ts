import type { AgentRunOutput } from "../loopgraph-core/evidence";
import type { LoopSpec } from "../loopgraph-core/loop-spec";
import type { VerificationResult } from "../loopgraph-core/trace";
import type { PreparedAction } from "../loopgraph-core/review";

export function runVerifiers(input: {
  spec: LoopSpec;
  output: AgentRunOutput;
  preparedActions: PreparedAction[];
}): VerificationResult[] {
  const results: VerificationResult[] = [];

  for (const verifier of input.spec.verification) {
    if (verifier.type === "schema") {
      results.push({
        verifierId: verifier.id,
        passed: Boolean(input.output.decisionSummary && input.output.proposedActions),
        confidence: 1,
        summary: "Structured output present",
        checks: [{ name: "decisionSummary", passed: Boolean(input.output.decisionSummary) }]
      });
    }
    if (verifier.type === "policy") {
      const blocked = input.preparedActions.some((action) => !input.spec.policy.allowedActions.find((p) => p.toolKey === action.toolKey && p.allowed));
      results.push({
        verifierId: verifier.id,
        passed: !blocked,
        confidence: 1,
        summary: blocked ? "Blocked action detected" : "All actions allowed by policy",
        checks: [{ name: "allowedActions", passed: !blocked }]
      });
    }
    if (verifier.type === "evidence") {
      const needsEvidence = input.output.escalationRequest?.required || input.output.proposedActions.some((a) => a.riskLevel === "high" || a.riskLevel === "critical");
      const passed = !needsEvidence || input.output.evidence.length > 0;
      results.push({
        verifierId: verifier.id,
        passed,
        confidence: passed ? 1 : 0.4,
        summary: passed ? "Evidence references present" : "Missing evidence for high-impact claim",
        checks: [{ name: "evidenceRefs", passed }]
      });
    }
    if (verifier.type === "approval_required") {
      const needsReview = input.preparedActions.some((action) => action.requiresApproval);
      results.push({
        verifierId: verifier.id,
        passed: true,
        confidence: 1,
        summary: needsReview ? "Approval required" : "No approval required",
        checks: [{ name: "approvalRequired", passed: !needsReview, message: needsReview ? "Review required" : undefined }]
      });
    }
    if (verifier.type === "mock_judge") {
      results.push({
        verifierId: verifier.id,
        passed: true,
        confidence: 0.7,
        summary: "Mock judge quality score recorded",
        checks: [{ name: "mockJudge", passed: true }]
      });
    }
  }

  return results;
}

export function allVerifiersPassed(results: VerificationResult[]): boolean {
  return results.every((result) => result.passed || result.verifierId.includes("mock_judge"));
}
