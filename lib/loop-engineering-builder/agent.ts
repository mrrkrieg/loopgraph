import type { AnswerMap } from "./question-engine";
import {
  createDefaultAnswers,
  generateQuestions,
  hasEnoughAnswersForSpec,
  flattenQuestionGroups
} from "./question-engine";
import {
  getDepartmentTemplates,
  getTemplateById
} from "./templates";
import type { DepartmentKey, GeneratedArtifact, HumanReview, LoopRecord, LoopRun, LoopRunStep } from "./types";
import { generateLoopSpec } from "./spec-generator";
import { generateImplementationArtifacts } from "./implementation-generator";

export const loopEngineeringArchitectSystemPrompt = `You are the Loop Engineering Architect Agent.

Your job is to help users design AI-human feedback loops for company functions.

You first identify the department, goal, work item, signals, data sources, routines, verification, escalation, human ownership, trace schema, and measurement plan.

A valid loop must include goal, target metric, recurring work item, trigger or cadence, data sources, routine steps, tool actions, verification checks, escalation rules, human owner, autonomy level, trace schema, measurement plan, improvement loop, and management review output.

Ask only questions that help complete the loop spec.
Do not invent company-specific data. If information is missing, ask for it or mark it as an assumption.
When generating implementation plans, include Supabase tables, Vercel API routes, Vercel cron jobs, UI screens, agent prompts, verification rubrics, escalation rules, trace logging, and management review cadence.
Optimize for practical implementation, not theory.`;

export const agentModes = [
  "Question mode",
  "Spec generation mode",
  "Implementation generation mode",
  "Review mode",
  "Management summary mode",
  "Improvement mode"
] as const;

export function createLoop(input: {
  organizationId: string;
  department: DepartmentKey;
  templateId: string;
  goal: string;
}): LoopRecord {
  const template = getTemplateById(input.templateId);
  return {
    id: "loop_demo_marketing_campaign",
    organizationId: input.organizationId,
    templateId: input.templateId,
    name: template?.name ?? "New Loop",
    department: input.department,
    loopType: template?.loopType ?? "custom_company_loop",
    status: "questions_in_progress",
    autonomyLevel: "draft_for_review",
    owner: "Department owner",
    goal: input.goal,
    targetMetric: template?.primaryMetric ?? "Quality-adjusted output",
    businessOutcome: template?.businessOutcome ?? "Improve a measurable business outcome",
    cadence: "Weekly",
    specGenerated: false,
    implementationGenerated: false,
    openReviews: 0,
    improvementItems: 0
  };
}

export function saveAnswer(
  answers: AnswerMap,
  questionKey: string,
  answer: string
) {
  return {
    ...answers,
    [questionKey]: answer
  };
}

export function generateLoopSpecForAgent(loop: LoopRecord, answers: AnswerMap) {
  const questions = flattenQuestionGroups(
    generateQuestions(loop.department, loop.templateId, loop.goal)
  );

  if (!hasEnoughAnswersForSpec(questions, answers)) {
    throw new Error("Required answers are missing.");
  }

  return generateLoopSpec(loop, answers);
}

export function generateImplementationPlanForAgent(loop: LoopRecord, answers: AnswerMap) {
  const spec = generateLoopSpecForAgent(loop, answers);
  return generateImplementationArtifacts(spec);
}

export function generateSupabaseSchema(loop: LoopRecord, answers: AnswerMap) {
  return findArtifact(loop, answers, "supabase_schema");
}

export function generateVercelPlan(loop: LoopRecord, answers: AnswerMap) {
  return findArtifact(loop, answers, "vercel_plan");
}

export function generateAgentPrompt(loop: LoopRecord, answers: AnswerMap) {
  return findArtifact(loop, answers, "agent_prompt");
}

export function generateVerificationRubric(loop: LoopRecord, answers: AnswerMap) {
  return findArtifact(loop, answers, "verification_rubric");
}

export function createGeneratedArtifact(
  artifacts: GeneratedArtifact[],
  artifact: GeneratedArtifact
) {
  return [...artifacts, artifact];
}

export function startLoopRun(loop: LoopRecord): {
  run: LoopRun;
  steps: LoopRunStep[];
  review?: HumanReview;
} {
  const startedAt = new Date().toISOString();
  const completedAt = new Date(Date.now() + 180000).toISOString();
  const run: LoopRun = {
    id: "run_demo_001",
    loopId: loop.id,
    status: "completed",
    triggerType: "manual",
    startedAt,
    completedAt,
    escalationRequired: true,
    humanReviewRequired: true,
    inputSnapshot: {
      channel: "Paid search",
      currentConstraint: "Qualified conversion rate",
      observedSignals: ["CAC rising", "Activation stable", "Creative fatigue"]
    },
    outputSnapshot: {
      recommendation: "Draft two new landing-page variants and pause spend scaling until qualified conversion recovers.",
      managementSummary: "Marketing loop found a proxy metric trap: click volume increased without downstream quality."
    },
    verificationResult: {
      passed: true,
      checks: ["Targets current constraint", "Uses downstream metric", "Requires human approval before spend change"]
    }
  };

  const steps: LoopRunStep[] = [
    step(run.id, "Observe state", "observe", { sources: ["analytics", "CRM", "product analytics"] }, { signals: run.inputSnapshot.observedSignals }),
    step(run.id, "Compare to goal", "goal_check", { targetMetric: loop.targetMetric }, { constraint: "Qualified conversion rate" }),
    step(run.id, "Draft recommendation", "execute", { routine: loop.loopType }, run.outputSnapshot),
    step(run.id, "Verify output", "verify", run.outputSnapshot, run.verificationResult),
    step(run.id, "Escalate judgment", "escalate", { reason: "Spend and brand-sensitive copy require approval" }, { humanReviewRequired: true })
  ];

  return {
    run,
    steps,
    review: createHumanReview(run.id, loop.id)
  };
}

export function createHumanReview(loopRunId: string, loopId = "loop_demo_marketing_campaign"): HumanReview {
  return {
    id: "review_demo_001",
    loopRunId,
    loopId,
    reviewer: "Marketing lead",
    status: "pending",
    reason: "The loop recommends spend or creative changes that require brand and budget approval.",
    recommendation: "Approve the test with a spend cap and require a downstream quality check before scaling.",
    createdAt: new Date().toISOString()
  };
}

export function generateManagementReview() {
  return {
    period: "This week",
    summary:
      "Active loops are producing useful traces. The highest leverage decision is whether to scale the marketing campaign test after downstream quality is verified.",
    risks: ["Proxy metrics can hide poor cohort quality", "Human review queue needs a clear owner"],
    decisions: ["Approve campaign test spend cap", "Decide whether to increase loop autonomy after two clean runs"],
    bottlenecks: ["CRM qualification data is manually updated", "Review time is not yet tracked consistently"],
    recommendations: ["Add qualification-source validation", "Record review and botsitting minutes for every run"]
  };
}

export const agentTools = {
  getDepartmentTemplates,
  getTemplateById,
  createLoop,
  generateQuestions,
  saveAnswer,
  generateLoopSpec: generateLoopSpecForAgent,
  generateImplementationPlan: generateImplementationPlanForAgent,
  generateSupabaseSchema,
  generateVercelPlan,
  generateAgentPrompt,
  generateVerificationRubric,
  createGeneratedArtifact,
  startLoopRun,
  createHumanReview,
  generateManagementReview
};

export function demoLoopBundle() {
  const loop = createLoop({
    organizationId: "org_demo",
    department: "marketing",
    templateId: "marketing-campaign_learning",
    goal:
      "Acquire qualified customers at sustainable CAC while increasing the speed and quality of marketing learning."
  });
  const answers = createDefaultAnswers(loop.department, loop.templateId, loop.goal);
  const spec = generateLoopSpecForAgent(loop, answers);
  const artifacts = generateImplementationArtifacts(spec);
  const runBundle = startLoopRun(loop);
  return {
    loop: {
      ...loop,
      status: "implementation_generated",
      specGenerated: true,
      implementationGenerated: true,
      lastRunAt: runBundle.run.completedAt,
      openReviews: 1,
      improvementItems: 2
    },
    answers,
    spec,
    artifacts,
    runBundle
  };
}

function findArtifact(
  loop: LoopRecord,
  answers: AnswerMap,
  artifactType: GeneratedArtifact["artifactType"]
) {
  return generateImplementationPlanForAgent(loop, answers).find(
    (artifact) => artifact.artifactType === artifactType
  );
}

function step(
  loopRunId: string,
  stepName: string,
  stepType: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>
): LoopRunStep {
  return {
    id: `step_${stepType}`,
    loopRunId,
    stepName,
    stepType,
    status: "completed",
    input,
    output,
    toolCalls: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  };
}
