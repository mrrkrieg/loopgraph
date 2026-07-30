import { open, readFile, readdir, rename, stat, unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  loopControllerCheckpointSchema,
  loopControllerPolicySchema,
  loopControllerRunSchema,
  type LoopControllerCheckpoint,
  type LoopControllerPolicy,
  type LoopControllerRun
} from "../core";

export type ControllerRunSaveResult = {
  run: LoopControllerRun;
  duplicate: boolean;
};

export interface LoopControllerStore {
  saveRun(run: LoopControllerRun): Promise<ControllerRunSaveResult>;
  getRun(runId: string): Promise<LoopControllerRun | undefined>;
  findRunByIdempotencyKey(idempotencyKey: string): Promise<LoopControllerRun | undefined>;
  listRuns(): Promise<LoopControllerRun[]>;
  readCheckpoint(): Promise<LoopControllerCheckpoint | undefined>;
  saveCheckpoint(checkpoint: LoopControllerCheckpoint): Promise<void>;
  readPolicy(): Promise<LoopControllerPolicy | undefined>;
  savePolicy(policy: LoopControllerPolicy): Promise<void>;
  withControllerLock<T>(operation: () => Promise<T>): Promise<T>;
}

export class FileLoopControllerStore implements LoopControllerStore {
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

  async withControllerLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureDirs();
    const lockPath = path.join(this.controllerRoot(), ".controller.lock");
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
    await mkdir(this.runsRoot(), { recursive: true, mode: 0o700 });
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
