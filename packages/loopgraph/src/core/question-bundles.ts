import {
  DEPARTMENT_TYPES,
  formatDepartmentType,
  type DepartmentType
} from "./department-skills";
import {
  QuestionBundleSchema,
  type QuestionBundle
} from "./discovery";

export const UNIVERSAL_DISCOVERY_BUNDLE_IDS = [
  "current_stack_sources",
  "biggest_recurring_problem",
  "automation_boundaries",
  "ideal_outcome_proof",
  "ownership_rollout"
] as const;

export type UniversalDiscoveryBundleId = (typeof UNIVERSAL_DISCOVERY_BUNDLE_IDS)[number];

const universalBundleTemplates: Omit<QuestionBundle, "departmentType">[] = [
  {
    id: "current_stack_sources",
    stage: "question_bundle",
    prompt: "What tools does this department use today, where is the source of truth, and which inputs can Loopgraph safely read?",
    whyAsked: "The loop needs explicit sources of truth and safe read boundaries before it can design useful monitoring or preparation work.",
    examples: ["Google Ads + HubSpot for marketing", "Linear + GitHub for engineering", "Manual CSV export as a fallback"],
    fields: [
      field("systems", "Systems and providers", "Which tools, systems, files, or providers are involved today?", "string_array", "company", true),
      field("source_of_truth", "Source of truth", "Which system is authoritative for the main business object?", "text", "company", true),
      field("event_sources_subjects", "Event sources and subjects", "Which system should tell Hermes this work needs attention, and what stable object does it concern?", "text", "access", false),
      field("safe_reads", "Safe reads", "Which inputs can Loopgraph safely read or receive during a pilot?", "string_array", "access", true),
      field("manual_fallbacks", "Manual fallbacks", "Which CSV, JSON, document, or manual export can stand in before real connectors are ready?", "string_array", "access", false),
      field("existing_automations", "Existing automations", "What existing automations must not be duplicated or disrupted?", "string_array", "process", false)
    ],
    requiredFor: ["candidate_generation", "design"],
    followUpRules: [
      "Ask for a source of truth when several systems appear authoritative.",
      "Ask for a manual fallback when a required connector is missing."
    ],
    maxFollowUps: 3
  },
  {
    id: "biggest_recurring_problem",
    stage: "question_bundle",
    prompt: "What recurring work creates the most delay, manual context gathering, rework, missed follow-up, or quality risk?",
    whyAsked: "Loopgraph designs loops around recurring business problems, not generic automation ideas.",
    examples: ["Weekly campaign review takes six hours", "Support escalations miss account context", "Forecast variance reviews are late"],
    fields: [
      field("processes", "Recurring processes", "Name one to three recurring processes or work items.", "string_array", "process", true),
      field("trigger_or_cadence", "Trigger or cadence", "What starts the work: an event, threshold, schedule, or manual request?", "text", "process", true),
      field("problem_signal", "Problem signal", "What event, threshold, message, or status change tells Hermes that this business problem may exist?", "text", "process", false),
      field("required_evidence", "Required evidence", "What evidence must be present before this loop is a valid routing candidate?", "string_array", "process", false),
      field("weekly_volume", "Weekly volume", "Roughly how many times per week does this happen?", "number", "process", false),
      field("current_owner", "Current owner", "Who currently owns this work?", "text", "human", true),
      field("current_steps", "Current steps", "What are the current inputs, steps, and output?", "string_array", "process", true),
      field("pain_type_severity", "Pain and severity", "What is the main pain type and how severe is it?", "text", "goal", true),
      field("baseline", "Current baseline", "What is the current time, cycle time, error rate, or quality baseline if known?", "text", "metric", false)
    ],
    requiredFor: ["candidate_generation", "design"],
    followUpRules: [
      "Ask a follow-up when the work item is not recurring.",
      "Ask for a stable trigger when the loop cannot tell when to start."
    ],
    maxFollowUps: 3
  },
  {
    id: "automation_boundaries",
    stage: "question_bundle",
    prompt: "What would be useful for AI to monitor, prepare, recommend, or execute—and what must it never do on its own?",
    whyAsked: "The first version should be useful while staying inside explicit risk and approval boundaries.",
    examples: ["Monitor spend anomalies", "Draft content briefs", "Never publish or change budget without approval"],
    fields: [
      field("desired_automation_mode", "Desired mode", "Should the loop monitor, prepare, recommend, draft, or execute approved actions?", "text", "goal", true),
      field("candidate_outputs_actions", "Outputs/actions", "What should the loop produce or prepare?", "string_array", "process", true),
      field("read_write_boundary", "Read/write boundary", "Which actions are read-only, draft-only, or approval-gated writes?", "text", "access", true),
      field("customer_facing_status", "Customer-facing status", "Could any output reach customers, candidates, partners, or the public?", "boolean", "human", true),
      field("forbidden_actions", "Never actions", "Which financial, brand, legal, employment, security, privacy, or destructive actions are forbidden?", "string_array", "human", true),
      field("ignore_conditions", "Ignore conditions", "Which similar events are noise, test data, expected behavior, already handled, or explicitly out of scope?", "string_array", "process", false),
      field("ambiguity_policy", "Ambiguity policy", "When two loops look equally appropriate, should Hermes ask a human, defer, route to triage, or ignore?", "text", "human", false, ["request_human", "defer", "route_to_triage", "ignore"]),
      field("fanout_policy", "Fan-out policy", "May one event trigger multiple independent loops, or should Hermes choose only one?", "text", "human", false, ["none", "independent_only", "declared_ordered"])
    ],
    requiredFor: ["design", "materialization"],
    followUpRules: [
      "Ask for an approval rule when a risky action is requested.",
      "Ask for a stricter starting mode when the user asks for execution before connectors are ready."
    ],
    maxFollowUps: 3
  },
  {
    id: "ideal_outcome_proof",
    stage: "question_bundle",
    prompt: "If this worked ideally, what would improve, how would we know the output is good, and what should not get worse?",
    whyAsked: "Every loop needs a measurable outcome, verification rule, and guardrail before materialization.",
    examples: ["Lower cost per qualified lead", "Improve response latency without hurting CSAT", "Drafts must cite approved evidence"],
    fields: [
      field("primary_outcome_metric", "Primary metric", "What primary outcome metric should improve?", "text", "metric", true),
      field("leading_indicator", "Leading indicator", "What early signal tells us the loop is moving in the right direction?", "text", "metric", false),
      field("guardrail_metric", "Guardrail", "What must not get worse?", "text", "metric", true),
      field("baseline_target", "Baseline and target", "What baseline and target should we use if known?", "text", "metric", false),
      field("verification_rules", "Verification rules", "What evidence proves the loop output is good enough?", "string_array", "metric", true),
      field("completion_signal", "Completion signal", "Which output or downstream event proves the problem was handled?", "string_array", "metric", false),
      field("failure_signal", "Failure signal", "Which timeout, rejection, or failed check should return to Hermes for a different response?", "string_array", "metric", false)
    ],
    requiredFor: ["design", "materialization"],
    followUpRules: [
      "Ask for at least one verification rule when the user gives only a business metric.",
      "Ask for a guardrail when optimization could create quality, risk, or relationship damage."
    ],
    maxFollowUps: 3
  },
  {
    id: "ownership_rollout",
    stage: "question_bundle",
    prompt: "Who owns the loop, who approves risky outputs, when should it escalate, and how cautiously should it start?",
    whyAsked: "Loopgraph requires ownership, escalation, and rollout controls before a loop can become operational.",
    examples: ["Marketing lead owns it; finance approves spend changes", "Start in shadow mode for two weeks"],
    fields: [
      field("loop_owner_role", "Owner", "Who owns this loop?", "text", "human", true),
      field("reviewer_roles", "Reviewers", "Who approves risky outputs or customer-facing work?", "string_array", "human", true),
      field("escalation_conditions", "Escalations", "When should the loop escalate and what SLA matters?", "string_array", "human", true),
      field("initial_autonomy_level", "Initial autonomy", "How cautiously should this start?", "text", "human", true, ["shadow", "recommend", "simulate", "execute_with_approval"]),
      field("repeat_policy", "Repeat policy", "When repeated events arrive for the same subject, should Hermes append evidence, ignore during cooldown, queue, or start new work?", "text", "human", false, ["append_evidence", "cooldown_ignore", "queue", "new_run"]),
      field("urgency_priority", "Urgency and priority", "How quickly must this problem be handled, and what wins when several problems appear together?", "text", "goal", false),
      field("pilot_scope", "Pilot scope", "What limited audience, account, campaign, queue, or time window should pilot this?", "text", "goal", false),
      field("management_summary", "Summary cadence", "What daily or weekly management summary would be useful?", "text", "goal", false)
    ],
    requiredFor: ["materialization", "execution"],
    followUpRules: [
      "Ask for an owner before materialization.",
      "Ask for reviewers when customer-facing, financial, legal, employment, security, or destructive actions are possible."
    ],
    maxFollowUps: 3
  }
];

export const DEPARTMENT_BRANCH_QUESTIONS = {
  management: [
    "Which operating cadence, OKR, dashboard, finance, project, and decision systems are authoritative?",
    "Which daily or weekly decisions and cross-functional bottlenecks should the management loop surface?",
    "Which department loops, metrics, access blockers, reviews, cases, and improvements should roll up?",
    "Which priority, staffing, budget, legal, customer, or resource decisions require an accountable leader?",
    "Which outcomes matter: decision latency, dependency age, experiment throughput, OKR drift, allocation cycle time, recurring issues, or trace-supported decisions?"
  ],
  marketing: [
    "Which motions should be included: paid ads, content creation, lifecycle/email, SEO, events, partnerships, or another motion?",
    "For paid ads, which platforms contain spend and campaign data, and which downstream system defines a qualified lead/customer?",
    "For content, where do ideas and evidence come from, which formats/channels are required, and where are drafts reviewed and published?",
    "Which proxy metrics should the loop distrust when qualified conversion, activation, retention, or revenue quality disagrees?",
    "Which spend changes, claims, brand language, publishing actions, or audience changes require approval, and what are the thresholds?"
  ],
  sales: [
    "Which CRM stages, lead queues, buyer signals, email/calendar systems, and qualification fields are authoritative?",
    "Where does seller time disappear: account research, qualification, follow-up, forecasting, proposal preparation, or CRM hygiene?",
    "What makes a lead qualified and what evidence must support an opportunity or forecast change?",
    "Which customer messages may be drafted, and which pricing, negotiation, commitment, or send actions must remain human-owned?",
    "Which metric best proves value: response latency, qualified lead rate, opportunity conversion, stage velocity, forecast accuracy, or seller relationship time?"
  ],
  product: [
    "Where do feedback, usage signals, support tickets, research notes, and roadmap decisions live?",
    "Which recurring work is most painful: feedback clustering, discovery prep, spec-to-ticket translation, release learning, or roadmap evidence review?",
    "What evidence is required before a theme becomes a product problem or a spec becomes a ticket?",
    "Who owns prioritization and which roadmap or scope changes must never be automated?",
    "Which outcome proves success: decision cycle time, spec clarity/rework, adoption, release outcome, or evidence coverage?"
  ],
  customer_success: [
    "Which product-usage, support, CRM, renewal, meeting, and health-score systems are authoritative?",
    "Which recurring work needs help: health monitoring, renewal-risk preparation, QBR preparation, ticket escalation, or knowledge-base maintenance?",
    "Which signals actually predict risk, and which false-positive signals should be discounted?",
    "Which customer communications, commitments, discounts, renewal actions, or escalations require human ownership?",
    "Which outcomes matter: renewal risk, support response/resolution, CSAT, QBR quality, or CSM relationship time?"
  ],
  engineering: [
    "Which repositories, issue trackers, CI systems, incident systems, and environments are in scope?",
    "Which work should be improved: issue triage, PR review preparation, QA planning, release readiness, incident learning, or bug clustering?",
    "What checks are mandatory before a recommendation, merge, release, or incident closure?",
    "Which actions can remain drafts, and which code, merge, deploy, rollback, or production operations require explicit approval?",
    "Which metrics matter: lead time, PR cycle time, escaped defects, incident recurrence, test coverage, or review burden?"
  ],
  ops_finance: [
    "Which finance, billing, spreadsheet, database, procurement, and approval systems contain authoritative records?",
    "Which recurring work needs help: approval bottlenecks, invoice variance, cash collection, forecast variance, or allocation review?",
    "What numeric tolerance or policy distinguishes a normal variance from an exception?",
    "Which payment, collection, budget, vendor, or allocation actions must be blocked or approved?",
    "Which outcomes matter: approval latency, invoice cycle time, forecast accuracy, variance resolution, transaction cost, or audit readiness?"
  ],
  hr_talent: [
    "Which ATS, HRIS, onboarding, performance, learning, and calendar systems are approved data sources?",
    "Which recurring work needs help: candidate pipeline, onboarding progress, review preparation, manager coaching, or engagement-risk preparation?",
    "What sensitive or protected data must be excluded from model context and traces?",
    "Which ranking, rejection, hiring, compensation, performance, discipline, or employment decisions must remain human and policy reviewed?",
    "Which outcomes matter: time to hire, candidate experience, onboarding completion, manager coaching time, or human-reviewed retention risk?"
  ],
  legal_compliance: [
    "Which contract, policy, control, evidence, access-log, questionnaire, and security systems are authoritative?",
    "Which work needs help: policy drift, questionnaire drafting, contract risk triage, compliance evidence, or access review?",
    "Which approved sources may support an answer, and what freshness/provenance rules apply?",
    "Which legal interpretations, risk acceptance, exceptions, contract changes, or access decisions require expert approval?",
    "Which outcomes matter: review cycle time, exception resolution, audit readiness, valid risk detection, expert review burden, or false positives?"
  ],
  custom: [
    "What recurring work item enters the loop, and what event or cadence starts it?",
    "What must the loop observe, and which sources are trusted?",
    "What may it prepare or do, and which actions are forbidden?",
    "How is output verified, who owns judgment, and when does it escalate?",
    "Which outcome and hidden-labor metrics determine whether the loop is worth keeping?"
  ]
} satisfies Record<DepartmentType, string[]>;

export function getUniversalQuestionBundles(departmentType?: DepartmentType): QuestionBundle[] {
  return universalBundleTemplates.map((bundle) => QuestionBundleSchema.parse({
    ...bundle,
    ...(departmentType ? { departmentType } : {})
  }));
}

export function getQuestionBundle(bundleId: string, departmentType?: DepartmentType): QuestionBundle | undefined {
  return getUniversalQuestionBundles(departmentType).find((bundle) => bundle.id === bundleId);
}

export function getDepartmentBranchQuestions(departmentType: DepartmentType): string[] {
  return DEPARTMENT_BRANCH_QUESTIONS[departmentType];
}

export function getInitialQuestionQueue(departmentType: DepartmentType) {
  return getUniversalQuestionBundles(departmentType).map((bundle, index) => ({
    bundleId: bundle.id,
    status: index === 0 ? "active" as const : "pending" as const,
    departmentType
  }));
}

export function listQuestionBundleSummary(departmentType: DepartmentType) {
  return getUniversalQuestionBundles(departmentType).map((bundle, index) => ({
    id: bundle.id,
    order: index + 1,
    label: bundle.prompt,
    department: formatDepartmentType(departmentType)
  }));
}

function field(
  id: string,
  label: string,
  prompt: string,
  valueType: QuestionBundle["fields"][number]["valueType"],
  scope: QuestionBundle["fields"][number]["scope"],
  required: boolean,
  options?: string[]
): QuestionBundle["fields"][number] {
  return {
    id,
    label,
    prompt,
    valueType,
    scope,
    required,
    ...(options ? { options } : {}),
    requiredFor: required ? ["design"] : []
  };
}

export const CANONICAL_DISCOVERY_DEPARTMENT_ORDER = DEPARTMENT_TYPES;
