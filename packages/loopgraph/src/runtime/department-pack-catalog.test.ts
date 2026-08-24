import { describe, expect, it } from "vitest";
import {
  getOfficialDepartmentPack,
  OFFICIAL_DEPARTMENT_PACK_CATALOG,
  searchOfficialDepartmentPacks
} from "./department-pack-catalog";

describe("official Department Pack catalog", () => {
  it("finds a department by business outcome with deterministic ranking", () => {
    const results = searchOfficialDepartmentPacks({ query: "renewal risk" });
    expect(results[0]?.pack.id).toBe("loopgraph.department.customer-success");
    expect(results[0]?.matchedTerms).toEqual(["renewal", "risk"]);
  });

  it("returns a complete nine-department default catalog", () => {
    expect(OFFICIAL_DEPARTMENT_PACK_CATALOG.packs).toHaveLength(9);
    expect(getOfficialDepartmentPack("loopgraph.department.engineering")?.apps.map((app) => app.appId)).toEqual([
      "loopgraph.engineering.triage-github-issues",
      "loopgraph.engineering.run-issue-incident-operations"
    ]);
  });
});
