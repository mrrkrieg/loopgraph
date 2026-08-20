import { describe, expect, it } from "vitest";
import { GENERATED_OFFICIAL_APP_CATALOG } from "../generated/official-app-catalog";
import { GENERATED_OFFICIAL_DEPARTMENT_PACK_CATALOG } from "../generated/official-department-pack-catalog";
import {
  departmentPackCatalogSchema,
  departmentPackSchema
} from "./department-pack";

describe("Department Pack contracts", () => {
  it("validates the generated catalog and references only official Apps", () => {
    const catalog = departmentPackCatalogSchema.parse(GENERATED_OFFICIAL_DEPARTMENT_PACK_CATALOG);
    const officialAppIds = new Set<string>(GENERATED_OFFICIAL_APP_CATALOG.entries.map((entry) => entry.app.id));
    expect(catalog.packs).toHaveLength(9);
    expect(new Set(catalog.packs.map((pack) => pack.department))).toEqual(new Set([
      "product",
      "sales",
      "marketing",
      "customer_success",
      "engineering",
      "ops_finance",
      "hr_talent",
      "legal_compliance",
      "management"
    ]));
    for (const pack of catalog.packs) {
      expect(pack.apps.every((app) => officialAppIds.has(app.appId))).toBe(true);
    }
  });

  it("rejects topology edges that escape a Department Pack", () => {
    const pack = departmentPackCatalogSchema.parse(GENERATED_OFFICIAL_DEPARTMENT_PACK_CATALOG).packs[1]!;
    const invalid = departmentPackSchema.safeParse({
      ...pack,
      topology: [{
        id: "loopgraph.edge.invalid",
        sourceAppId: pack.defaultAppId,
        targetAppId: "outside.department.app",
        type: "handoff",
        reason: "This edge must be rejected."
      }]
    });
    expect(invalid.success).toBe(false);
  });
});
