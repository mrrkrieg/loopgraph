import { describe, expect, it } from "vitest";
import { filterRunsForLoop } from "./run-filters";

describe("run-filters", () => {
  it("filters runs by hero loop id", () => {
    const runs = [
      { id: "run_a", loopId: "github-issue-triage", status: "COMPLETED" },
      { id: "run_b", loopId: "strategic-account-escalation", status: "WAITING_FOR_REVIEW" }
    ];

    expect(filterRunsForLoop(runs, "github-issue-triage").map((run) => run.id)).toEqual(["run_a"]);
    expect(filterRunsForLoop(runs, "strategic-account-escalation").map((run) => run.id)).toEqual(["run_b"]);
  });
});
