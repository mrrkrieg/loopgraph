import type { GeneratedArtifact, LoopRequirement, LoopRecord } from "./types";
import type { LoopSpec } from "./loop-spec-schema";
import { validateLoopSpec } from "./loop-spec-schema";
import type { AnswerMap } from "./question-engine";
import { getDepartmentTemplate, getTemplateById } from "./templates";

const splitAnswer = (value?: string) =>
  (value ?? "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function generateLoopSpec(loop: LoopRecord, answers: AnswerMap): LoopSpec {
  const template = getTemplateById(loop.templateId);
  const department = getDepartmentTemplate(loop.department);
  const dataSources = splitAnswer(answers.data_sources || template?.requiredDataSources?.join(", "));
  const signals = splitAnswer(answers.signals || template?.observes?.join(", "));
  const routine = template?.routine ?? [
    "Observe current state",
    "Compare state to goal",
    "Draft recommended action",
    "Verify output",
    "Escalate if judgment is required",
    "Record trace and learning"
  ];

  const spec: LoopSpec = {
    id: loop.id,
    name: loop.name,
    department: department?.name ?? loop.department,
    loopType: loop.loopType,
    goal: answers.goal || loop.goal,
    targetMetric: answers.target_metric || loop.targetMetric,
    businessOutcome: answers.business_outcome || loop.businessOutcome,
    workItem: answers.work_item || template?.name || loop.name,
    trigger: "Manual run in V1, cron or event trigger after integration",
    cadence: loop.cadence,
    inputs: signals.map((signal) => ({
      name: signal,
      source: "Configured data source or manual snapshot",
      required: true,
      description: `Signal observed by the loop: ${signal}`
    })),
    dataSources: dataSources.map((source) => ({
      name: source,
      type: inferSourceType(source),
      purpose: `Provide state for ${loop.name}`,
      required: true
    })),
    routine: routine.map((step, index) => ({
      stepName: step,
      stepType: index === 0 ? "observe" : index === routine.length - 1 ? "learn" : "execute",
      description: step,
      actor: index === 5 ? "human" : index === 0 ? "system" : "agent",
      toolRequired: department?.commonTools[index % Math.max(department.commonTools.length, 1)]
    })),
    verification: splitAnswer(answers.verification || template?.verification?.join("; ")).map((check, index) => ({
      name: `Verification ${index + 1}`,
      checkType: index % 3 === 0 ? "deterministic" : index % 3 === 1 ? "llm_judge" : "human_review",
      description: check,
      passCriteria: "The check is passed with evidence or the loop escalates to the human owner."
    })),
    escalation: splitAnswer(answers.escalation || template?.escalation?.join("; ")).map((condition, index) => ({
      condition,
      reason: "Human judgment, risk ownership, or approval is required.",
      ownerRole: answers.human_owner || "Department owner",
      severity: index === 0 ? "high" : "medium"
    })),
    humanOwner: answers.human_owner || loop.owner,
    autonomyLevel: answers.autonomy_level || loop.autonomyLevel,
    traceSchema: {
      run_id: "uuid",
      observed_signals: "json",
      selected_goal: "text",
      routine_steps: "json",
      tool_calls: "json",
      verification_result: "json",
      escalation_reason: "text",
      human_decision: "text",
      final_outcome: "json"
    },
    metrics: [
      {
        name: answers.target_metric || loop.targetMetric,
        type: "primary",
        target: "Improve from baseline without degrading quality",
        source: dataSources[0] ?? "manual"
      },
      ...((template?.secondaryMetrics ?? department?.commonMetrics ?? []).slice(0, 4).map((metric) => ({
        name: metric,
        type: "secondary",
        target: "Track weekly movement",
        source: dataSources[0] ?? "manual"
      })))
    ],
    measurementPlan: {
      baselineWorkVolume: "Count matching work items before loop launch.",
      baselineHumanTime: "Measure active human time before the loop.",
      loopHumanExecutionTime: "Measure remaining human execution time after loop assistance.",
      reviewTime: "Track minutes spent verifying or approving outputs.",
      reworkTime: "Track minutes spent correcting low-quality outputs.",
      botsittingTime: "Track context setup, reruns, cleanup, and manual transfer work.",
      escalationTime: "Track time spent on escalated cases.",
      qualityMetric: "Score output usefulness, accuracy, and downstream acceptance.",
      businessOutcomeMetric: answers.business_outcome || loop.businessOutcome,
      reviewCadence: "Weekly"
    },
    managementReviewOutput: {
      cadence: "Weekly",
      questions: department?.managementReviewQuestions ?? [
        "Is the loop improving the right metric?",
        "Where is human judgment still required?",
        "Which system change should be made next?"
      ],
      decisionsNeeded: [
        "Approve autonomy level changes",
        "Resolve escalations",
        "Prioritize improvement items",
        "Decide whether to scale, pause, or redesign the loop"
      ],
      rollupMetrics: [
        "run count",
        "failure rate",
        "review time",
        "rework time",
        "botsitting time",
        "escalation time",
        "business outcome movement"
      ]
    }
  };

  return validateLoopSpec(spec);
}

export function createLoopSpecArtifact(spec: LoopSpec): GeneratedArtifact {
  return {
    artifactType: "loop_spec",
    title: `${spec.name} Loop Spec`,
    content: JSON.stringify(spec, null, 2),
    jsonContent: spec,
    version: 1
  };
}

export function generateLoopRequirements(spec: LoopSpec): LoopRequirement[] {
  return [
    {
      category: "data",
      title: "Connect required state inputs",
      description: `Configure sources for ${spec.dataSources.map((source) => source.name).join(", ")}.`,
      requirementType: "schema",
      priority: "high",
      status: "open"
    },
    {
      category: "routine",
      title: "Implement loop routine",
      description: "Create an executable routine that observes, compares, acts, verifies, escalates, traces, and learns.",
      requirementType: "route",
      priority: "high",
      status: "open"
    },
    {
      category: "verification",
      title: "Implement verification rubric",
      description: "Use deterministic checks where possible, then model or human review for qualitative criteria.",
      requirementType: "rubric",
      priority: "high",
      status: "open"
    },
    {
      category: "human_review",
      title: "Track human review and escalation decisions",
      description: "Persist reviewer decision, notes, and downstream changes.",
      requirementType: "screen",
      priority: "medium",
      status: "open"
    },
    {
      category: "measurement",
      title: "Measure hidden labor and business value",
      description: "Track baseline time, loop-assisted time, review, rework, escalation, governance, botsitting, quality, and business outcome.",
      requirementType: "schema",
      priority: "high",
      status: "open"
    }
  ];
}

function inferSourceType(source: string) {
  const normalized = source.toLowerCase();
  if (normalized.includes("crm")) return "hubspot";
  if (normalized.includes("analytics")) return "analytics";
  if (normalized.includes("payment") || normalized.includes("subscription")) return "stripe";
  if (normalized.includes("github")) return "github";
  if (normalized.includes("linear")) return "linear";
  return "manual";
}
