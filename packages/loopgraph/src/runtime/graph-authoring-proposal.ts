import {
  contentHash,
  type GraphEditorTransaction,
  type SemanticTopology,
  type TopologyNode
} from "../core";
import type { GraphEditorProposalIntent } from "./loop-opportunity-engine";

export function buildGraphEditorProposalIntents(input: {
  transaction: GraphEditorTransaction;
  topology: SemanticTopology;
}): GraphEditorProposalIntent[] {
  const nodes = new Map(input.topology.nodes.map((node) => [node.id, node]));
  const intents: GraphEditorProposalIntent[] = [];
  input.transaction.operations.forEach((operation, index) => {
    if (operation.kind === "move_node") return;
    const operationKey = `operation_${contentHash({
      transactionId: input.transaction.id,
      index,
      operation
    })}`;
    const common = {
      transactionId: input.transaction.id,
      operationKey,
      workspaceId: input.transaction.workspaceId,
      companyId: input.transaction.companyId,
      actorId: input.transaction.actorId,
      createdAt: input.transaction.createdAt
    };
    if (operation.kind === "propose_node") {
      if (operation.nodeType !== "workflow_loop") {
        throw new Error(
          "Department nodes are derived from their workflow loops. Propose a workflow loop for the department instead."
        );
      }
      intents.push({
        ...common,
        department: operation.departmentId,
        kind: "create_loop",
        problemType: `graph_editor_${slug(operation.label)}_coverage`,
        title: `Design ${operation.label}`,
        summary: operation.purpose,
        targetLoopIds: []
      });
      return;
    }

    const source = requireNode(nodes, operation.sourceId);
    const target = requireNode(nodes, operation.targetId);
    const workflow = workflowForRelation(operation.relation, source, target);
    if (!workflow.loopId || !workflow.department) {
      throw new Error(
        `Workflow node ${workflow.label} is missing its loop or department identity`
      );
    }
    intents.push({
      ...common,
      department: operation.relation === "department_contains_loop"
        ? source.department ?? workflow.department
        : workflow.department,
      kind: "improve_loop",
      problemType: `graph_relationship_${operation.relation}`,
      title: `Review ${workflow.label} topology`,
      summary: `${operation.reason} Proposed relationship: ${source.label} → ${target.label} (${operation.relation}).`,
      targetLoopIds: [workflow.loopId]
    });
  });
  return intents;
}

function requireNode(
  nodes: Map<string, TopologyNode>,
  nodeId: string
): TopologyNode {
  const node = nodes.get(nodeId);
  if (!node) throw new Error(`Graph proposal references an unknown node: ${nodeId}`);
  return node;
}

function workflowForRelation(
  relation: "brain_routes_to" | "department_contains_loop" | "learning_returns_to",
  source: TopologyNode,
  target: TopologyNode
): TopologyNode {
  if (relation === "brain_routes_to") {
    if (source.type !== "company" || !isWorkflow(target)) {
      throw new Error("Hermes routes-to proposals must connect Hermes Brain to a workflow loop");
    }
    return target;
  }
  if (relation === "department_contains_loop") {
    if (source.type !== "department_loop" || !isWorkflow(target)) {
      throw new Error("Department ownership proposals must connect a department to a workflow loop");
    }
    return target;
  }
  if (!isWorkflow(source)) {
    throw new Error("Evidence-return proposals must start from a workflow loop");
  }
  return source;
}

function isWorkflow(node: TopologyNode): boolean {
  return node.type === "workflow_loop" || node.type === "task_loop";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "new_loop";
}
