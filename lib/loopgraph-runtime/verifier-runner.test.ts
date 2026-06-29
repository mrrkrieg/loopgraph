import { describe, expect, it } from "vitest";
import type { AgentRunOutput } from "../loopgraph-core/evidence";
import type { LoopSpec } from "../loopgraph-core/loop-spec";
import { runVerifiers } from "./verifier-runner";

const spec = {
  policy: {
    allowedActions: [{ toolKey: "act", allowed: true, requiresApproval: false, riskLevel: "low" }]
  },
  verification: [
    {
      id: "confidence_threshold",
      type: "numeric_threshold",
      config: { policyInputKey: "confidence", operator: ">=", threshold: 0.8 }
    }
  ]
} as unknown as LoopSpec;

describe("verifier-runner", () => {
  it("evaluates numeric_threshold against policyInputs", () => {
    const passingOutput: AgentRunOutput = {
      decisionSummary: "ok",
      assumptions: [],
      proposedActions: [],
      evidence: [],
      policyInputs: [{ key: "confidence", value: 0.91, source: "fixture-provider" }],
      verificationRequest: { required: false, checks: [] }
    };

    const failingOutput: AgentRunOutput = {
      ...passingOutput,
      policyInputs: [{ key: "confidence", value: 0.55, source: "fixture-provider" }]
    };

    expect(runVerifiers({ spec, output: passingOutput, preparedActions: [] })[0]?.passed).toBe(true);
    expect(runVerifiers({ spec, output: failingOutput, preparedActions: [] })[0]?.passed).toBe(false);
  });
});
