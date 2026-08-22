import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  APP_OPERATION_ACTION_SCHEMA_VERSION,
  appOperationActionSchema,
  type AppOperationAction
} from "../core";
import { assertSecretFree } from "./secret-redaction";

export const APP_OPERATION_ACTION_LEDGER_SCHEMA_VERSION = "loopgraph-app-operation-action-ledger/v1alpha1" as const;
export const MAX_LOCAL_APP_OPERATION_ACTIONS = 10_000;

export const appOperationActionLedgerSchema = z.object({
  schemaVersion: z.literal(APP_OPERATION_ACTION_LEDGER_SCHEMA_VERSION),
  workspaceId: z.string().min(1).max(160),
  revision: z.number().int().nonnegative(),
  actions: z.array(appOperationActionSchema).max(MAX_LOCAL_APP_OPERATION_ACTIONS),
  updatedAt: z.string().datetime()
}).strict();

export type AppOperationActionLedger = z.infer<typeof appOperationActionLedgerSchema>;

export type AppOperationActionQuery = {
  workspaceId: string;
  installationId?: string;
  loopId?: string;
  routeJobId?: string;
  status?: AppOperationAction["status"];
  limit?: number;
};

/**
 * Secret-free ownership ledger for provider actions prepared by installed Apps.
 * Canonical provider input remains exclusively in Connector Broker storage.
 */
export interface AppOperationActionStore {
  readonly persistence: "file" | "distributed";
  recordPrepared(action: AppOperationAction): Promise<AppOperationAction>;
  get(workspaceId: string, actionId: string): Promise<AppOperationAction | undefined>;
  list(query: AppOperationActionQuery): Promise<AppOperationAction[]>;
}

export function emptyAppOperationActionLedger(workspaceId: string): AppOperationActionLedger {
  return {
    schemaVersion: APP_OPERATION_ACTION_LEDGER_SCHEMA_VERSION,
    workspaceId,
    revision: 0,
    actions: [],
    updatedAt: new Date(0).toISOString()
  };
}

export class FileAppOperationActionStore implements AppOperationActionStore {
  readonly persistence = "file" as const;
  private readonly ledgerPath: string;
  private readonly mutexPath: string;

  constructor(private readonly appsRoot: string, private readonly workspaceId: string) {
    this.ledgerPath = path.join(appsRoot, "operation-actions.json");
    this.mutexPath = path.join(appsRoot, ".operation-actions.lock");
  }

  async recordPrepared(input: AppOperationAction): Promise<AppOperationAction> {
    const action = appOperationActionSchema.parse(input);
    assertPreparedActionBoundary(action, this.workspaceId);
    await mkdir(this.appsRoot, { recursive: true, mode: 0o700 });
    const handle = await acquireLock(this.mutexPath);
    try {
      const ledger = await this.readLedger();
      const existing = ledger.actions.find((candidate) => candidate.id === action.id);
      if (existing) {
        if (existing.recordDigest !== action.recordDigest) {
          throw new Error(`Prepared App action identity conflict: ${action.id}`);
        }
        return existing;
      }
      if (ledger.actions.length >= MAX_LOCAL_APP_OPERATION_ACTIONS) {
        throw new Error("Local App operation action ledger is full; archive it before preparing more provider actions");
      }
      const next = appOperationActionLedgerSchema.parse({
        ...ledger,
        revision: ledger.revision + 1,
        actions: [...ledger.actions, action],
        updatedAt: action.updatedAt
      });
      await atomicWriteJson(this.ledgerPath, next);
      return action;
    } finally {
      await handle.close();
      await rm(this.mutexPath, { force: true });
    }
  }

  async get(workspaceId: string, actionId: string): Promise<AppOperationAction | undefined> {
    if (workspaceId !== this.workspaceId) return undefined;
    return (await this.readLedger()).actions.find((action) => action.id === actionId);
  }

  async list(query: AppOperationActionQuery): Promise<AppOperationAction[]> {
    if (query.workspaceId !== this.workspaceId) return [];
    const limit = boundedLimit(query.limit);
    return (await this.readLedger()).actions
      .filter((action) => !query.installationId || action.installationId === query.installationId)
      .filter((action) => !query.loopId || action.loopId === query.loopId)
      .filter((action) => !query.routeJobId || action.routeJobId === query.routeJobId)
      .filter((action) => !query.status || action.status === query.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  private async readLedger(): Promise<AppOperationActionLedger> {
    try {
      const ledger = appOperationActionLedgerSchema.parse(JSON.parse(await readFile(this.ledgerPath, "utf8")));
      if (ledger.workspaceId !== this.workspaceId) throw new Error("App operation action ledger belongs to another workspace");
      return ledger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAppOperationActionLedger(this.workspaceId);
      throw error;
    }
  }
}

export function assertPreparedActionBoundary(action: AppOperationAction, workspaceId: string): void {
  if (action.schemaVersion !== APP_OPERATION_ACTION_SCHEMA_VERSION || action.workspaceId !== workspaceId) {
    throw new Error("Prepared App action belongs to another workspace or schema");
  }
  if (action.status !== "prepared") {
    throw new Error("Only newly prepared App actions may be recorded through the preparation boundary");
  }
  assertSecretFree(action, "app_operation_action_ledger");
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error("App operation action list limit must be an integer from 1 to 1000");
  }
  return value;
}

async function acquireLock(lockPath: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, 5 + attempt * 2)));
    }
  }
  throw new Error("Timed out waiting for the App operation action ledger lock");
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}
