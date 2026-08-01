import { describe, expect, it } from "vitest";
import {
  CROSS_DEPARTMENT_PLAYBOOKS,
  DEPARTMENT_OPERATING_SKILLS,
  HERMES_ROUTER_EVALUATION_QUESTIONS,
  PREBUILT_COMPANY_LOOPS
} from "./company-loop-library";

describe("prebuilt company loop library", () => {
  it("defines one complete operating skill for each canonical company department", () => {
    expect(DEPARTMENT_OPERATING_SKILLS).toHaveLength(9);
    expect(new Set(DEPARTMENT_OPERATING_SKILLS.map((skill) => skill.departmentType)).size).toBe(9);
    for (const skill of DEPARTMENT_OPERATING_SKILLS) {
      expect(skill.taskApproach.map((phase) => phase.phase)).toEqual([
        "understand",
        "assemble_context",
        "decide",
        "govern",
        "learn"
      ]);
      expect(skill.defaultLoopTemplateIds.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("defines the complete Hermes routing decision checklist", () => {
    expect(HERMES_ROUTER_EVALUATION_QUESTIONS).toHaveLength(10);
    expect(HERMES_ROUTER_EVALUATION_QUESTIONS.at(-1)).toBe("Should Hermes abstain and ask a human?");
  });

  it("bounds prebuilt loop fan-out and connects learning across departments", () => {
    expect(PREBUILT_COMPANY_LOOPS.length).toBeGreaterThanOrEqual(45);
    expect(CROSS_DEPARTMENT_PLAYBOOKS.length).toBeGreaterThanOrEqual(6);
    for (const loop of PREBUILT_COMPANY_LOOPS) {
      expect(loop.requiredContext.length).toBeGreaterThan(0);
      expect(loop.requiredConnections.length).toBeGreaterThan(0);
      expect(loop.fanoutPolicy.maxRoutes).toBeLessThanOrEqual(4);
    }
    expect(CROSS_DEPARTMENT_PLAYBOOKS.find((item) => item.id === "incident-to-company-learning")?.orderedLoopTemplateIds).toEqual([
      "engineering-incident_response",
      "strategic-account-escalation",
      "customer_success-customer_communication_review",
      "engineering-incident_learning"
    ]);
  });
});
