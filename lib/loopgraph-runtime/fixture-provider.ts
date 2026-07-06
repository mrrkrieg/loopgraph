import type { AgentRunOutput } from "../loopgraph-core/evidence";
import type { LoopSpec } from "../loopgraph-core/loop-spec";
import type { ContextSnapshot } from "../loopgraph-core/context";
import type { SimulationFixture } from "./fixture-loader";

export function generateAssessment(input: {
  spec: LoopSpec;
  fixture: SimulationFixture;
  context: ContextSnapshot;
}): AgentRunOutput {
  if (input.fixture.expectedAssessment) {
    return normalizeAssessment(input.fixture.expectedAssessment);
  }

  const template = input.spec.metadata.id;

  if (template === "github-issue-triage") {
    return generateGithubAssessment(input.fixture);
  }

  if (template === "management-review") {
    return generateManagementAssessment(input.fixture);
  }

  return generateAccountAssessment(input.fixture);
}

function generateGithubAssessment(fixture: SimulationFixture): AgentRunOutput {
  const labels = Array.isArray(fixture.issue?.labels) ? fixture.issue?.labels as string[] : [];
  const body = String(fixture.issue?.body ?? "");
  const security = labels.includes("security") || /credential|vulnerability|exploit|CVE|token leak/i.test(body);

  return {
    decisionSummary: security
      ? "Possible security issue requires maintainer review before public response."
      : "Routine bug triage with labels and maintainer response draft.",
    assumptions: [{ id: "a1", statement: "Issue content is untrusted user input", confidence: 1 }],
    proposedActions: security
      ? [
          { id: "act_labels", toolKey: "propose_labels", label: "Propose security label", input: { labels: ["security"] }, riskLevel: "medium", requiresApproval: true, customerFacing: false },
          { id: "act_case", toolKey: "create_escalation_case", label: "Create security escalation case", input: { category: "security" }, riskLevel: "high", requiresApproval: true, customerFacing: false }
        ]
      : [
          { id: "act_labels", toolKey: "propose_labels", label: "Propose bug labels", input: { labels: ["bug"] }, riskLevel: "low", requiresApproval: false, customerFacing: false },
          { id: "act_draft", toolKey: "draft_response", label: "Draft maintainer response", input: { body: "Thanks for the report." }, riskLevel: "low", requiresApproval: false, customerFacing: false }
        ],
    evidence: [
      { id: "ev1", sourceId: "issue.body", sourceType: "fixture", excerpt: body.slice(0, 120), trusted: false },
      { id: "ev2", sourceId: "issue.labels", sourceType: "fixture", excerpt: labels.join(", "), trusted: true }
    ],
    policyInputs: [
      { key: "issue.labels", value: labels.join(","), source: "mock-github" },
      { key: "issue.body", value: body, source: "mock-github" }
    ],
    verificationRequest: { required: security, reason: security ? "Security-sensitive issue" : undefined, checks: ["evidence", "policy"] },
    escalationRequest: security ? { required: true, category: "security", severity: "P1", rationale: "Security keywords detected" } : { required: false }
  };
}

function generateManagementAssessment(fixture: SimulationFixture): AgentRunOutput {
  const cases = Array.isArray(fixture.cases) ? (fixture.cases as Array<Record<string, unknown>>) : [];
  const leadershipRequired = cases.some((item) => item.severity === "P0" || item.severity === "P1");

  return {
    decisionSummary: `Weekly management review covering ${cases.length} open escalation case(s).`,
    assumptions: [{ id: "a1", statement: "Cases are normalized EscalationCase payloads only", confidence: 1 }],
    proposedActions: [],
    evidence: cases.map((item, index) => ({
      id: `ev_case_${index + 1}`,
      sourceId: "open_cases",
      sourceType: "policy" as const,
      excerpt: `${String(item.summary ?? item.id)} (${String(item.severity ?? "unknown")})`,
      trusted: true
    })),
    policyInputs: [{ key: "openCases.count", value: cases.length, source: "case-registry" }],
    verificationRequest: { required: leadershipRequired, checks: ["evidence"] },
    escalationRequest: { required: false }
  };
}

function generateAccountAssessment(fixture: SimulationFixture): AgentRunOutput {
  const segment = String(fixture.account?.segment ?? "smb");
  const severity = String(fixture.incident?.severity ?? "P3");
  const category = String(fixture.incident?.category ?? "product_defect");
  const renewalRisk = String(fixture.businessImpact?.renewalRisk ?? "low");
  const renewalDays = Number(fixture.account?.renewalDaysRemaining ?? 999);
  const incomplete = fixture.account == null || fixture.businessImpact == null;
  const shouldEscalate =
    ["enterprise", "strategic"].includes(segment) &&
    category === "service_outage" &&
    ["P0", "P1"].includes(severity);

  const lowRisk = ["P2", "P3"].includes(severity) && renewalRisk === "low";

  return {
    decisionSummary: shouldEscalate
      ? "Enterprise account outage near renewal requires cross-functional escalation."
      : lowRisk
        ? "Low-risk support question can stay with customer success."
        : incomplete
          ? "Insufficient account context; request more evidence before escalation."
          : "Account signal reviewed with standard follow-up.",
    assumptions: [{ id: "a1", statement: "Ticket content is untrusted", confidence: 1 }],
    proposedActions: shouldEscalate
      ? [
          { id: "act_task", toolKey: "create_internal_task", label: "Create P1 incident task", input: { priority: "P1" }, riskLevel: "medium", requiresApproval: true, customerFacing: false },
          { id: "act_msg", toolKey: "customer_message", label: "Draft customer update", input: { body: "We are investigating." }, riskLevel: "high", requiresApproval: true, customerFacing: true }
        ]
      : [{ id: "act_reply", toolKey: "draft_internal_reply", label: "Draft internal reply", input: { body: "Follow up with account owner." }, riskLevel: "low", requiresApproval: true, customerFacing: false }],
    evidence: incomplete
      ? [{ id: "ev_ticket", sourceId: "support.ticket.current", sourceType: "fixture", excerpt: String((fixture.ticket as { current?: { body?: string } })?.current?.body ?? ""), trusted: false }]
      : [
          { id: "ev_ticket", sourceId: "support.ticket.current", sourceType: "fixture", excerpt: String((fixture.ticket as { current?: { body?: string } })?.current?.body ?? ""), trusted: false },
          { id: "ev_renewal", sourceId: "crm.account", sourceType: "fixture", excerpt: `Renewal in ${renewalDays} days`, trusted: true }
        ],
    policyInputs: [
      { key: "account.segment", value: segment, source: "mock-crm" },
      { key: "incident.category", value: category, source: "mock-status" },
      { key: "incident.severity", value: severity, source: "mock-status" },
      { key: "businessImpact.renewalRisk", value: renewalRisk, source: "mock-crm" },
      { key: "account.renewalDaysRemaining", value: renewalDays, source: "mock-crm" },
      { key: "confidence", value: incomplete ? 0.55 : 0.91, source: "fixture-provider" }
    ],
    verificationRequest: { required: shouldEscalate || incomplete, checks: ["evidence", "policy"] },
    escalationRequest: shouldEscalate
      ? { required: true, category: "customer_risk", severity: severity as "P0" | "P1" | "P2" | "P3", rationale: "Enterprise outage near renewal" }
      : { required: false }
  };
}

function normalizeAssessment(raw: Record<string, unknown>): AgentRunOutput {
  return raw as unknown as AgentRunOutput;
}
