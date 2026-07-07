import { getTemplateById } from "../loop-engineering-builder/templates";
import type { LoopRecord } from "../loop-engineering-builder/types";
import { loopIdsMatch, type RunIndex } from "@/lib/loopgraph-runtime/run-filters";

export type TopologyCaseIndex = {
  id: string;
  sourceLoopId: string;
  severity: string;
  status: string;
};

export type TopologyRuntimeSummary = {
  runsByLoopId: Record<string, RunIndex>;
  openCasesByLoopId: Record<string, TopologyCaseIndex[]>;
  openCaseCount: number;
  waitingReviewCount: number;
  failedRunCount: number;
  attentionLoopIds: string[];
};

function failedRunStatuses(status: string) {
  return ["FAILED", "BLOCKED", "POLICY_BLOCKED", "VERIFICATION_FAILED"].includes(status);
}

function findWorkspaceLoopId(externalLoopId: string, loops: LoopRecord[]): string | undefined {
  return loops.find((loop) => loopIdsMatch(loop.id, externalLoopId))?.id;
}

export function buildTopologyRuntimeSummary(input: {
  loops: LoopRecord[];
  runs: RunIndex[];
  cases: TopologyCaseIndex[];
}): TopologyRuntimeSummary {
  const runsByLoopId: Record<string, RunIndex> = {};
  const openCasesByLoopId: Record<string, TopologyCaseIndex[]> = {};
  const attentionLoopIds = new Set<string>();

  for (const run of input.runs) {
    const workspaceLoopId = findWorkspaceLoopId(run.loopId, input.loops) ?? run.loopId;
    const existing = runsByLoopId[workspaceLoopId];
    if (!existing) {
      runsByLoopId[workspaceLoopId] = run;
    }

    if (run.status === "WAITING_FOR_REVIEW") {
      attentionLoopIds.add(workspaceLoopId);
    }
    if (failedRunStatuses(run.status)) {
      attentionLoopIds.add(workspaceLoopId);
    }
  }

  for (const caseItem of input.cases) {
    if (caseItem.status !== "open") {
      continue;
    }
    const workspaceLoopId =
      findWorkspaceLoopId(caseItem.sourceLoopId, input.loops) ?? caseItem.sourceLoopId;
    openCasesByLoopId[workspaceLoopId] = [...(openCasesByLoopId[workspaceLoopId] ?? []), caseItem];
    attentionLoopIds.add(workspaceLoopId);
  }

  for (const loop of input.loops) {
    if (loop.openReviews > 0 || loop.status === "needs_attention") {
      attentionLoopIds.add(loop.id);
    }
  }

  return {
    runsByLoopId,
    openCasesByLoopId,
    openCaseCount: input.cases.filter((caseItem) => caseItem.status === "open").length,
    waitingReviewCount: input.runs.filter((run) => run.status === "WAITING_FOR_REVIEW").length,
    failedRunCount: input.runs.filter((run) => failedRunStatuses(run.status)).length,
    attentionLoopIds: Array.from(attentionLoopIds)
  };
}

export function getExampleSimulateCommand(
  loop: Pick<LoopRecord, "templateId" | "sourcePath"> | undefined
): string | undefined {
  if (!loop) {
    return undefined;
  }
  const template = getTemplateById(loop.templateId);
  const examplePath = loop.sourcePath ?? template?.examplePath;
  const fixturePath = template?.fixturePaths?.[0];
  if (!examplePath) {
    return undefined;
  }
  if (fixturePath) {
    return `npm run loopgraph -- simulate ${examplePath} --fixture ${fixturePath}`;
  }
  return `npm run loopgraph -- simulate ${examplePath}`;
}

export function runtimeForLoop(
  loopId: string | undefined,
  runtime: TopologyRuntimeSummary
): {
  latestRun?: RunIndex;
  openCases: TopologyCaseIndex[];
} {
  if (!loopId) {
    return { openCases: [] };
  }
  return {
    latestRun: runtime.runsByLoopId[loopId],
    openCases: runtime.openCasesByLoopId[loopId] ?? []
  };
}
