import { describe, expect, it } from "vitest";
import { validateEscalationCaseInvariants } from "./escalation";
import type { EscalationCase } from "./escalation";

const baseCase: EscalationCase = {
  id: "case_1",
  sourceRunId: "run_1",
  sourceLoopId: "loop_1",
  createdAt: "2026-06-27T12:00:00.000Z",
  category: "security",
  severity: "P1",
  confidence: 0.9,
  affectedEntities: {},
  summary: "Security issue",
  evidence: [{ id: "e1", sourceId: "issue", sourceType: "fixture", excerpt: "token leak", trusted: false }],
  unresolvedQuestions: [],
  recommendedActions: [],
  decisionsRequired: [{ id: "d1", question: "Approve?", requiredRole: "owner", blocking: true }],
  routing: {
    primaryOwner: { role: "security_owner" },
    reviewers: [],
    informed: [],
    escalationDeadline: "2026-06-27T13:00:00.000Z"
  },
  responsePlan: { internalActions: [], successCriteria: [] },
  status: "open"
};

describe("escalation case invariants", () => {
  it("passes valid P1 case", () => {
    expect(validateEscalationCaseInvariants(baseCase)).toEqual([]);
  });

  it("requires evidence for high severity", () => {
    const errors = validateEscalationCaseInvariants({ ...baseCase, evidence: [] });
    expect(errors.length).toBeGreaterThan(0);
  });
});
