import { describe, expect, it } from "vitest";
import { buildGraphFromCatalog } from "./graph";
import { createSpecFromTemplate } from "./template-spec";
import { getDepartmentTemplates, getTemplateCatalog } from "./templates";
import { validateLoopSpec } from "../loopgraph-core/loop-spec";

describe("Loopgraph template catalog", () => {
  it("defines a broad department catalog with maturity labels", () => {
    const departments = getDepartmentTemplates();
    const templates = getTemplateCatalog();

    expect(departments.map((department) => department.key)).toEqual([
      "marketing",
      "product",
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
      expect(template.primaryMetric).toBeTruthy();
      expect(template.defaultOwners?.length).toBeGreaterThan(0);
      expect(template.defaultMetrics?.length).toBeGreaterThan(0);
      expect(template.connections?.length).toBeGreaterThan(0);
    }
  });

  it("generates valid v1alpha1 starter specs for spec-stub templates", () => {
    const specStub = getTemplateCatalog().find((template) => template.runtimeLevel === "spec_stub");
    expect(specStub).toBeTruthy();

    const spec = createSpecFromTemplate(specStub!.id, { id: "test-template-loop" });

    expect(validateLoopSpec(spec).metadata.id).toBe("test-template-loop");
    expect(spec.policy.allowedActions.some((action) => action.requiresApproval)).toBe(true);
    expect(spec.trace.evidenceRequired).toBe(true);
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
  });
});
