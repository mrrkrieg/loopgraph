import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateLoopSpec, collectLoopSpecSemanticErrors, exportLoopSpecJsonSchema } from "./loop-spec";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "./constants";

const minimalSpec = {
  apiVersion: LOOPGRAPH_API_VERSION,
  kind: LOOP_KIND,
  metadata: { id: "test", name: "Test", version: "1.0.0" },
  trigger: { type: "manual", source: "test", event: "run" },
  input: { schema: { type: "object" } },
  output: {
    schema: {
      type: "object",
      required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
      properties: {
        decisionSummary: { type: "string" },
        proposedActions: { type: "array" },
        evidence: { type: "array" },
        policyInputs: { type: "array" },
        verificationRequest: { type: "object" }
      }
    }
  },
  context: { sources: [], precedence: [] },
  routine: { steps: [{ id: "s1", name: "Step", stepType: "observe", actor: "system", description: "d" }] },
  tools: [{ key: "write_tool", adapterId: "local-json", label: "Write", writeCapable: true, riskLevel: "medium" }],
  policy: {
    allowedActions: [{ toolKey: "write_tool", allowed: true, requiresApproval: true, riskLevel: "medium" }],
    forbiddenActions: [],
    escalationRules: [{
      id: "rule1",
      when: { all: [] },
      routeTo: { primaryOwner: "owner", reviewers: [], responseSla: "30m" },
      requiresApproval: [],
      decisionsRequired: ["Approve"]
    }]
  },
  verification: [],
  approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["approver"] },
  persistence: { idempotency: { enabled: true } },
  trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true }
};

describe("loop-spec", () => {
  it("validates minimal spec", () => {
    expect(() => validateLoopSpec(minimalSpec)).not.toThrow();
  });

  it("fails write-capable tool without policy", () => {
    const errors = collectLoopSpecSemanticErrors({
      ...minimalSpec,
      policy: { ...minimalSpec.policy, allowedActions: [] }
    } as never);
    expect(errors.some((e) => e.includes("write_tool"))).toBe(true);
  });

  it("fails escalation rule missing owner or deadline", () => {
    const errors = collectLoopSpecSemanticErrors({
      ...minimalSpec,
      policy: {
        ...minimalSpec.policy,
        escalationRules: [{
          id: "bad_rule",
          when: { all: [] },
          routeTo: { primaryOwner: "", reviewers: [], responseSla: "" },
          requiresApproval: [],
          decisionsRequired: ["Approve"]
        }]
      }
    } as never);
    expect(errors.some((e) => e.includes("missing routeTo.primaryOwner"))).toBe(true);
    expect(errors.some((e) => e.includes("missing routeTo.responseSla"))).toBe(true);
  });

  it("matches checked-in JSON Schema export", () => {
    const schemaPath = path.join(__dirname, "../../docs/schemas/loop-v1alpha1.json");
    const checkedIn = JSON.parse(readFileSync(schemaPath, "utf8"));
    const generated = exportLoopSpecJsonSchema();
    expect(generated).toEqual(checkedIn);
  });
});
