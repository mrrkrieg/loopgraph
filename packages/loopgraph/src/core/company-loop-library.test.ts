import { describe, expect, it } from "vitest";
import {
  CROSS_DEPARTMENT_PLAYBOOKS,
  DEPARTMENT_OPERATING_SKILLS,
  HERMES_ROUTER_EVALUATION_QUESTIONS,
  OFFICIAL_APP_CATALOG_SOURCE_DIGEST,
  PACK_DERIVED_COMPANY_LOOPS,
  PREBUILT_COMPANY_LOOPS,
  getPrebuiltLoopDefinition,
  resolveCompanyLoopTemplateId
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
      "engineering-incident-response",
      "cs-strategic-account-escalation",
      "engineering-customer-impact",
      "engineering-incident-learning"
    ]);
  });

  it("uses the generated official LoopPack catalog for migrated departments", () => {
    expect(OFFICIAL_APP_CATALOG_SOURCE_DIGEST).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(PACK_DERIVED_COMPANY_LOOPS).toHaveLength(35);
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "product-feedback_to_problem")).toBeUndefined();
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "product-feedback-clustering")).toMatchObject({
      departmentType: "product",
      problemTypes: ["product.recurring_feedback"]
    });
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "operations_finance-forecast_variance")).toBeDefined();
    expect(resolveCompanyLoopTemplateId("marketing-campaign_learning")).toBe("marketing-campaign-learning");
    expect(getPrebuiltLoopDefinition("marketing-campaign_learning")?.templateId).toBe("marketing-campaign-learning");
  });
});
