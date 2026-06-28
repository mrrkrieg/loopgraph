import type { LoopSpec } from "../loopgraph-core/loop-spec";
import type { StorageAdapter } from "../loopgraph-sdk/adapters";
import { runLoop, type RunLoopResult } from "./loop-runner";

export type ExecuteResult = RunLoopResult;

export function isExecuteEnabled() {
  return process.env.LOOPGRAPH_EXECUTE_ENABLED === "true";
}

export async function executeLoop(input: {
  spec: LoopSpec;
  triggerPayload: Record<string, unknown>;
  eventId: string;
  startedAt?: string;
  storage: StorageAdapter;
}): Promise<ExecuteResult> {
  if (!isExecuteEnabled()) {
    throw new Error("Execute mode is disabled. Set LOOPGRAPH_EXECUTE_ENABLED=true");
  }

  return runLoop({
    spec: input.spec,
    mode: "execute",
    triggerPayload: input.triggerPayload,
    eventId: input.eventId,
    startedAt: input.startedAt ?? new Date().toISOString(),
    storage: input.storage
  });
}
