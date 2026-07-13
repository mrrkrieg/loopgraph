import type { EscalationCase } from "../core/escalation";
import type { LoopRunTrace } from "../core/trace";

export function formatReviewPacket(trace: LoopRunTrace, escalationCase?: EscalationCase | null): string {
  const agentOutput = trace.agentOutput ?? {
    decisionSummary: "(assessment missing)",
    assumptions: [],
    proposedActions: [],
    evidence: [],
    policyInputs: [],
    verificationRequest: { required: false, checks: [] }
  };

  const lines: string[] = [
    `# Review decision packet`,
    ``,
    `Run: ${trace.id}`,
    `Loop: ${trace.loopId}@${trace.loopSpecVersion}`,
    `Status: ${trace.status}`,
    `Mode: ${trace.mode} (fixture/simulate — no live integrations unless execute is enabled)`,
    `Context hash: ${trace.contextSnapshot.contentHash}`,
    `Trigger: ${trace.trigger.source}/${trace.trigger.event} · eventId=${trace.trigger.eventId}`,
    ``,
    `## Decision summary`,
    agentOutput.decisionSummary,
    ``
  ];

  if (agentOutput.assumptions.length > 0) {
    lines.push(`## Assumptions`);
    for (const assumption of agentOutput.assumptions) {
      lines.push(`- [${assumption.confidence}] ${assumption.statement}`);
    }
    lines.push(``);
  }

  lines.push(`## Evidence`);
  if (agentOutput.evidence.length === 0) {
    lines.push(`(none recorded)`);
  } else {
    for (const evidence of agentOutput.evidence) {
      lines.push(
        `- ${evidence.sourceId} (${evidence.sourceType}) trusted=${evidence.trusted}: ${evidence.excerpt.slice(0, 160)}`
      );
    }
  }
  lines.push(``);

  lines.push(`## Prepared actions (approve exact fingerprints)`);
  const internal = trace.preparedActions.filter((action) => !action.customerFacing);
  const customer = trace.preparedActions.filter((action) => action.customerFacing);

  if (internal.length > 0) {
    lines.push(`### Internal`);
    for (const action of internal) {
      lines.push(formatPreparedAction(action));
    }
    lines.push(``);
  }

  if (customer.length > 0) {
    lines.push(`### Customer-facing (separate approval gate)`);
    for (const action of customer) {
      lines.push(formatPreparedAction(action));
    }
    lines.push(``);
  }

  lines.push(`## Policy decisions`);
  for (const decision of trace.policyDecisions.filter((entry) => entry.matched)) {
    lines.push(`- ${decision.ruleId}: ${decision.action} — ${decision.reason}`);
  }
  if (trace.policyDecisions.every((entry) => !entry.matched)) {
    lines.push(`(no matched blocking rules)`);
  }
  lines.push(``);

  lines.push(`## Verification`);
  for (const result of trace.verificationResults) {
    lines.push(`- ${result.verifierId}: ${result.passed ? "PASS" : "FAIL"} — ${result.summary}`);
  }
  lines.push(``);

  if (escalationCase) {
    lines.push(`## EscalationCase ${escalationCase.id}`);
    lines.push(`Severity: ${escalationCase.severity} · Category: ${escalationCase.category}`);
    lines.push(`Summary: ${escalationCase.summary}`);
    lines.push(`Owner: ${escalationCase.routing.primaryOwner.role}`);
    lines.push(`Deadline: ${escalationCase.routing.escalationDeadline}`);
    if (escalationCase.decisionsRequired.length > 0) {
      lines.push(`Decisions required:`);
      for (const decision of escalationCase.decisionsRequired) {
        lines.push(`- ${decision.question} (${decision.requiredRole})`);
      }
    }
    lines.push(``);
  }

  if (trace.humanReviews.length > 0) {
    lines.push(`## Prior reviews`);
    for (const review of trace.humanReviews) {
      lines.push(
        `- ${review.status} by ${review.role} at ${review.decidedAt ?? review.createdAt}` +
          (review.comment ? `: ${review.comment}` : "")
      );
    }
  }

  return lines.join("\n");
}

function formatPreparedAction(action: LoopRunTrace["preparedActions"][number]): string {
  return [
    `- ${action.label}`,
    `  toolKey=${action.toolKey} fingerprint=${action.fingerprint}`,
    `  requiresApproval=${action.requiresApproval} customerFacing=${action.customerFacing} risk=${action.riskLevel}`,
    `  payload=${JSON.stringify(action.payload)}`
  ].join("\n");
}
