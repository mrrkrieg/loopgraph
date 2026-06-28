import type { LoopSpec } from "./loop-spec";
import type { AgentRunOutput, ProposedAction } from "./evidence";
import { contentHash } from "./hash";
import type { PreparedAction } from "./review";
import type { PolicyDecision } from "./trace";
import type { EscalationCase } from "./escalation";

export function evaluatePolicy(spec: LoopSpec, output: AgentRunOutput, preparedActions: PreparedAction[]): PolicyDecision[] {
  const decisions: PolicyDecision[] = [];

  for (const forbidden of spec.policy.forbiddenActions) {
    const matched = output.proposedActions.some((a) => a.toolKey === forbidden.toolKey);
    decisions.push({
      ruleId: `forbidden:${forbidden.toolKey}`,
      matched,
      action: matched ? "block" : "allow",
      reason: forbidden.reason,
      requiresReview: false,
      createEscalationCase: false
    });
  }

  for (const rule of spec.policy.escalationRules) {
    const matched = matchesWhen(rule.when, output);
    decisions.push({
      ruleId: rule.id,
      matched,
      action: matched ? "escalate" : "continue",
      reason: matched ? `Matched escalation rule ${rule.id}` : `No match for ${rule.id}`,
      requiresReview: matched && rule.requiresApproval.length > 0,
      createEscalationCase: Boolean(matched && rule.createEscalationCase)
    });
  }

  for (const prepared of preparedActions) {
    const policy = spec.policy.allowedActions.find((a) => a.toolKey === prepared.toolKey);
    if (!policy?.allowed) {
      decisions.push({
        ruleId: `allow:${prepared.toolKey}`,
        matched: true,
        action: "block",
        reason: `Tool ${prepared.toolKey} is not allowed`,
        requiresReview: false,
        createEscalationCase: false
      });
    } else if (policy.requiresApproval || prepared.requiresApproval) {
      decisions.push({
        ruleId: `approval:${prepared.toolKey}`,
        matched: true,
        action: "review",
        reason: `Tool ${prepared.toolKey} requires approval`,
        requiresReview: true,
        createEscalationCase: false
      });
    }
  }

  return decisions;
}

export function shouldCreateEscalationCase(decisions: PolicyDecision[]): boolean {
  return decisions.some((d) => d.matched && d.createEscalationCase);
}

export function buildEscalationCaseFromPolicy(input: {
  spec: LoopSpec;
  runId: string;
  output: AgentRunOutput;
  preparedActions: PreparedAction[];
  decisions: PolicyDecision[];
  simulatedAt: string;
}): EscalationCase | null {
  const matchedRule = input.spec.policy.escalationRules.find((rule) =>
    input.decisions.some((d) => d.ruleId === rule.id && d.matched && d.createEscalationCase)
  );
  if (!matchedRule?.createEscalationCase) return null;

  const category = matchedRule.createEscalationCase.category as EscalationCase["category"];
  const severity = matchedRule.createEscalationCase.severity ?? "P1";
  const deadline = new Date(new Date(input.simulatedAt).getTime() + parseSlaMs(matchedRule.routeTo.responseSla)).toISOString();

  return {
    id: `case_${input.runId.slice(-12)}`,
    sourceRunId: input.runId,
    sourceLoopId: input.spec.metadata.id,
    createdAt: input.simulatedAt,
    category,
    severity,
    confidence: input.output.policyInputs.find((p) => p.key === "confidence")?.value as number ?? 0.85,
    affectedEntities: {},
    summary: input.output.decisionSummary,
    evidence: input.output.evidence,
    unresolvedQuestions: [],
    recommendedActions: input.output.proposedActions,
    decisionsRequired: matchedRule.decisionsRequired.map((q, i) => ({
      id: `decision_${i + 1}`,
      question: q,
      requiredRole: matchedRule.routeTo.primaryOwner,
      blocking: true
    })),
    routing: {
      primaryOwner: { role: matchedRule.routeTo.primaryOwner },
      reviewers: matchedRule.routeTo.reviewers.map((r) => ({ role: r })),
      informed: [],
      escalationDeadline: deadline
    },
    responsePlan: {
      internalActions: input.preparedActions.filter((a) => !a.customerFacing).map((a) => ({
        id: a.id,
        toolKey: a.toolKey,
        label: a.label,
        payload: a.payload,
        fingerprint: a.fingerprint
      })),
      customerFacingDraft: input.preparedActions.find((a) => a.customerFacing)
        ? {
            id: input.preparedActions.find((a) => a.customerFacing)!.id,
            toolKey: input.preparedActions.find((a) => a.customerFacing)!.toolKey,
            label: input.preparedActions.find((a) => a.customerFacing)!.label,
            payload: input.preparedActions.find((a) => a.customerFacing)!.payload,
            fingerprint: input.preparedActions.find((a) => a.customerFacing)!.fingerprint
          }
        : undefined,
      successCriteria: ["Policy checks passed", "Required review completed"]
    },
    status: "open"
  };
}

function matchesWhen(when: Record<string, unknown>, output: AgentRunOutput): boolean {
  if ("any" in when && Array.isArray(when.any)) {
    return (when.any as Record<string, unknown>[]).some((clause) => matchesClause(clause, output));
  }
  if ("all" in when && Array.isArray(when.all)) {
    return (when.all as Record<string, unknown>[]).every((clause) => matchesClause(clause, output));
  }
  return matchesClause(when, output);
}

function matchesClause(clause: Record<string, unknown>, output: AgentRunOutput): boolean {
  for (const [key, value] of Object.entries(clause)) {
    if (key === "issue.labels contains") {
      const label = String(value);
      if (!output.policyInputs.some((p) => p.key === "issue.labels" && String(p.value).includes(label))) return false;
      continue;
    }
    if (key === "issue.body matches") {
      const pattern = String(value);
      const body = String(output.policyInputs.find((p) => p.key === "issue.body")?.value ?? "");
      if (!new RegExp(pattern, "i").test(body)) return false;
      continue;
    }
    if (key === "account.segment in") {
      const segments = value as string[];
      const segment = String(output.policyInputs.find((p) => p.key === "account.segment")?.value ?? "");
      if (!segments.includes(segment)) return false;
      continue;
    }
    if (key === "incident.category ==") {
      if (String(output.policyInputs.find((p) => p.key === "incident.category")?.value ?? "") !== String(value)) return false;
      continue;
    }
    if (key === "incident.severity in") {
      const severities = value as string[];
      const severity = String(output.policyInputs.find((p) => p.key === "incident.severity")?.value ?? "");
      if (!severities.includes(severity)) return false;
      continue;
    }
    if (key === "businessImpact.renewalRisk ==") {
      if (String(output.policyInputs.find((p) => p.key === "businessImpact.renewalRisk")?.value ?? "") !== String(value)) return false;
      continue;
    }
    if (key === "account.renewalDaysRemaining <=") {
      const max = Number(value);
      const days = Number(output.policyInputs.find((p) => p.key === "account.renewalDaysRemaining")?.value ?? 999);
      if (days > max) return false;
      continue;
    }
  }
  if (output.escalationRequest?.required && Object.keys(clause).length === 0) return true;
  return Object.keys(clause).length > 0;
}

function parseSlaMs(sla?: string): number {
  if (!sla) return 60 * 60 * 1000;
  const match = sla.match(/^(\d+)(m|h)$/);
  if (!match) return 60 * 60 * 1000;
  const value = Number(match[1]);
  return match[2] === "h" ? value * 3600000 : value * 60000;
}

export function prepareActionsFromProposed(proposed: ProposedAction[]): PreparedAction[] {
  return proposed.map((action) => ({
    id: `prepared_${action.id}`,
    toolKey: action.toolKey,
    label: action.label,
    payload: action.input,
    fingerprint: contentHash(action.input),
    riskLevel: action.riskLevel,
    requiresApproval: action.requiresApproval,
    customerFacing: action.customerFacing,
    proposedActionId: action.id
  }));
}
