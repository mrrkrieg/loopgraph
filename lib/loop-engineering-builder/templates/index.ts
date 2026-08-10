import type {
  DepartmentKey,
  DepartmentTemplate,
  LoopTemplate,
  QuestionDefinition,
  QuestionSection
} from "../types";
import {
  LEGACY_COMPANY_LOOP_TEMPLATE_ALIASES,
  getPrebuiltLoopDefinition,
  resolveCompanyLoopTemplateId
} from "loopgraph/core";
import { GENERATED_OFFICIAL_APP_CATALOG } from "../../../packages/loopgraph/src/generated/official-app-catalog";

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
  description: string,
  runtimeLevel: LoopTemplate["runtimeLevel"] = "spec_stub"
): LoopTemplate => ({
  id: `${department}-${loopType}`,
  department,
  loopType,
  name,
  description,
  runtimeLevel
});

export const marketingCampaignLearningLoop: LoopTemplate = {
  id: "marketing-campaign_learning",
  department: "marketing",
  loopType: "campaign_learning",
  runtimeLevel: "spec_stub",
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

const githubIssueTriageTemplate: LoopTemplate = {
  id: "github-issue-triage",
  department: "engineering",
  loopType: "github_issue_triage",
  runtimeLevel: "runnable",
  name: "GitHub Issue Triage",
  description:
    "Classify incoming GitHub issues, propose labels and responses, and escalate security-sensitive items with exact action approval.",
  goal: "Turn incoming issues into trustworthy triage decisions without unsafe repository mutations.",
  businessOutcome: "Maintainers spend less time sorting issues while security-sensitive items reach the right owner faster.",
  primaryMetric: "Triage latency",
  secondaryMetrics: ["Escalation accuracy", "Maintainer review minutes", "False positive rate"],
  observes: ["Issue title", "Issue body", "Labels", "Repository policy", "Security keywords"],
  requiredDataSources: ["GitHub", "Repository policy", "Maintainer rules"],
  routine: [
    "Load issue and repository policy context",
    "Classify issue type and risk",
    "Prepare labels, response draft, or escalation case",
    "Verify evidence and policy constraints",
    "Route sensitive actions to human review"
  ],
  verification: ["Schema is valid", "Evidence references issue content", "Forbidden actions are blocked", "Security escalation policy is respected"],
  escalation: ["Issue suggests credentials, exploit, CVE, or vulnerability", "Public response requires security judgment"],
  examplePath: "examples/github-issue-triage",
  fixturePaths: [
    "fixtures/github-issue-triage/normal-bug.json",
    "fixtures/github-issue-triage/security-issue.json"
  ]
};

const supportTicketTriageTemplate: LoopTemplate = {
  id: "support-ticket-triage",
  department: "customer_success",
  loopType: "support_triage",
  runtimeLevel: "runnable",
  name: "Support Ticket Triage",
  description:
    "Classify inbound support tickets from Intercom or similar systems, draft responses, and escalate high-risk cases with separate customer-facing approval.",
  goal: "Route support volume quickly while escalating revenue and outage risk with evidence-backed cases.",
  businessOutcome: "Customers get accurate responses faster; high-risk tickets reach the right owner without unsafe auto-replies.",
  primaryMetric: "Time to first response",
  secondaryMetrics: ["Escalation accuracy", "Customer-facing review minutes", "Duplicate ticket rate"],
  observes: ["Support ticket", "CRM account", "Incident severity", "Renewal context", "Customer sentiment"],
  requiredDataSources: ["Intercom or support inbox", "CRM", "Status page", "Account notes"],
  routine: [
    "Assemble ticket and account context",
    "Assess severity, sentiment, and routing",
    "Prepare internal task and customer draft separately",
    "Require approval for customer-facing messages",
    "Escalate renewal and outage risk to cases"
  ],
  verification: ["Ticket context is current", "Evidence is cited", "Customer-facing action is separately approved", "Escalation has owner and SLA"],
  escalation: ["Enterprise outage", "Renewal risk", "Angry strategic customer", "Incomplete context"],
  examplePath: "examples/support-ticket-triage",
  fixturePaths: [
    "fixtures/support-ticket-triage/high-priority-billing.json",
    "fixtures/support-ticket-triage/angry-enterprise-customer.json"
  ]
};

const strategicAccountEscalationTemplate: LoopTemplate = {
  id: "strategic-account-escalation",
  department: "customer_success",
  loopType: "strategic_account_escalation",
  runtimeLevel: "runnable",
  name: "Strategic Account Escalation",
  description:
    "Turn customer-risk signals into evidence-backed escalation cases with accountable ownership and separate customer-facing approval.",
  goal: "Escalate strategic account risk with complete evidence, owner routing, and approved response actions.",
  businessOutcome: "At-risk revenue gets faster human attention without generic customer communication.",
  primaryMetric: "Escalation response time",
  secondaryMetrics: ["Renewal risk surfaced", "Customer-facing review minutes", "Case resolution time"],
  observes: ["Support ticket", "CRM account", "Renewal date", "Incident severity", "Business impact"],
  requiredDataSources: ["Support system", "CRM", "Status page", "Account notes"],
  routine: [
    "Assemble ticket and account context",
    "Assess escalation severity and business impact",
    "Prepare internal task and customer-facing draft separately",
    "Require approval for risky actions",
    "Write outcome back to the trace"
  ],
  verification: ["Account context is current", "Evidence is cited", "Customer-facing action is separately approved", "Case has an owner and SLA"],
  escalation: ["Strategic customer outage", "Renewal risk", "Executive escalation", "Commercial commitment"],
  examplePath: "examples/strategic-account-escalation",
  fixturePaths: [
    "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json",
    "fixtures/strategic-account-escalation/executive-escalation.json"
  ]
};

const managementReviewTemplate: LoopTemplate = {
  id: "management-review",
  department: "management",
  loopType: "management_review",
  runtimeLevel: "runnable",
  name: "Management Review Loop",
  description:
    "Consume loop health, escalation cases, hidden labor, and improvement signals to prepare leadership decisions.",
  goal: "Turn operational traces and escalation cases into clear management decisions and follow-up ownership.",
  businessOutcome: "Leadership attention moves to the loops, owners, and decisions that most affect company outcomes.",
  primaryMetric: "Decision latency",
  secondaryMetrics: ["Open escalations", "Loop health drift", "Improvement throughput"],
  observes: ["Loop traces", "Escalation cases", "Human reviews", "Improvement items", "Hidden labor"],
  requiredDataSources: ["Loopgraph traces", "Case registry", "Metrics warehouse", "Project system"],
  routine: [
    "Read loop health and unresolved cases",
    "Summarize risks, bottlenecks, and decisions",
    "Route management decisions to accountable owners",
    "Track whether improvement work closes repeated failure modes"
  ],
  verification: ["Evidence links to traces", "Decision owner is clear", "No raw customer data is overexposed", "Recommendations name tradeoffs"],
  escalation: ["Cross-functional ownership conflict", "High-risk loop degradation", "Capital allocation decision"],
  examplePath: "examples/management-review",
  fixturePaths: ["fixtures/management-review/open-cases-weekly.json"]
};

const templateDetailsById: Record<string, Partial<LoopTemplate>> = {
  "marketing-channel_allocation": {
    goal: "Move budget toward channels producing qualified pipeline and durable activation, not just cheaper clicks.",
    businessOutcome: "Marketing spend compounds into higher-quality pipeline with fewer wasted experiments.",
    primaryMetric: "Qualified pipeline per dollar",
    secondaryMetrics: ["CAC payback", "Activation rate", "Channel saturation", "Spend waste avoided"],
    observes: ["Channel spend", "Qualified leads", "Opportunity source", "Activation", "Payback period"],
    requiredDataSources: ["Ad platforms", "CRM", "Product analytics", "Finance spend report"],
    routine: ["Compare channel spend to qualified downstream outcomes", "Identify overfunded and underfunded channels", "Draft allocation changes with confidence and risk", "Route material budget moves to review", "Record the decision and next measurement window"],
    verification: ["Attribution window is comparable", "Pipeline quality improved downstream", "Spend change respects budget limits"],
    escalation: ["Budget move exceeds approval threshold", "Attribution conflicts across systems", "Strategic channel would be paused"]
  },
  "marketing-creative_testing": {
    goal: "Find creative messages that improve qualified conversion while protecting brand and claim accuracy.",
    businessOutcome: "The team learns faster which messages produce customers who activate and retain.",
    primaryMetric: "Qualified creative conversion",
    secondaryMetrics: ["Creative fatigue", "Activation rate", "Review rework minutes", "Learning velocity"],
    observes: ["Creative variant", "Audience", "Click-through rate", "Qualified conversion", "Reviewer edits"],
    requiredDataSources: ["Ad platforms", "Creative library", "Analytics", "CRM", "Brand guidelines"],
    routine: ["Detect underperforming or fatigued creatives", "Generate variants tied to the current constraint", "Check claims against brand and product facts", "Prepare launch packet for approval", "Save results to the message library"],
    verification: ["Claim is factually supported", "Variant maps to one hypothesis", "Sample size can support a decision"],
    escalation: ["Creative includes a factual claim", "Brand risk is flagged", "Winning variant worsens customer quality"]
  },
  "marketing-landing_page_conversion": {
    goal: "Improve landing page conversion while preserving ICP fit and downstream activation.",
    businessOutcome: "More qualified visitors become activated customers without increasing low-quality lead volume.",
    primaryMetric: "Qualified landing page conversion",
    secondaryMetrics: ["Form completion", "Activation rate", "Bounce rate", "Sales accepted lead rate"],
    observes: ["Landing page visits", "Form submissions", "ICP fields", "Activation events", "Sales feedback"],
    requiredDataSources: ["Web analytics", "Form data", "Product analytics", "CRM", "Session recordings"],
    routine: ["Find the largest landing page drop-off", "Draft copy or flow changes for one hypothesis", "Check messaging and qualification criteria", "Queue approved experiment", "Compare conversion to downstream quality"],
    verification: ["Experiment changes one main variable", "Tracking events fire correctly", "Conversion gain does not lower qualification quality"],
    escalation: ["Pricing or legal claims change", "Tracking is broken", "Conversion rises while activation falls"]
  },
  "marketing-icp_messaging_learning": {
    goal: "Turn sales and customer evidence into sharper ICP, pain, and message hypotheses.",
    businessOutcome: "Marketing and sales align on who the company should target and what proof matters.",
    primaryMetric: "Message-to-opportunity fit",
    secondaryMetrics: ["Sales accepted lead rate", "Win reason frequency", "Objection recurrence", "Persona clarity"],
    observes: ["Sales notes", "Call summaries", "Closed-won reasons", "Lost reasons", "Customer success notes"],
    requiredDataSources: ["CRM", "Call transcripts", "Sales notes", "Customer success notes", "Message library"],
    routine: ["Cluster repeated pains and objections", "Identify ICP patterns in won and retained accounts", "Draft message hypotheses with evidence", "Review with sales and customer success", "Update message and ICP library"],
    verification: ["Evidence comes from real customer interactions", "ICP segment is specific", "Hypothesis has a measurable test"],
    escalation: ["Message conflicts with positioning", "Evidence is thin or anecdotal", "Sales and marketing disagree on ICP"]
  },
  "product-feedback_to_problem": {
    goal: "Convert recurring customer feedback into specific product problems with evidence and priority context.",
    businessOutcome: "Product decisions start from validated customer pain instead of scattered requests.",
    primaryMetric: "Validated problem rate",
    secondaryMetrics: ["Feedback cluster size", "Affected revenue", "Support burden", "Problem clarity"],
    observes: ["Support tickets", "Customer interviews", "Sales notes", "Product usage", "Churn reasons"],
    requiredDataSources: ["Support system", "CRM", "Product analytics", "Interview notes", "Slack"],
    routine: ["Cluster feedback by pain and customer segment", "Separate symptoms from underlying problem", "Attach impact and frequency evidence", "Draft problem brief", "Route ambiguous clusters to product review"],
    verification: ["Problem statement names user and context", "Evidence spans more than one source", "Impact is measurable"],
    escalation: ["Strategic customer impact", "Evidence conflicts by segment", "Problem implies roadmap change"]
  },
  "product-problem_to_product_bet": {
    goal: "Turn validated problems into scoped product bets with clear assumptions, risks, and success measures.",
    businessOutcome: "Teams commit to product work with tighter scope and clearer learning goals.",
    primaryMetric: "Bet validation cycle time",
    secondaryMetrics: ["Assumption confidence", "Expected adoption", "Engineering effort", "Decision latency"],
    observes: ["Problem briefs", "Usage data", "Customer segment impact", "Design notes", "Engineering estimates"],
    requiredDataSources: ["Product analytics", "Design docs", "Linear", "Customer evidence", "Roadmap"],
    routine: ["Review validated problem evidence", "Draft solution options and assumptions", "Estimate effort and reversibility", "Select learning metric", "Prepare bet review packet"],
    verification: ["Problem evidence is linked", "Bet scope is reversible", "Success metric is observable"],
    escalation: ["Bet affects roadmap commitments", "Capacity tradeoff is material", "Assumption risk is high"]
  },
  "product-release_learning": {
    goal: "Measure whether shipped releases created the intended customer and business outcome.",
    businessOutcome: "Release decisions improve because adoption, retention, and support signals feed the next product loop.",
    primaryMetric: "Release outcome attainment",
    secondaryMetrics: ["Feature adoption", "Retention lift", "Support deflection", "Regression reports"],
    observes: ["Feature flags", "Usage events", "Support tickets", "Release notes", "Customer feedback"],
    requiredDataSources: ["Feature flag system", "Product analytics", "Support system", "GitHub", "Release notes"],
    routine: ["Compare release goals to observed usage", "Check support and regression signals", "Summarize customer outcome", "Recommend continue, adjust, or rollback", "Feed learning into roadmap review"],
    verification: ["Measurement window is valid", "Usage events match release scope", "Support signals are not ignored"],
    escalation: ["Release harms key accounts", "Regression risk rises", "Rollback or roadmap change is recommended"]
  },
  "product-bug_cluster_to_problem": {
    goal: "Detect repeated bugs that reveal a deeper product, UX, or reliability problem.",
    businessOutcome: "Engineering and product fix root causes instead of repeatedly treating symptoms.",
    primaryMetric: "Recurring bug reduction",
    secondaryMetrics: ["Duplicate bug rate", "Affected users", "Support burden", "Root-cause closure"],
    observes: ["Bug reports", "Support tickets", "Session data", "Error logs", "Customer impact"],
    requiredDataSources: ["GitHub", "Support system", "Error tracking", "Product analytics", "Session recordings"],
    routine: ["Cluster bugs by workflow and user impact", "Identify shared root-cause hypotheses", "Draft product problem brief", "Prioritize by frequency and severity", "Track whether fix reduces recurrence"],
    verification: ["Cluster is not only keyword similarity", "Affected workflow is clear", "Root-cause hypothesis is testable"],
    escalation: ["Bug affects strategic accounts", "Security or data loss is possible", "Ownership crosses teams"]
  },
  "product-roadmap_signal": {
    goal: "Compare customer demand, strategy, and capacity before roadmap review.",
    businessOutcome: "Roadmap choices become evidence-backed tradeoffs rather than a queue of loud requests.",
    primaryMetric: "Roadmap evidence coverage",
    secondaryMetrics: ["Revenue represented", "Strategic fit", "Capacity confidence", "Decision age"],
    observes: ["Customer requests", "Revenue impact", "Strategic goals", "Engineering capacity", "Win/loss notes"],
    requiredDataSources: ["CRM", "Roadmap", "Linear", "Product analytics", "Customer notes"],
    routine: ["Gather demand and impact signals", "Score each theme against strategy and capacity", "Name tradeoffs and missing evidence", "Prepare roadmap decision memo", "Track decisions and revisit dates"],
    verification: ["Revenue and customer counts are current", "Capacity estimate has an owner", "Tradeoffs are explicit"],
    escalation: ["Executive priority conflict", "Major capacity mismatch", "High-value customer commitment"]
  },
  "customer_success-customer_health_risk": {
    goal: "Detect account health risk early from usage, sentiment, ticket, and renewal signals.",
    businessOutcome: "Customer teams intervene before risk becomes churn or executive escalation.",
    primaryMetric: "Risk detection lead time",
    secondaryMetrics: ["Health score recovery", "Churn risk", "Relationship hours", "Escalation accuracy"],
    observes: ["Product usage", "Support volume", "Sentiment", "Renewal date", "QBR notes"],
    requiredDataSources: ["Product analytics", "Support system", "CRM", "Customer notes", "Calendar"],
    routine: ["Combine usage, support, and renewal context", "Identify risk reason and severity", "Draft account intervention plan", "Route high-risk accounts to owner", "Track health score recovery"],
    verification: ["Risk reason is evidence-backed", "Owner and next action are clear", "Sensitive customer context is minimized"],
    escalation: ["Strategic account risk", "Renewal inside threshold", "Negative executive sentiment"]
  },
  "customer_success-support_triage": {
    goal: "Classify support requests, draft accurate responses, and route issues to the right owner.",
    businessOutcome: "Customers get faster helpful responses while complex cases reach humans sooner.",
    primaryMetric: "Time to useful response",
    secondaryMetrics: ["First contact resolution", "Escalation accuracy", "CSAT", "Reviewer edits"],
    observes: ["Ticket body", "Account plan", "Product area", "Severity", "Past interactions"],
    requiredDataSources: ["Support system", "Knowledge base", "CRM", "Product status", "Slack"],
    routine: ["Classify issue type and severity", "Fetch relevant account and knowledge context", "Draft response or internal handoff", "Verify answer against source material", "Escalate uncertain or sensitive cases"],
    verification: ["Answer cites current knowledge", "Tone fits customer context", "Product status is checked"],
    escalation: ["Customer is upset", "Bug or outage suspected", "Billing, legal, or security issue"]
  },
  "customer_success-renewal_risk": {
    goal: "Surface renewal risk early and prepare targeted retention actions.",
    businessOutcome: "Renewal conversations happen with evidence, owner accountability, and enough time to recover.",
    primaryMetric: "Renewal risk surfaced days before renewal",
    secondaryMetrics: ["At-risk ARR", "Save plan completion", "Executive alignment", "Churn probability"],
    observes: ["Renewal date", "Usage trend", "Support burden", "Champion engagement", "Contract notes"],
    requiredDataSources: ["CRM", "Product analytics", "Support system", "Contract system", "Calendar"],
    routine: ["Rank renewals by risk and time remaining", "Identify risk drivers", "Draft save plan and owner actions", "Route executive or commercial risks", "Track action completion"],
    verification: ["ARR and renewal date are current", "Risk driver is specific", "Save plan has accountable owner"],
    escalation: ["Executive sponsor needed", "Commercial concession requested", "Renewal risk is high"]
  },
  "customer_success-proactive_outreach": {
    goal: "Identify moments where proactive human outreach can create value or prevent risk.",
    businessOutcome: "Relationship time moves to accounts where it changes adoption, trust, or expansion.",
    primaryMetric: "Proactive outreach conversion",
    secondaryMetrics: ["Expansion signal", "Usage milestone", "Risk prevented", "Relationship hours"],
    observes: ["Usage milestones", "Feature adoption", "Support patterns", "Upcoming meetings", "Customer goals"],
    requiredDataSources: ["Product analytics", "CRM", "Calendar", "Customer notes", "Support system"],
    routine: ["Detect milestone, risk, or opportunity triggers", "Match trigger to customer goal", "Draft personalized outreach brief", "Route to account owner", "Record outcome and next signal"],
    verification: ["Outreach reason is customer-specific", "Timing is appropriate", "No generic automation is sent"],
    escalation: ["High-value account", "Sensitive relationship context", "Unclear customer goal"]
  },
  "customer_success-qbr_preparation": {
    goal: "Prepare evidence-backed QBR packets for high-value accounts.",
    businessOutcome: "Business reviews focus on outcomes, risks, and next commitments instead of manual reporting.",
    primaryMetric: "QBR prep time saved",
    secondaryMetrics: ["Outcome evidence coverage", "Action item completion", "Executive engagement", "Expansion opportunities"],
    observes: ["Usage outcomes", "Support history", "Commercial notes", "Goals", "Previous QBR actions"],
    requiredDataSources: ["CRM", "Product analytics", "Support system", "Slides or docs", "Calendar"],
    routine: ["Gather usage, value, and risk evidence", "Summarize goal progress and open commitments", "Draft QBR narrative and agenda", "Route to account owner for edits", "Capture next actions after meeting"],
    verification: ["Metrics match account goals", "Claims are source-backed", "Sensitive notes are excluded"],
    escalation: ["Executive attendee joins", "Value story is weak", "Commercial risk appears"]
  },
  "sales-lead_qualification": {
    goal: "Score and route leads using fit, intent, readiness, and risk signals.",
    businessOutcome: "Sales spends time on accounts with real potential and clear next actions.",
    primaryMetric: "Qualified meeting conversion",
    secondaryMetrics: ["Speed to lead", "Disqualification accuracy", "Pipeline quality", "AE review minutes"],
    observes: ["Form fields", "Firmographics", "Intent signals", "Product usage", "CRM history"],
    requiredDataSources: ["CRM", "Enrichment provider", "Product analytics", "Website forms", "Email engagement"],
    routine: ["Assemble lead fit and intent context", "Score qualification and confidence", "Draft routing reason and next action", "Send uncertain cases to sales review", "Measure meeting and opportunity outcomes"],
    verification: ["Qualification criteria are explicit", "Routing territory is correct", "Disqualification is explainable"],
    escalation: ["Enterprise or strategic account", "Conflicting ownership", "Low confidence but high potential"]
  },
  "sales-account_research": {
    goal: "Prepare concise account context and likely buying triggers before outreach.",
    businessOutcome: "Outbound and meeting prep become more relevant without adding manual research load.",
    primaryMetric: "Research-to-meeting conversion",
    secondaryMetrics: ["Personalization accuracy", "Prep time saved", "Reply rate", "Opportunity creation"],
    observes: ["Account firmographics", "Website activity", "CRM notes", "News signals", "Role context"],
    requiredDataSources: ["CRM", "Company website", "Enrichment provider", "Email history", "Calendar"],
    routine: ["Collect account context and recent signals", "Identify likely business trigger", "Draft short account brief", "Generate personalized talking points", "Log evidence and reviewer edits"],
    verification: ["Personalization is factual", "Trigger is relevant to buyer role", "No unsupported claims are used"],
    escalation: ["Strategic account", "Sensitive company news", "Existing relationship owner conflict"]
  },
  "sales-follow_up": {
    goal: "Keep meeting next steps moving with timely, accurate, personalized follow-up.",
    businessOutcome: "Deals progress because commitments, objections, and owners are not lost after calls.",
    primaryMetric: "Follow-up latency",
    secondaryMetrics: ["Next-step completion", "Meeting-to-opportunity conversion", "Reply rate", "CRM completeness"],
    observes: ["Meeting transcript", "Calendar event", "CRM opportunity", "Buyer objections", "Action items"],
    requiredDataSources: ["Calendar", "CRM", "Call notes", "Email", "Proposal docs"],
    routine: ["Extract commitments and objections from meeting notes", "Draft follow-up with next steps", "Update CRM fields and tasks", "Route sensitive claims to seller review", "Track whether next step completes"],
    verification: ["Names and commitments are correct", "Tone fits relationship stage", "CRM update is traceable"],
    escalation: ["Pricing or legal terms mentioned", "Executive buyer involved", "Seller confidence is low"]
  },
  "sales-crm_hygiene": {
    goal: "Detect stale opportunities, missing fields, and inconsistent CRM state before pipeline review.",
    businessOutcome: "Forecast and pipeline conversations use cleaner data with less seller admin burden.",
    primaryMetric: "CRM completeness",
    secondaryMetrics: ["Stale opportunity rate", "Forecast accuracy", "Admin time saved", "Manager review minutes"],
    observes: ["Opportunity stage", "Close date", "Next step", "Activity history", "Forecast category"],
    requiredDataSources: ["CRM", "Calendar", "Email", "Call notes", "Forecast sheet"],
    routine: ["Scan opportunities for missing or stale fields", "Suggest updates from recent activity", "Create seller review queue", "Apply approved CRM changes", "Report hygiene risk to manager"],
    verification: ["Suggested update cites recent activity", "Forecast fields match policy", "No customer-facing action is automated"],
    escalation: ["Forecast-impacting update", "Conflicting activity evidence", "Strategic deal lacks next step"]
  },
  "sales-deal_risk": {
    goal: "Detect stalled strategic deals and prepare manager intervention options.",
    businessOutcome: "Sales leadership focuses on deal risks that can still be changed.",
    primaryMetric: "Stalled deal recovery rate",
    secondaryMetrics: ["Deal velocity", "Risk age", "Executive coverage", "Forecast movement"],
    observes: ["Stage age", "Buyer engagement", "Next step", "Objections", "Competition"],
    requiredDataSources: ["CRM", "Email engagement", "Calendar", "Call notes", "Mutual action plan"],
    routine: ["Identify deals with stalled motion or missing buyer action", "Classify risk reason", "Draft intervention options", "Route manager or executive action", "Track whether risk clears"],
    verification: ["Risk is tied to observable deal evidence", "Recommended action has an owner", "Forecast impact is explicit"],
    escalation: ["Large forecast impact", "Executive relationship needed", "Commercial exception requested"]
  },
  "engineering-issue_to_plan": {
    goal: "Turn accepted issues into scoped implementation plans with tests, risks, and owners.",
    businessOutcome: "Engineering starts work with less ambiguity and fewer review surprises.",
    primaryMetric: "Planning cycle time",
    secondaryMetrics: ["Rework rate", "Test coverage identified", "Blocked issue age", "Review readiness"],
    observes: ["Issue description", "Acceptance criteria", "Related code areas", "Dependencies", "Bug reports"],
    requiredDataSources: ["GitHub", "Linear", "Codebase", "Docs", "CI history"],
    routine: ["Read accepted issue and context", "Identify affected surfaces and risks", "Draft implementation plan and test plan", "Route ambiguous requirements to owner", "Update issue with scoped next step"],
    verification: ["Acceptance criteria are explicit", "Test plan covers risky paths", "Dependencies are named"],
    escalation: ["Security or data migration risk", "Requirements conflict", "Owner is unclear"]
  },
  "engineering-pr_review_prep": {
    goal: "Summarize PR risk, tests, and reviewer context before review.",
    businessOutcome: "Reviewers spend less time reconstructing intent and more time catching real risk.",
    primaryMetric: "Review time saved",
    secondaryMetrics: ["Review turnaround", "Defect escape rate", "Test evidence coverage", "Reviewer load"],
    observes: ["PR diff", "Test output", "Linked issue", "Changed files", "Deployment risk"],
    requiredDataSources: ["GitHub", "CI", "Issue tracker", "Codebase", "Docs"],
    routine: ["Read PR diff and linked context", "Summarize behavior change and risk", "Collect test evidence", "Suggest reviewers and questions", "Track review corrections"],
    verification: ["Summary matches diff", "Tests are real and current", "Risk areas are not hidden"],
    escalation: ["Security-sensitive change", "Migration or rollback risk", "No clear owner"]
  },
  "engineering-qa_checklist": {
    goal: "Generate release-specific QA checks and trace outcomes.",
    businessOutcome: "Releases ship with clearer quality evidence and fewer escaped defects.",
    primaryMetric: "Escaped defect rate",
    secondaryMetrics: ["QA coverage", "Checklist completion", "Regression risk", "Release confidence"],
    observes: ["Release scope", "Changed files", "Known risks", "Past incidents", "Test results"],
    requiredDataSources: ["GitHub", "CI", "Release notes", "Incident log", "Test management"],
    routine: ["Map release scope to user workflows", "Generate targeted QA checks", "Prioritize risky paths", "Record pass/fail evidence", "Feed misses into improvement work"],
    verification: ["Checklist covers changed behavior", "Critical paths are included", "Results are traceable"],
    escalation: ["Critical path fails", "Regression risk remains high", "Release owner missing"]
  },
  "engineering-incident_learning": {
    goal: "Convert incidents into root-cause learning and prevention items.",
    businessOutcome: "Repeated incidents decline because post-incident work turns into owned system changes.",
    primaryMetric: "Incident recurrence rate",
    secondaryMetrics: ["Action item closure", "Mean time to learning", "Blast radius", "Detection gap"],
    observes: ["Incident timeline", "Alerts", "Logs", "Customer impact", "Postmortem actions"],
    requiredDataSources: ["Incident tracker", "Observability", "GitHub", "Status page", "Customer reports"],
    routine: ["Build incident timeline from evidence", "Identify contributing factors", "Draft prevention actions", "Assign owners and dates", "Check recurrence after fix"],
    verification: ["Timeline cites sources", "Action items address root causes", "Customer impact is represented accurately"],
    escalation: ["Customer data or security impact", "Ownership conflict", "Repeated severe incident"]
  },
  "engineering-release_readiness": {
    goal: "Check tests, migrations, rollback, docs, and owner readiness before release.",
    businessOutcome: "Release decisions become explicit and reversible instead of hopeful.",
    primaryMetric: "Readiness pass rate",
    secondaryMetrics: ["Rollback confidence", "Migration risk", "Documentation completeness", "Release delay avoided"],
    observes: ["CI status", "Migration plan", "Rollback plan", "Feature flags", "Owner approvals"],
    requiredDataSources: ["CI", "GitHub", "Deployment platform", "Docs", "Runbooks"],
    routine: ["Collect readiness evidence", "Check release gates", "Draft risk and rollback summary", "Route missing owners or blockers", "Record go or no-go decision"],
    verification: ["Rollback path exists", "Migration has review", "Critical owners approved"],
    escalation: ["Data migration risk", "Rollback unavailable", "Customer-facing outage risk"]
  },
  "operations_finance-approval_bottleneck": {
    goal: "Detect stuck approvals and route the next decision to the accountable owner.",
    businessOutcome: "Operational work moves faster without bypassing policy or audit requirements.",
    primaryMetric: "Approval latency",
    secondaryMetrics: ["Blocked request age", "Policy exception rate", "Owner response time", "Cycle time saved"],
    observes: ["Approval status", "Request amount", "Policy threshold", "Owner", "SLA"],
    requiredDataSources: ["Approval system", "Finance policy", "Slack", "Calendar", "Procurement records"],
    routine: ["Find approvals older than SLA", "Identify blocker and policy path", "Draft owner-specific decision request", "Escalate threshold exceptions", "Track time to unblock"],
    verification: ["Policy threshold is correct", "Approver is accountable", "Audit trail is preserved"],
    escalation: ["Spend threshold exceeded", "Missing approver", "Policy exception requested"]
  },
  "operations_finance-forecast_variance": {
    goal: "Explain material forecast changes and recommend accountable follow-up.",
    businessOutcome: "Leadership sees forecast movement early enough to make decisions.",
    primaryMetric: "Forecast variance explained",
    secondaryMetrics: ["Forecast accuracy", "Variance age", "Revenue at risk", "Decision latency"],
    observes: ["Forecast changes", "Pipeline movement", "Bookings", "Churn risk", "Expense variance"],
    requiredDataSources: ["Forecast model", "CRM", "Billing system", "Finance spreadsheet", "Revenue reports"],
    routine: ["Detect material forecast variance", "Trace drivers by account or cost line", "Draft variance memo", "Assign follow-up owners", "Review impact in management loop"],
    verification: ["Numbers reconcile to source", "Variance driver is specific", "Recommendation names tradeoff"],
    escalation: ["Material revenue miss", "Cash runway impact", "Data does not reconcile"]
  },
  "operations_finance-vendor_review": {
    goal: "Review vendor spend, usage, renewals, and ownership before commitments renew.",
    businessOutcome: "Spend decisions use value evidence and clear ownership instead of auto-renewal drift.",
    primaryMetric: "Vendor value coverage",
    secondaryMetrics: ["Spend avoided", "Renewal risk", "License utilization", "Owner clarity"],
    observes: ["Vendor spend", "Contract renewal", "Usage", "Owner", "Security review"],
    requiredDataSources: ["Procurement system", "Billing system", "SSO usage", "Contract repository", "Security review"],
    routine: ["Find upcoming vendor renewals", "Compare spend to usage and owner need", "Draft renewal recommendation", "Route security or legal exceptions", "Record decision and next review date"],
    verification: ["Usage data is current", "Business owner confirms need", "Contract risk is checked"],
    escalation: ["High spend renewal", "No business owner", "Security or legal issue"]
  },
  "operations_finance-close_readiness": {
    goal: "Track month-end close blockers and evidence before close review.",
    businessOutcome: "Finance closes faster with fewer surprises and clearer accountability.",
    primaryMetric: "Close readiness score",
    secondaryMetrics: ["Close time", "Open reconciliations", "Exception count", "Controller review minutes"],
    observes: ["Reconciliation status", "Journal entries", "Approvals", "Exception list", "Close calendar"],
    requiredDataSources: ["ERP", "Close checklist", "Bank feeds", "Billing system", "Approval system"],
    routine: ["Scan close checklist for blockers", "Match exceptions to owners", "Draft close readiness summary", "Escalate unresolved material items", "Track close completion and rework"],
    verification: ["Numbers reconcile", "Material exceptions are named", "Owner and due date are clear"],
    escalation: ["Material unreconciled item", "Late approval", "Control failure"]
  },
  "operations_finance-cash_collection": {
    goal: "Detect invoice risk and prepare owner follow-up before cash collection slips.",
    businessOutcome: "Cash collection improves through timely, accurate, relationship-aware follow-up.",
    primaryMetric: "At-risk cash recovered",
    secondaryMetrics: ["Days sales outstanding", "Past-due amount", "Follow-up latency", "Dispute resolution time"],
    observes: ["Invoice age", "Payment history", "Customer notes", "Disputes", "Account owner"],
    requiredDataSources: ["Billing system", "CRM", "Email", "Support tickets", "Collections sheet"],
    routine: ["Rank invoices by risk and amount", "Identify reason for nonpayment", "Draft owner follow-up plan", "Route sensitive customer communication to approval", "Track payment or dispute outcome"],
    verification: ["Invoice status is current", "Customer context is checked", "Communication owner approves"],
    escalation: ["Large past-due balance", "Customer dispute", "Legal or relationship risk"]
  },
  "hr-candidate_pipeline": {
    goal: "Track candidate stage, missing feedback, and next action across the hiring pipeline.",
    businessOutcome: "Hiring teams reduce candidate drop-off and make decisions with better evidence.",
    primaryMetric: "Candidate stage latency",
    secondaryMetrics: ["Feedback completion", "Candidate experience", "Offer conversion", "Time to hire"],
    observes: ["Candidate stage", "Interview feedback", "Role priority", "Scheduling status", "Offer status"],
    requiredDataSources: ["ATS", "Calendar", "Interview notes", "Email", "Hiring plan"],
    routine: ["Find candidates stuck by stage", "Identify missing feedback or owner action", "Draft recruiter and interviewer nudges", "Escalate late hiring decisions", "Track stage movement"],
    verification: ["Candidate data is current", "Feedback request is role-specific", "Sensitive notes are minimized"],
    escalation: ["Offer-stage delay", "Potential bias signal", "Hiring manager decision overdue"]
  },
  "hr-onboarding_progress": {
    goal: "Detect onboarding gaps and route manager actions for new hires.",
    businessOutcome: "New hires reach productivity faster with fewer missed setup or manager touchpoints.",
    primaryMetric: "Onboarding completion",
    secondaryMetrics: ["Time to first contribution", "Manager check-in completion", "Access readiness", "New hire sentiment"],
    observes: ["Onboarding checklist", "Access setup", "Manager meetings", "Training progress", "New hire feedback"],
    requiredDataSources: ["HRIS", "Calendar", "IT tickets", "Learning system", "Manager notes"],
    routine: ["Check onboarding milestones by hire date", "Identify missing access or meetings", "Draft manager action list", "Escalate blocked setup", "Record completion and feedback"],
    verification: ["Checklist matches role", "No private feedback is overexposed", "Manager owns next action"],
    escalation: ["Access blocker", "Manager check-in missed", "Sensitive new hire concern"]
  },
  "hr-manager_coaching": {
    goal: "Summarize recurring team signals into responsible manager coaching prompts.",
    businessOutcome: "Managers get timely support while sensitive people data stays human-owned.",
    primaryMetric: "Coaching action completion",
    secondaryMetrics: ["Team sentiment trend", "Manager follow-through", "Retention risk", "Coaching hours"],
    observes: ["Engagement survey", "One-on-one themes", "Team delivery signals", "Feedback patterns", "Manager actions"],
    requiredDataSources: ["Survey tool", "Calendar", "Manager notes", "HRIS", "Project system"],
    routine: ["Detect recurring team or manager signals", "Summarize coaching theme with safeguards", "Draft private coaching prompt", "Route to people partner review", "Track follow-up action"],
    verification: ["Sensitive details are minimized", "Prompt is supportive not punitive", "Evidence is not overgeneralized"],
    escalation: ["Potential discrimination or harassment", "High retention risk", "Manager conflict"]
  },
  "hr-retention_signal": {
    goal: "Surface retention risks with privacy, fairness, and human judgment controls.",
    businessOutcome: "People teams intervene thoughtfully before preventable attrition occurs.",
    primaryMetric: "Retention risk action rate",
    secondaryMetrics: ["Regrettable attrition", "Engagement trend", "Manager follow-up", "Fairness review"],
    observes: ["Engagement signals", "Role changes", "Manager check-ins", "Workload indicators", "Career growth notes"],
    requiredDataSources: ["HRIS", "Survey tool", "Calendar", "Manager notes", "Project system"],
    routine: ["Identify retention risk patterns", "Filter out unsupported or sensitive inferences", "Draft human review brief", "Assign people partner follow-up", "Measure action completion"],
    verification: ["No protected-class inference is used", "Evidence is appropriate", "Human owner approves any action"],
    escalation: ["High attrition risk", "Potential fairness issue", "Sensitive employee concern"]
  },
  "hr-performance_review_prep": {
    goal: "Prepare fair, evidence-backed review packets for managers.",
    businessOutcome: "Performance conversations become more balanced, specific, and less administratively heavy.",
    primaryMetric: "Review evidence completeness",
    secondaryMetrics: ["Manager prep time saved", "Calibration edits", "Fairness flags", "Feedback specificity"],
    observes: ["Goals", "Peer feedback", "Manager notes", "Project outcomes", "Calibration guidance"],
    requiredDataSources: ["HRIS", "Performance system", "Project system", "Manager notes", "Feedback forms"],
    routine: ["Collect evidence tied to goals", "Balance accomplishments and growth areas", "Flag missing or biased evidence", "Draft manager packet", "Route to manager and people partner review"],
    verification: ["Evidence is recent and specific", "Sensitive data is excluded", "Fairness checks pass"],
    escalation: ["Adverse employment decision", "Bias risk", "Insufficient evidence"]
  },
  "legal_security-contract_triage": {
    goal: "Extract contract clauses, compare them to playbook, and route exceptions.",
    businessOutcome: "Contract review cycles speed up while legal judgment stays focused on material risk.",
    primaryMetric: "Contract triage cycle time",
    secondaryMetrics: ["Exception accuracy", "Legal review minutes", "Risk exposure", "Sales cycle impact"],
    observes: ["Contract text", "Clause playbook", "Deal context", "Customer redlines", "Risk tier"],
    requiredDataSources: ["Contract repository", "Clause playbook", "CRM", "Email", "Legal ticketing"],
    routine: ["Extract clauses and requested changes", "Compare to approved playbook", "Classify exceptions and risk", "Draft legal review summary", "Track approval or fallback language"],
    verification: ["Clause citation is exact", "Playbook match is current", "Risk tier is justified"],
    escalation: ["Nonstandard liability or data terms", "Large deal exposure", "Legal interpretation required"]
  },
  "legal_security-policy_drift": {
    goal: "Detect product, process, or control changes that require policy review.",
    businessOutcome: "Security and legal controls stay current as the company changes.",
    primaryMetric: "Policy drift detection time",
    secondaryMetrics: ["Control coverage", "Exception age", "Audit readiness", "Reviewer effort"],
    observes: ["Code changes", "Access changes", "Process updates", "Policy documents", "Audit findings"],
    requiredDataSources: ["GitHub", "Policy repository", "Access logs", "Audit findings", "Change tickets"],
    routine: ["Detect changes touching regulated or controlled areas", "Compare against current policy", "Draft drift summary and owner action", "Route exceptions for review", "Track policy update or control fix"],
    verification: ["Change is mapped to specific policy", "Owner is accountable", "Audit trail is preserved"],
    escalation: ["Policy exception", "Customer contractual impact", "Critical control drift"]
  },
  "legal_security-access_review": {
    goal: "Track access exceptions and owner approvals across sensitive systems.",
    businessOutcome: "Access risk decreases without turning quarterly reviews into manual spreadsheet work.",
    primaryMetric: "Access exception closure",
    secondaryMetrics: ["Overdue access reviews", "Privilege reduction", "Owner approval rate", "Audit readiness"],
    observes: ["User access", "Role changes", "Manager approvals", "System criticality", "Exceptions"],
    requiredDataSources: ["Identity provider", "Access logs", "HRIS", "Ticketing", "System inventory"],
    routine: ["Identify access that needs review", "Match users to owners and roles", "Draft approval or removal queue", "Escalate overdue exceptions", "Record decision evidence"],
    verification: ["Owner mapping is current", "Least privilege policy is applied", "Decision is auditable"],
    escalation: ["Privileged access", "Terminated user access", "Owner does not respond"]
  },
  "legal_security-incident_evidence": {
    goal: "Collect incident evidence and prepare review summaries for legal and security owners.",
    businessOutcome: "Incident response uses complete evidence without exposing unnecessary sensitive detail.",
    primaryMetric: "Evidence packet completeness",
    secondaryMetrics: ["Incident response time", "Chain-of-custody coverage", "Reviewer edits", "Remediation closure"],
    observes: ["Incident timeline", "Logs", "Alerts", "Customer impact", "Remediation actions"],
    requiredDataSources: ["SIEM", "Incident tracker", "Cloud logs", "GitHub", "Status page"],
    routine: ["Collect time-bounded incident evidence", "Build source-cited timeline", "Draft impact and remediation summary", "Route legal or security review", "Track evidence gaps and follow-up"],
    verification: ["Evidence source and time window are clear", "Sensitive data is minimized", "Chain of custody is preserved"],
    escalation: ["Possible breach", "Customer notification risk", "Evidence gap blocks decision"]
  },
  "legal_security-security_questionnaire": {
    goal: "Draft evidence-backed security questionnaire responses for human review.",
    businessOutcome: "Sales and security respond faster while customer-facing claims stay accurate.",
    primaryMetric: "Questionnaire turnaround time",
    secondaryMetrics: ["Citation coverage", "Reviewer rework", "Deal unblock rate", "Unsupported claim count"],
    observes: ["Questionnaire questions", "Security docs", "Control evidence", "Customer requirements", "Past approved answers"],
    requiredDataSources: ["Security knowledge base", "Policy repository", "SOC 2 evidence", "CRM", "Past questionnaires"],
    routine: ["Map questions to approved evidence", "Draft concise answers with citations", "Flag unsupported or changed controls", "Route security review", "Store approved reusable answer"],
    verification: ["Every claim has evidence", "Answer matches current control state", "Customer-specific commitments are reviewed"],
    escalation: ["Unsupported control claim", "Contractual commitment requested", "Sensitive architecture detail"]
  },
  "management-weekly_anomaly_review": {
    goal: "Detect important company metric drift and prepare leadership decisions.",
    businessOutcome: "Management attention moves quickly to anomalies that need ownership or tradeoffs.",
    primaryMetric: "Anomaly decision latency",
    secondaryMetrics: ["Metric drift magnitude", "Owner assignment rate", "False alarm rate", "Decision follow-through"],
    observes: ["Company metrics", "Department rollups", "Loop health", "Escalations", "Recent decisions"],
    requiredDataSources: ["Metrics warehouse", "Loopgraph traces", "CRM", "Finance reports", "Project system"],
    routine: ["Scan key metrics for meaningful drift", "Separate noise from actionable anomaly", "Draft owner-specific decision options", "Route leadership review", "Track follow-through"],
    verification: ["Baseline and comparison window are valid", "Anomaly has likely driver", "Decision owner is explicit"],
    escalation: ["Revenue or churn anomaly", "Cross-functional owner conflict", "Capital allocation decision"]
  },
  "management-department_loop_review": {
    goal: "Roll up department loop health, bottlenecks, reviews, and improvement work.",
    businessOutcome: "Leaders see which operating loops are creating value and which ones need intervention.",
    primaryMetric: "Loop health recovery",
    secondaryMetrics: ["Open review age", "Improvement throughput", "Hidden labor ratio", "Department bottleneck age"],
    observes: ["Loop health", "Human reviews", "Improvement items", "Hidden labor", "Department metrics"],
    requiredDataSources: ["Loopgraph traces", "Review queue", "Improvement backlog", "Metrics warehouse", "Project system"],
    routine: ["Read health and hidden labor by department", "Identify bottlenecks and repeated failure modes", "Draft department review summary", "Assign improvement owners", "Track whether health recovers"],
    verification: ["Health score ties to trace evidence", "Bottleneck has owner", "Recommendation names tradeoffs"],
    escalation: ["Repeated loop failure", "Unowned bottleneck", "Department goal at risk"]
  },
  "management-decision_memo": {
    goal: "Turn ambiguous signals into decision options with evidence, tradeoffs, and owners.",
    businessOutcome: "Leadership decisions become faster, clearer, and easier to audit later.",
    primaryMetric: "Decision memo acceptance rate",
    secondaryMetrics: ["Decision latency", "Evidence coverage", "Tradeoff clarity", "Owner follow-through"],
    observes: ["Metric changes", "Customer evidence", "Financial impact", "Capacity constraints", "Risk notes"],
    requiredDataSources: ["Metrics warehouse", "CRM", "Finance reports", "Project system", "Loopgraph traces"],
    routine: ["Collect signals around the decision", "Frame options and tradeoffs", "Estimate impact and risk", "Draft memo with recommendation", "Record decision and owner"],
    verification: ["Options are mutually clear", "Evidence supports recommendation", "Risks and reversibility are named"],
    escalation: ["Strategic tradeoff", "High financial impact", "Insufficient evidence for decision"]
  },
  "management-resource_allocation": {
    goal: "Match goals, bottlenecks, capacity, and constraints before resource decisions.",
    businessOutcome: "People, budget, and attention move to the highest-leverage constraints.",
    primaryMetric: "Constraint resolution speed",
    secondaryMetrics: ["Capacity confidence", "Bottleneck age", "Goal impact", "Reallocation follow-through"],
    observes: ["Team capacity", "Goal progress", "Bottlenecks", "Budget", "Loop health"],
    requiredDataSources: ["Project system", "Finance reports", "People plan", "Loopgraph traces", "Metrics warehouse"],
    routine: ["Compare goals to current bottlenecks", "Estimate capacity and cost tradeoffs", "Draft allocation options", "Route leadership decision", "Track whether constraint improves"],
    verification: ["Capacity source is current", "Tradeoff is explicit", "Owner and success metric are clear"],
    escalation: ["Capital allocation required", "Hiring or budget change", "Cross-functional priority conflict"]
  },
  "management-improvement": {
    goal: "Convert loop failures, reviewer corrections, and trace evidence into owned system changes.",
    businessOutcome: "The operating system gets better each week instead of repeating the same human corrections.",
    primaryMetric: "Improvement closure rate",
    secondaryMetrics: ["Repeated failure reduction", "Reviewer correction rate", "Autonomy readiness", "Hidden labor saved"],
    observes: ["Improvement items", "Reviewer corrections", "Failure modes", "Loop health", "Trace evidence"],
    requiredDataSources: ["Improvement backlog", "Review queue", "Loopgraph traces", "Project system", "Metrics warehouse"],
    routine: ["Cluster repeated failure modes", "Prioritize improvements by value and risk", "Assign owners and due dates", "Verify changes against new traces", "Recommend autonomy changes when evidence supports it"],
    verification: ["Improvement links to trace evidence", "Owner and acceptance criteria are clear", "Closure reduced repeated failure"],
    escalation: ["Repeated high-risk failure", "No owner accepts work", "Autonomy increase requested"]
  },
  "management-operating_rhythm": {
    goal: "Keep recurring leadership cadences connected to trace-backed decisions and follow-up.",
    businessOutcome: "Meetings become shorter and more useful because each cadence has evidence, decisions, and owners.",
    primaryMetric: "Operating cadence follow-through",
    secondaryMetrics: ["Decision carryover", "Meeting time saved", "Owner completion", "Unresolved risk age"],
    observes: ["Meeting agendas", "Decision log", "Loop health", "Action items", "Metric rollups"],
    requiredDataSources: ["Calendar", "Decision log", "Loopgraph traces", "Project system", "Metrics warehouse"],
    routine: ["Prepare cadence agenda from traces and decisions", "Highlight unresolved owners and risks", "Draft decision and follow-up list", "Route pre-read to leaders", "Close the loop after meeting"],
    verification: ["Agenda items tie to evidence", "Follow-ups have owners", "Old decisions are not lost"],
    escalation: ["Decision keeps carrying over", "Unowned cross-functional risk", "Leadership attention conflict"]
  },
  "engineering-incident_response": {
    goal: "Stabilize production incidents quickly while preserving one source of truth for technical and customer impact.",
    businessOutcome: "Incidents have clear ownership, bounded supporting work, safer communication, and faster mitigation.",
    primaryMetric: "Time to mitigation",
    secondaryMetrics: ["Time to ownership", "Customer impact duration", "Evidence completeness", "Recurrence rate"],
    observes: ["Incident state", "Service health", "Customer impact", "Mitigation actions", "Decision timeline"],
    requiredDataSources: ["Incident tracker", "Observability", "Repository", "Deployments", "CRM"],
    routine: ["Establish incident identity and severity", "Assign accountable incident owner", "Collect current technical and customer evidence", "Prepare bounded mitigation actions", "Permit declared customer and learning routes only when evidence supports them"],
    verification: ["One primary incident problem exists", "Mitigation evidence is current", "Affected accounts are explicit", "Actions respect approval policy"],
    escalation: ["Critical severity", "Unclear blast radius", "Security or legal implication", "Material customer impact"]
  },
  "customer_success-customer_communication_review": {
    goal: "Prepare accurate, timely, audience-specific customer communication from verified incident facts.",
    businessOutcome: "Affected customers receive trustworthy updates without speculation or conflicting promises.",
    primaryMetric: "Approved communication latency",
    secondaryMetrics: ["Fact correction rate", "Customer response", "Approval time", "Promise accuracy"],
    observes: ["Known incident facts", "Affected accounts", "Service status", "Approved commitments", "Prior messages"],
    requiredDataSources: ["Incident tracker", "CRM", "Status page", "Communication drafts", "Approval log"],
    routine: ["Resolve the affected audience", "Separate verified facts from unknowns", "Draft audience-specific update", "Route accountable approval", "Return customer response as incident evidence"],
    verification: ["Every claim maps to current incident evidence", "Unknowns are explicit", "Commitments are approved"],
    escalation: ["Possible breach", "Contractual commitment", "Strategic account harm", "Conflicting facts"]
  },
  "sales-pipeline_outcome": {
    goal: "Connect campaign cohorts and qualification decisions to pipeline, revenue, and customer outcomes.",
    businessOutcome: "Marketing and Sales optimize for qualified customers rather than inexpensive surface-level leads.",
    primaryMetric: "Qualified pipeline per campaign cohort",
    secondaryMetrics: ["Opportunity conversion", "Revenue conversion", "Time to qualify", "Healthy customer rate"],
    observes: ["Campaign cohort", "Lead qualification", "Opportunity stage", "Revenue outcome", "Customer health"],
    requiredDataSources: ["CRM", "Billing system", "Product analytics", "Customer success system", "Campaign attribution"],
    routine: ["Join leads to a campaign cohort", "Measure qualification and opportunity progression", "Resolve revenue and early customer outcome", "Explain loss or quality patterns", "Return evidence to campaign and ICP learning"],
    verification: ["Cohort identity is stable", "Qualification definitions are consistent", "Revenue and customer evidence is attributable"],
    escalation: ["Attribution conflict", "Material pipeline discrepancy", "Missing customer outcome window"]
  },
  "operations_finance-resource_allocation": {
    goal: "Prepare reconciled financial and capacity tradeoffs before resources move.",
    businessOutcome: "Budget and capacity follow evidenced constraints with accountable approval.",
    primaryMetric: "Resource decision cycle time",
    secondaryMetrics: ["Constraint resolution", "Forecast impact", "Approval latency", "Decision follow-through"],
    observes: ["Forecast variance", "Budget", "Capacity", "Operating constraint", "Decision options"],
    requiredDataSources: ["Finance system", "Capacity plan", "Project system", "Approval system", "Metrics warehouse"],
    routine: ["Reconcile the financial baseline", "Name the operating constraint", "Compare allocation options", "Prepare impact and risk", "Route an accountable management decision"],
    verification: ["Numbers reconcile", "Constraint and alternatives are explicit", "Decision owner is accountable"],
    escalation: ["Material spend", "Hiring or headcount change", "Runway impact", "Cross-functional conflict"]
  },
  "legal_security-compliance_evidence": {
    goal: "Assemble current control evidence with exact sources, owners, gaps, and review boundaries.",
    businessOutcome: "Audits and customer assurance move faster without unsupported security or compliance claims.",
    primaryMetric: "Evidence request cycle time",
    secondaryMetrics: ["Citation coverage", "Stale evidence rate", "Control gap age", "Reviewer rework"],
    observes: ["Evidence request", "Control state", "Policy version", "Audit window", "Owner attestation"],
    requiredDataSources: ["Control system", "Policy repository", "Cloud logs", "Ticketing", "Audit repository"],
    routine: ["Resolve requested controls and time window", "Collect minimum necessary source evidence", "Validate owner and freshness", "Flag gaps without inferring compliance", "Route qualified review and record approval"],
    verification: ["Every assertion has a source", "Evidence is current for the requested window", "Sensitive data is minimized"],
    escalation: ["Material control gap", "Possible breach", "Unsupported external claim", "Legal interpretation required"]
  },
  "custom-custom_company_loop": {
    goal: "Define one recurring workflow with observable signals, accountable owners, verification, and improvement.",
    businessOutcome: "A custom operating loop becomes explicit enough to run, review, and improve.",
    primaryMetric: "Workflow cycle time",
    secondaryMetrics: ["Output quality", "Review time", "Rework rate", "Business outcome"],
    observes: ["Workflow input", "Current status", "Owner notes", "Output evidence", "Review decision"],
    requiredDataSources: ["Manual input", "Workspace documents", "System of record", "Metrics source"],
    routine: ["Capture the recurring work item", "Draft next action from source evidence", "Verify output against rubric", "Route human review when needed", "Record trace and improvement item"],
    verification: ["Goal is measurable", "Output cites evidence", "Owner and escalation path are clear"],
    escalation: ["Data is missing", "Confidence is low", "Human judgment or approval is required"]
  }
};

const departments: DepartmentTemplate[] = [
  {
    key: "product",
    name: "Product",
    description:
      "Loops for turning customer evidence into product problems, bets, releases, and learning.",
    commonLoops: [
      loop("product", "feedback_to_problem", "Feedback to Problem Loop", "Cluster feedback and convert repeated pain into well-formed product problems."),
      loop("product", "problem_to_product_bet", "Problem to Product Bet Loop", "Turn a validated problem into a scoped product bet."),
      loop("product", "release_learning", "Release Learning Loop", "Compare shipped releases against adoption and customer outcome signals."),
      loop("product", "bug_cluster_to_problem", "Bug Cluster to Product Problem Loop", "Detect repeated bugs that point to deeper product or UX problems."),
      loop("product", "roadmap_signal", "Roadmap Signal Loop", "Compare customer demand, strategy, and capacity before roadmap review.")
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
    key: "customer_success",
    name: "Customer Success",
    description:
      "Loops for health monitoring, support triage, renewal risk, and proactive customer outreach.",
    commonLoops: [
      strategicAccountEscalationTemplate,
      supportTicketTriageTemplate,
      loop("customer_success", "customer_health_risk", "Customer Health Risk Loop", "Detect risk from usage, sentiment, tickets, and renewal context."),
      loop("customer_success", "customer_communication_review", "Customer Communication Review Loop", "Prepare and approve fact-checked customer communication for incidents and material service changes."),
      loop("customer_success", "support_triage", "Support Triage Loop", "Classify, route, and draft support responses with human escalation."),
      loop("customer_success", "renewal_risk", "Renewal Risk Loop", "Surface renewal risk early and generate account intervention plans."),
      loop("customer_success", "proactive_outreach", "Proactive Outreach Loop", "Identify moments where proactive human outreach matters."),
      loop("customer_success", "qbr_preparation", "QBR Preparation Loop", "Prepare evidence-backed business review packets for high-value accounts.")
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
      loop("sales", "pipeline_outcome", "Pipeline Outcome Loop", "Return qualified pipeline and customer outcomes to the campaign and qualification loops that created them."),
      loop("sales", "account_research", "Account Research Loop", "Prepare concise account context and likely buying triggers."),
      loop("sales", "follow_up", "Follow-up Loop", "Keep next steps moving after meetings without losing personalization."),
      loop("sales", "crm_hygiene", "CRM Hygiene Loop", "Detect stale opportunities and missing fields."),
      loop("sales", "deal_risk", "Deal Risk Loop", "Detect stalled strategic deals and prepare manager intervention options.")
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
      githubIssueTriageTemplate,
      loop("engineering", "incident_response", "Incident Response Loop", "Coordinate production incident ownership, mitigation, evidence, and governed supporting routes."),
      loop("engineering", "issue_to_plan", "Issue to Implementation Plan Loop", "Turn accepted issues into scoped implementation plans."),
      loop("engineering", "pr_review_prep", "PR Review Prep Loop", "Summarize risk, tests, and reviewer context before review."),
      loop("engineering", "qa_checklist", "QA Checklist Loop", "Generate release-specific QA checks and trace outcomes."),
      loop("engineering", "incident_learning", "Incident Learning Loop", "Convert incidents into root-cause learning and prevention items."),
      loop("engineering", "release_readiness", "Release Readiness Loop", "Check tests, migrations, rollback, docs, and owner readiness before release.")
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
      loop("operations_finance", "close_readiness", "Close Readiness Loop", "Track month-end close blockers and evidence."),
      loop("operations_finance", "cash_collection", "Cash Collection Loop", "Detect invoice risk, owner follow-up, and customer communication needs."),
      loop("operations_finance", "resource_allocation", "Finance Resource Allocation Loop", "Prepare reconciled budget and capacity tradeoffs for an accountable resource decision.")
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
      loop("hr", "retention_signal", "Retention Signal Loop", "Surface retention risks with privacy and fairness controls."),
      loop("hr", "performance_review_prep", "Performance Review Prep Loop", "Prepare fair, evidence-backed review packets for managers.")
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
      loop("legal_security", "incident_evidence", "Incident Evidence Loop", "Collect incident evidence and prepare review summaries."),
      loop("legal_security", "security_questionnaire", "Security Questionnaire Loop", "Draft evidence-backed security questionnaire responses for review."),
      loop("legal_security", "compliance_evidence", "Compliance Evidence Loop", "Assemble current, source-cited control evidence and route material gaps to qualified owners.")
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
      managementReviewTemplate,
      loop("management", "weekly_anomaly_review", "Weekly Anomaly Review Loop", "Detect important company metric drift and prepare decisions."),
      loop("management", "department_loop_review", "Department Loop Review", "Roll up loop health, bottlenecks, reviews, and improvement work."),
      loop("management", "decision_memo", "Decision Memo Loop", "Turn ambiguous signals into decision options with tradeoffs."),
      loop("management", "resource_allocation", "Resource Allocation Loop", "Match goals, bottlenecks, capacity, and constraints."),
      loop("management", "improvement", "Improvement Loop", "Convert loop failures and human corrections into system changes."),
      loop("management", "operating_rhythm", "Operating Rhythm Loop", "Keep recurring leadership cadences connected to trace-backed decisions.")
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
      loop("custom", "custom_company_loop", "Custom Company Loop", "Design a specific observable, goal-driven, verified, improvable loop.", "catalog")
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

const departmentOwners: Record<DepartmentKey, string[]> = {
  marketing: ["Marketing lead", "Growth owner"],
  sales: ["Sales manager", "Account executive"],
  product: ["Product lead", "Design partner"],
  engineering: ["Engineering lead", "Incident owner"],
  customer_success: ["Customer success owner", "Account owner"],
  operations_finance: ["Operations owner", "Finance controller"],
  hr: ["People lead", "Hiring manager"],
  legal_security: ["Security owner", "Legal reviewer"],
  management: ["Leadership team", "Operating owner"],
  custom: ["Loop owner"]
};

const hiddenLaborDefaults: Record<DepartmentKey, LoopTemplate["defaultHiddenLabor"]> = {
  marketing: { baselineMinutes: 420, loopExecutionMinutes: 160, reviewMinutes: 42, reworkMinutes: 28, botsittingMinutes: 22, escalationMinutes: 18, governanceMinutes: 10, relationshipRedeploymentMinutes: 90, qualityScore: 84 },
  sales: { baselineMinutes: 360, loopExecutionMinutes: 150, reviewMinutes: 34, reworkMinutes: 24, botsittingMinutes: 18, escalationMinutes: 26, governanceMinutes: 8, relationshipRedeploymentMinutes: 100, qualityScore: 82 },
  product: { baselineMinutes: 390, loopExecutionMinutes: 168, reviewMinutes: 44, reworkMinutes: 32, botsittingMinutes: 24, escalationMinutes: 28, governanceMinutes: 12, relationshipRedeploymentMinutes: 72, qualityScore: 83 },
  engineering: { baselineMinutes: 330, loopExecutionMinutes: 144, reviewMinutes: 46, reworkMinutes: 36, botsittingMinutes: 26, escalationMinutes: 20, governanceMinutes: 10, relationshipRedeploymentMinutes: 54, qualityScore: 81 },
  customer_success: { baselineMinutes: 410, loopExecutionMinutes: 172, reviewMinutes: 48, reworkMinutes: 26, botsittingMinutes: 20, escalationMinutes: 34, governanceMinutes: 12, relationshipRedeploymentMinutes: 110, qualityScore: 85 },
  operations_finance: { baselineMinutes: 380, loopExecutionMinutes: 156, reviewMinutes: 38, reworkMinutes: 22, botsittingMinutes: 18, escalationMinutes: 24, governanceMinutes: 20, relationshipRedeploymentMinutes: 46, qualityScore: 86 },
  hr: { baselineMinutes: 340, loopExecutionMinutes: 150, reviewMinutes: 44, reworkMinutes: 26, botsittingMinutes: 20, escalationMinutes: 28, governanceMinutes: 18, relationshipRedeploymentMinutes: 82, qualityScore: 82 },
  legal_security: { baselineMinutes: 420, loopExecutionMinutes: 190, reviewMinutes: 64, reworkMinutes: 30, botsittingMinutes: 28, escalationMinutes: 42, governanceMinutes: 28, relationshipRedeploymentMinutes: 48, qualityScore: 88 },
  management: { baselineMinutes: 300, loopExecutionMinutes: 116, reviewMinutes: 52, reworkMinutes: 18, botsittingMinutes: 16, escalationMinutes: 40, governanceMinutes: 24, relationshipRedeploymentMinutes: 60, qualityScore: 84 },
  custom: { baselineMinutes: 300, loopExecutionMinutes: 144, reviewMinutes: 36, reworkMinutes: 24, botsittingMinutes: 18, escalationMinutes: 20, governanceMinutes: 12, relationshipRedeploymentMinutes: 48, qualityScore: 80 }
};

const packTemplatesByDepartment = new Map<DepartmentKey, LoopTemplate[]>();
for (const entry of GENERATED_OFFICIAL_APP_CATALOG.entries) {
  const template = entry.template;
  const department = template.department as DepartmentKey;
  const existing = packTemplatesByDepartment.get(department) ?? [];
  existing.push({
    ...template,
    secondaryMetrics: [...template.secondaryMetrics],
    observes: [...template.observes],
    requiredDataSources: [...template.requiredDataSources],
    routine: [...template.routine],
    verification: [...template.verification],
    escalation: [...template.escalation],
    fixturePaths: [...template.fixturePaths]
  });
  packTemplatesByDepartment.set(department, existing);
}

export const departmentTemplates: DepartmentTemplate[] = departments.map((department) => {
  const packTemplates = packTemplatesByDepartment.get(department.key);
  const unmatchedLegacyTemplates = department.commonLoops.filter((template) =>
    !(template.id in LEGACY_COMPANY_LOOP_TEMPLATE_ALIASES));
  return {
    ...department,
    commonLoops: [...(packTemplates ?? []), ...unmatchedLegacyTemplates]
      .map((template) => enrichTemplate(department, template))
  };
});

export function getTemplateCatalog() {
  return departmentTemplates.flatMap((department) => department.commonLoops);
}

export function getDepartmentTemplates() {
  return departmentTemplates;
}

export function getDepartmentTemplate(department: DepartmentKey) {
  return departmentTemplates.find((template) => template.key === department);
}

export function getTemplateById(templateId: string) {
  const canonicalId = resolveCompanyLoopTemplateId(templateId);
  return getTemplateCatalog().find((template) => template.id === canonicalId);
}

export function getTemplatesForDepartment(department: DepartmentKey) {
  return getDepartmentTemplate(department)?.commonLoops ?? [];
}

function enrichTemplate(department: DepartmentTemplate, template: LoopTemplate): LoopTemplate {
  const detailedTemplate = {
    ...(templateDetailsById[template.id] ?? {}),
    ...template
  };
  const metrics = detailedTemplate.defaultMetrics ?? Array.from(new Set([
    detailedTemplate.primaryMetric ?? department.commonMetrics[0] ?? "Quality-adjusted output",
    ...(detailedTemplate.secondaryMetrics ?? []),
    ...department.commonMetrics
  ])).slice(0, 5);
  const owners = detailedTemplate.defaultOwners ?? departmentOwners[department.key];
  const dataSources = detailedTemplate.requiredDataSources ?? department.commonDataSources;

  return {
    ...detailedTemplate,
    primaryMetric: detailedTemplate.primaryMetric ?? department.commonMetrics[0] ?? "Quality-adjusted output",
    defaultMetrics: Array.from(new Set(metrics)).slice(0, 5),
    defaultOwners: owners,
    routingDefinition: getPrebuiltLoopDefinition(template.id),
    defaultHiddenLabor: {
      ...hiddenLaborDefaults[department.key],
      ...detailedTemplate.defaultHiddenLabor
    },
    connections: detailedTemplate.connections ?? [
      ...dataSources.slice(0, 4).map((source) => ({
        kind: "data_source" as const,
        target: titleCase(source),
        label: "observes"
      })),
      ...owners.slice(0, 2).map((owner) => ({
        kind: "owner" as const,
        target: owner,
        label: "owned by"
      })),
      ...Array.from(new Set(metrics)).slice(0, 3).map((metric) => ({
        kind: "metric" as const,
        target: metric,
        label: "measured by"
      })),
      {
        kind: "rollup" as const,
        target: "Management Loop",
        label: "rolls up"
      }
    ]
  };
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
