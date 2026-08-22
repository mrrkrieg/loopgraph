import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  APP_INSTALL_SCHEMA_VERSION,
  appOnboardingDraftSchema,
  appActivationApprovalReceiptSchema,
  appAssetOwnershipSchema,
  appEvalRunSchema,
  appInstallationStateSchema,
  appLifecycleReceiptSchema,
  appInstallationLockSchema,
  workspaceAppInstallationSchema,
  contentHash,
  type AppInstallationLock
} from "../core";

export const APP_LIFECYCLE_OPERATION_LIMIT = 100;

export const appLifecycleOperationSchema = z.object({
  id: z.string().min(1).max(160),
  idempotencyKey: z.string().min(16).max(160),
  installationId: z.string().min(1).max(160),
  appId: z.string().min(1).max(160),
  action: z.enum(["install", "uninstall", "activate"]),
  targetArtifactDigest: z.string().min(16).max(160),
  status: z.enum(["prepared", "requires_reconciliation", "completed"]),
  desired: z.object({
    loopIds: z.array(z.string().min(1).max(160)).max(100),
    fieldMappingIds: z.array(z.string().min(1).max(160)).max(200),
    companyContextKeys: z.array(z.string().min(1).max(160)).max(100)
  }).strict(),
  activation: z.object({
    approvalReceiptId: z.string().regex(/^activation-approval\.[0-9a-f]{16}$/),
    approvalDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    fromState: appInstallationStateSchema,
    targetMode: z.enum(["shadow", "recommend", "execute_with_approval"])
  }).strict().optional(),
  actor: z.string().min(1).max(160),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  resultReceiptId: z.string().min(1).max(160).optional(),
  failureCode: z.literal("operation_interrupted").optional()
}).strict().superRefine((operation, context) => {
  if (operation.status === "completed" && !operation.completedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "Completed lifecycle operations require a completion time" });
  }
  if (operation.status !== "completed" && (operation.completedAt || operation.resultReceiptId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Incomplete lifecycle operations cannot contain result fields" });
  }
  if ((operation.status === "requires_reconciliation") !== Boolean(operation.failureCode)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["failureCode"], message: "Only interrupted lifecycle operations may contain a failure code" });
  }
  if (operation.resultReceiptId && operation.action !== "uninstall") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Only completed uninstall operations may reference a lifecycle receipt" });
  }
  if ((operation.action === "activate") !== Boolean(operation.activation)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["activation"], message: "Only activation operations require exact activation authority" });
  }
  if (operation.action === "activate" && (operation.desired.fieldMappingIds.length > 0 || operation.desired.companyContextKeys.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["desired"], message: "Activation recovery may change only owned LoopSpec rollout state" });
  }
});

export type AppLifecycleOperation = z.infer<typeof appLifecycleOperationSchema>;

const appOnboardingMutationAuditContextSchema = z.object({
  actor: z.string().min(1).max(300),
  action: z.enum([
    "app.onboarding_draft.saved",
    "app.onboarding_draft.reset"
  ]),
  targetType: z.literal("app_onboarding_draft"),
  targetId: z.string().min(1).max(160),
  metadata: z.object({
    appIdDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    presetIdDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    draftRevision: z.number().int().positive(),
    presetChanged: z.boolean(),
    selectedModuleCount: z.number().int().nonnegative().max(100),
    answerCount: z.number().int().nonnegative().max(20),
    fieldMappingCount: z.number().int().nonnegative().max(200)
  }).strict()
}).strict();

const appActivationMutationAuditContextSchema = z.object({
  actor: z.string().min(1).max(300),
  action: z.enum([
    "app.activation.approved",
    "app.activation.consumed"
  ]),
  targetType: z.literal("app_activation_approval"),
  targetId: z.string().regex(/^activation-approval\.[0-9a-f]{16}$/),
  metadata: z.object({
    installationIdDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    appIdDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    approvalDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    fromState: z.enum([
      "selected",
      "resolving",
      "waiting_for_connections",
      "waiting_for_configuration",
      "ready_to_test",
      "simulation_passed",
      "shadow",
      "recommend",
      "execute_with_approval",
      "live",
      "paused",
      "broken",
      "degraded",
      "update_available",
      "deprecated",
      "revoked",
      "uninstalling",
      "rolled_back"
    ]),
    requestedMode: z.enum(["shadow", "recommend", "execute_with_approval"]),
    evidenceRefCount: z.number().int().nonnegative().max(100),
    expiresAt: z.string().datetime()
  }).strict()
}).strict();

export const appInstallationMutationAuditContextSchema = z.union([
  appOnboardingMutationAuditContextSchema,
  appActivationMutationAuditContextSchema
]);

export type AppInstallationMutationAuditContext = z.infer<typeof appInstallationMutationAuditContextSchema>;

export const appInstallationRegistrySchema = z.object({
  schemaVersion: z.literal(APP_INSTALL_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  installations: z.array(workspaceAppInstallationSchema),
  assets: z.array(appAssetOwnershipSchema),
  evaluations: z.array(appEvalRunSchema),
  lifecycleReceipts: z.array(appLifecycleReceiptSchema).default([]),
  lifecycleOperations: z.array(appLifecycleOperationSchema).max(APP_LIFECYCLE_OPERATION_LIMIT).default([]),
  activationApprovals: z.array(appActivationApprovalReceiptSchema).default([]),
  onboardingDrafts: z.array(appOnboardingDraftSchema).max(50).default([]),
  updatedAt: z.string().datetime()
}).strict();

export type AppInstallationRegistry = z.infer<typeof appInstallationRegistrySchema>;

export type AppInstallationUpdate<T> = {
  registry: AppInstallationRegistry;
  value: T;
  lock?: AppInstallationLock;
  audit?: AppInstallationMutationAuditContext;
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
    lifecycleOperations: [],
    activationApprovals: [],
    onboardingDrafts: [],
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
