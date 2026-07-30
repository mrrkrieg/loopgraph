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
  hermesDesignTaskSchema,
  type HermesDesignCallback,
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

export interface HermesDesignStore {
  createTaskAtomically(task: HermesDesignTask): Promise<HermesDesignTaskCreateResult>;
  getTask(taskId: string): Promise<HermesDesignTask | undefined>;
  listTasks(filters?: HermesDesignTaskFilters): Promise<HermesDesignTask[]>;
  updateTaskAtomically(input: HermesDesignTaskUpdateInput): Promise<HermesDesignTask>;
  applyCallbackAtomically(
    input: HermesDesignCallbackApplyInput
  ): Promise<HermesDesignCallbackApplyResult>;
}

export class FileHermesDesignStore implements HermesDesignStore {
  constructor(private readonly rootDir = getLoopgraphRoot()) {}

  async createTaskAtomically(
    task: HermesDesignTask
  ): Promise<HermesDesignTaskCreateResult> {
    const parsed = hermesDesignTaskSchema.parse(task);
    return this.withLock(async () => {
      const existing = (await this.listTasks())
        .find((candidate) =>
          candidate.idempotencyKey === parsed.idempotencyKey &&
          !["failed", "cancelled"].includes(candidate.status)
        );
      if (existing) return { task: existing, created: false };
      await this.writeTask(parsed);
      return { task: parsed, created: true };
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

  private async writeTask(task: HermesDesignTask): Promise<void> {
    await writeJson(this.taskPath(task.id), task);
  }

  private async writeCallback(callback: HermesDesignCallback): Promise<void> {
    await writeJson(
      path.join(this.callbacksRoot(), `${safeFileName(callback.callbackId)}.json`),
      callback
    );
  }

  private tasksRoot(): string {
    return path.join(this.rootDir, "hermes", "design-tasks");
  }

  private callbacksRoot(): string {
    return path.join(this.rootDir, "hermes", "design-callbacks");
  }

  private taskPath(taskId: string): string {
    return path.join(this.tasksRoot(), `${safeFileName(taskId)}.json`);
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
