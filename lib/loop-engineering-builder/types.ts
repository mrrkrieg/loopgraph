import type { LoopSpec } from "./loop-spec-schema";
import type { PrebuiltLoopDefinition } from "loopgraph/core";

export type DepartmentKey =
  | "marketing"
  | "sales"
  | "product"
  | "engineering"
  | "customer_success"
  | "operations_finance"
  | "hr"
  | "legal_security"
  | "management"
  | "custom";

export type QuestionSection =
  | "Goal"
  | "Work item"
  | "Current workflow"
  | "Signals"
  | "Data sources"
  | "Tools/actions"
  | "Verification"
  | "Escalation"
  | "Human ownership"
  | "Autonomy level"
  | "Trace schema"
  | "Measurement"
  | "Management review";

export type AnswerType = "text" | "textarea" | "number" | "select" | "multi_select";

export type QuestionDefinition = {
  section: QuestionSection;
  questionKey: string;
  question: string;
  helpText?: string;
  required: boolean;
  answerType: AnswerType;
  options?: string[];
  sortOrder: number;
};

export type LoopTemplateRuntimeLevel = "runnable" | "spec_stub" | "catalog";

export type LoopTemplate = {
  id: string;
  department: DepartmentKey;
  loopType: string;
  name: string;
  description: string;
  runtimeLevel: LoopTemplateRuntimeLevel;
  goal?: string;
  businessOutcome?: string;
  primaryMetric?: string;
  secondaryMetrics?: string[];
  observes?: string[];
  requiredDataSources?: string[];
  routine?: string[];
  verification?: string[];
  escalation?: string[];
  connections?: Array<{
    kind: "data_source" | "owner" | "metric" | "review" | "improvement" | "rollup";
    target: string;
    label?: string;
  }>;
  defaultMetrics?: string[];
  defaultOwners?: string[];
  defaultHiddenLabor?: Partial<HiddenLaborMetrics>;
  examplePath?: string;
  fixturePaths?: string[];
  /** Hermes-native claim, context, connection, exclusion, and fan-out contract. */
  routingDefinition?: PrebuiltLoopDefinition;
};

export type DepartmentTemplate = {
  key: DepartmentKey;
  name: string;
  description: string;
  commonLoops: LoopTemplate[];
  requiredQuestions: QuestionDefinition[];
  commonDataSources: string[];
  commonTools: string[];
  commonMetrics: string[];
  verificationDefaults: string[];
  escalationDefaults: string[];
  failureModes: string[];
  managementReviewQuestions: string[];
};

export type LoopRecord = {
  id: string;
  organizationId: string;
  templateId: string;
  name: string;
  department: DepartmentKey;
  loopType: string;
  status: string;
  autonomyLevel: string;
  owner: string;
  goal: string;
  targetMetric: string;
  businessOutcome: string;
  cadence: string;
  specGenerated: boolean;
  implementationGenerated: boolean;
  lastRunAt?: string;
  openReviews: number;
  improvementItems: number;
  source?: "demo_catalog" | "local_spec" | "supabase";
  sourcePath?: string;
  runtimeLevel?: LoopTemplateRuntimeLevel;
};

export type GeneratedArtifact = {
  artifactType:
    | "loop_spec"
    | "supabase_schema"
    | "vercel_plan"
    | "agent_prompt"
    | "verification_rubric"
    | "cron_plan"
    | "ui_plan"
    | "implementation_plan"
    | "management_summary";
  title: string;
  content: string;
  jsonContent?: unknown;
  version: number;
};

export type LoopGraphNodeKind =
  | "organization"
  | "management_loop"
  | "department"
  | "loop"
  | "data_source"
  | "human_owner"
  | "review"
  | "metric"
  | "improvement"
  | "escalation_case"
  | "trace";

export type LoopGraphEdgeKind =
  | "observes"
  | "data_flow"
  | "escalates_to"
  | "owned_by"
  | "measured_by"
  | "rolls_up_to"
  | "improves"
  | "writes_trace_to"
  | "reports_to";

export type LoopGraphNode = {
  id: string;
  kind: LoopGraphNodeKind;
  label: string;
  subtitle?: string;
  department?: DepartmentKey;
  status?: string;
  health?: number;
  count?: number;
  metadata?: Record<string, unknown>;
};

export type LoopGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: LoopGraphEdgeKind;
  label?: string;
  metadata?: Record<string, unknown>;
};

export type LoopGraphViewState = {
  selectedNodeId?: string;
  mode: "topology" | "reviews" | "metrics" | "improvements";
  filters: {
    department?: DepartmentKey | "all";
    status?: string | "all";
    attentionOnly?: boolean;
  };
  inspectorTab: "overview" | "health" | "runs" | "signals" | "settings";
};

export type HiddenLaborMetrics = {
  baselineMinutes: number;
  loopExecutionMinutes: number;
  reviewMinutes: number;
  reworkMinutes: number;
  botsittingMinutes: number;
  escalationMinutes: number;
  governanceMinutes: number;
  relationshipRedeploymentMinutes: number;
  qualityScore?: number;
  businessOutcomeNotes?: string;
};

export type LoopHealthSummary = {
  loopId: string;
  healthScore: number;
  status: string;
  openReviews: number;
  openImprovements: number;
  netTimeSavedMinutes: number;
  botsittingMinutes: number;
  relationshipRedeploymentMinutes: number;
  qualityScore?: number;
};

export type LoopGraph = {
  nodes: LoopGraphNode[];
  edges: LoopGraphEdge[];
  health: LoopHealthSummary[];
  view: LoopGraphViewState;
  sourceLabel?: string;
};

export type RegisteredLoopSpec = {
  id: string;
  name: string;
  path: string;
  templateId: string;
  department: DepartmentKey;
  addedAt: string;
};

export type LoopgraphWorkspaceRegistry = {
  version: 1;
  registeredSpecs: RegisteredLoopSpec[];
  demoCatalogEnabled: boolean;
};

export type LoopRequirement = {
  category:
    | "data"
    | "routine"
    | "tool"
    | "verification"
    | "escalation"
    | "trace"
    | "measurement"
    | "ui"
    | "cron"
    | "security"
    | "human_review";
  title: string;
  description: string;
  requirementType: "schema" | "route" | "prompt" | "rubric" | "policy" | "screen";
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "done";
};

export type LoopRun = {
  id: string;
  loopId: string;
  status: "running" | "completed" | "failed";
  triggerType: "manual" | "cron" | "event";
  startedAt: string;
  completedAt?: string;
  escalationRequired: boolean;
  humanReviewRequired: boolean;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  verificationResult: Record<string, unknown>;
  error?: string;
};

export type LoopRunStep = {
  id: string;
  loopRunId: string;
  stepName: string;
  stepType: string;
  status: "completed" | "failed" | "running";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  toolCalls: Array<Record<string, unknown>>;
  startedAt: string;
  completedAt?: string;
  error?: string;
};

export type HumanReview = {
  id: string;
  loopRunId: string;
  loopId: string;
  reviewer: string;
  status: "pending" | "approved" | "rejected" | "edited" | "escalated";
  reason: string;
  recommendation: string;
  reviewerDecision?: string;
  reviewerNotes?: string;
  hiddenLabor?: Partial<HiddenLaborMetrics>;
  createdAt: string;
  reviewedAt?: string;
};

export type ImprovementItem = {
  id: string;
  loopId: string;
  title: string;
  description: string;
  failureMode: string;
  recommendation: string;
  status: "open" | "in_progress" | "done";
  owner: string;
  createdAt: string;
  sourceRunId?: string;
};

export type WorkspaceData = {
  organization: {
    id: string;
    name: string;
  };
  profile: {
    id: string;
    email: string;
    fullName: string;
    role: string;
  };
  templates: DepartmentTemplate[];
  loops: LoopRecord[];
  loop: LoopRecord;
  answers: Record<string, string>;
  questions: Array<{
    section: string;
    questions: QuestionDefinition[];
  }>;
  progress: {
    totalRequired: number;
    answered: number;
    missing: number;
    percent: number;
  };
  spec: LoopSpec;
  artifacts: GeneratedArtifact[];
  runBundle: {
    run: LoopRun;
    steps: LoopRunStep[];
    review?: HumanReview;
  };
  improvements: ImprovementItem[];
  managementReview: {
    period: string;
    summary: string;
    risks: string[];
    decisions: string[];
    bottlenecks: string[];
    recommendations: string[];
  };
  metrics: Array<{
    name: string;
    value: string;
    note: string;
  }>;
  graph: LoopGraph;
};

export const questionSections: QuestionSection[] = [
  "Goal",
  "Work item",
  "Current workflow",
  "Signals",
  "Data sources",
  "Tools/actions",
  "Verification",
  "Escalation",
  "Human ownership",
  "Autonomy level",
  "Trace schema",
  "Measurement",
  "Management review"
];
