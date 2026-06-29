import type { LoopSpec } from "./loop-spec";
import type { EscalationCase } from "./escalation";
import type { LoopRunTrace } from "./trace";

export type GraphNode = {
  id: string;
  kind: string;
  label: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "observes" | "calls" | "verifies_with" | "requires_approval" | "escalates_to" | "writes_trace_to" | "reports_to" | "learns_from";
  semantic: boolean;
};

export type DerivedGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function buildGraphFromSpecs(input: {
  specs: LoopSpec[];
  cases?: EscalationCase[];
  traces?: LoopRunTrace[];
}): DerivedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const spec of input.specs) {
    nodes.push({
      id: `loop:${spec.metadata.id}`,
      kind: "loop",
      label: spec.metadata.name,
      subtitle: spec.metadata.version,
      metadata: { department: spec.topology?.department }
    });

    for (const source of spec.context.sources) {
      const nodeId = `source:${spec.metadata.id}:${source.id}`;
      nodes.push({ id: nodeId, kind: "signal_source", label: source.title, subtitle: source.type });
      edges.push({
        id: `${nodeId}->loop:${spec.metadata.id}`,
        source: nodeId,
        target: `loop:${spec.metadata.id}`,
        kind: "observes",
        semantic: true
      });
    }

    for (const verifier of spec.verification) {
      const nodeId = `verifier:${spec.metadata.id}:${verifier.id}`;
      nodes.push({ id: nodeId, kind: "verifier", label: verifier.id, subtitle: verifier.type });
      edges.push({
        id: `${nodeId}->loop:${spec.metadata.id}`,
        source: nodeId,
        target: `loop:${spec.metadata.id}`,
        kind: "verifies_with",
        semantic: true
      });
    }
  }

  for (const trace of input.traces ?? []) {
    nodes.push({ id: `trace:${trace.id}`, kind: "trace", label: trace.id, subtitle: trace.status });
    edges.push({
      id: `loop:${trace.loopId}->trace:${trace.id}`,
      source: `loop:${trace.loopId}`,
      target: `trace:${trace.id}`,
      kind: "writes_trace_to",
      semantic: true
    });
  }

  for (const caseItem of input.cases ?? []) {
    nodes.push({ id: `case:${caseItem.id}`, kind: "escalation_case", label: caseItem.summary, subtitle: caseItem.severity });
    edges.push({
      id: `loop:${caseItem.sourceLoopId}->case:${caseItem.id}`,
      source: `loop:${caseItem.sourceLoopId}`,
      target: `case:${caseItem.id}`,
      kind: "escalates_to",
      semantic: true
    });
    edges.push({
      id: `case:${caseItem.id}->management`,
      source: `case:${caseItem.id}`,
      target: "management:escalation",
      kind: "reports_to",
      semantic: false
    });
  }

  nodes.push({ id: "management:escalation", kind: "management_loop", label: "Management Escalation Loop" });

  return { nodes, edges };
}
