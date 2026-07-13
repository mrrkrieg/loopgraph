import { describe, expect, it } from "vitest";
import { loadDepartmentSkillPacks, validateDepartmentSkillPackReferences } from "./skill-pack-loader";

describe("department skill packs", () => {
  it("loads and validates all department skill YAML files", async () => {
    const packs = await loadDepartmentSkillPacks();
    expect(packs.map((pack) => pack.id).sort()).toEqual([
      "customer-success",
      "engineering",
      "hr-talent",
      "legal-compliance",
      "management",
      "marketing",
      "ops-finance",
      "product",
      "sales"
    ]);
    expect(packs.flatMap(validateDepartmentSkillPackReferences)).toEqual([]);
    expect(packs.every((pack) => pack.loopBlueprints.length > 0)).toBe(true);
    expect(packs.every((pack) => pack.defaultMetrics.length > 0)).toBe(true);
  });
});
