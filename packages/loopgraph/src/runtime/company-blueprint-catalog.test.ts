import { describe, expect, it } from "vitest";
import {
  getOfficialCompanyBlueprint,
  OFFICIAL_COMPANY_BLUEPRINT_CATALOG,
  searchOfficialCompanyBlueprints
} from "./company-blueprint-catalog";

describe("official Company Blueprint catalog", () => {
  it("finds the SaaS operating system from cross-department outcomes", () => {
    const results = searchOfficialCompanyBlueprints({ query: "recurring revenue customer" });
    expect(results[0]?.blueprint.id).toBe("loopgraph.company.saas-operating-system");
    expect(results[0]?.matchedTerms).toEqual(["recurring", "revenue", "customer"]);
  });

  it("publishes one versioned official company topology", () => {
    expect(OFFICIAL_COMPANY_BLUEPRINT_CATALOG.blueprints).toHaveLength(1);
    expect(getOfficialCompanyBlueprint("loopgraph.company.saas-operating-system")?.defaultPackId).toBe("loopgraph.department.product");
  });
});
