import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  hermesDesignCallbackSchema,
  hermesDesignDispatchJobSchema,
  hermesDesignTaskSchema,
  type HermesDesignCallback,
  type HermesDesignDispatchJob,
  type HermesDesignTask
} from "../core";
import { getLoopgraphRoot } from "./storage-resolver";

export type HermesDesignTaskFilters = {
  sessionId?: string;
  status?: HermesDesignTask["status"];
};

export type HermesDesignTaskCreateResult = {
  task: HermesDesignTask;
  created: boolean;
  dispatchJob?: HermesDesignDispatchJob;
};

export type HermesDesignTaskCreateOptions = {
  dispatchJob?: HermesDesignDispatchJob;
};

export type HermesDesignTaskUpdateInput = {
  taskId: string;
  update: (task: HermesDesignTask) => HermesDesignTask;
};

export type HermesDesignCallbackApplyInput = HermesDesignTaskUpdateInput & {
  callback: HermesDesignCallback;
};

export type HermesDesignCallbackApplyResult = {
  task: HermesDesignTask;
  duplicate: boolean;
};

export type HermesDesignDispatchJobFilters = {
  taskId?: string;
  status?: HermesDesignDispatchJob["status"];
};

export type HermesDesignDispatchJobCreateResult = {
  job: HermesDesignDispatchJob;
  created: boolean;
};

export type HermesDesignDispatchJobClaimInput = {
  claimedBy: string;
  now: Date;
  leaseSeconds: number;
  limit: number;
};

export type HermesDesignDispatchJobUpdateInput = {
  jobId: string;
  expectedLeaseToken?: string;
  update: (job: HermesDesignDispatchJob) => HermesDesignDispatchJob;
};

export type HermesDesignTaskDispatchUpdateInput = {
  taskId: string;
  update: (task: HermesDesignTask) => {
    task: HermesDesignTask;
    dispatchJob: HermesDesignDispatchJob;
  };
};

export type HermesDesignTaskDispatchUpdateResult = {
  task: HermesDesignTask;
  dispatchJob: HermesDesignDispatchJob;
  dispatchCreated: boolean;
};

export interface HermesDesignStore {
  createTaskAtomically(
    task: HermesDesignTask,
    options?: HermesDesignTaskCreateOptions
  ): Promise<HermesDesignTaskCreateResult>;
  getTask(taskId: string): Promise<HermesDesignTask | undefined>;
  listTasks(filters?: HermesDesignTaskFilters): Promise<HermesDesignTask[]>;
  updateTaskAtomically(input: HermesDesignTaskUpdateInput): Promise<HermesDesignTask>;
  updateTaskAndEnqueueDispatchAtomically(
    input: HermesDesignTaskDispatchUpdateInput
  ): Promise<HermesDesignTaskDispatchUpdateResult>;
  applyCallbackAtomically(
    input: HermesDesignCallbackApplyInput
  ): Promise<HermesDesignCallbackApplyResult>;
  enqueueDispatchJobAtomically(
    job: HermesDesignDispatchJob
  ): Promise<HermesDesignDispatchJobCreateResult>;
  getDispatchJob(jobId: string): Promise<HermesDesignDispatchJob | undefined>;
  listDispatchJobs(
    filters?: HermesDesignDispatchJobFilters
  ): Promise<HermesDesignDispatchJob[]>;
  claimDueDispatchJobsAtomically(
    input: HermesDesignDispatchJobClaimInput
  ): Promise<HermesDesignDispatchJob[]>;
  updateDispatchJobAtomically(
    input: HermesDesignDispatchJobUpdateInput
  ): Promise<HermesDesignDispatchJob>;
}

export class FileHermesDesignStore implements HermesDesignStore {
  constructor(private readonly rootDir = getLoopgraphRoot()) {}

  async createTaskAtomically(
    task: HermesDesignTask,
    options: HermesDesignTaskCreateOptions = {}
  ): Promise<HermesDesignTaskCreateResult> {
    const parsed = hermesDesignTaskSchema.parse(task);
    const dispatchJob = options.dispatchJob
      ? hermesDesignDispatchJobSchema.parse(options.dispatchJob)
      : undefined;
    if (dispatchJob && dispatchJob.taskId !== parsed.id) {
      throw new Error("Hermes design dispatch job does not belong to the task");
    }
    return this.withLock(async () => {
      const existing = (await this.listTasks())
        .find((candidate) =>
          candidate.idempotencyKey === parsed.idempotencyKey &&
          !["failed", "cancelled"].includes(candidate.status)
        );
      if (existing) {
        const existingJob = dispatchJob && dispatchJob.taskId === existing.id
          ? (await this.enqueueDispatchJobUnlocked(dispatchJob)).job
          : undefined;
        return {
          task: existing,
          created: false,
          ...(existingJob ? { dispatchJob: existingJob } : {})
        };
      }
      if (dispatchJob) {
        await this.writeTaskAndDispatchTransaction(parsed, dispatchJob);
      } else {
        await this.writeTask(parsed);
      }
      return {
        task: parsed,
        created: true,
        ...(dispatchJob ? { dispatchJob } : {})
      };
    });
  }

  async getTask(taskId: string): Promise<HermesDesignTask | undefined> {
    try {
      return hermesDesignTaskSchema.parse(
        JSON.parse(await readFile(this.taskPath(taskId), "utf8"))
      );
    } catch {
      return undefined;
    }
  }

  async listTasks(
    filters: HermesDesignTaskFilters = {}
  ): Promise<HermesDesignTask[]> {
    try {
      const files = await readdir(this.tasksRoot());
      const tasks = await Promise.all(files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          try {
            return hermesDesignTaskSchema.parse(
              JSON.parse(await readFile(path.join(this.tasksRoot(), file), "utf8"))
            );
          } catch {
            return undefined;
          }
        }));
      return tasks
        .filter((task): task is HermesDesignTask => Boolean(task))
        .filter((task) => !filters.sessionId || task.sessionId === filters.sessionId)
        .filter((task) => !filters.status || task.status === filters.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch {
      return [];
    }
  }

  async updateTaskAtomically(
    input: HermesDesignTaskUpdateInput
  ): Promise<HermesDesignTask> {
    return this.withLock(async () => {
      const current = await this.getTask(input.taskId);
      if (!current) throw new Error(`Hermes design task not found: ${input.taskId}`);
      const updated = hermesDesignTaskSchema.parse(input.update(current));
      if (updated.id !== current.id || updated.idempotencyKey !== current.idempotencyKey) {
        throw new Error("Hermes design task identity cannot change");
      }
      await this.writeTask(updated);
      return updated;
    });
  }

  async updateTaskAndEnqueueDispatchAtomically(
    input: HermesDesignTaskDispatchUpdateInput
  ): Promise<HermesDesignTaskDispatchUpdateResult> {
    return this.withLock(async () => {
      const current = await this.getTask(input.taskId);
      if (!current) throw new Error(`Hermes design task not found: ${input.taskId}`);
      const result = input.update(current);
      const updated = hermesDesignTaskSchema.parse(result.task);
      const dispatchJob = hermesDesignDispatchJobSchema.parse(result.dispatchJob);
      if (
        updated.id !== current.id ||
        updated.idempotencyKey !== current.idempotencyKey
      ) {
        throw new Error("Hermes design task identity cannot change");
      }
      if (dispatchJob.taskId !== updated.id) {
        throw new Error("Hermes design dispatch job does not belong to the task");
      }
      const existing = (await this.listDispatchJobs())
        .find((candidate) => candidate.idempotencyKey === dispatchJob.idempotencyKey);
      if (existing) {
        await this.writeTask(updated);
        return {
          task: updated,
          dispatchJob: existing,
          dispatchCreated: false
        };
      }
      await this.writeTaskAndDispatchTransaction(updated, dispatchJob);
      return {
        task: updated,
        dispatchJob,
        dispatchCreated: true
      };
    });
  }

  async applyCallbackAtomically(
    input: HermesDesignCallbackApplyInput
  ): Promise<HermesDesignCallbackApplyResult> {
    const callback = hermesDesignCallbackSchema.parse(input.callback);
    return this.withLock(async () => {
      const current = await this.getTask(input.taskId);
      if (!current) throw new Error(`Hermes design task not found: ${input.taskId}`);
      if (current.callbackIds.includes(callback.callbackId)) {
        await this.writeCallback(callback);
        return { task: current, duplicate: true };
      }
      const updated = hermesDesignTaskSchema.parse(input.update(current));
      if (
        updated.id !== current.id ||
        updated.idempotencyKey !== current.idempotencyKey ||
        !updated.callbackIds.includes(callback.callbackId)
      ) {
        throw new Error("Hermes callback update violated the task identity contract");
      }
      // The task carries the durable callback identity. If the process stops
      // between these writes, a retry repairs the callback audit file without
      // applying the callback twice.
      await this.writeTask(updated);
      await this.writeCallback(callback);
      return { task: updated, duplicate: false };
    });
  }

  async enqueueDispatchJobAtomically(
    job: HermesDesignDispatchJob
  ): Promise<HermesDesignDispatchJobCreateResult> {
    const parsed = hermesDesignDispatchJobSchema.parse(job);
    return this.withLock(() => this.enqueueDispatchJobUnlocked(parsed));
  }

  async getDispatchJob(
    jobId: string
  ): Promise<HermesDesignDispatchJob | undefined> {
    try {
      return hermesDesignDispatchJobSchema.parse(
        JSON.parse(await readFile(this.dispatchJobPath(jobId), "utf8"))
      );
    } catch {
      return undefined;
    }
  }

  async listDispatchJobs(
    filters: HermesDesignDispatchJobFilters = {}
  ): Promise<HermesDesignDispatchJob[]> {
    try {
      const files = await readdir(this.dispatchJobsRoot());
      const jobs = await Promise.all(files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          try {
            return hermesDesignDispatchJobSchema.parse(
              JSON.parse(
                await readFile(path.join(this.dispatchJobsRoot(), file), "utf8")
              )
            );
          } catch {
            return undefined;
          }
        }));
      return jobs
        .filter((job): job is HermesDesignDispatchJob => Boolean(job))
        .filter((job) => !filters.taskId || job.taskId === filters.taskId)
        .filter((job) => !filters.status || job.status === filters.status)
        .sort((left, right) =>
          left.nextRunAt.localeCompare(right.nextRunAt) ||
          left.createdAt.localeCompare(right.createdAt)
        );
    } catch {
      return [];
    }
  }

  async claimDueDispatchJobsAtomically(
    input: HermesDesignDispatchJobClaimInput
  ): Promise<HermesDesignDispatchJob[]> {
    return this.withLock(async () => {
      const jobs = await this.listDispatchJobs();
      const nowIso = input.now.toISOString();
      for (const job of jobs) {
        if (
          job.status === "claimed" &&
          job.lease &&
          Date.parse(job.lease.expiresAt) <= input.now.getTime() &&
          job.attemptCount >= job.maxAttempts
        ) {
          await this.writeDispatchJob(hermesDesignDispatchJobSchema.parse({
            ...job,
            status: "dead_letter",
            lease: undefined,
            deadLetterReason:
              "Dispatch worker lease expired after the maximum attempt count.",
            updatedAt: nowIso
          }));
        }
      }
      const refreshed = await this.listDispatchJobs();
      const eligible = refreshed
        .filter((job) =>
          job.attemptCount < job.maxAttempts &&
          (
            (["queued", "failed"].includes(job.status) &&
              Date.parse(job.nextRunAt) <= input.now.getTime()) ||
            (
              job.status === "claimed" &&
              job.lease &&
              Date.parse(job.lease.expiresAt) <= input.now.getTime()
            )
          )
        )
        .slice(0, input.limit);
      const claimed: HermesDesignDispatchJob[] = [];
      for (const job of eligible) {
        const updated = hermesDesignDispatchJobSchema.parse({
          ...job,
          status: "claimed",
          attemptCount: job.attemptCount + 1,
          lease: {
            claimedBy: input.claimedBy,
            leaseToken: randomUUID(),
            claimedAt: nowIso,
            expiresAt: new Date(
              input.now.getTime() + input.leaseSeconds * 1000
            ).toISOString()
          },
          updatedAt: nowIso
        });
        await this.writeDispatchJob(updated);
        claimed.push(updated);
      }
      return claimed;
    });
  }

  async updateDispatchJobAtomically(
    input: HermesDesignDispatchJobUpdateInput
  ): Promise<HermesDesignDispatchJob> {
    return this.withLock(async () => {
      const current = await this.getDispatchJob(input.jobId);
      if (!current) {
        throw new Error(`Hermes design dispatch job not found: ${input.jobId}`);
      }
      if (
        input.expectedLeaseToken &&
        current.lease?.leaseToken !== input.expectedLeaseToken
      ) {
        throw new Error(`Hermes design dispatch job lease lost: ${input.jobId}`);
      }
      const updated = hermesDesignDispatchJobSchema.parse(input.update(current));
      if (
        updated.id !== current.id ||
        updated.idempotencyKey !== current.idempotencyKey ||
        updated.taskId !== current.taskId
      ) {
        throw new Error("Hermes design dispatch job identity cannot change");
      }
      await this.writeDispatchJob(updated);
      return updated;
    });
  }

  private async enqueueDispatchJobUnlocked(
    job: HermesDesignDispatchJob
  ): Promise<HermesDesignDispatchJobCreateResult> {
    const task = await this.getTask(job.taskId);
    if (!task) throw new Error(`Hermes design task not found: ${job.taskId}`);
    const existing = (await this.listDispatchJobs())
      .find((candidate) => candidate.idempotencyKey === job.idempotencyKey);
    if (existing) return { job: existing, created: false };
    await this.writeDispatchJob(job);
    return { job, created: true };
  }

  private async writeTask(task: HermesDesignTask): Promise<void> {
    await writeJson(this.taskPath(task.id), task);
  }

  private async writeCallback(callback: HermesDesignCallback): Promise<void> {
    await writeJson(
      path.join(this.callbacksRoot(), `${safeFileName(callback.callbackId)}.json`),
      callback
    );
  }

  private async writeDispatchJob(job: HermesDesignDispatchJob): Promise<void> {
    await writeJson(this.dispatchJobPath(job.id), job);
  }

  private async writeTaskAndDispatchTransaction(
    task: HermesDesignTask,
    dispatchJob: HermesDesignDispatchJob
  ): Promise<void> {
    const transactionPath = path.join(
      this.transactionsRoot(),
      `${safeFileName(dispatchJob.idempotencyKey)}.json`
    );
    await writeJson(transactionPath, { task, dispatchJob });
    await this.writeTask(task);
    await this.writeDispatchJob(dispatchJob);
    await unlink(transactionPath).catch(() => undefined);
  }

  private async recoverPendingTransactions(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.transactionsRoot());
    } catch {
      return;
    }
    for (const file of files.filter((item) => item.endsWith(".json"))) {
      const transactionPath = path.join(this.transactionsRoot(), file);
      try {
        const value = JSON.parse(await readFile(transactionPath, "utf8")) as {
          task?: unknown;
          dispatchJob?: unknown;
        };
        const task = hermesDesignTaskSchema.parse(value.task);
        const dispatchJob = hermesDesignDispatchJobSchema.parse(value.dispatchJob);
        if (dispatchJob.taskId !== task.id) {
          throw new Error("Pending Hermes dispatch transaction identity mismatch");
        }
        await this.writeTask(task);
        await this.writeDispatchJob(dispatchJob);
        await unlink(transactionPath);
      } catch {
        // Leave malformed or temporarily unreadable transactions in place for
        // operator inspection instead of deleting recovery evidence.
      }
    }
  }

  private tasksRoot(): string {
    return path.join(this.rootDir, "hermes", "design-tasks");
  }

  private callbacksRoot(): string {
    return path.join(this.rootDir, "hermes", "design-callbacks");
  }

  private dispatchJobsRoot(): string {
    return path.join(this.rootDir, "hermes", "design-dispatch-jobs");
  }

  private transactionsRoot(): string {
    return path.join(this.rootDir, "hermes", "design-transactions");
  }

  private taskPath(taskId: string): string {
    return path.join(this.tasksRoot(), `${safeFileName(taskId)}.json`);
  }

  private dispatchJobPath(jobId: string): string {
    return path.join(this.dispatchJobsRoot(), `${safeFileName(jobId)}.json`);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.tasksRoot(), { recursive: true });
    const lockPath = path.join(this.tasksRoot(), ".store.lock");
    const startedAt = Date.now();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    while (!handle) {
      try {
        handle = await open(lockPath, "wx");
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString()
        }));
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        if (await isStaleLock(lockPath, 30_000)) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() - startedAt >= 5_000) {
          throw new Error("Timed out waiting for the Hermes design store lock");
        }
        await wait(10);
      }
    }
    try {
      await this.recoverPendingTransactions();
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function safeFileName(id: string): string {
  return encodeURIComponent(id);
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs > staleAfterMs;
  } catch {
    return false;
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
