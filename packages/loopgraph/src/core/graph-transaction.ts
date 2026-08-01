import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { loopSpecSchema } from "./loop-spec";
import { graphChangeOperationSchema } from "./loop-opportunity";
import { routingActivationModeSchema } from "./routing";

export const GRAPH_SNAPSHOT_SCHEMA_VERSION = "graph-snapshot/v1alpha1" as const;
export const GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION = "graph-change-approval-receipt/v1alpha1" as const;
export const GRAPH_TRANSACTION_SCHEMA_VERSION = "graph-transaction/v1alpha1" as const;
export const LOOP_PROMOTION_RECEIPT_SCHEMA_VERSION = "loop-promotion-receipt/v1alpha1" as const;

export const graphSnapshotEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  templateId: z.string().min(1).optional(),
  department: DepartmentTypeSchema,
  addedAt: z.string().datetime(),
  specHash: z.string().min(1),
  versionHash: z.string().min(1).optional(),
  spec: loopSpecSchema,
  fixtures: z.record(z.string(), z.unknown()).default({}),
  archivedAssetsPath: z.string().min(1).optional(),
  assetRoot: z.string().min(1).optional(),
  registeredPathKind: z.enum(["file", "directory"]).optional(),
  specRelativePath: z.string().min(1).optional()
});

export const graphSnapshotSchema = z.object({
  schemaVersion: z.literal(GRAPH_SNAPSHOT_SCHEMA_VERSION).default(GRAPH_SNAPSHOT_SCHEMA_VERSION),
  id: z.string().min(1),
  projectRootId: z.string().min(1),
  graphHash: z.string().min(1),
  sequence: z.number().int().min(0),
  reason: z.string().min(1),
  transactionId: z.string().min(1).optional(),
  entries: z.array(graphSnapshotEntrySchema).default([]),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1)
});

export const graphChangeApprovalReceiptSchema = z.object({
  schemaVersion: z.literal(GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION)
    .default(GRAPH_CHANGE_APPROVAL_RECEIPT_SCHEMA_VERSION),
  id: z.string().min(1),
  projectRootId: z.string().min(1),
  subjectType: z.enum(["graph_change", "promotion", "lifecycle", "rollback"]).default("graph_change"),
  changeSetId: z.string().min(1).optional(),
  changeSetHash: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  transactionId: z.string().min(1).optional(),
  promotionRehearsalId: z.string().min(1).optional(),
  nextLifecycleStatus: z.enum(["active", "paused"]).optional(),
  baseGraphHash: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  approvedChangeIds: z.array(z.string().min(1)).default([]),
  actorId: z.string().min(1),
  actorRole: z.string().min(1),
  policyVersion: z.string().min(1),
  reason: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  decidedAt: z.string().datetime()
});

export const graphOperationReceiptSchema = z.object({
  changeId: z.string().min(1),
  operation: graphChangeOperationSchema,
  department: DepartmentTypeSchema,
  targetLoopIds: z.array(z.string().min(1)).default([]),
  resultLoopIds: z.array(z.string().min(1)).default([]),
  retiredLoopIds: z.array(z.string().min(1)).default([]),
  specHashes: z.record(z.string(), z.string()).default({})
});

export const graphTransactionSchema = z.object({
  schemaVersion: z.literal(GRAPH_TRANSACTION_SCHEMA_VERSION).default(GRAPH_TRANSACTION_SCHEMA_VERSION),
  id: z.string().min(1),
  projectRootId: z.string().min(1),
  kind: z.enum(["change_set", "promotion", "lifecycle", "rollback"]),
  status: z.enum(["prepared", "committed", "failed", "rolled_back"]),
  changeSetId: z.string().min(1).optional(),
  approvalReceiptId: z.string().min(1),
  initiatedBy: z.string().min(1),
  baseSnapshotId: z.string().min(1),
  resultSnapshotId: z.string().min(1).optional(),
  baseGraphHash: z.string().min(1),
  resultGraphHash: z.string().min(1).optional(),
  operationReceipts: z.array(graphOperationReceiptSchema).default([]),
  rollbackOfTransactionId: z.string().min(1).optional(),
  rollbackTransactionId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  committedAt: z.string().datetime().optional(),
  rolledBackAt: z.string().datetime().optional()
});

export const loopPromotionReceiptSchema = z.object({
  schemaVersion: z.literal(LOOP_PROMOTION_RECEIPT_SCHEMA_VERSION).default(LOOP_PROMOTION_RECEIPT_SCHEMA_VERSION),
  id: z.string().min(1),
  projectRootId: z.string().min(1),
  loopId: z.string().min(1),
  transactionId: z.string().min(1),
  approvalReceiptId: z.string().min(1),
  rehearsalReportId: z.string().min(1),
  previousMode: routingActivationModeSchema,
  nextMode: routingActivationModeSchema,
  previousSpecHash: z.string().min(1),
  nextSpecHash: z.string().min(1),
  gateEvidenceRefs: z.array(z.string().min(1)).min(1),
  status: z.enum(["applied", "rolled_back"]),
  promotedBy: z.string().min(1),
  promotedAt: z.string().datetime(),
  rolledBackAt: z.string().datetime().optional()
});

export type GraphSnapshotEntry = z.infer<typeof graphSnapshotEntrySchema>;
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;
export type GraphChangeApprovalReceipt = z.infer<typeof graphChangeApprovalReceiptSchema>;
export type GraphOperationReceipt = z.infer<typeof graphOperationReceiptSchema>;
export type GraphTransaction = z.infer<typeof graphTransactionSchema>;
export type LoopPromotionReceipt = z.infer<typeof loopPromotionReceiptSchema>;
