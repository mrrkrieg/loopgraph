import { describe, expect, it } from "vitest";
import { GENERATED_OFFICIAL_COMPANY_BLUEPRINT_CATALOG } from "../generated/official-company-blueprint-catalog";
import { GENERATED_OFFICIAL_DEPARTMENT_PACK_CATALOG } from "../generated/official-department-pack-catalog";
import {
  companyBlueprintCatalogSchema,
  companyBlueprintSchema
} from "./company-blueprint";

describe("Company Blueprint contracts", () => {
  it("validates the official company topology against all nine Department Packs", () => {
    const catalog = companyBlueprintCatalogSchema.parse(GENERATED_OFFICIAL_COMPANY_BLUEPRINT_CATALOG);
    const blueprint = catalog.blueprints[0]!;
    const departmentPackIds = new Set<string>(GENERATED_OFFICIAL_DEPARTMENT_PACK_CATALOG.packs.map((pack) => pack.id));
    expect(blueprint.packs).toHaveLength(9);
    expect(blueprint.packs.every((pack) => departmentPackIds.has(pack.packId))).toBe(true);
    expect(blueprint.objectContracts.map((contract) => contract.objectType)).toEqual(expect.arrayContaining([
      "company.account",
      "company.campaign",
      "company.product_problem",
      "company.incident",
      "company.contract",
      "company.forecast",
      "company.decision"
    ]));
    expect(blueprint.topology.length).toBeGreaterThanOrEqual(10);
  });

  it("rejects topology edges without a canonical company object contract", () => {
    const blueprint = companyBlueprintCatalogSchema.parse(GENERATED_OFFICIAL_COMPANY_BLUEPRINT_CATALOG).blueprints[0]!;
    const invalid = companyBlueprintSchema.safeParse({
      ...blueprint,
      topology: [{
        ...blueprint.topology[0],
        objectType: "company.unknown_object"
      }]
    });
    expect(invalid.success).toBe(false);
  });
});
