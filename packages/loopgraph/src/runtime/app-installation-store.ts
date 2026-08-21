import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  APP_INSTALL_SCHEMA_VERSION,
  appActivationApprovalReceiptSchema,
  appAssetOwnershipSchema,
  appEvalRunSchema,
  appLifecycleReceiptSchema,
  appInstallationLockSchema,
  workspaceAppInstallationSchema,
  contentHash,
  type AppInstallationLock
} from "../core";

export const appInstallationRegistrySchema = z.object({
  schemaVersion: z.literal(APP_INSTALL_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  installations: z.array(workspaceAppInstallationSchema),
  assets: z.array(appAssetOwnershipSchema),
  evaluations: z.array(appEvalRunSchema),
  lifecycleReceipts: z.array(appLifecycleReceiptSchema).default([]),
  activationApprovals: z.array(appActivationApprovalReceiptSchema).default([]),
  updatedAt: z.string().datetime()
}).strict();

export type AppInstallationRegistry = z.infer<typeof appInstallationRegistrySchema>;

export type AppInstallationUpdate<T> = {
  registry: AppInstallationRegistry;
  value: T;
  lock?: AppInstallationLock;
};

export interface AppInstallationStore {
  readonly persistence: "file" | "distributed";
  read(): Promise<AppInstallationRegistry>;
  readLockfile(): Promise<AppInstallationLock | undefined>;
  withExclusiveUpdate<T>(operation: (registry: AppInstallationRegistry) => Promise<AppInstallationUpdate<T>>): Promise<T>;
}

export function emptyAppInstallationRegistry(workspaceId: string): AppInstallationRegistry {
  return {
    schemaVersion: APP_INSTALL_SCHEMA_VERSION,
    workspaceId,
    revision: 0,
    installations: [],
    assets: [],
    evaluations: [],
    lifecycleReceipts: [],
    activationApprovals: [],
    updatedAt: new Date(0).toISOString()
  };
}

export function assertAppInstallationRegistryRevision(
  current: AppInstallationRegistry,
  next: AppInstallationRegistry
): void {
  if (
    next.revision < current.revision ||
    (next.revision === current.revision && contentHash(next) !== contentHash(current))
  ) {
    throw new Error("Installation registry revision must increase for a mutation");
  }
  if (next.revision > current.revision + 1) {
    throw new Error("Installation registry revision may advance by only one per mutation");
  }
}

export class FileAppInstallationStore implements AppInstallationStore {
  readonly persistence = "file" as const;
  private readonly registryPath: string;
  private readonly lockfilePath: string;
  private readonly mutexPath: string;

  constructor(private readonly appsRoot: string, private readonly workspaceId: string) {
    this.registryPath = path.join(appsRoot, "installations.json");
    this.lockfilePath = path.join(appsRoot, "app-lock.json");
    this.mutexPath = path.join(appsRoot, ".installation.lock");
  }

  static async discoverWorkspaceId(appsRoot: string): Promise<string | undefined> {
    try {
      const registry = appInstallationRegistrySchema.parse(JSON.parse(await readFile(path.join(appsRoot, "installations.json"), "utf8")));
      return registry.workspaceId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async read(): Promise<AppInstallationRegistry> {
    try {
      const registry = appInstallationRegistrySchema.parse(JSON.parse(await readFile(this.registryPath, "utf8")));
      if (registry.workspaceId !== this.workspaceId) throw new Error("Installation registry belongs to another workspace");
      return registry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return emptyAppInstallationRegistry(this.workspaceId);
    }
  }

  async readLockfile(): Promise<AppInstallationLock | undefined> {
    try {
      return appInstallationLockSchema.parse(JSON.parse(await readFile(this.lockfilePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async withExclusiveUpdate<T>(operation: (registry: AppInstallationRegistry) => Promise<AppInstallationUpdate<T>>): Promise<T> {
    await mkdir(this.appsRoot, { recursive: true, mode: 0o700 });
    const handle = await acquireLock(this.mutexPath);
    try {
      const current = await this.read();
      const result = await operation(current);
      const next = appInstallationRegistrySchema.parse(result.registry);
      assertAppInstallationRegistryRevision(current, next);
      await atomicWriteJson(this.registryPath, next);
      if (result.lock) await atomicWriteJson(this.lockfilePath, appInstallationLockSchema.parse(result.lock));
      return result.value;
    } finally {
      await handle.close();
      await rm(this.mutexPath, { force: true });
    }
  }
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
  throw new Error("Timed out waiting for the app installation lock");
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}
