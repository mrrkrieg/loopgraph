import { randomUUID } from "node:crypto";
import { open, readFile, readdir, rename, stat, unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  loopControllerCheckpointSchema,
  loopControllerPolicySchema,
  loopControllerRunSchema,
  loopControllerTriggerRecordSchema,
  type LoopControllerCheckpoint,
  type LoopControllerPolicy,
  type LoopControllerRun,
  type LoopControllerTriggerRecord
} from "../core";

export type ControllerRunSaveResult = {
  run: LoopControllerRun;
  duplicate: boolean;
};

export type ClaimControllerTriggersInput = {
  limit: number;
  maxAttempts: number;
  leaseSeconds: number;
  now: Date;
};

export interface LoopControllerStore {
  readonly persistence: "file" | "distributed";
  saveRun(run: LoopControllerRun): Promise<ControllerRunSaveResult>;
  getRun(runId: string): Promise<LoopControllerRun | undefined>;
  findRunByIdempotencyKey(idempotencyKey: string): Promise<LoopControllerRun | undefined>;
  listRuns(): Promise<LoopControllerRun[]>;
  readCheckpoint(): Promise<LoopControllerCheckpoint | undefined>;
  saveCheckpoint(checkpoint: LoopControllerCheckpoint): Promise<void>;
  readPolicy(): Promise<LoopControllerPolicy | undefined>;
  savePolicy(policy: LoopControllerPolicy): Promise<void>;
  saveTrigger(record: LoopControllerTriggerRecord): Promise<void>;
  enqueueTrigger(record: LoopControllerTriggerRecord): Promise<{
    record: LoopControllerTriggerRecord;
    duplicate: boolean;
  }>;
  claimTriggers(
    input: ClaimControllerTriggersInput
  ): Promise<LoopControllerTriggerRecord[]>;
  settleTrigger(
    record: LoopControllerTriggerRecord,
    expectedLeaseId: string
  ): Promise<void>;
  getTrigger(triggerRecordId: string): Promise<LoopControllerTriggerRecord | undefined>;
  listTriggers(status?: LoopControllerTriggerRecord["status"]): Promise<LoopControllerTriggerRecord[]>;
  withControllerLock<T>(operation: () => Promise<T>): Promise<T>;
  withTriggerLock<T>(operation: () => Promise<T>): Promise<T>;
}

export class FileLoopControllerStore implements LoopControllerStore {
  readonly persistence = "file" as const;

  constructor(private readonly loopgraphRoot = path.join(process.cwd(), ".loopgraph")) {}

  async saveRun(run: LoopControllerRun): Promise<ControllerRunSaveResult> {
    const parsed = loopControllerRunSchema.parse(run);
    await this.ensureDirs();
    const existing = await this.getRun(parsed.id);
    if (existing) {
      if (existing.idempotencyKey !== parsed.idempotencyKey) {
        throw new Error(`Controller run identity conflict: ${parsed.id}`);
      }
      if (isTerminal(existing.status) && existing.status !== parsed.status) {
        throw new Error(`Terminal controller run cannot transition from ${existing.status} to ${parsed.status}`);
      }
    }
    await writeJsonAtomic(this.runPath(parsed.id), parsed);
    return { run: parsed, duplicate: Boolean(existing && isTerminal(existing.status)) };
  }

  async getRun(runId: string): Promise<LoopControllerRun | undefined> {
    return readJson(this.runPath(runId), loopControllerRunSchema);
  }

  async findRunByIdempotencyKey(idempotencyKey: string): Promise<LoopControllerRun | undefined> {
    return (await this.listRuns()).find((run) => run.idempotencyKey === idempotencyKey);
  }

  async listRuns(): Promise<LoopControllerRun[]> {
    try {
      const files = (await readdir(this.runsRoot())).filter((file) => file.endsWith(".json")).sort();
      const runs = await Promise.all(files.map((file) =>
        readJson(path.join(this.runsRoot(), file), loopControllerRunSchema)
      ));
      return runs
        .filter((run): run is LoopControllerRun => Boolean(run))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id));
    } catch {
      return [];
    }
  }

  async readCheckpoint(): Promise<LoopControllerCheckpoint | undefined> {
    return readJson(this.checkpointPath(), loopControllerCheckpointSchema);
  }

  async saveCheckpoint(checkpoint: LoopControllerCheckpoint): Promise<void> {
    await this.ensureDirs();
    await writeJsonAtomic(this.checkpointPath(), loopControllerCheckpointSchema.parse(checkpoint));
  }

  async readPolicy(): Promise<LoopControllerPolicy | undefined> {
    return readJson(this.policyPath(), loopControllerPolicySchema);
  }

  async savePolicy(policy: LoopControllerPolicy): Promise<void> {
    await this.ensureDirs();
    await writeJsonAtomic(this.policyPath(), loopControllerPolicySchema.parse(policy));
  }

  async saveTrigger(record: LoopControllerTriggerRecord): Promise<void> {
    await this.ensureDirs();
    await writeJsonAtomic(
      this.triggerPath(record.id),
      loopControllerTriggerRecordSchema.parse(record)
    );
  }

  async enqueueTrigger(record: LoopControllerTriggerRecord): Promise<{
    record: LoopControllerTriggerRecord;
    duplicate: boolean;
  }> {
    const parsed = loopControllerTriggerRecordSchema.parse(record);
    return this.withTriggerLock(async () => {
      const existing = await this.getTrigger(parsed.id);
      if (existing) {
        if (
          existing.projectRootId !== parsed.projectRootId ||
          existing.trigger.type !== parsed.trigger.type ||
          existing.trigger.id !== parsed.trigger.id
        ) {
          throw new Error(`Controller trigger identity conflict: ${parsed.id}`);
        }
        return { record: existing, duplicate: true };
      }
      await this.saveTrigger(parsed);
      return { record: parsed, duplicate: false };
    });
  }

  async claimTriggers(
    input: ClaimControllerTriggersInput
  ): Promise<LoopControllerTriggerRecord[]> {
    return this.withTriggerLock(async () => {
      const eligible = (await this.listTriggers())
        .filter(
          (record) =>
            record.attempts < input.maxAttempts &&
            (record.status === "pending" ||
              record.status === "failed" ||
              (record.status === "processing" &&
                Date.parse(
                  record.leaseExpiresAt ?? record.updatedAt
                ) <= input.now.getTime()))
        )
        .slice(0, input.limit);
      const claimed: LoopControllerTriggerRecord[] = [];
      for (const record of eligible) {
        const leaseId = randomUUID();
        const updated = loopControllerTriggerRecordSchema.parse({
          ...record,
          status: "processing",
          attempts: record.attempts + 1,
          leaseId,
          leaseExpiresAt: new Date(
            input.now.getTime() + input.leaseSeconds * 1000
          ).toISOString(),
          error: undefined,
          updatedAt: input.now.toISOString()
        });
        await this.saveTrigger(updated);
        claimed.push(updated);
      }
      return claimed;
    });
  }

  async settleTrigger(
    record: LoopControllerTriggerRecord,
    expectedLeaseId: string
  ): Promise<void> {
    const parsed = loopControllerTriggerRecordSchema.parse(record);
    await this.withTriggerLock(async () => {
      const current = await this.getTrigger(parsed.id);
      if (
        !current ||
        current.status !== "processing" ||
        current.leaseId !== expectedLeaseId
      ) {
        throw new Error(`Controller trigger lease is no longer owned: ${parsed.id}`);
      }
      await this.saveTrigger({
        ...parsed,
        leaseId: undefined,
        leaseExpiresAt: undefined
      });
    });
  }

  async getTrigger(triggerRecordId: string): Promise<LoopControllerTriggerRecord | undefined> {
    return readJson(this.triggerPath(triggerRecordId), loopControllerTriggerRecordSchema);
  }

  async listTriggers(status?: LoopControllerTriggerRecord["status"]): Promise<LoopControllerTriggerRecord[]> {
    try {
      const files = (await readdir(this.triggersRoot())).filter((file) => file.endsWith(".json")).sort();
      const records = await Promise.all(files.map((file) =>
        readJson(path.join(this.triggersRoot(), file), loopControllerTriggerRecordSchema)
      ));
      return records
        .filter((record): record is LoopControllerTriggerRecord => Boolean(record))
        .filter((record) => !status || record.status === status)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    } catch {
      return [];
    }
  }

  async withControllerLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.withLock(".controller.lock", operation);
  }

  async withTriggerLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.withLock(".triggers.lock", operation);
  }

  private async withLock<T>(lockFileName: string, operation: () => Promise<T>): Promise<T> {
    await this.ensureDirs();
    const lockPath = path.join(this.controllerRoot(), lockFileName);
    const startedAt = Date.now();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    while (!handle) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        if (await isStaleLock(lockPath, 60_000)) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() - startedAt >= 5_000) {
          throw new Error("Timed out waiting for the loop-controller lock");
        }
        await wait(10);
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private async ensureDirs() {
    await Promise.all([
      mkdir(this.runsRoot(), { recursive: true, mode: 0o700 }),
      mkdir(this.triggersRoot(), { recursive: true, mode: 0o700 })
    ]);
  }

  private controllerRoot() {
    return path.join(this.loopgraphRoot, "controller");
  }

  private runsRoot() {
    return path.join(this.controllerRoot(), "runs");
  }

  private runPath(runId: string) {
    return path.join(this.runsRoot(), `${safeFileName(runId)}.json`);
  }

  private triggersRoot() {
    return path.join(this.controllerRoot(), "triggers");
  }

  private triggerPath(triggerRecordId: string) {
    return path.join(this.triggersRoot(), `${safeFileName(triggerRecordId)}.json`);
  }

  private checkpointPath() {
    return path.join(this.controllerRoot(), "checkpoint.json");
  }

  private policyPath() {
    return path.join(this.controllerRoot(), "policy.json");
  }
}

function isTerminal(status: LoopControllerRun["status"]) {
  return ["completed", "failed", "disabled"].includes(status);
}

function safeFileName(value: string) {
  return encodeURIComponent(value);
}

async function readJson<T>(
  filePath: string,
  schema: { parse(value: unknown): T }
): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs > staleAfterMs;
  } catch {
    return false;
  }
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
