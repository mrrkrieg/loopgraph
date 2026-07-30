import path from "node:path";
import {
  LOOP_CONTROLLER_TRIGGER_RECORD_SCHEMA_VERSION,
  contentHash,
  loopControllerTriggerRecordSchema,
  loopControllerTriggerSchema,
  type LoopControllerTriggerRecord,
  type LoopControllerTriggerType
} from "../core";
import { FileLoopControllerStore, type LoopControllerStore } from "./loop-controller-store";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace } from "./workspace";

export type EnqueueLoopControllerTriggerInput = {
  projectRoot?: string;
  type: LoopControllerTriggerType;
  triggerId: string;
  sourceRef: string;
  occurredAt?: string;
  requestedBy?: string;
  evidenceRefs?: string[];
};

export async function enqueueLoopControllerTrigger(
  input: EnqueueLoopControllerTriggerInput,
  options: {
    store?: LoopControllerStore;
    now?: Date;
  } = {}
): Promise<{ record: LoopControllerTriggerRecord; duplicate: boolean }> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = options.now ?? new Date();
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const store = options.store ?? new FileLoopControllerStore(getLoopgraphRoot(projectRoot));
  const trigger = loopControllerTriggerSchema.parse({
    type: input.type,
    id: input.triggerId,
    occurredAt: input.occurredAt ?? now.toISOString(),
    sourceRef: input.sourceRef,
    requestedBy: input.requestedBy,
    evidenceRefs: unique(input.evidenceRefs ?? [])
  });
  const recordId = `controller_trigger_${contentHash({
    projectRootId: workspace.projectRootId,
    type: trigger.type,
    id: trigger.id
  })}`;

  return store.withTriggerLock(async () => {
    const existing = await store.getTrigger(recordId);
    if (existing) return { record: existing, duplicate: true };
    const record = loopControllerTriggerRecordSchema.parse({
      schemaVersion: LOOP_CONTROLLER_TRIGGER_RECORD_SCHEMA_VERSION,
      id: recordId,
      projectRootId: workspace.projectRootId,
      trigger,
      status: "pending",
      attempts: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    await store.saveTrigger(record);
    return { record, duplicate: false };
  });
}

export async function enqueueLoopControllerTriggerBestEffort(
  input: EnqueueLoopControllerTriggerInput,
  options: {
    store?: LoopControllerStore;
    now?: Date;
  } = {}
): Promise<{
  enqueued: boolean;
  duplicate: boolean;
  triggerRecordId?: string;
  error?: string;
}> {
  try {
    const result = await enqueueLoopControllerTrigger(input, options);
    return {
      enqueued: true,
      duplicate: result.duplicate,
      triggerRecordId: result.record.id
    };
  } catch (error) {
    return {
      enqueued: false,
      duplicate: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
