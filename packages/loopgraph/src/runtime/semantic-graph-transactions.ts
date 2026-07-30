import { access, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION,
  GRAPH_SNAPSHOT_SCHEMA_VERSION,
  GRAPH_TRANSACTION_SCHEMA_VERSION,
  LOOP_PROMOTION_RECEIPT_SCHEMA_VERSION,
  contentHash,
  graphChangeApprovalReceiptSchema,
  graphSnapshotSchema,
  graphTransactionSchema,
  loopPromotionReceiptSchema,
  loopSpecHash,
  routingActivationModeSchema,
  validateLoopSpec,
  type GraphChange,
  type GraphChangeApprovalReceipt,
  type GraphOperationReceipt,
  type GraphSnapshot,
  type GraphTransaction,
  type LoopPromotionReceipt,
  type LoopSpec,
  type RoutingActivationMode
} from "../core";
import {
  getGraphChangeSet,
  markLoopOpportunityImplemented,
  saveGraphChangeSet
} from "./loop-opportunity-engine";
import { materializeAcceptedLoopDesignProposals } from "./loop-materialization";
import { getLoopgraphRoot } from "./storage-resolver";
import {
  graphChangeSetHash,
  readWorkspaceGraphState
} from "./semantic-graph-state";
import { FileSemanticGraphStore } from "./semantic-graph-store";
import {
  readLoopgraphWorkspace,
  writeLoopgraphWorkspace,
  type RegisteredLoopSpec
} from "./workspace";

export type GraphApprovalInput = {
  projectRoot?: string;
  changeSetId: string;
  decision: "approved" | "rejected";
  approvedChangeIds?: string[];
  actorId: string;
  actorRole: string;
  policyVersion: string;
  reason: string;
  evidenceRefs?: string[];
  now?: Date;
};

export type ApplyGraphChangeSetInput = {
  projectRoot?: string;
  changeSetId: string;
  approvalReceiptId: string;
  designRunId?: string;
  acceptedProposalIds?: string[];
  proposalIdsByChangeId?: Record<string, string[]>;
  initiatedBy: string;
  now?: Date;
};

export type PromotionApprovalInput = {
  projectRoot?: string;
  loopId: string;
  nextMode: RoutingActivationMode;
  actorId: string;
  actorRole: string;
  policyVersion: string;
  reason: string;
  evidenceRefs: string[];
  now?: Date;
};

export type PromoteLoopInput = {
  projectRoot?: string;
  loopId: string;
  nextMode: RoutingActivationMode;
  approvalReceiptId: string;
  gateEvidenceRefs: string[];
  initiatedBy: string;
  now?: Date;
};

export type LoopLifecycleApprovalInput = {
  projectRoot?: string;
  loopId: string;
  nextStatus: "active" | "paused";
  actorId: string;
  actorRole: string;
  policyVersion: string;
  reason: string;
  evidenceRefs?: string[];
  now?: Date;
};

export type SetLoopLifecycleStatusInput = {
  projectRoot?: string;
  loopId: string;
  nextStatus: "active" | "paused";
  approvalReceiptId: string;
  initiatedBy: string;
  now?: Date;
};

export type RollbackApprovalInput = {
  projectRoot?: string;
  transactionId: string;
  actorId: string;
  actorRole: string;
  policyVersion: string;
  reason: string;
  evidenceRefs?: string[];
  now?: Date;
};

export type RollbackGraphTransactionInput = {
  projectRoot?: string;
  transactionId: string;
  approvalReceiptId: string;
  initiatedBy: string;
  now?: Date;
};

export async function captureGraphSnapshot(input: {
  projectRoot?: string;
  reason: string;
  createdBy: string;
  transactionId?: string;
  now?: Date;
  store?: FileSemanticGraphStore;
}): Promise<GraphSnapshot> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const store = input.store ?? new FileSemanticGraphStore(loopgraphRoot);
  const state = await readWorkspaceGraphState(projectRoot);
  const sequence = Math.max(-1, ...(await store.listSnapshots()).map((snapshot) => snapshot.sequence)) + 1;
  const createdAt = (input.now ?? new Date()).toISOString();
  const snapshotId = `graph_snapshot_${contentHash({
    projectRootId: state.workspace.projectRootId,
    graphHash: state.graphHash,
    sequence,
    reason: input.reason,
    createdAt
  })}`;
  const assetsRoot = store.snapshotAssetsRoot(snapshotId);
  await mkdir(assetsRoot, { recursive: true, mode: 0o700 });

  const entries = [];
  for (const entry of state.entries) {
    const registeredPath = path.isAbsolute(entry.path)
      ? path.resolve(entry.path)
      : path.resolve(projectRoot, entry.path);
    const registeredPathKind = isSpecFilePath(registeredPath) ? "file" as const : "directory" as const;
    const assetRoot = registeredPathKind === "file" ? path.dirname(registeredPath) : registeredPath;
    if (isWithin(loopgraphRoot, assetRoot) && await pathExists(assetRoot)) {
      const archivedAssetsPath = path.join(assetsRoot, safeFileName(entry.id));
      await cp(assetRoot, archivedAssetsPath, { recursive: true, force: false, errorOnExist: true });
      entries.push({
        ...entry,
        archivedAssetsPath: path.relative(loopgraphRoot, archivedAssetsPath),
        assetRoot: path.relative(projectRoot, assetRoot),
        registeredPathKind,
        specRelativePath: path.relative(assetRoot, registeredPath)
      });
    } else {
      entries.push(entry);
    }
  }

  const snapshot = graphSnapshotSchema.parse({
    schemaVersion: GRAPH_SNAPSHOT_SCHEMA_VERSION,
    id: snapshotId,
    projectRootId: state.workspace.projectRootId,
    graphHash: state.graphHash,
    sequence,
    reason: input.reason,
    transactionId: input.transactionId,
    entries,
    createdAt,
    createdBy: input.createdBy
  });
  await store.saveSnapshot(snapshot);
  return snapshot;
}

export async function approveGraphChangeSet(
  input: GraphApprovalInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<{ receipt: GraphChangeApprovalReceipt; changeSet: NonNullable<Awaited<ReturnType<typeof getGraphChangeSet>>> }> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    const changeSet = await requireChangeSet(input.changeSetId, projectRoot);
    if (!["proposed", "approved"].includes(changeSet.status)) {
      throw new Error(`Graph change set ${changeSet.id} cannot be reviewed from status=${changeSet.status}`);
    }
    const state = await readWorkspaceGraphState(projectRoot);
    if (input.decision === "approved" && state.graphHash !== changeSet.baseGraphHash) {
      throw new Error(
        `Graph change set ${changeSet.id} is stale: expected ${changeSet.baseGraphHash}, current ${state.graphHash}`
      );
    }
    const approvedChangeIds = input.decision === "approved"
      ? unique(input.approvedChangeIds?.length ? input.approvedChangeIds : changeSet.changes.map((change) => change.id))
      : [];
    assertKnownChangeIds(changeSet.changes, approvedChangeIds);
    if (
      input.decision === "approved" &&
      changeSet.changes.some((change) => change.requiresExplicitApproval && !approvedChangeIds.includes(change.id))
    ) {
      throw new Error("Every explicitly governed graph operation must be approved before application");
    }
    const decidedAt = (input.now ?? new Date()).toISOString();
    const receipt = graphChangeApprovalReceiptSchema.parse({
      schemaVersion: GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION,
      id: `graph_approval_${contentHash({
        changeSetId: changeSet.id,
        changeSetHash: graphChangeSetHash(changeSet),
        decision: input.decision,
        approvedChangeIds,
        actorId: input.actorId,
        decidedAt
      })}`,
      projectRootId: state.workspace.projectRootId,
      subjectType: "graph_change",
      changeSetId: changeSet.id,
      changeSetHash: graphChangeSetHash(changeSet),
      baseGraphHash: changeSet.baseGraphHash,
      decision: input.decision,
      approvedChangeIds,
      actorId: required(input.actorId, "actorId"),
      actorRole: required(input.actorRole, "actorRole"),
      policyVersion: required(input.policyVersion, "policyVersion"),
      reason: required(input.reason, "reason"),
      evidenceRefs: unique(input.evidenceRefs ?? []),
      decidedAt
    });
    await store.saveApproval(receipt);
    const reviewed = {
      ...changeSet,
      status: input.decision === "approved" ? "approved" as const : "rejected" as const,
      approvalReceiptIds: unique([...changeSet.approvalReceiptIds, receipt.id]),
      updatedAt: decidedAt
    };
    await saveGraphChangeSet(reviewed, projectRoot);
    return { receipt, changeSet: reviewed };
  });
}

export async function applyGraphChangeSet(
  input: ApplyGraphChangeSetInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<{
  transaction: GraphTransaction;
  changeSet: NonNullable<Awaited<ReturnType<typeof getGraphChangeSet>>>;
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    const changeSet = await requireChangeSet(input.changeSetId, projectRoot);
    const approval = await requireApproval(input.approvalReceiptId, store);
    validateChangeApproval(changeSet, approval);
    if (changeSet.status === "applied" && changeSet.appliedTransactionId) {
      const existing = await store.getTransaction(changeSet.appliedTransactionId);
      if (existing) return { transaction: existing, changeSet };
    }
    if (changeSet.status !== "approved") {
      throw new Error(`Graph change set ${changeSet.id} cannot be applied from status=${changeSet.status}`);
    }
    const state = await readWorkspaceGraphState(projectRoot);
    if (state.graphHash !== changeSet.baseGraphHash) {
      throw new Error(
        `Graph change set ${changeSet.id} is stale: expected ${changeSet.baseGraphHash}, current ${state.graphHash}`
      );
    }
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const transactionId = `graph_transaction_${contentHash({
      changeSetId: changeSet.id,
      approvalReceiptId: approval.id,
      baseGraphHash: state.graphHash,
      initiatedBy: input.initiatedBy,
      createdAt
    })}`;
    const baseSnapshot = await captureGraphSnapshot({
      projectRoot,
      reason: `Before applying ${changeSet.id}`,
      createdBy: input.initiatedBy,
      transactionId,
      now,
      store
    });
    let transaction = graphTransactionSchema.parse({
      schemaVersion: GRAPH_TRANSACTION_SCHEMA_VERSION,
      id: transactionId,
      projectRootId: state.workspace.projectRootId,
      kind: "change_set",
      status: "prepared",
      changeSetId: changeSet.id,
      approvalReceiptId: approval.id,
      initiatedBy: required(input.initiatedBy, "initiatedBy"),
      baseSnapshotId: baseSnapshot.id,
      baseGraphHash: baseSnapshot.graphHash,
      operationReceipts: [],
      createdAt
    });
    await store.saveTransaction(transaction);

    try {
      const operationReceipts: GraphOperationReceipt[] = [];
      for (const change of changeSet.changes) {
        const resultLoopIds = change.operation === "retire"
          ? []
          : await materializeChangeResults({
              projectRoot,
              change,
              designRunId: input.designRunId ?? changeSet.designRunId,
              acceptedProposalIds: proposalIdsForChange(input, change, changeSet.changes.length),
              initiatedBy: input.initiatedBy,
              now
            });
        validateOperationCardinality(change, resultLoopIds);
        const retiredLoopIds = retiredLoopsForOperation(change, resultLoopIds);
        await retireRegisteredLoops(projectRoot, retiredLoopIds);
        const resultState = await readWorkspaceGraphState(projectRoot);
        operationReceipts.push({
          changeId: change.id,
          operation: change.operation,
          department: change.department,
          targetLoopIds: [...change.targetLoopIds],
          resultLoopIds,
          retiredLoopIds,
          specHashes: Object.fromEntries(
            resultState.entries
              .filter((entry) => resultLoopIds.includes(entry.id))
              .map((entry) => [entry.id, entry.specHash])
          )
        });
      }
      const resultSnapshot = await captureGraphSnapshot({
        projectRoot,
        reason: `After applying ${changeSet.id}`,
        createdBy: input.initiatedBy,
        transactionId,
        now,
        store
      });
      transaction = graphTransactionSchema.parse({
        ...transaction,
        status: "committed",
        resultSnapshotId: resultSnapshot.id,
        resultGraphHash: resultSnapshot.graphHash,
        operationReceipts,
        committedAt: createdAt
      });
      await store.saveTransaction(transaction);
      const applied = {
        ...changeSet,
        status: "applied" as const,
        designRunId: input.designRunId ?? changeSet.designRunId,
        appliedTransactionId: transaction.id,
        resultGraphHash: resultSnapshot.graphHash,
        appliedAt: createdAt,
        updatedAt: createdAt
      };
      await saveGraphChangeSet(applied, projectRoot);
      if (applied.designRunId) {
        await markLoopOpportunityImplemented({
          projectRoot,
          designRunId: applied.designRunId,
          now
        });
      }
      return { transaction, changeSet: applied };
    } catch (error) {
      await restoreGraphSnapshot({
        projectRoot,
        snapshot: baseSnapshot,
        restoredBy: input.initiatedBy
      });
      transaction = graphTransactionSchema.parse({
        ...transaction,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      await store.saveTransaction(transaction);
      await saveGraphChangeSet({
        ...changeSet,
        status: "approved",
        appliedAt: undefined,
        appliedTransactionId: undefined,
        resultGraphHash: undefined,
        updatedAt: createdAt
      }, projectRoot);
      throw error;
    }
  });
}

export async function approveLoopPromotion(
  input: PromotionApprovalInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<GraphChangeApprovalReceipt> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    const state = await readWorkspaceGraphState(projectRoot);
    const entry = state.entries.find((candidate) => candidate.id === input.loopId);
    if (!entry) throw new Error(`Registered loop not found: ${input.loopId}`);
    assertPromotionTransition(entry.spec.routing?.activationMode, input.nextMode);
    const decidedAt = (input.now ?? new Date()).toISOString();
    const receipt = graphChangeApprovalReceiptSchema.parse({
      schemaVersion: GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION,
      id: `graph_approval_${contentHash({
        subjectType: "promotion",
        loopId: input.loopId,
        nextMode: input.nextMode,
        baseGraphHash: state.graphHash,
        actorId: input.actorId,
        decidedAt
      })}`,
      projectRootId: state.workspace.projectRootId,
      subjectType: "promotion",
      loopId: input.loopId,
      baseGraphHash: state.graphHash,
      decision: "approved",
      approvedChangeIds: [],
      actorId: required(input.actorId, "actorId"),
      actorRole: required(input.actorRole, "actorRole"),
      policyVersion: required(input.policyVersion, "policyVersion"),
      reason: required(input.reason, "reason"),
      evidenceRefs: unique(input.evidenceRefs),
      decidedAt
    });
    await store.saveApproval(receipt);
    return receipt;
  });
}

export async function promoteLoop(
  input: PromoteLoopInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<{ transaction: GraphTransaction; promotion: LoopPromotionReceipt }> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    if (input.gateEvidenceRefs.length === 0) {
      throw new Error("Promotion requires at least one durable gate evidence reference");
    }
    const state = await readWorkspaceGraphState(projectRoot);
    const entry = state.entries.find((candidate) => candidate.id === input.loopId);
    if (!entry) throw new Error(`Registered loop not found: ${input.loopId}`);
    const previousMode = entry.spec.routing?.activationMode;
    if (!previousMode) throw new Error(`Loop ${input.loopId} has no routing activation mode`);
    const nextMode = routingActivationModeSchema.parse(input.nextMode);
    assertPromotionTransition(previousMode, nextMode);
    const approval = await requireApproval(input.approvalReceiptId, store);
    if (
      approval.subjectType !== "promotion" ||
      approval.loopId !== input.loopId ||
      approval.decision !== "approved" ||
      approval.baseGraphHash !== state.graphHash
    ) {
      throw new Error("Promotion approval is not bound to this loop and current graph");
    }
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const transactionId = `graph_transaction_${contentHash({
      kind: "promotion",
      loopId: input.loopId,
      previousMode,
      nextMode,
      approvalReceiptId: approval.id,
      createdAt
    })}`;
    const baseSnapshot = await captureGraphSnapshot({
      projectRoot,
      reason: `Before promoting ${input.loopId} from ${previousMode} to ${nextMode}`,
      createdBy: input.initiatedBy,
      transactionId,
      now,
      store
    });
    let transaction = graphTransactionSchema.parse({
      schemaVersion: GRAPH_TRANSACTION_SCHEMA_VERSION,
      id: transactionId,
      projectRootId: state.workspace.projectRootId,
      kind: "promotion",
      status: "prepared",
      approvalReceiptId: approval.id,
      initiatedBy: required(input.initiatedBy, "initiatedBy"),
      baseSnapshotId: baseSnapshot.id,
      baseGraphHash: baseSnapshot.graphHash,
      operationReceipts: [],
      createdAt
    });
    await store.saveTransaction(transaction);
    try {
      const promotedSpec = validateLoopSpec({
        ...entry.spec,
        metadata: {
          ...entry.spec.metadata,
          labels: {
            ...(entry.spec.metadata.labels ?? {}),
            lifecycleStatus: "active",
            activationMode: nextMode,
            promotedAt: createdAt,
            promotionApprovalReceiptId: approval.id
          }
        },
        routing: {
          ...entry.spec.routing!,
          activationMode: nextMode
        }
      });
      await writeRegisteredLoopSpec(projectRoot, entry.path, promotedSpec);
      const resultSnapshot = await captureGraphSnapshot({
        projectRoot,
        reason: `After promoting ${input.loopId} to ${nextMode}`,
        createdBy: input.initiatedBy,
        transactionId,
        now,
        store
      });
      transaction = graphTransactionSchema.parse({
        ...transaction,
        status: "committed",
        resultSnapshotId: resultSnapshot.id,
        resultGraphHash: resultSnapshot.graphHash,
        operationReceipts: [{
          changeId: `promotion:${input.loopId}`,
          operation: "update",
          department: entry.department,
          targetLoopIds: [input.loopId],
          resultLoopIds: [input.loopId],
          retiredLoopIds: [],
          specHashes: { [input.loopId]: loopSpecHash(promotedSpec) }
        }],
        committedAt: createdAt
      });
      await store.saveTransaction(transaction);
      const promotion = loopPromotionReceiptSchema.parse({
        schemaVersion: LOOP_PROMOTION_RECEIPT_SCHEMA_VERSION,
        id: `loop_promotion_${contentHash({
          loopId: input.loopId,
          transactionId,
          previousMode,
          nextMode
        })}`,
        projectRootId: state.workspace.projectRootId,
        loopId: input.loopId,
        transactionId,
        approvalReceiptId: approval.id,
        previousMode,
        nextMode,
        previousSpecHash: entry.specHash,
        nextSpecHash: loopSpecHash(promotedSpec),
        gateEvidenceRefs: unique(input.gateEvidenceRefs),
        status: "applied",
        promotedBy: input.initiatedBy,
        promotedAt: createdAt
      });
      await store.savePromotion(promotion);
      return { transaction, promotion };
    } catch (error) {
      await restoreGraphSnapshot({ projectRoot, snapshot: baseSnapshot, restoredBy: input.initiatedBy });
      transaction = graphTransactionSchema.parse({
        ...transaction,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      await store.saveTransaction(transaction);
      throw error;
    }
  });
}

export async function approveGraphRollback(
  input: RollbackApprovalInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<GraphChangeApprovalReceipt> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    const transaction = await requireTransaction(input.transactionId, store);
    if (transaction.status !== "committed") {
      throw new Error(`Only a committed graph transaction can be rolled back (status=${transaction.status})`);
    }
    const state = await readWorkspaceGraphState(projectRoot);
    if (transaction.resultGraphHash !== state.graphHash) {
      throw new Error(
        `Cannot approve rollback because the graph advanced from ${transaction.resultGraphHash} to ${state.graphHash}`
      );
    }
    const decidedAt = (input.now ?? new Date()).toISOString();
    const receipt = graphChangeApprovalReceiptSchema.parse({
      schemaVersion: GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION,
      id: `graph_approval_${contentHash({
        subjectType: "rollback",
        transactionId: transaction.id,
        baseGraphHash: state.graphHash,
        actorId: input.actorId,
        decidedAt
      })}`,
      projectRootId: state.workspace.projectRootId,
      subjectType: "rollback",
      transactionId: transaction.id,
      baseGraphHash: state.graphHash,
      decision: "approved",
      approvedChangeIds: [],
      actorId: required(input.actorId, "actorId"),
      actorRole: required(input.actorRole, "actorRole"),
      policyVersion: required(input.policyVersion, "policyVersion"),
      reason: required(input.reason, "reason"),
      evidenceRefs: unique(input.evidenceRefs ?? []),
      decidedAt
    });
    await store.saveApproval(receipt);
    return receipt;
  });
}

export async function approveLoopLifecycleChange(
  input: LoopLifecycleApprovalInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<GraphChangeApprovalReceipt> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    const state = await readWorkspaceGraphState(projectRoot);
    const entry = state.entries.find((candidate) => candidate.id === input.loopId);
    if (!entry) throw new Error(`Registered loop not found: ${input.loopId}`);
    const currentStatus = entry.spec.metadata.labels?.lifecycleStatus === "paused" ? "paused" : "active";
    if (currentStatus === input.nextStatus) {
      throw new Error(`Loop ${input.loopId} is already ${input.nextStatus}`);
    }
    const decidedAt = (input.now ?? new Date()).toISOString();
    const receipt = graphChangeApprovalReceiptSchema.parse({
      schemaVersion: GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION,
      id: `graph_approval_${contentHash({
        subjectType: "lifecycle",
        loopId: input.loopId,
        nextStatus: input.nextStatus,
        baseGraphHash: state.graphHash,
        actorId: input.actorId,
        decidedAt
      })}`,
      projectRootId: state.workspace.projectRootId,
      subjectType: "lifecycle",
      loopId: input.loopId,
      nextLifecycleStatus: input.nextStatus,
      baseGraphHash: state.graphHash,
      decision: "approved",
      approvedChangeIds: [],
      actorId: required(input.actorId, "actorId"),
      actorRole: required(input.actorRole, "actorRole"),
      policyVersion: required(input.policyVersion, "policyVersion"),
      reason: required(input.reason, "reason"),
      evidenceRefs: unique(input.evidenceRefs ?? []),
      decidedAt
    });
    await store.saveApproval(receipt);
    return receipt;
  });
}

export async function setLoopLifecycleStatus(
  input: SetLoopLifecycleStatusInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<{ transaction: GraphTransaction; status: "active" | "paused" }> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    const state = await readWorkspaceGraphState(projectRoot);
    const entry = state.entries.find((candidate) => candidate.id === input.loopId);
    if (!entry) throw new Error(`Registered loop not found: ${input.loopId}`);
    const currentStatus = entry.spec.metadata.labels?.lifecycleStatus === "paused" ? "paused" : "active";
    if (currentStatus === input.nextStatus) {
      throw new Error(`Loop ${input.loopId} is already ${input.nextStatus}`);
    }
    const approval = await requireApproval(input.approvalReceiptId, store);
    if (
      approval.subjectType !== "lifecycle" ||
      approval.loopId !== input.loopId ||
      approval.nextLifecycleStatus !== input.nextStatus ||
      approval.decision !== "approved" ||
      approval.baseGraphHash !== state.graphHash
    ) {
      throw new Error("Lifecycle approval is not bound to this loop, status, and current graph");
    }
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const transactionId = `graph_transaction_${contentHash({
      kind: "lifecycle",
      loopId: input.loopId,
      currentStatus,
      nextStatus: input.nextStatus,
      approvalReceiptId: approval.id,
      createdAt
    })}`;
    const baseSnapshot = await captureGraphSnapshot({
      projectRoot,
      reason: `Before setting ${input.loopId} ${input.nextStatus}`,
      createdBy: input.initiatedBy,
      transactionId,
      now,
      store
    });
    let transaction = graphTransactionSchema.parse({
      schemaVersion: GRAPH_TRANSACTION_SCHEMA_VERSION,
      id: transactionId,
      projectRootId: state.workspace.projectRootId,
      kind: "lifecycle",
      status: "prepared",
      approvalReceiptId: approval.id,
      initiatedBy: required(input.initiatedBy, "initiatedBy"),
      baseSnapshotId: baseSnapshot.id,
      baseGraphHash: baseSnapshot.graphHash,
      operationReceipts: [],
      createdAt
    });
    await store.saveTransaction(transaction);
    try {
      const nextSpec = validateLoopSpec({
        ...entry.spec,
        metadata: {
          ...entry.spec.metadata,
          labels: {
            ...(entry.spec.metadata.labels ?? {}),
            lifecycleStatus: input.nextStatus,
            lifecycleChangedAt: createdAt,
            lifecycleApprovalReceiptId: approval.id
          }
        }
      });
      await writeRegisteredLoopSpec(projectRoot, entry.path, nextSpec);
      const resultSnapshot = await captureGraphSnapshot({
        projectRoot,
        reason: `After setting ${input.loopId} ${input.nextStatus}`,
        createdBy: input.initiatedBy,
        transactionId,
        now,
        store
      });
      transaction = graphTransactionSchema.parse({
        ...transaction,
        status: "committed",
        resultSnapshotId: resultSnapshot.id,
        resultGraphHash: resultSnapshot.graphHash,
        operationReceipts: [{
          changeId: `lifecycle:${input.loopId}:${input.nextStatus}`,
          operation: "update",
          department: entry.department,
          targetLoopIds: [input.loopId],
          resultLoopIds: [input.loopId],
          retiredLoopIds: [],
          specHashes: { [input.loopId]: loopSpecHash(nextSpec) }
        }],
        committedAt: createdAt
      });
      await store.saveTransaction(transaction);
      return { transaction, status: input.nextStatus };
    } catch (error) {
      await restoreGraphSnapshot({ projectRoot, snapshot: baseSnapshot, restoredBy: input.initiatedBy });
      transaction = graphTransactionSchema.parse({
        ...transaction,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      await store.saveTransaction(transaction);
      throw error;
    }
  });
}

export async function rollbackGraphTransaction(
  input: RollbackGraphTransactionInput,
  options: { store?: FileSemanticGraphStore } = {}
): Promise<{ original: GraphTransaction; rollback: GraphTransaction }> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  return store.withTransactionLock(async () => {
    const original = await requireTransaction(input.transactionId, store);
    if (original.status === "rolled_back" && original.rollbackTransactionId) {
      const existing = await requireTransaction(original.rollbackTransactionId, store);
      return { original, rollback: existing };
    }
    if (original.status !== "committed") {
      throw new Error(`Only a committed graph transaction can be rolled back (status=${original.status})`);
    }
    const approval = await requireApproval(input.approvalReceiptId, store);
    const state = await readWorkspaceGraphState(projectRoot);
    if (
      approval.subjectType !== "rollback" ||
      approval.transactionId !== original.id ||
      approval.decision !== "approved" ||
      approval.baseGraphHash !== state.graphHash
    ) {
      throw new Error("Rollback approval is not bound to this transaction and current graph");
    }
    if (original.resultGraphHash !== state.graphHash) {
      throw new Error(
        `Cannot rollback ${original.id}: graph advanced from ${original.resultGraphHash} to ${state.graphHash}`
      );
    }
    const baseSnapshot = await store.getSnapshot(original.baseSnapshotId);
    if (!baseSnapshot) throw new Error(`Base graph snapshot not found: ${original.baseSnapshotId}`);
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const rollbackId = `graph_transaction_${contentHash({
      kind: "rollback",
      originalTransactionId: original.id,
      approvalReceiptId: approval.id,
      createdAt
    })}`;
    const beforeRollback = await captureGraphSnapshot({
      projectRoot,
      reason: `Before rolling back ${original.id}`,
      createdBy: input.initiatedBy,
      transactionId: rollbackId,
      now,
      store
    });
    await restoreGraphSnapshot({
      projectRoot,
      snapshot: baseSnapshot,
      restoredBy: input.initiatedBy
    });
    const resultSnapshot = await captureGraphSnapshot({
      projectRoot,
      reason: `After rolling back ${original.id}`,
      createdBy: input.initiatedBy,
      transactionId: rollbackId,
      now,
      store
    });
    if (resultSnapshot.graphHash !== original.baseGraphHash) {
      await restoreGraphSnapshot({
        projectRoot,
        snapshot: beforeRollback,
        restoredBy: input.initiatedBy
      });
      throw new Error(
        `Rollback verification failed: expected ${original.baseGraphHash}, restored ${resultSnapshot.graphHash}`
      );
    }
    const rollback = graphTransactionSchema.parse({
      schemaVersion: GRAPH_TRANSACTION_SCHEMA_VERSION,
      id: rollbackId,
      projectRootId: state.workspace.projectRootId,
      kind: "rollback",
      status: "committed",
      changeSetId: original.changeSetId,
      approvalReceiptId: approval.id,
      initiatedBy: required(input.initiatedBy, "initiatedBy"),
      baseSnapshotId: beforeRollback.id,
      resultSnapshotId: resultSnapshot.id,
      baseGraphHash: beforeRollback.graphHash,
      resultGraphHash: resultSnapshot.graphHash,
      operationReceipts: original.operationReceipts.map((operation) => ({
        ...operation,
        targetLoopIds: operation.resultLoopIds,
        resultLoopIds: operation.targetLoopIds,
        retiredLoopIds: operation.resultLoopIds.filter((id) => !operation.targetLoopIds.includes(id))
      })),
      rollbackOfTransactionId: original.id,
      createdAt,
      committedAt: createdAt
    });
    await store.saveTransaction(rollback);
    const rolledBackOriginal = graphTransactionSchema.parse({
      ...original,
      status: "rolled_back",
      rollbackTransactionId: rollback.id,
      rolledBackAt: createdAt
    });
    await store.saveTransaction(rolledBackOriginal);
    if (original.changeSetId) {
      const changeSet = await getGraphChangeSet(original.changeSetId, projectRoot);
      if (changeSet) {
        await saveGraphChangeSet({
          ...changeSet,
          status: "rolled_back",
          rolledBackAt: createdAt,
          rolledBackBy: input.initiatedBy,
          updatedAt: createdAt
        }, projectRoot);
      }
    }
    for (const promotion of await store.listPromotions()) {
      if (promotion.transactionId !== original.id || promotion.status === "rolled_back") continue;
      await store.savePromotion(loopPromotionReceiptSchema.parse({
        ...promotion,
        status: "rolled_back",
        rolledBackAt: createdAt
      }));
    }
    return { original: rolledBackOriginal, rollback };
  });
}

export async function restoreGraphSnapshot(input: {
  projectRoot?: string;
  snapshot: GraphSnapshot;
  restoredBy: string;
}): Promise<void> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const targetIds = new Set(input.snapshot.entries.map((entry) => entry.id));

  for (const entry of workspace.registeredSpecs) {
    if (targetIds.has(entry.id)) continue;
    await removeGeneratedAssets(projectRoot, entry);
  }

  for (const entry of input.snapshot.entries) {
    if (!entry.archivedAssetsPath || !entry.assetRoot) continue;
    const archive = path.resolve(loopgraphRoot, entry.archivedAssetsPath);
    const target = path.resolve(projectRoot, entry.assetRoot);
    assertWithin(loopgraphRoot, archive, "snapshot archive");
    assertWithin(loopgraphRoot, target, "snapshot restore target");
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await cp(archive, target, { recursive: true, force: false, errorOnExist: true });
  }

  await writeLoopgraphWorkspace({
    ...workspace,
    registeredSpecs: input.snapshot.entries.map(snapshotEntryToRegistry),
    updatedAt: new Date().toISOString()
  }, projectRoot);
  const restored = await readWorkspaceGraphState(projectRoot);
  if (restored.graphHash !== input.snapshot.graphHash) {
    throw new Error(
      `Restored graph hash ${restored.graphHash} does not match snapshot ${input.snapshot.graphHash}`
    );
  }
}

async function materializeChangeResults(input: {
  projectRoot: string;
  change: GraphChange;
  designRunId?: string;
  acceptedProposalIds: string[];
  initiatedBy: string;
  now: Date;
}): Promise<string[]> {
  if (!input.designRunId) {
    throw new Error(`Graph operation ${input.change.id} requires a designRunId`);
  }
  if (input.acceptedProposalIds.length === 0) {
    throw new Error(`Graph operation ${input.change.id} requires accepted proposal IDs`);
  }
  const result = await materializeAcceptedLoopDesignProposals({
    projectRoot: input.projectRoot,
    designRunId: input.designRunId,
    acceptedProposalIds: input.acceptedProposalIds,
    acceptedBy: input.initiatedBy,
    overwriteExisting: input.change.operation !== "add",
    allowedExistingLoopIds: input.change.targetLoopIds,
    now: input.now
  });
  if (!result.valid) {
    throw new Error(`Graph operation ${input.change.id} failed materialization: ${result.errors.join("; ")}`);
  }
  return unique(result.materializedLoops.map((loop) => loop.loopId));
}

function proposalIdsForChange(
  input: ApplyGraphChangeSetInput,
  change: GraphChange,
  changeCount: number
): string[] {
  const explicit = input.proposalIdsByChangeId?.[change.id];
  if (explicit) return unique(explicit);
  if (changeCount === 1) return unique(input.acceptedProposalIds ?? []);
  throw new Error(`proposalIdsByChangeId.${change.id} is required for a multi-operation change set`);
}

function validateOperationCardinality(change: GraphChange, resultLoopIds: string[]) {
  if (change.operation === "add") {
    if (change.targetLoopIds.length > 0) throw new Error(`Add operation ${change.id} cannot target existing loops`);
    assertCount(change, resultLoopIds, change.proposedLoopCount);
    return;
  }
  if (change.operation === "update") {
    if (change.targetLoopIds.length !== 1) throw new Error(`Update operation ${change.id} must target exactly one loop`);
    assertCount(change, resultLoopIds, change.proposedLoopCount);
    return;
  }
  if (change.operation === "split") {
    if (change.targetLoopIds.length !== 1) throw new Error(`Split operation ${change.id} must target exactly one loop`);
    if (change.proposedLoopCount < 2) throw new Error(`Split operation ${change.id} must propose at least two loops`);
    assertCount(change, resultLoopIds, change.proposedLoopCount);
    return;
  }
  if (change.operation === "merge") {
    if (change.targetLoopIds.length < 2) throw new Error(`Merge operation ${change.id} must target at least two loops`);
    if (change.proposedLoopCount !== 1) throw new Error(`Merge operation ${change.id} must produce exactly one loop`);
    assertCount(change, resultLoopIds, 1);
    return;
  }
  if (change.operation === "retire") {
    if (change.targetLoopIds.length === 0) throw new Error(`Retire operation ${change.id} must target a loop`);
    if (change.proposedLoopCount !== 0 || resultLoopIds.length !== 0) {
      throw new Error(`Retire operation ${change.id} cannot produce replacement loops`);
    }
  }
}

function assertCount(change: GraphChange, resultLoopIds: string[], expected: number) {
  if (resultLoopIds.length !== expected) {
    throw new Error(
      `${change.operation} operation ${change.id} expected ${expected} result loop(s), received ${resultLoopIds.length}`
    );
  }
}

function retiredLoopsForOperation(change: GraphChange, resultLoopIds: string[]) {
  if (change.operation === "add") return [];
  if (change.operation === "retire") return [...change.targetLoopIds];
  if (change.operation === "update" || change.operation === "split" || change.operation === "merge") {
    return change.targetLoopIds.filter((loopId) => !resultLoopIds.includes(loopId));
  }
  return [];
}

async function retireRegisteredLoops(projectRoot: string, loopIds: string[]) {
  if (loopIds.length === 0) return;
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const target = new Set(loopIds);
  const missing = loopIds.filter((loopId) => !workspace.registeredSpecs.some((entry) => entry.id === loopId));
  if (missing.length > 0) throw new Error(`Cannot retire unregistered loop(s): ${missing.join(", ")}`);
  for (const entry of workspace.registeredSpecs) {
    if (target.has(entry.id)) await removeGeneratedAssets(projectRoot, entry);
  }
  await writeLoopgraphWorkspace({
    ...workspace,
    registeredSpecs: workspace.registeredSpecs.filter((entry) => !target.has(entry.id)),
    updatedAt: new Date().toISOString()
  }, projectRoot);
}

async function removeGeneratedAssets(projectRoot: string, entry: RegisteredLoopSpec) {
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const generatedRoot = path.join(loopgraphRoot, "generated", "hermes");
  const registeredPath = path.isAbsolute(entry.path) ? path.resolve(entry.path) : path.resolve(projectRoot, entry.path);
  const assetRoot = isSpecFilePath(registeredPath) ? path.dirname(registeredPath) : registeredPath;
  if (!isWithin(generatedRoot, assetRoot)) return;
  await rm(assetRoot, { recursive: true, force: true });
}

async function writeRegisteredLoopSpec(projectRoot: string, registeredPath: string, spec: LoopSpec) {
  const absolute = path.isAbsolute(registeredPath)
    ? path.resolve(registeredPath)
    : path.resolve(projectRoot, registeredPath);
  const filePath = isSpecFilePath(absolute) ? absolute : path.join(absolute, "loopgraph.yaml");
  assertWithin(projectRoot, filePath, "registered LoopSpec");
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${YAML.stringify(spec)}\n`, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function validateChangeApproval(
  changeSet: NonNullable<Awaited<ReturnType<typeof getGraphChangeSet>>>,
  approval: GraphChangeApprovalReceipt
) {
  if (
    approval.subjectType !== "graph_change" ||
    approval.changeSetId !== changeSet.id ||
    approval.changeSetHash !== graphChangeSetHash(changeSet) ||
    approval.baseGraphHash !== changeSet.baseGraphHash ||
    approval.decision !== "approved"
  ) {
    throw new Error("Graph approval receipt does not match the current change-set content");
  }
  const requiredChanges = changeSet.changes
    .filter((change) => change.requiresExplicitApproval)
    .map((change) => change.id);
  if (requiredChanges.some((id) => !approval.approvedChangeIds.includes(id))) {
    throw new Error("Graph approval receipt does not approve every governed operation");
  }
}

function assertPromotionTransition(
  previousMode: RoutingActivationMode | undefined,
  nextMode: RoutingActivationMode
) {
  if (!previousMode) throw new Error("Loop has no current routing activation mode");
  const allowed: Record<RoutingActivationMode, RoutingActivationMode[]> = {
    simulate: ["shadow"],
    shadow: ["recommend"],
    recommend: ["execute_with_approval"],
    execute_with_approval: ["autonomous_low_risk"],
    autonomous_low_risk: []
  };
  if (!allowed[previousMode].includes(nextMode)) {
    throw new Error(`Invalid promotion transition: ${previousMode} -> ${nextMode}`);
  }
}

async function requireChangeSet(changeSetId: string, projectRoot: string) {
  const changeSet = await getGraphChangeSet(changeSetId, projectRoot);
  if (!changeSet) throw new Error(`Graph change set not found: ${changeSetId}`);
  return changeSet;
}

async function requireApproval(receiptId: string, store: FileSemanticGraphStore) {
  const receipt = await store.getApproval(receiptId);
  if (!receipt) throw new Error(`Graph approval receipt not found: ${receiptId}`);
  return receipt;
}

async function requireTransaction(transactionId: string, store: FileSemanticGraphStore) {
  const transaction = await store.getTransaction(transactionId);
  if (!transaction) throw new Error(`Graph transaction not found: ${transactionId}`);
  return transaction;
}

function assertKnownChangeIds(changes: GraphChange[], approvedChangeIds: string[]) {
  const known = new Set(changes.map((change) => change.id));
  const unknown = approvedChangeIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`Unknown graph change ID(s): ${unknown.join(", ")}`);
}

function snapshotEntryToRegistry(entry: GraphSnapshot["entries"][number]): RegisteredLoopSpec {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    ...(entry.templateId ? { templateId: entry.templateId } : {}),
    department: entry.department,
    addedAt: entry.addedAt
  };
}

function isSpecFilePath(value: string) {
  return value.endsWith(".yaml") || value.endsWith(".yml") || value.endsWith(".json");
}

function isWithin(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertWithin(parent: string, child: string, label: string) {
  if (!isWithin(parent, child)) throw new Error(`${label} escapes its allowed root`);
}

async function pathExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function safeFileName(value: string) {
  return encodeURIComponent(value);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}
