import { describe, expect, it } from "vitest";
import { buildGraphFromCatalog } from "./graph";
import { createSpecFromTemplate } from "./template-spec";
import { getDepartmentTemplates, getTemplateCatalog } from "./templates";
import {
  PREBUILT_COMPANY_LOOPS,
  compileRoutingCardFromLoopSpec,
  validateCompanyLoopLibraryReferences,
  validateLoopSpec
} from "loopgraph/core";

describe("Loopgraph template catalog", () => {
  it("defines a broad department catalog with maturity labels", () => {
    const departments = getDepartmentTemplates();
    const templates = getTemplateCatalog();

    expect(departments.map((department) => department.key)).toEqual([
      "product",
      "marketing",
      "customer_success",
      "sales",
      "engineering",
      "operations_finance",
      "hr",
      "legal_security",
      "management",
      "custom"
    ]);
    expect(templates.length).toBeGreaterThanOrEqual(40);
    expect(templates.some((template) => template.runtimeLevel === "runnable")).toBe(true);
    expect(templates.some((template) => template.runtimeLevel === "spec_stub")).toBe(true);
    expect(templates.some((template) => template.runtimeLevel === "catalog")).toBe(true);

    for (const template of templates) {
      expect(template.id).toBeTruthy();
      expect(template.loopType).toBeTruthy();
      expect(template.goal).toBeTruthy();
      expect(template.businessOutcome).toBeTruthy();
      expect(template.primaryMetric).toBeTruthy();
      expect(template.defaultOwners?.length).toBeGreaterThan(0);
      expect(template.defaultMetrics?.length).toBeGreaterThanOrEqual(3);
      expect(template.requiredDataSources?.length).toBeGreaterThan(0);
      expect(template.routine?.length).toBeGreaterThanOrEqual(4);
      expect(template.verification?.length).toBeGreaterThanOrEqual(3);
      expect(template.escalation?.length).toBeGreaterThanOrEqual(2);
      expect(template.connections?.length).toBeGreaterThan(0);
      expect(template.businessOutcome).not.toContain("A measurable business outcome improves");
      expect(template.routine).not.toContain("Draft next action");
      expect(template.verification).not.toContain("Verify output");
      expect(template.requiredDataSources).not.toContain("Workspace signals");
    }
  });

  it("builds migrated department cards from the generated official app catalog", () => {
    const productTemplates = getDepartmentTemplates().find((department) => department.key === "product")!.commonLoops;
    expect(productTemplates).toHaveLength(5);
    expect(productTemplates.find((template) => template.id === "product-feedback_to_problem")).toBeUndefined();
    expect(productTemplates.find((template) => template.id === "product-feedback-clustering")).toMatchObject({
      runtimeLevel: "runnable",
      examplePath: "packs/official/product/turn-feedback-into-product-problems",
      routingDefinition: expect.objectContaining({ problemTypes: ["product.recurring_feedback"] })
    });

    const financeTemplates = getDepartmentTemplates().find((department) => department.key === "operations_finance")!.commonLoops;
    expect(financeTemplates).toHaveLength(6);
    expect(financeTemplates.find((template) => template.id === "operations_finance-forecast_variance")).toBeUndefined();
    expect(financeTemplates.find((template) => template.id === "ops-finance-forecast-variance")).toMatchObject({
      runtimeLevel: "runnable",
      examplePath: "packs/official/operations-finance/manage-forecast-controls",
      routingDefinition: expect.objectContaining({
        problemTypes: ["finance.forecast_variance"],
        supportingLoopTemplateIds: ["ops-finance-approval-bottleneck", "ops-finance-resource-allocation"]
      })
    });

    const hrTemplates = getDepartmentTemplates().find((department) => department.key === "hr")!.commonLoops;
    expect(hrTemplates).toHaveLength(5);
    expect(hrTemplates.find((template) => template.id === "hr-performance_review_prep")).toBeUndefined();
    expect(hrTemplates.find((template) => template.id === "hr-performance-review-preparation")).toMatchObject({
      runtimeLevel: "runnable",
      examplePath: "packs/official/hr-talent/operate-people-workflows",
      routingDefinition: expect.objectContaining({ problemTypes: ["talent.performance_review"] })
    });
  });

  it("generates valid v1alpha1 starter specs for spec-stub templates", () => {
    const specStub = getTemplateCatalog().find((template) => template.runtimeLevel === "spec_stub");
    expect(specStub).toBeTruthy();

    const spec = createSpecFromTemplate(specStub!.id, { id: "test-template-loop" });

    expect(validateLoopSpec(spec).metadata.id).toBe("test-template-loop");
    expect(spec.policy.allowedActions.some((action) => action.requiresApproval)).toBe(true);
    expect(spec.trace.evidenceRequired).toBe(true);
  });

  it("materializes every prebuilt company loop as a Hermes routing card", () => {
    const templates = getTemplateCatalog();
    expect(validateCompanyLoopLibraryReferences(templates.map((template) => template.id))).toEqual([]);

    for (const definition of PREBUILT_COMPANY_LOOPS) {
      const spec = createSpecFromTemplate(definition.templateId);
      const card = compileRoutingCardFromLoopSpec(spec, { currentReadiness: "ready" });
      expect(card?.problemTypes).toEqual(definition.problemTypes);
      expect(card?.requiredConnections).toEqual(definition.requiredConnections);
      expect(card?.fanoutPolicy).toEqual(definition.fanoutPolicy);
      expect(card?.permittedSupportingLoopIds).toEqual(definition.supportingLoopTemplateIds);
      expect(card?.activationMode).toBe("shadow");
    }
  });

  it("derives a dense catalog graph with loop, department, owner, metric, review, and improvement context", () => {
    const graph = buildGraphFromCatalog();
    const kinds = new Set(graph.nodes.map((node) => node.kind));

    expect(graph.sourceLabel).toBe("Demo catalog");
    expect(graph.nodes.filter((node) => node.kind === "loop").length).toBeGreaterThanOrEqual(40);
    expect(kinds.has("department")).toBe(true);
    expect(kinds.has("data_source")).toBe(true);
    expect(kinds.has("human_owner")).toBe(true);
    expect(kinds.has("metric")).toBe(true);
    expect(kinds.has("improvement")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "measured_by")).toBe(true);
    expect(graph.edges.some((edge) => edge.metadata?.relationship === "supporting_sequence")).toBe(true);
    expect(graph.edges.some((edge) => edge.metadata?.relationship === "shared_learning")).toBe(true);
  });
});
