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

export type LoopTemplate = {
  id: string;
  department: DepartmentKey;
  loopType: string;
  name: string;
  description: string;
  goal?: string;
  businessOutcome?: string;
  primaryMetric?: string;
  secondaryMetrics?: string[];
  observes?: string[];
  requiredDataSources?: string[];
  routine?: string[];
  verification?: string[];
  escalation?: string[];
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
