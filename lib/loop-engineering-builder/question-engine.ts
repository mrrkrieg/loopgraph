import type { DepartmentKey, QuestionDefinition } from "./types";
import {
  getDepartmentTemplate,
  getTemplateById,
  marketingCampaignLearningLoop
} from "./templates";

export type QuestionGroup = {
  section: string;
  questions: QuestionDefinition[];
};

export type AnswerMap = Record<string, string>;

export function generateQuestions(
  department: DepartmentKey,
  templateId?: string,
  goal?: string
): QuestionGroup[] {
  const departmentTemplate = getDepartmentTemplate(department);
  const loopTemplate = templateId ? getTemplateById(templateId) : undefined;
  const questions = [...(departmentTemplate?.requiredQuestions ?? [])];

  if (loopTemplate?.id === marketingCampaignLearningLoop.id) {
    questions.push(
      {
        section: "Signals",
        questionKey: "proxy_metrics_to_distrust",
        question: "Which proxy metrics should the loop distrust when downstream quality disagrees?",
        required: true,
        answerType: "textarea",
        sortOrder: 160,
        helpText: "Examples: clicks without qualified conversion, leads without activation, low CAC with poor retention."
      },
      {
        section: "Management review",
        questionKey: "scale_or_kill_decisions",
        question: "Which campaign decisions should be sent to management each week?",
        required: true,
        answerType: "textarea",
        sortOrder: 170
      }
    );
  }

  if (goal) {
    questions.unshift({
      section: "Goal",
      questionKey: "initial_goal_summary",
      question: "Confirm the goal the loop should optimize for.",
      helpText: goal,
      required: true,
      answerType: "textarea",
      sortOrder: 1
    });
  }

  const sections = Array.from(new Set(questions.map((question) => question.section)));
  return sections.map((section) => ({
    section,
    questions: questions
      .filter((question) => question.section === section)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }));
}

export function flattenQuestionGroups(groups: QuestionGroup[]) {
  return groups.flatMap((group) => group.questions);
}

export function getMissingRequiredQuestions(
  questions: QuestionDefinition[],
  answers: AnswerMap
) {
  return questions.filter((question) => {
    if (!question.required) {
      return false;
    }

    const answer = answers[question.questionKey];
    return !answer || answer.trim().length === 0;
  });
}

export function hasEnoughAnswersForSpec(
  questions: QuestionDefinition[],
  answers: AnswerMap
) {
  return getMissingRequiredQuestions(questions, answers).length === 0;
}

export function createDefaultAnswers(
  department: DepartmentKey,
  templateId: string,
  goal: string
): AnswerMap {
  const template = getTemplateById(templateId);
  const departmentTemplate = getDepartmentTemplate(department);

  return {
    initial_goal_summary: goal,
    goal: goal || template?.goal || "Improve a measurable business outcome with reviewable evidence.",
    target_metric: template?.primaryMetric ?? departmentTemplate?.commonMetrics[0] ?? "Quality-adjusted output per human hour",
    business_outcome: template?.businessOutcome ?? "A measurable business outcome improves while review, rework, escalation, governance, and botsitting costs are visible.",
    work_item: template?.name ?? "Recurring company loop",
    current_workflow: "The team handles the workflow manually across meetings, spreadsheets, docs, and system updates.",
    signals: (template?.observes ?? ["status changes", "metric changes", "human corrections"]).join(", "),
    data_sources: (template?.requiredDataSources ?? departmentTemplate?.commonDataSources ?? ["manual"]).join(", "),
    tools_actions: (departmentTemplate?.commonTools ?? ["summary", "recommendation", "review packet"]).join(", "),
    verification: (template?.verification ?? departmentTemplate?.verificationDefaults ?? ["Output must be accurate, useful, and reviewable"]).join("; "),
    escalation: (template?.escalation ?? departmentTemplate?.escalationDefaults ?? ["Escalate when confidence is low or human judgment is required"]).join("; "),
    human_owner: "Department owner",
    autonomy_level: "draft_for_review",
    trace_schema: "run_id, observed_signals, selected_goal, routine_steps, tool_calls, verification_result, escalation_reason, human_decision, final_outcome",
    measurement_plan: "Measure baseline work volume, baseline human time, loop-assisted time, review time, rework time, botsitting time, escalation time, output quality, and business value weekly.",
    management_review: "Review loop health, bottlenecks, failed runs, open reviews, improvement items, decisions needed, and metric movement.",
    icp: "B2B teams with recurring operational pain that can be measured through activation, retention, and revenue quality.",
    qualified_customer: "A customer that matches the ICP, activates on the value metric, and has a path to sustainable payback.",
    payback_threshold: "CAC payback must remain inside the company target before budget scaling is recommended.",
    active_channels: "Paid search, founder-led social, partner referrals, and lifecycle email.",
    minimum_sample_size: "Use enough qualified conversions to distinguish a real signal from noise before scaling spend.",
    spend_approval: "Marketing lead approves tests; finance or management approves material spend increases.",
    proxy_metrics_to_distrust: "Upstream engagement metrics that do not translate into qualified conversion, activation, retention, or revenue quality.",
    scale_or_kill_decisions: "Send decisions to scale, pause, kill, or redesign tests when spend, brand risk, or strategic channel implications are material."
  };
}
