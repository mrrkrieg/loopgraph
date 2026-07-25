import type { SemanticTopology } from "@/lib/loopgraph-core/graph";

export type BrainNodeType =
  | "company_brain"
  | "management_loop"
  | "department_loop"
  | "workflow_loop"
  | "data"
  | "metric"
  | "review"
  | "improvement"
  | "trace";

export type BrainNodeStatus =
  | "ready"
  | "active"
  | "needs_attention"
  | "blocked"
  | "draft";

export interface BrainGraphNode {
  id: string;
  type: BrainNodeType;
  label: string;
  subtitle?: string;
  purpose?: string;
  loopId?: string;
  departmentId?: string;
  refId?: string;
  parentId?: string;
  status: BrainNodeStatus;
  health?: number;
  openReviews?: number;
  missingData?: number;
  undefinedMetrics?: number;
  radius: number;
  color: string;
  stroke: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  metadata?: Record<string, unknown>;
}

export type BrainEdgeType =
  | "brain_routes_to"
  | "management_calls_department"
  | "department_contains_loop"
  | "loop_observes_data"
  | "loop_updates_metric"
  | "loop_requires_review"
  | "loop_learns_from_trace";

export interface BrainGraphEdge {
  id: string;
  source: string;
  target: string;
  type: BrainEdgeType;
  label?: string;
  semantic: boolean;
  executable: boolean;
  width: number;
  color: string;
  opacity: number;
  dashed?: boolean;
}

export type BrainGraphDiagnostics = {
  sourceNodeCount: number;
  visibleNodeCount: number;
  hiddenNodeIds: string[];
  removedEdges: Array<{
    id: string;
    source: string;
    target: string;
    reason: "missing_source" | "missing_target" | "hidden_endpoint" | "unsupported_edge";
  }>;
  warnings: string[];
};

export type BrainGraph = {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  diagnostics: BrainGraphDiagnostics;
};

export type BrainGraphMode = "global" | "local";

export type BrainGraphStoryPreset =
  | "company_map"
  | "routing_signals"
  | "evidence_return"
  | "custom";

export type BrainGraphSettings = {
  includeData: boolean;
  includeMetrics: boolean;
  includeReviews: boolean;
  includeImprove: boolean;
};

export type BrainGraphAdapterInput = BrainGraphSettings & {
  includeCatalogLoops?: boolean;
  previewStory?: boolean;
  topology: SemanticTopology;
};
