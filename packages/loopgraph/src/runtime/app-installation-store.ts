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
  appRolloutModeSchema,
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
  action: z.enum(["install", "uninstall", "activate", "pause", "resume", "configure", "overlay", "repair", "duplicate", "update", "rollback"]),
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
  rollout: z.object({
    fromState: appInstallationStateSchema,
    fromMode: appRolloutModeSchema,
    fromUpdatedAt: z.string().datetime(),
    targetState: appInstallationStateSchema,
    targetMode: z.enum(["shadow", "recommend", "execute_with_approval"])
  }).strict().optional(),
  configure: z.object({
    fromUpdatedAt: z.string().datetime(),
    sourceConfigurationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    valuesDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetConfigurationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/)
  }).strict().optional(),
  overlay: z.object({
    fromUpdatedAt: z.string().datetime(),
    sourceArtifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceWorkspaceRevision: z.number().int().nonnegative(),
    sourceLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceLoopIds: z.array(z.string().min(1).max(160)).max(100),
    expectedOverlayRevision: z.number().int().nonnegative(),
    operationsDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopIds: z.array(z.string().min(1).max(160)).max(100)
  }).strict().optional(),
  repair: z.object({
    fromUpdatedAt: z.string().datetime(),
    sourceArtifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceWorkspaceRevision: z.number().int().nonnegative(),
    sourceLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceLoopIds: z.array(z.string().min(1).max(160)).max(100),
    targetInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopIds: z.array(z.string().min(1).max(160)).max(100)
  }).strict().optional(),
  duplicate: z.object({
    fromUpdatedAt: z.string().datetime(),
    sourceArtifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceFieldMappingsDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceWorkspaceRevision: z.number().int().nonnegative(),
    derivedAppId: z.string().min(3).max(160),
    operationsDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetInstallationId: z.string().min(1).max(160),
    targetInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopIds: z.array(z.string().min(1).max(160)).max(100)
  }).strict().optional(),
  uninstall: z.object({
    fromUpdatedAt: z.string().datetime(),
    sourceInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    reasonDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceWorkspaceRevision: z.number().int().nonnegative(),
    sourceLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    remainingLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    remainingLoopIds: z.array(z.string().min(1).max(160)).max(100)
  }).strict().optional(),
  update: z.object({
    fromUpdatedAt: z.string().datetime(),
    sourceArtifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceWorkspaceRevision: z.number().int().nonnegative(),
    sourceLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceLoopIds: z.array(z.string().min(1).max(160)).max(100),
    planDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    approvedPermissionCapabilities: z.array(z.string().min(1).max(160)).max(100),
    targetInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopIds: z.array(z.string().min(1).max(160)).max(100)
  }).strict().optional(),
  rollback: z.object({
    fromUpdatedAt: z.string().datetime(),
    sourceArtifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceWorkspaceRevision: z.number().int().nonnegative(),
    sourceLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceLoopIds: z.array(z.string().min(1).max(160)).max(100),
    targetInstallationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetOwnershipDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopInventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetLoopIds: z.array(z.string().min(1).max(160)).max(100)
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
  if (operation.resultReceiptId && !["configure", "overlay", "repair", "duplicate", "uninstall", "update", "rollback"].includes(operation.action)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Only completed receipt-producing lifecycle operations may reference a lifecycle receipt" });
  }
  if (operation.action === "rollback" && operation.status === "completed" && !operation.resultReceiptId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Completed rollback operations require their exact lifecycle receipt" });
  }
  if (operation.action === "update" && operation.status === "completed" && !operation.resultReceiptId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Completed update operations require their exact lifecycle receipt" });
  }
  if (operation.action === "configure" && operation.status === "completed" && !operation.resultReceiptId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Completed configure operations require their exact lifecycle receipt" });
  }
  if (operation.action === "overlay" && operation.status === "completed" && !operation.resultReceiptId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Completed overlay operations require their exact lifecycle receipt" });
  }
  if (operation.action === "repair" && operation.status === "completed" && !operation.resultReceiptId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Completed repair operations require their exact lifecycle receipt" });
  }
  if (operation.action === "duplicate" && operation.status === "completed" && !operation.resultReceiptId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultReceiptId"], message: "Completed duplicate operations require their exact lifecycle receipt" });
  }
  if ((operation.action === "activate") !== Boolean(operation.activation)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["activation"], message: "Only activation operations require exact activation authority" });
  }
  const isRolloutOperation = operation.action === "pause" || operation.action === "resume";
  if (isRolloutOperation !== Boolean(operation.rollout)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rollout"], message: "Only pause and resume operations require exact rollout state" });
  }
  if ((operation.action === "configure") !== Boolean(operation.configure)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["configure"], message: "Only configure operations require an exact configuration contract" });
  }
  if ((operation.action === "overlay") !== Boolean(operation.overlay)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["overlay"], message: "Only overlay operations require an exact graph rematerialization contract" });
  }
  if ((operation.action === "repair") !== Boolean(operation.repair)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["repair"], message: "Only repair operations require an exact regeneration contract" });
  }
  if ((operation.action === "duplicate") !== Boolean(operation.duplicate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["duplicate"], message: "Only duplicate operations require an exact derived-installation contract" });
  }
  if (operation.action !== "uninstall" && operation.uninstall) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["uninstall"], message: "Only uninstall operations may contain exact removal intent" });
  }
  if ((operation.action === "update") !== Boolean(operation.update)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["update"], message: "Only update operations require an exact upgrade contract" });
  }
  if ((operation.action === "rollback") !== Boolean(operation.rollback)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rollback"], message: "Only rollback operations require an exact rematerialization contract" });
  }
  if (operation.update && Date.parse(operation.update.fromUpdatedAt) > Date.parse(operation.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["update", "fromUpdatedAt"], message: "Update source revision cannot be newer than the prepared operation" });
  }
  if (operation.configure && Date.parse(operation.configure.fromUpdatedAt) > Date.parse(operation.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["configure", "fromUpdatedAt"], message: "Configure source revision cannot be newer than the prepared operation" });
  }
  if (operation.overlay && Date.parse(operation.overlay.fromUpdatedAt) > Date.parse(operation.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["overlay", "fromUpdatedAt"], message: "Overlay source revision cannot be newer than the prepared operation" });
  }
  if (operation.repair && Date.parse(operation.repair.fromUpdatedAt) > Date.parse(operation.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["repair", "fromUpdatedAt"], message: "Repair source revision cannot be newer than the prepared operation" });
  }
  if (operation.duplicate && Date.parse(operation.duplicate.fromUpdatedAt) > Date.parse(operation.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["duplicate", "fromUpdatedAt"], message: "Duplicate source revision cannot be newer than the prepared operation" });
  }
  if (operation.rollback && Date.parse(operation.rollback.fromUpdatedAt) > Date.parse(operation.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rollback", "fromUpdatedAt"], message: "Rollback source revision cannot be newer than the prepared operation" });
  }
  if (operation.action === "uninstall" && operation.uninstall && (
    operation.uninstall.fromUpdatedAt !== operation.startedAt &&
    Date.parse(operation.uninstall.fromUpdatedAt) > Date.parse(operation.startedAt)
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["uninstall", "fromUpdatedAt"], message: "Uninstall source revision cannot be newer than the prepared operation" });
  }
  if (operation.action === "uninstall" && operation.uninstall && operation.uninstall.remainingLoopIds.some((loopId) => !operation.desired.loopIds.includes(loopId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["uninstall", "remainingLoopIds"], message: "Remaining shared LoopSpecs must be a subset of the recorded source inventory" });
  }
  if (operation.rollback && (
    new Set(operation.rollback.sourceLoopIds).size !== operation.rollback.sourceLoopIds.length ||
    new Set(operation.rollback.targetLoopIds).size !== operation.rollback.targetLoopIds.length ||
    new Set(operation.desired.loopIds).size !== operation.desired.loopIds.length ||
    operation.rollback.targetLoopIds.length !== operation.desired.loopIds.length ||
    operation.rollback.targetLoopIds.some((loopId) => !operation.desired.loopIds.includes(loopId))
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rollback", "targetLoopIds"], message: "Rollback target LoopSpecs must match the desired inventory" });
  }
  if (operation.update && (
    new Set(operation.update.sourceLoopIds).size !== operation.update.sourceLoopIds.length ||
    new Set(operation.update.targetLoopIds).size !== operation.update.targetLoopIds.length ||
    new Set(operation.update.approvedPermissionCapabilities).size !== operation.update.approvedPermissionCapabilities.length ||
    new Set(operation.desired.loopIds).size !== operation.desired.loopIds.length ||
    operation.update.targetLoopIds.length !== operation.desired.loopIds.length ||
    operation.update.targetLoopIds.some((loopId) => !operation.desired.loopIds.includes(loopId))
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["update", "targetLoopIds"], message: "Update target LoopSpecs and permission approvals must be unique and match the desired inventory" });
  }
  if (operation.overlay && (
    new Set(operation.overlay.sourceLoopIds).size !== operation.overlay.sourceLoopIds.length ||
    new Set(operation.overlay.targetLoopIds).size !== operation.overlay.targetLoopIds.length ||
    new Set(operation.desired.loopIds).size !== operation.desired.loopIds.length ||
    operation.overlay.targetLoopIds.length !== operation.desired.loopIds.length ||
    operation.overlay.targetLoopIds.some((loopId) => !operation.desired.loopIds.includes(loopId))
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["overlay", "targetLoopIds"], message: "Overlay target LoopSpecs must be unique and match the desired inventory" });
  }
  if (operation.repair && (
    new Set(operation.repair.sourceLoopIds).size !== operation.repair.sourceLoopIds.length ||
    new Set(operation.repair.targetLoopIds).size !== operation.repair.targetLoopIds.length ||
    new Set(operation.desired.loopIds).size !== operation.desired.loopIds.length ||
    operation.repair.targetLoopIds.length !== operation.desired.loopIds.length ||
    operation.repair.targetLoopIds.some((loopId) => !operation.desired.loopIds.includes(loopId))
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["repair", "targetLoopIds"], message: "Repair target LoopSpecs must be unique and match the desired inventory" });
  }
  if (operation.duplicate && (
    new Set(operation.duplicate.targetLoopIds).size !== operation.duplicate.targetLoopIds.length ||
    new Set(operation.desired.loopIds).size !== operation.desired.loopIds.length ||
    new Set(operation.desired.fieldMappingIds).size !== operation.desired.fieldMappingIds.length ||
    new Set(operation.desired.companyContextKeys).size !== operation.desired.companyContextKeys.length ||
    operation.duplicate.targetLoopIds.length !== operation.desired.loopIds.length ||
    operation.duplicate.targetLoopIds.some((loopId) => !operation.desired.loopIds.includes(loopId))
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["duplicate", "targetLoopIds"], message: "Duplicate target LoopSpecs and shared dependencies must be unique and match the desired inventory" });
  }
  if ((operation.activation || operation.rollout) && (operation.desired.fieldMappingIds.length > 0 || operation.desired.companyContextKeys.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["desired"], message: "Rollout recovery may change only owned LoopSpec rollout state" });
  }
  if (operation.configure && (
    operation.desired.loopIds.length > 0 ||
    operation.desired.fieldMappingIds.length > 0 ||
    operation.desired.companyContextKeys.length > 0
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["desired"], message: "Configure recovery may change only the installation configuration" });
  }
  if (operation.overlay && (
    operation.desired.fieldMappingIds.length > 0 ||
    operation.desired.companyContextKeys.length > 0
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["desired"], message: "Overlay recovery may change only the installation, ownership, and owned LoopSpec inventory" });
  }
  if (operation.action === "pause" && operation.rollout && (
    !["shadow", "recommend", "execute_with_approval"].includes(operation.rollout.fromState) ||
    operation.rollout.fromMode !== operation.rollout.fromState ||
    operation.rollout.targetState !== "paused" ||
    operation.rollout.targetMode !== operation.rollout.fromMode
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rollout"], message: "Pause recovery must preserve the approved mode while moving active routing to shadow" });
  }
  if (operation.action === "resume" && operation.rollout && (
    operation.rollout.fromState !== "paused" ||
    operation.rollout.fromMode !== operation.rollout.targetMode ||
    operation.rollout.targetState !== operation.rollout.targetMode
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rollout"], message: "Resume recovery must restore the exact previously approved non-live mode" });
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
