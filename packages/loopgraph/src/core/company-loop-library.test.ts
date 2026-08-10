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
    expect(PACK_DERIVED_COMPANY_LOOPS).toHaveLength(52);
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "product-feedback_to_problem")).toBeUndefined();
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "product-feedback-clustering")).toMatchObject({
      departmentType: "product",
      problemTypes: ["product.recurring_feedback"]
    });
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "operations_finance-forecast_variance")).toBeUndefined();
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "ops-finance-forecast-variance")).toMatchObject({
      departmentType: "ops_finance",
      problemTypes: ["finance.forecast_variance"],
      supportingLoopTemplateIds: ["ops-finance-approval-bottleneck", "ops-finance-resource-allocation"]
    });
    expect(resolveCompanyLoopTemplateId("marketing-campaign_learning")).toBe("marketing-campaign-learning");
    expect(getPrebuiltLoopDefinition("marketing-campaign_learning")?.templateId).toBe("marketing-campaign-learning");
    expect(resolveCompanyLoopTemplateId("operations_finance-forecast_variance")).toBe("ops-finance-forecast-variance");
    expect(getPrebuiltLoopDefinition("operations_finance-forecast_variance")?.templateId).toBe("ops-finance-forecast-variance");
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "hr-retention_signal")).toBeUndefined();
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "hr-retention-review")).toMatchObject({
      departmentType: "hr_talent",
      problemTypes: ["talent.retention_risk"]
    });
    expect(resolveCompanyLoopTemplateId("hr-performance_review_prep")).toBe("hr-performance-review-preparation");
    expect(getPrebuiltLoopDefinition("hr-performance_review_prep")?.templateId).toBe("hr-performance-review-preparation");
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "legal_security-contract_triage")).toBeUndefined();
    expect(PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === "legal-contract-exception-triage")).toMatchObject({
      departmentType: "legal_compliance",
      problemTypes: ["legal.contract_exception"],
      supportingLoopTemplateIds: ["legal-policy-control-drift"]
    });
    expect(resolveCompanyLoopTemplateId("legal_security-security_questionnaire")).toBe("legal-security-questionnaire");
    expect(getPrebuiltLoopDefinition("legal_security-security_questionnaire")?.templateId).toBe("legal-security-questionnaire");
  });
});
