import type { ImprovementItem } from "../loop-engineering-builder/types";
import type { LoopRunTrace } from "../loopgraph-core/trace";
import type { StorageAdapter } from "../loopgraph-sdk/adapters";
import { listTraceFiles } from "../loopgraph-sdk/storage";
import { loopIdsMatch } from "./run-filters";

type ImprovementSignalContent = {
  loopId: string;
  sourceRunId: string;
  title: string;
  description: string;
  failureMode: string;
  teacherFeedback?: string;
};

function mapSignalToItem(trace: LoopRunTrace, outputId: string, content: ImprovementSignalContent): ImprovementItem {
  return {
    id: outputId,
    loopId: content.loopId,
    title: content.title,
    description: content.description,
    failureMode: content.failureMode,
    recommendation: content.teacherFeedback ?? content.description,
    status: "open",
    owner: "Loop owner",
    createdAt: trace.completedAt ?? trace.startedAt,
    sourceRunId: content.sourceRunId
  };
}

function isImprovementSignalContent(value: unknown): value is ImprovementSignalContent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.loopId === "string" &&
    typeof record.sourceRunId === "string" &&
    typeof record.title === "string" &&
    typeof record.description === "string" &&
    typeof record.failureMode === "string"
  );
}

export async function loadImprovementsFromStorage(
  storage: StorageAdapter,
  loopId?: string
): Promise<ImprovementItem[]> {
  const runs = await storage.listRuns();
  const runIds = runs.length > 0 ? runs.map((run) => run.id) : await listTraceFiles();

  const items: ImprovementItem[] = [];

  for (const runId of runIds) {
    const trace = await storage.getRun(runId);
    if (!trace) {
      continue;
    }

    if (loopId && !loopIdsMatch(trace.loopId, loopId)) {
      continue;
    }

    for (const output of trace.outputs) {
      if (output.type !== "improvement_signal" || !isImprovementSignalContent(output.content)) {
        continue;
      }

      items.push(mapSignalToItem(trace, output.id, output.content));
    }
  }

  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
