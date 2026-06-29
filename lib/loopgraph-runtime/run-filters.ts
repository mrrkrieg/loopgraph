import type { LoopRunTrace } from "../loopgraph-core/trace";

export type RunIndex = { id: string; loopId: string; status: string };

/** Match runs page / API filtering: hero spec loopIds vs Design Studio loop_demo_* ids. */
export function filterRunsForLoop(runs: RunIndex[], pageLoopId: string): RunIndex[] {
  const heroLoopIds: Record<string, string[]> = {
    "github-issue-triage": ["github-issue-triage", "loop_demo_marketing_campaign"],
    "strategic-account-escalation": ["strategic-account-escalation"]
  };

  const aliases = heroLoopIds[pageLoopId] ?? [pageLoopId];
  if (pageLoopId.startsWith("loop_") && !aliases.includes(pageLoopId)) {
    return runs;
  }

  return runs.filter((run) => aliases.includes(run.loopId));
}

export function describeTraceMode(trace: LoopRunTrace): {
  mode: string;
  source: string;
  writes: string;
  variant: "simulate" | "execute" | "other";
} {
  if (trace.mode === "execute") {
    return {
      mode: "execute",
      source: "live integrations",
      writes: "enabled after approval",
      variant: "execute"
    };
  }

  if (trace.mode === "simulate") {
    return {
      mode: "simulate",
      source: "fixture",
      writes: "none (mock_committed only after approval)",
      variant: "simulate"
    };
  }

  return {
    mode: trace.mode,
    source: "unknown",
    writes: "unknown",
    variant: "other"
  };
}
