import { describe, expect, it } from "vitest";
import { filterRunsForLoop, loopIdsMatch, resolveLoopIdAliases } from "./run-filters";

describe("run-filters", () => {
  it("filters runs by hero loop id", () => {
    const runs = [
      { id: "run_a", loopId: "github-issue-triage", status: "COMPLETED" },
      { id: "run_b", loopId: "strategic-account-escalation", status: "WAITING_FOR_REVIEW" }
    ];

    expect(filterRunsForLoop(runs, "github-issue-triage").map((run) => run.id)).toEqual(["run_a"]);
    expect(filterRunsForLoop(runs, "strategic-account-escalation").map((run) => run.id)).toEqual(["run_b"]);
  });

  it("resolves catalog and hero loop ids to the same aliases", () => {
    const heroAliases = resolveLoopIdAliases("strategic-account-escalation");
    const catalogAliases = resolveLoopIdAliases("catalog_strategic-account-escalation");

    expect(heroAliases).toContain("catalog_strategic-account-escalation");
    expect(catalogAliases).toContain("strategic-account-escalation");
    expect(loopIdsMatch("catalog_strategic-account-escalation", "strategic-account-escalation")).toBe(true);
  });

  it("maps legacy demo loop ids to hero aliases", () => {
    expect(resolveLoopIdAliases("loop_demo_marketing_campaign")).toContain("github-issue-triage");
    expect(filterRunsForLoop(
      [{ id: "run_a", loopId: "github-issue-triage", status: "COMPLETED" }],
      "loop_demo_marketing_campaign"
    ).map((run) => run.id)).toEqual(["run_a"]);
  });
});
