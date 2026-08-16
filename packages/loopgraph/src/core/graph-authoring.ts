import { z } from "zod";

export const GRAPH_EDITOR_TRANSACTION_SCHEMA_VERSION = "graph-editor-transaction/v1alpha1" as const;

const graphLifecycleProposalSchema = z.object({
  kind: z.literal("propose_lifecycle"),
  mode: z.enum(["improve", "split", "merge", "retire"]),
  targetNodeIds: z.array(z.string().min(1).max(240)).min(1).max(10),
  reason: z.string().min(1).max(2000)
});

export const graphEditorOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move_node"), nodeId: z.string().min(1).max(240), x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000) }),
  z.object({ kind: z.literal("propose_node"), temporaryId: z.string().min(1).max(240), nodeType: z.enum(["department_loop", "workflow_loop"]), label: z.string().min(1).max(200), departmentId: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/), purpose: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("propose_edge"), sourceId: z.string().min(1).max(240), targetId: z.string().min(1).max(240), relation: z.enum(["brain_routes_to", "department_contains_loop", "learning_returns_to"]), reason: z.string().min(1).max(2000) }),
  graphLifecycleProposalSchema
]).superRefine((operation, context) => {
  if (operation.kind !== "propose_lifecycle") return;
  const uniqueTargets = new Set(operation.targetNodeIds);
  if (uniqueTargets.size !== operation.targetNodeIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Lifecycle proposals cannot repeat a target node",
      path: ["targetNodeIds"]
    });
  }
  if (operation.mode === "merge" && operation.targetNodeIds.length < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Merge proposals require at least two workflow loops",
      path: ["targetNodeIds"]
    });
  }
  if (operation.mode !== "merge" && operation.targetNodeIds.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${operation.mode} proposals require exactly one workflow loop`,
      path: ["targetNodeIds"]
    });
  }
});

export const graphEditorTransactionSchema = z.object({
  schemaVersion: z.literal(GRAPH_EDITOR_TRANSACTION_SCHEMA_VERSION).default(GRAPH_EDITOR_TRANSACTION_SCHEMA_VERSION),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  actorId: z.string().min(1),
  expectedTopologyHash: z.string().min(1),
  operations: z.array(graphEditorOperationSchema).min(1).max(200),
  status: z.enum(["layout_applied", "proposal_pending", "rejected"]),
  createdAt: z.string().datetime()
}).superRefine((transaction, context) => {
  const semantic = transaction.operations.some((operation) => operation.kind !== "move_node");
  if (semantic && transaction.status === "layout_applied") context.addIssue({ code: z.ZodIssueCode.custom, message: "Semantic operations must remain proposal_pending", path: ["status"] });
});

export type GraphEditorOperation = z.infer<typeof graphEditorOperationSchema>;
export type GraphEditorTransaction = z.infer<typeof graphEditorTransactionSchema>;
