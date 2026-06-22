import type {
  DepartmentKey,
  DepartmentTemplate,
  LoopTemplate,
  QuestionDefinition,
  QuestionSection
} from "../types";

const q = (
  section: QuestionSection,
  questionKey: string,
  question: string,
  sortOrder: number,
  helpText?: string,
  answerType: QuestionDefinition["answerType"] = "textarea",
  options?: string[]
): QuestionDefinition => ({
  section,
  questionKey,
  question,
  helpText,
  required: true,
  answerType,
  options,
  sortOrder
});

const baseQuestions = (department: string): QuestionDefinition[] => [
  q("Goal", "goal", `What goal should the ${department} loop pursue?`, 10),
  q("Goal", "target_metric", "What target metric proves the loop is working?", 20),
  q("Goal", "business_outcome", "What business outcome should improve if this loop works?", 30),
  q("Work item", "work_item", "What recurring work item should the loop move forward?", 40),
  q("Current workflow", "current_workflow", "How does the team handle this work today?", 50),
  q("Signals", "signals", "What signals should the loop observe?", 60),
  q("Data sources", "data_sources", "Which systems or documents contain the required state?", 70),
  q("Tools/actions", "tools_actions", "What actions may the loop draft, recommend, or execute?", 80),
  q("Verification", "verification", "What checks must pass before the output is trusted?", 90),
  q("Escalation", "escalation", "When should the loop escalate to a human?", 100),
  q("Human ownership", "human_owner", "Who owns the loop and the final judgment?", 110),
  q(
    "Autonomy level",
    "autonomy_level",
    "How autonomous should the loop be?",
    120,
    "Pick the highest safe level for V1.",
    "select",
    [
      "monitor_only",
      "recommend",
      "draft_for_review",
      "execute_with_approval",
      "execute_with_limits"
    ]
  ),
  q("Trace schema", "trace_schema", "What should each run record for audit and improvement?", 130),
  q("Measurement", "measurement_plan", "How will the team measure baseline time, review time, rework, escalation, botsitting, quality, and business value?", 140),
  q("Management review", "management_review", "What should leadership review on a recurring cadence?", 150)
];

const loop = (
  department: DepartmentKey,
  loopType: string,
  name: string,
  description: string
): LoopTemplate => ({
  id: `${department}-${loopType}`,
  department,
  loopType,
  name,
  description
});

export const marketingCampaignLearningLoop: LoopTemplate = {
  id: "marketing-campaign_learning",
  department: "marketing",
  loopType: "campaign_learning",
  name: "Campaign Learning Loop",
  description:
    "Observe funnel and cohort quality, generate experiment hypotheses, verify against downstream metrics, and feed learning into a reusable message and channel library.",
  goal:
    "Acquire qualified customers at a sustainable CAC while increasing the speed and quality of marketing learning.",
  businessOutcome:
    "More qualified activated or paying customers from channels that can scale without degrading cohort quality.",
  primaryMetric: "Cost per qualified customer",
  secondaryMetrics: [
    "Qualified conversion rate",
    "CAC payback",
    "Activation rate",
    "Retention of acquired cohort",
    "Experiment learning velocity"
  ],
  observes: [
    "Ad spend",
    "Impressions",
    "Clicks",
    "Landing page visits",
    "Leads",
    "Qualified leads",
    "Activated users",
    "Paying customers",
    "Channel source",
    "Campaign",
    "Audience",
    "Creative",
    "Landing page",
    "Sales feedback",
    "Customer quality",
    "Retention"
  ],
  requiredDataSources: [
    "Ad platforms",
    "Analytics",
    "CRM",
    "Payment or subscription system",
    "Product analytics",
    "Landing page or form data",
    "Sales notes",
    "Customer success notes"
  ],
  routine: [
    "Pull channel and funnel data",
    "Identify the current funnel constraint",
    "Generate experiment hypotheses against that constraint",
    "Prioritize experiments by expected impact, confidence, cost, and speed",
    "Draft creative, copy, or landing-page changes",
    "Route risky or brand-sensitive assets to human review",
    "Launch approved tests",
    "Monitor results",
    "Compare against value metric, not only proxy metrics",
    "Kill, continue, or scale",
    "Save learning into message, ICP, and channel library",
    "Feed weekly summary into management loop"
  ],
  verification: [
    "Does this test target the current constraint?",
    "Is the ICP clear?",
    "Is the claim accurate?",
    "Is brand voice acceptable?",
    "Is attribution trustworthy?",
    "Is sample size enough to make a decision?",
    "Did the test improve downstream quality or only upstream proxy metrics?"
  ],
  escalation: [
    "Spend increase exceeds threshold",
    "Creative makes factual or performance claims",
    "Legal or compliance-sensitive claims are included",
    "CAC improves but activation or retention worsens",
    "The loop recommends killing a strategic channel",
    "Data is inconsistent or attribution is unclear"
  ]
};

const departments: DepartmentTemplate[] = [
  {
    key: "marketing",
    name: "Marketing",
    description:
      "Loops for market learning, channel allocation, creative testing, landing page conversion, and ICP or messaging iteration.",
    commonLoops: [
      marketingCampaignLearningLoop,
      loop("marketing", "channel_allocation", "Channel Allocation Loop", "Shift budget toward channels with the strongest qualified downstream outcomes."),
      loop("marketing", "creative_testing", "Creative Testing Loop", "Generate, review, launch, and learn from creative variants."),
      loop("marketing", "landing_page_conversion", "Landing Page Conversion Loop", "Improve landing page performance while preserving customer quality."),
      loop("marketing", "icp_messaging_learning", "ICP / Messaging Learning Loop", "Turn sales and customer feedback into sharper audience and message hypotheses.")
    ],
    requiredQuestions: [
      ...baseQuestions("marketing"),
      q("Goal", "icp", "Who is the ICP?", 16),
      q("Measurement", "qualified_customer", "What counts as a qualified customer?", 26),
      q("Measurement", "payback_threshold", "What CAC payback threshold is acceptable?", 36),
      q("Signals", "active_channels", "What channels are active today?", 46),
      q("Measurement", "minimum_sample_size", "What minimum sample size is required before a decision?", 56),
      q("Escalation", "spend_approval", "Who approves new tests and spend increases?", 66)
    ],
    commonDataSources: ["analytics", "hubspot", "salesforce", "posthog", "stripe", "custom_api"],
    commonTools: ["campaign brief", "landing page draft", "experiment tracker", "message library", "management summary"],
    commonMetrics: ["cost per qualified customer", "activation rate", "CAC payback", "experiment learning velocity"],
    verificationDefaults: marketingCampaignLearningLoop.verification ?? [],
    escalationDefaults: marketingCampaignLearningLoop.escalation ?? [],
    failureModes: ["proxy metric trap", "weak attribution", "small sample size", "brand drift", "low-quality leads"],
    managementReviewQuestions: [
      "Which channel has the strongest qualified downstream outcome?",
      "Where is the funnel constraint this week?",
      "Which tests should be killed, continued, or scaled?"
    ]
  },
  {
    key: "product",
    name: "Product",
    description:
      "Loops for turning customer evidence into product problems, bets, releases, and learning.",
    commonLoops: [
      loop("product", "feedback_to_problem", "Feedback to Problem Loop", "Cluster feedback and convert repeated pain into well-formed product problems."),
      loop("product", "problem_to_product_bet", "Problem to Product Bet Loop", "Turn a validated problem into a scoped product bet."),
      loop("product", "release_learning", "Release Learning Loop", "Compare shipped releases against adoption and customer outcome signals."),
      loop("product", "bug_cluster_to_problem", "Bug Cluster to Product Problem Loop", "Detect repeated bugs that point to deeper product or UX problems.")
    ],
    requiredQuestions: baseQuestions("product"),
    commonDataSources: ["linear", "github", "posthog", "analytics", "slack", "custom_api"],
    commonTools: ["problem brief", "PRD draft", "release note", "feedback cluster", "roadmap update"],
    commonMetrics: ["adoption", "activation", "retention", "support deflection", "cycle time"],
    verificationDefaults: ["Evidence links to the problem", "The target user is explicit", "Success metric is measurable", "Scope is reversible"],
    escalationDefaults: ["Strategic roadmap change", "High customer risk", "Security or privacy implication", "Conflicting executive priority"],
    failureModes: ["solution-first framing", "thin evidence", "roadmap churn", "unclear success metric"],
    managementReviewQuestions: ["Which problems are recurring?", "Which bets need decisions?", "Where is product learning blocked?"]
  },
  {
    key: "customer_success",
    name: "Customer Success",
    description:
      "Loops for health monitoring, support triage, renewal risk, and proactive customer outreach.",
    commonLoops: [
      loop("customer_success", "customer_health_risk", "Customer Health Risk Loop", "Detect risk from usage, sentiment, tickets, and renewal context."),
      loop("customer_success", "support_triage", "Support Triage Loop", "Classify, route, and draft support responses with human escalation."),
      loop("customer_success", "renewal_risk", "Renewal Risk Loop", "Surface renewal risk early and generate account intervention plans."),
      loop("customer_success", "proactive_outreach", "Proactive Outreach Loop", "Identify moments where proactive human outreach matters.")
    ],
    requiredQuestions: baseQuestions("customer success"),
    commonDataSources: ["hubspot", "salesforce", "slack", "gmail", "calendar", "analytics"],
    commonTools: ["risk brief", "QBR draft", "support response draft", "escalation note", "health score"],
    commonMetrics: ["time to first response", "CSAT", "NPS", "churn risk", "expansion", "relationship hours"],
    verificationDefaults: ["Answer is accurate", "Tone is empathetic", "Account context is current", "Escalation threshold is respected"],
    escalationDefaults: ["Strategic account risk", "Legal or billing issue", "Customer sentiment is negative", "Renewal is at risk"],
    failureModes: ["generic response", "missed context", "late escalation", "relationship erosion"],
    managementReviewQuestions: ["Which accounts need human attention?", "Which product gaps repeat?", "Where is support burden increasing?"]
  },
  {
    key: "sales",
    name: "Sales",
    description:
      "Loops for qualification, account research, follow-up, and CRM hygiene.",
    commonLoops: [
      loop("sales", "lead_qualification", "Lead Qualification Loop", "Score and route leads using fit, intent, and readiness signals."),
      loop("sales", "account_research", "Account Research Loop", "Prepare concise account context and likely buying triggers."),
      loop("sales", "follow_up", "Follow-up Loop", "Keep next steps moving after meetings without losing personalization."),
      loop("sales", "crm_hygiene", "CRM Hygiene Loop", "Detect stale opportunities and missing fields.")
    ],
    requiredQuestions: baseQuestions("sales"),
    commonDataSources: ["hubspot", "salesforce", "gmail", "calendar", "slack", "custom_api"],
    commonTools: ["account brief", "follow-up draft", "qualification score", "proposal outline", "CRM update"],
    commonMetrics: ["follow-up latency", "meeting conversion", "win rate", "deal velocity", "CRM completeness"],
    verificationDefaults: ["Personalization is accurate", "Claims are supported", "Tone matches relationship stage", "CRM updates are traceable"],
    escalationDefaults: ["Enterprise account", "Pricing exception", "Legal terms", "Executive relationship required"],
    failureModes: ["shallow personalization", "wrong account context", "over-automation", "lost next step"],
    managementReviewQuestions: ["Which opportunities are stuck?", "Which objections repeat?", "Where does relationship coverage need attention?"]
  },
  {
    key: "engineering",
    name: "Engineering",
    description:
      "Loops for issue planning, review prep, quality checklists, and incident learning.",
    commonLoops: [
      loop("engineering", "issue_to_plan", "Issue to Implementation Plan Loop", "Turn accepted issues into scoped implementation plans."),
      loop("engineering", "pr_review_prep", "PR Review Prep Loop", "Summarize risk, tests, and reviewer context before review."),
      loop("engineering", "qa_checklist", "QA Checklist Loop", "Generate release-specific QA checks and trace outcomes."),
      loop("engineering", "incident_learning", "Incident Learning Loop", "Convert incidents into root-cause learning and prevention items.")
    ],
    requiredQuestions: baseQuestions("engineering"),
    commonDataSources: ["github", "linear", "slack", "postgres", "custom_api"],
    commonTools: ["implementation plan", "test plan", "PR summary", "QA checklist", "incident note"],
    commonMetrics: ["lead time", "review time", "escaped defects", "incident recurrence", "deployment frequency"],
    verificationDefaults: ["Tests are identified", "Risk is summarized", "Owner is clear", "Rollback path exists"],
    escalationDefaults: ["Security risk", "Data migration", "Production incident", "Ambiguous acceptance criteria"],
    failureModes: ["missing context", "weak test coverage", "review burden", "unowned risk"],
    managementReviewQuestions: ["Where is delivery blocked?", "Which incidents repeated?", "Which quality risks need resourcing?"]
  },
  {
    key: "operations_finance",
    name: "Operations & Finance",
    description:
      "Loops for operational bottlenecks, approvals, forecasting, and finance controls.",
    commonLoops: [
      loop("operations_finance", "approval_bottleneck", "Approval Bottleneck Loop", "Detect stuck approvals and route decisions."),
      loop("operations_finance", "forecast_variance", "Forecast Variance Loop", "Explain changes in forecast and recommend action."),
      loop("operations_finance", "vendor_review", "Vendor Review Loop", "Review spend, usage, renewals, and ownership."),
      loop("operations_finance", "close_readiness", "Close Readiness Loop", "Track month-end close blockers and evidence.")
    ],
    requiredQuestions: baseQuestions("operations and finance"),
    commonDataSources: ["stripe", "postgres", "supabase", "calendar", "custom_api"],
    commonTools: ["variance memo", "approval summary", "vendor renewal note", "close checklist"],
    commonMetrics: ["approval latency", "forecast accuracy", "close time", "error rate", "cost per transaction"],
    verificationDefaults: ["Policy is respected", "Approval owner is clear", "Numbers reconcile", "Audit trail exists"],
    escalationDefaults: ["Spend threshold exceeded", "Forecast materially changes", "Control failure", "Unclear owner"],
    failureModes: ["missing approval", "bad source data", "unclear policy", "late variance"],
    managementReviewQuestions: ["Which bottlenecks need decisions?", "Which forecast changes matter?", "Where are controls weak?"]
  },
  {
    key: "hr",
    name: "HR & Talent",
    description:
      "Loops for hiring, onboarding, manager follow-up, coaching, and retention signals.",
    commonLoops: [
      loop("hr", "candidate_pipeline", "Candidate Pipeline Loop", "Track candidate stage, missing feedback, and next action."),
      loop("hr", "onboarding_progress", "Onboarding Progress Loop", "Detect onboarding gaps and route manager actions."),
      loop("hr", "manager_coaching", "Manager Coaching Loop", "Summarize recurring team signals into coaching prompts."),
      loop("hr", "retention_signal", "Retention Signal Loop", "Surface retention risks with privacy and fairness controls.")
    ],
    requiredQuestions: baseQuestions("HR and talent"),
    commonDataSources: ["calendar", "gmail", "slack", "custom_api"],
    commonTools: ["interview kit", "onboarding checklist", "manager note", "learning plan"],
    commonMetrics: ["time to hire", "candidate experience", "onboarding completion", "retention", "coaching hours"],
    verificationDefaults: ["Fairness risk checked", "Sensitive data minimized", "Human owner approves", "Context is current"],
    escalationDefaults: ["Employment decision", "Sensitive feedback", "Legal risk", "Potential bias"],
    failureModes: ["privacy leakage", "biased summary", "missing context", "over-automation of sensitive work"],
    managementReviewQuestions: ["Where is hiring blocked?", "Which teams need coaching?", "Which risks require human handling?"]
  },
  {
    key: "legal_security",
    name: "Legal & Security",
    description:
      "Loops for contract triage, policy drift, access reviews, incident evidence, and risk escalation.",
    commonLoops: [
      loop("legal_security", "contract_triage", "Contract Triage Loop", "Extract clauses, compare to playbook, and route exceptions."),
      loop("legal_security", "policy_drift", "Policy Drift Loop", "Detect changes that require policy or control review."),
      loop("legal_security", "access_review", "Access Review Loop", "Track access exceptions and owner approvals."),
      loop("legal_security", "incident_evidence", "Incident Evidence Loop", "Collect incident evidence and prepare review summaries.")
    ],
    requiredQuestions: baseQuestions("legal and security"),
    commonDataSources: ["github", "slack", "gmail", "calendar", "postgres", "custom_api"],
    commonTools: ["risk summary", "clause extraction", "access review", "incident packet"],
    commonMetrics: ["review cycle time", "risk detection", "false positives", "audit readiness", "incident response time"],
    verificationDefaults: ["Source citations included", "Risk owner is clear", "Human approval required", "Audit log exists"],
    escalationDefaults: ["Legal interpretation", "Critical security incident", "Customer contractual risk", "Policy exception"],
    failureModes: ["unsupported conclusion", "missed citation", "over-permissioned action", "late escalation"],
    managementReviewQuestions: ["Which risks need decisions?", "Where do controls fail?", "Which exceptions are recurring?"]
  },
  {
    key: "management",
    name: "Management",
    description:
      "Loops for weekly anomaly review, department loop health, decision memos, resource allocation, and improvement governance.",
    commonLoops: [
      loop("management", "weekly_anomaly_review", "Weekly Anomaly Review Loop", "Detect important company metric drift and prepare decisions."),
      loop("management", "department_loop_review", "Department Loop Review", "Roll up loop health, bottlenecks, reviews, and improvement work."),
      loop("management", "decision_memo", "Decision Memo Loop", "Turn ambiguous signals into decision options with tradeoffs."),
      loop("management", "resource_allocation", "Resource Allocation Loop", "Match goals, bottlenecks, capacity, and constraints."),
      loop("management", "improvement", "Improvement Loop", "Convert loop failures and human corrections into system changes.")
    ],
    requiredQuestions: baseQuestions("management"),
    commonDataSources: ["postgres", "supabase", "analytics", "hubspot", "linear", "custom_api"],
    commonTools: ["decision memo", "weekly summary", "bottleneck report", "resource plan", "risk register"],
    commonMetrics: ["decision latency", "OKR drift", "bottleneck age", "experiment throughput", "resource allocation speed"],
    verificationDefaults: ["Evidence is traceable", "Decision owner is clear", "Tradeoffs are explicit", "Risks are named"],
    escalationDefaults: ["Capital allocation", "Strategic tradeoff", "High risk", "Cross-functional ownership conflict"],
    failureModes: ["metric theater", "unclear owner", "stale decision", "missing tradeoff"],
    managementReviewQuestions: ["Which decisions are stuck?", "Which loops are unhealthy?", "Where should leadership attention move?"]
  },
  {
    key: "custom",
    name: "Custom",
    description:
      "A blank loop template for teams with a specific recurring workflow that does not fit a built-in department.",
    commonLoops: [
      loop("custom", "custom_company_loop", "Custom Company Loop", "Design a specific observable, goal-driven, verified, improvable loop.")
    ],
    requiredQuestions: baseQuestions("custom"),
    commonDataSources: ["manual", "postgres", "supabase", "custom_api"],
    commonTools: ["loop spec", "implementation plan", "verification rubric", "management summary"],
    commonMetrics: ["cycle time", "quality", "review time", "rework", "business outcome"],
    verificationDefaults: ["Goal is measurable", "Output is reviewable", "Trace is complete", "Owner is clear"],
    escalationDefaults: ["High risk", "Low confidence", "Missing data", "Human judgment required"],
    failureModes: ["unclear goal", "missing data", "weak verification", "unowned escalation"],
    managementReviewQuestions: ["Is this loop producing value?", "What keeps failing?", "What should be changed?"]
  }
];

export const departmentTemplates = departments;

export function getDepartmentTemplates() {
  return departmentTemplates;
}

export function getDepartmentTemplate(department: DepartmentKey) {
  return departmentTemplates.find((template) => template.key === department);
}

export function getTemplateById(templateId: string) {
  return departmentTemplates
    .flatMap((department) => department.commonLoops)
    .find((template) => template.id === templateId);
}

export function getTemplatesForDepartment(department: DepartmentKey) {
  return getDepartmentTemplate(department)?.commonLoops ?? [];
}
