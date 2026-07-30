import path from "node:path";
import { z } from "zod";
import { routingActivationModeSchema } from "../core";
import {
  applyGraphChangeSet,
  approveGraphChangeSet,
  approveGraphRollback,
  approveLoopLifecycleChange,
  approveLoopPromotion,
  promoteLoop,
  rollbackGraphTransaction,
  setLoopLifecycleStatus
} from "./semantic-graph-transactions";
import {
  runLoopPromotionRehearsal
} from "./promotion-rehearsal";
import { FileSemanticGraphStore } from "./semantic-graph-store";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOPGRAPH_SEMANTIC_GRAPH_TOOL_NAMES = [
  "loopgraph_graph_change_decide",
  "loopgraph_graph_change_apply",
  "loopgraph_graph_history_get",
  "loopgraph_promotion_rehearsal_run",
  "loopgraph_promotion_rehearsals_get",
  "loopgraph_loop_promotion_approve",
  "loopgraph_loop_promote",
  "loopgraph_loop_lifecycle_approve",
  "loopgraph_loop_lifecycle_set",
  "loopgraph_graph_rollback_approve",
  "loopgraph_graph_rollback"
] as const;

export type LoopgraphSemanticGraphToolName = (typeof LOOPGRAPH_SEMANTIC_GRAPH_TOOL_NAMES)[number];

const actorFields = {
  actorId: z.string().min(1),
  actorRole: z.string().min(1),
  policyVersion: z.string().min(1),
  reason: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([])
};

export const graphChangeDecideInputSchema = z.object({
  projectRoot: z.string().optional(),
  changeSetId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  approvedChangeIds: z.array(z.string().min(1)).default([]),
  ...actorFields
});

export const graphChangeApplyInputSchema = z.object({
  projectRoot: z.string().optional(),
  changeSetId: z.string().min(1),
  approvalReceiptId: z.string().min(1),
  designRunId: z.string().min(1).optional(),
  acceptedProposalIds: z.array(z.string().min(1)).default([]),
  proposalIdsByChangeId: z.record(z.string(), z.array(z.string().min(1))).default({}),
  initiatedBy: z.string().min(1)
});

export const graphHistoryGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  transactionId: z.string().min(1).optional(),
  snapshotId: z.string().min(1).optional(),
  approvalReceiptId: z.string().min(1).optional(),
  promotionReceiptId: z.string().min(1).optional(),
  rehearsalReportId: z.string().min(1).optional(),
  changeSetId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional()
}).default({});

export const promotionRehearsalRunInputSchema = z.object({
  projectRoot: z.string().optional(),
  loopId: z.string().min(1),
  targetMode: routingActivationModeSchema,
  thresholds: z.object({
    minPrecision: z.number().min(0).max(1).optional(),
    minRecall: z.number().min(0).max(1).optional(),
    maxFalseTriggerRate: z.number().min(0).max(1).optional(),
    maxMissedProblemRate: z.number().min(0).max(1).optional(),
    maxAbstentionRate: z.number().min(0).max(1).optional(),
    minDuplicateSuppressionRate: z.number().min(0).max(1).optional()
  }).optional(),
  generatedBy: z.string().min(1).optional(),
  validForSeconds: z.number().int().min(60).max(30 * 24 * 60 * 60).optional()
});

export const promotionRehearsalsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  reportId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional()
}).default({});

export const loopPromotionApproveInputSchema = z.object({
  projectRoot: z.string().optional(),
  loopId: z.string().min(1),
  nextMode: routingActivationModeSchema,
  rehearsalReportId: z.string().min(1),
  ...actorFields
});

export const loopPromoteInputSchema = z.object({
  projectRoot: z.string().optional(),
  loopId: z.string().min(1),
  nextMode: routingActivationModeSchema,
  approvalReceiptId: z.string().min(1),
  rehearsalReportId: z.string().min(1),
  gateEvidenceRefs: z.array(z.string().min(1)).default([]),
  initiatedBy: z.string().min(1)
});

export const loopLifecycleApproveInputSchema = z.object({
  projectRoot: z.string().optional(),
  loopId: z.string().min(1),
  nextStatus: z.enum(["active", "paused"]),
  ...actorFields
});

export const loopLifecycleSetInputSchema = z.object({
  projectRoot: z.string().optional(),
  loopId: z.string().min(1),
  nextStatus: z.enum(["active", "paused"]),
  approvalReceiptId: z.string().min(1),
  initiatedBy: z.string().min(1)
});

export const graphRollbackApproveInputSchema = z.object({
  projectRoot: z.string().optional(),
  transactionId: z.string().min(1),
  ...actorFields
});

export const graphRollbackInputSchema = z.object({
  projectRoot: z.string().optional(),
  transactionId: z.string().min(1),
  approvalReceiptId: z.string().min(1),
  initiatedBy: z.string().min(1)
});

export const loopgraphSemanticGraphToolDefinitions = [
  {
    name: "loopgraph_graph_change_decide",
    description: "Record an accountable, content-bound approval or rejection for a proposed semantic graph change.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_graph_change_apply",
    description: "Atomically apply an approved add, update, split, merge, or retire operation against the reviewed graph hash.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_graph_history_get",
    description: "Read graph snapshots, approvals, transactions, promotions, and rollback history.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_promotion_rehearsal_run",
    description: "Run and persist the exact simulation, routing, duplicate, ambiguity, overlap, regression, and policy checks required before one loop promotion.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_promotion_rehearsals_get",
    description: "Read durable content-bound promotion rehearsal reports by report or loop.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_loop_promotion_approve",
    description: "Approve one ordered loop activation-mode promotion using a passing rehearsal bound to the exact current graph.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_loop_promote",
    description: "Apply an approved promotion using the same passing rehearsal and a reversible graph transaction.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_loop_lifecycle_approve",
    description: "Approve pausing or resuming one registered loop against the exact current graph.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_loop_lifecycle_set",
    description: "Apply an approved pause or resume and update routing eligibility through a reversible transaction.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_graph_rollback_approve",
    description: "Approve rollback only when the current graph still equals the selected transaction result.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_graph_rollback",
    description: "Restore the exact pre-transaction graph snapshot using a rollback-specific approval receipt.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphSemanticGraphToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphSemanticGraphTool(
  name: LoopgraphSemanticGraphToolName,
  input: unknown,
  options: { projectRoot?: string; now?: Date } = {}
) {
  if (name === "loopgraph_graph_change_decide") {
    const parsed = graphChangeDecideInputSchema.parse(input);
    return approveGraphChangeSet({
      ...parsed,
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      approvedChangeIds: parsed.approvedChangeIds.length > 0 ? parsed.approvedChangeIds : undefined,
      now: options.now
    });
  }
  if (name === "loopgraph_graph_change_apply") {
    const parsed = graphChangeApplyInputSchema.parse(input);
    return applyGraphChangeSet({
      ...parsed,
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      acceptedProposalIds: parsed.acceptedProposalIds,
      proposalIdsByChangeId: parsed.proposalIdsByChangeId,
      now: options.now
    });
  }
  if (name === "loopgraph_graph_history_get") {
    const parsed = graphHistoryGetInputSchema.parse(input);
    const projectRoot = path.resolve(parsed.projectRoot ?? options.projectRoot ?? process.cwd());
    const store = new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
    if (parsed.transactionId) return { transaction: await store.getTransaction(parsed.transactionId) };
    if (parsed.snapshotId) return { snapshot: await store.getSnapshot(parsed.snapshotId) };
    if (parsed.approvalReceiptId) return { approval: await store.getApproval(parsed.approvalReceiptId) };
    if (parsed.promotionReceiptId) return { promotion: await store.getPromotion(parsed.promotionReceiptId) };
    if (parsed.rehearsalReportId) {
      return { rehearsal: await store.getPromotionRehearsal(parsed.rehearsalReportId) };
    }
    const [transactions, snapshots, approvals, promotions, rehearsals] = await Promise.all([
      store.listTransactions(),
      store.listSnapshots(),
      store.listApprovals(parsed.changeSetId),
      store.listPromotions(parsed.loopId),
      store.listPromotionRehearsals(parsed.loopId)
    ]);
    return { transactions, snapshots, approvals, promotions, rehearsals };
  }
  if (name === "loopgraph_promotion_rehearsal_run") {
    const parsed = promotionRehearsalRunInputSchema.parse(input);
    return {
      report: await runLoopPromotionRehearsal({
        ...parsed,
        projectRoot: parsed.projectRoot ?? options.projectRoot,
        now: options.now
      })
    };
  }
  if (name === "loopgraph_promotion_rehearsals_get") {
    const parsed = promotionRehearsalsGetInputSchema.parse(input);
    const projectRoot = path.resolve(parsed.projectRoot ?? options.projectRoot ?? process.cwd());
    const store = new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
    if (parsed.reportId) return { report: await store.getPromotionRehearsal(parsed.reportId) };
    return { reports: await store.listPromotionRehearsals(parsed.loopId) };
  }
  if (name === "loopgraph_loop_promotion_approve") {
    const parsed = loopPromotionApproveInputSchema.parse(input);
    return {
      receipt: await approveLoopPromotion({
        ...parsed,
        projectRoot: parsed.projectRoot ?? options.projectRoot,
        now: options.now
      })
    };
  }
  if (name === "loopgraph_loop_promote") {
    const parsed = loopPromoteInputSchema.parse(input);
    return promoteLoop({
      ...parsed,
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    });
  }
  if (name === "loopgraph_loop_lifecycle_approve") {
    const parsed = loopLifecycleApproveInputSchema.parse(input);
    return {
      receipt: await approveLoopLifecycleChange({
        ...parsed,
        projectRoot: parsed.projectRoot ?? options.projectRoot,
        now: options.now
      })
    };
  }
  if (name === "loopgraph_loop_lifecycle_set") {
    const parsed = loopLifecycleSetInputSchema.parse(input);
    return setLoopLifecycleStatus({
      ...parsed,
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    });
  }
  if (name === "loopgraph_graph_rollback_approve") {
    const parsed = graphRollbackApproveInputSchema.parse(input);
    return {
      receipt: await approveGraphRollback({
        ...parsed,
        projectRoot: parsed.projectRoot ?? options.projectRoot,
        now: options.now
      })
    };
  }
  if (name === "loopgraph_graph_rollback") {
    const parsed = graphRollbackInputSchema.parse(input);
    return rollbackGraphTransaction({
      ...parsed,
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    });
  }
  throw new Error(`Unknown semantic graph tool: ${String(name)}`);
}
