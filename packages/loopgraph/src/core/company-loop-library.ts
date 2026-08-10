import { z } from "zod";
import { GENERATED_OFFICIAL_APP_CATALOG } from "../generated/official-app-catalog";
import { DepartmentTypeSchema, type DepartmentType } from "./department-skills";

export const COMPANY_LOOP_LIBRARY_SCHEMA_VERSION = "company-loop-library/v1alpha1" as const;
export const DEPARTMENT_OPERATING_SKILL_PROTOCOL_VERSION = "loopgraph-department-skill/v1alpha1" as const;

export const HERMES_ROUTER_EVALUATION_QUESTIONS = [
  "What happened?",
  "Which company object is affected?",
  "Is this a new problem or additional evidence for an existing problem?",
  "Which loops claim to handle this problem type?",
  "Which loops have the required context?",
  "Which loops are currently active and connected?",
  "Are any exclusion rules matched?",
  "Is there one clear route?",
  "Is explicit fan-out permitted?",
  "Should Hermes abstain and ask a human?"
] as const;

export const prebuiltLoopDefinitionSchema = z.object({
  schemaVersion: z.literal(COMPANY_LOOP_LIBRARY_SCHEMA_VERSION),
  templateId: z.string().min(1),
  departmentType: DepartmentTypeSchema,
  problemTypes: z.array(z.string().min(1)).min(1),
  eventTypes: z.array(z.string().min(1)).min(1),
  subjectTypes: z.array(z.string().min(1)).min(1),
  requiredContext: z.array(z.string().min(1)).min(1),
  requiredConnections: z.array(z.string().min(1)).min(1),
  exclusionRules: z.array(z.object({
    eventTypePattern: z.string().min(1),
    fields: z.array(z.string().min(1)).default([]),
    reason: z.string().min(1)
  })).default([]),
  fanoutPolicy: z.object({
    mode: z.enum(["none", "independent_only", "declared_ordered"]),
    maxRoutes: z.number().int().min(1),
    requiresIndependentProblems: z.boolean()
  }),
  priority: z.number().int(),
  minimumConfidence: z.number().min(0).max(1),
  supportingLoopTemplateIds: z.array(z.string().min(1)).default([]),
  learningOutputs: z.array(z.string().min(1)).min(1),
  learningConsumers: z.array(z.string().min(1)).min(1),
  shouldRouteExamples: z.array(z.string().min(1)).min(1),
  shouldNotRouteExamples: z.array(z.string().min(1)).min(1)
});

export const departmentOperatingSkillSchema = z.object({
  schemaVersion: z.literal(COMPANY_LOOP_LIBRARY_SCHEMA_VERSION),
  id: z.string().min(1),
  departmentType: DepartmentTypeSchema,
  name: z.string().min(1),
  mission: z.string().min(1),
  operatingGoals: z.array(z.string().min(1)).min(2),
  taskApproach: z.array(z.object({
    phase: z.enum(["understand", "assemble_context", "decide", "govern", "learn"]),
    instruction: z.string().min(1),
    requiredOutput: z.string().min(1)
  })).length(5),
  boundaries: z.array(z.string().min(1)).min(2),
  learningQuestions: z.array(z.string().min(1)).min(2),
  defaultLoopTemplateIds: z.array(z.string().min(1)).min(1)
});

export const crossDepartmentPlaybookSchema = z.object({
  schemaVersion: z.literal(COMPANY_LOOP_LIBRARY_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  triggerEventTypes: z.array(z.string().min(1)).min(1),
  primaryLoopTemplateId: z.string().min(1),
  supportingLoopTemplateIds: z.array(z.string().min(1)).min(1),
  orderedLoopTemplateIds: z.array(z.string().min(1)).min(2),
  learningReturnTemplateIds: z.array(z.string().min(1)).min(1),
  explicitFanoutPermitted: z.boolean(),
  decisionRule: z.string().min(1),
  sharedLearning: z.string().min(1)
});

export type PrebuiltLoopDefinition = z.infer<typeof prebuiltLoopDefinitionSchema>;
export type DepartmentOperatingSkill = z.infer<typeof departmentOperatingSkillSchema>;
export type CrossDepartmentPlaybook = z.infer<typeof crossDepartmentPlaybookSchema>;

type LoopOptions = Partial<Pick<PrebuiltLoopDefinition,
  "problemTypes" | "exclusionRules" | "fanoutPolicy" | "priority" | "minimumConfidence" |
  "supportingLoopTemplateIds" | "learningConsumers"
>>;

function loop(
  departmentType: DepartmentType,
  templateId: string,
  problemType: string,
  eventTypes: string[],
  subjectTypes: string[],
  requiredContext: string[],
  requiredConnections: string[],
  learningOutputs: string[],
  options: LoopOptions = {}
): PrebuiltLoopDefinition {
  return prebuiltLoopDefinitionSchema.parse({
    schemaVersion: COMPANY_LOOP_LIBRARY_SCHEMA_VERSION,
    templateId,
    departmentType,
    problemTypes: options.problemTypes ?? [problemType],
    eventTypes,
    subjectTypes,
    requiredContext,
    requiredConnections,
    exclusionRules: options.exclusionRules ?? [{
      eventTypePattern: "loopgraph.lifecycle.*",
      fields: [],
      reason: "Loopgraph lifecycle notifications are evidence callbacks, not new business work."
    }],
    fanoutPolicy: options.fanoutPolicy ?? {
      mode: "none",
      maxRoutes: 1,
      requiresIndependentProblems: true
    },
    priority: options.priority ?? 50,
    minimumConfidence: options.minimumConfidence ?? sensitiveConfidence(departmentType),
    supportingLoopTemplateIds: options.supportingLoopTemplateIds ?? [],
    learningOutputs,
    learningConsumers: options.learningConsumers ?? [departmentType, "management"],
    shouldRouteExamples: [`${eventTypes[0]} with ${requiredContext.join(", ")}`],
    shouldNotRouteExamples: [
      `A related signal with no ${requiredContext[0]}`,
      "A lifecycle notification or event matching an exclusion rule"
    ]
  });
}

const incidentFanout = { mode: "declared_ordered", maxRoutes: 4, requiresIndependentProblems: false } as const;
const campaignFanout = { mode: "declared_ordered", maxRoutes: 3, requiresIndependentProblems: false } as const;
const forecastFanout = { mode: "declared_ordered", maxRoutes: 4, requiresIndependentProblems: false } as const;
const feedbackFanout = { mode: "independent_only", maxRoutes: 3, requiresIndependentProblems: true } as const;

const LEGACY_PREBUILT_COMPANY_LOOPS: PrebuiltLoopDefinition[] = [
  // Product
  loop("product", "product-feedback_to_problem", "product.feedback_pattern", ["customer.feedback_repeated", "feedback.cluster_ready"], ["feedback_cluster", "product_area"], ["normalizedPayload.feedbackCount", "evidenceRefs"], ["support.read", "analytics.read"], ["validated problem brief", "customer segment impact", "feedback cluster evidence"], { fanoutPolicy: feedbackFanout, supportingLoopTemplateIds: ["customer_success-customer_health_risk", "product-bug_cluster_to_problem"], learningConsumers: ["product", "customer_success", "engineering"] }),
  loop("product", "product-problem_to_product_bet", "product.validated_problem", ["product.problem_validated"], ["product_problem"], ["normalizedPayload.problemStatement", "normalizedPayload.impact", "evidenceRefs"], ["analytics.read", "roadmap.read"], ["product bet options", "assumption register", "success metric"], { learningConsumers: ["product", "engineering", "management"] }),
  loop("product", "product-release_learning", "product.release_outcome", ["release.measurement_window_closed", "release.outcome_changed", "incident.regression_detected"], ["release", "feature"], ["normalizedPayload.releaseId", "normalizedPayload.outcomeWindow", "evidenceRefs"], ["analytics.read", "support.read", "release.read"], ["release outcome memo", "adoption and retention evidence", "continue-adjust-rollback recommendation"], { fanoutPolicy: incidentFanout, learningConsumers: ["product", "engineering", "customer_success"] }),
  loop("product", "product-bug_cluster_to_problem", "product.recurring_defect", ["bug.cluster_detected", "customer.feedback_repeated"], ["bug_cluster", "product_area"], ["normalizedPayload.occurrenceCount", "normalizedPayload.affectedWorkflow", "evidenceRefs"], ["issues.read", "support.read", "errors.read"], ["root-cause hypothesis", "affected workflow evidence", "recurrence measurement"], { fanoutPolicy: feedbackFanout, learningConsumers: ["product", "engineering", "customer_success"] }),
  loop("product", "product-roadmap_signal", "product.roadmap_tradeoff", ["roadmap.signal_changed", "customer.demand_clustered"], ["roadmap_theme", "product_problem"], ["normalizedPayload.demand", "normalizedPayload.strategicFit", "evidenceRefs"], ["roadmap.read", "crm.read", "capacity.read"], ["roadmap evidence packet", "explicit tradeoffs", "revisit condition"], { minimumConfidence: 0.85, learningConsumers: ["product", "management"] }),

  // Marketing
  loop("marketing", "marketing-campaign_learning", "marketing.campaign_performance", ["campaign.performance_anomaly", "campaign.cohort_outcome_ready"], ["campaign"], ["normalizedPayload.spend", "normalizedPayload.qualifiedOutcome", "evidenceRefs"], ["ads.read", "analytics.read", "crm.read"], ["campaign learning", "qualified cohort result", "message and channel evidence"], { fanoutPolicy: campaignFanout, supportingLoopTemplateIds: ["sales-lead_qualification", "sales-pipeline_outcome"], learningConsumers: ["marketing", "sales", "management"] }),
  loop("marketing", "marketing-channel_allocation", "marketing.channel_allocation", ["channel.efficiency_changed", "budget.reallocation_requested"], ["channel", "budget"], ["normalizedPayload.currentSpend", "normalizedPayload.qualifiedPipeline", "evidenceRefs"], ["ads.read", "crm.read", "finance.read"], ["allocation recommendation", "downstream quality comparison", "next measurement window"], { minimumConfidence: 0.85 }),
  loop("marketing", "marketing-creative_testing", "marketing.creative_learning", ["creative.fatigue_detected", "creative.test_requested"], ["creative", "campaign"], ["normalizedPayload.hypothesis", "normalizedPayload.audience", "evidenceRefs"], ["ads.read", "content_repository.read", "brand_policy.read"], ["creative hypothesis", "review packet", "message-library learning"], { learningConsumers: ["marketing", "sales"] }),
  loop("marketing", "marketing-landing_page_conversion", "marketing.conversion_drop", ["landing_page.conversion_dropped", "landing_page.experiment_requested"], ["landing_page"], ["normalizedPayload.pageId", "normalizedPayload.conversionWindow", "evidenceRefs"], ["web_analytics.read", "cms.read", "crm.read"], ["conversion diagnosis", "experiment proposal", "downstream lead-quality result"], { exclusionRules: [{ eventTypePattern: "landing_page.conversion_dropped", fields: ["normalizedPayload.missingCampaignMapping"], reason: "Campaign mapping is missing, so Hermes must request context instead of guessing Ads versus Content." }] }),
  loop("marketing", "marketing-icp_messaging_learning", "marketing.message_market_fit", ["sales.objection_clustered", "win_loss.pattern_detected", "customer.language_clustered"], ["market_segment", "message"], ["normalizedPayload.segment", "normalizedPayload.pattern", "evidenceRefs"], ["crm.read", "calls.read", "support.read"], ["ICP hypothesis", "message evidence", "objection and win-loss patterns"], { learningConsumers: ["marketing", "sales", "product"] }),

  // Sales
  loop("sales", "sales-lead_qualification", "sales.lead_qualification", ["lead.created", "campaign.cohort_outcome_ready"], ["lead", "campaign_cohort"], ["normalizedPayload.fitSignals", "normalizedPayload.intentSignals", "evidenceRefs"], ["crm.read", "enrichment.read", "analytics.read"], ["qualification decision", "routing reason", "meeting and opportunity outcome"], { fanoutPolicy: campaignFanout, learningConsumers: ["sales", "marketing"] }),
  loop("sales", "sales-account_research", "sales.account_research", ["account.research_requested", "meeting.scheduled"], ["account"], ["normalizedPayload.accountId", "normalizedPayload.buyerRole", "evidenceRefs"], ["crm.read", "enrichment.read", "calendar.read"], ["account brief", "verified buying trigger", "personalization corrections"], { learningConsumers: ["sales", "marketing"] }),
  loop("sales", "sales-follow_up", "sales.follow_up_latency", ["meeting.completed", "next_step.overdue"], ["meeting", "opportunity"], ["normalizedPayload.commitments", "normalizedPayload.owner", "evidenceRefs"], ["calendar.read", "crm.read", "email.draft"], ["follow-up draft", "commitment ledger", "next-step completion evidence"], { minimumConfidence: 0.8 }),
  loop("sales", "sales-crm_hygiene", "sales.crm_state_drift", ["opportunity.stale", "crm.required_field_missing"], ["opportunity"], ["normalizedPayload.opportunityId", "normalizedPayload.recentActivity", "evidenceRefs"], ["crm.read", "calendar.read"], ["proposed CRM correction", "source evidence", "forecast impact flag"], { minimumConfidence: 0.85 }),
  loop("sales", "sales-deal_risk", "sales.deal_risk", ["opportunity.stalled", "deal.risk_changed"], ["opportunity", "account"], ["normalizedPayload.stageAge", "normalizedPayload.nextStep", "evidenceRefs"], ["crm.read", "calendar.read", "calls.read"], ["deal-risk diagnosis", "intervention options", "forecast outcome"], { priority: 70 }),
  loop("sales", "sales-pipeline_outcome", "sales.pipeline_outcome", ["campaign.cohort_outcome_ready", "opportunity.outcome_recorded"], ["campaign_cohort", "opportunity"], ["normalizedPayload.qualifiedPipeline", "normalizedPayload.customerOutcome", "evidenceRefs"], ["crm.read", "billing.read"], ["pipeline quality outcome", "revenue conversion evidence", "campaign feedback"], { fanoutPolicy: campaignFanout, learningConsumers: ["sales", "marketing", "management"] }),

  // Customer Success
  loop("customer_success", "support-ticket-triage", "customer.support_request", ["support.ticket_created", "support.ticket_priority_changed"], ["support_ticket"], ["normalizedPayload.ticketId", "normalizedPayload.severity", "evidenceRefs"], ["support.read", "knowledge_base.read", "crm.read"], ["triage decision", "response draft", "escalation evidence"], { learningConsumers: ["customer_success", "product", "engineering"] }),
  loop("customer_success", "customer_success-customer_health_risk", "customer.health_risk", ["customer.health_changed", "customer.feedback_repeated", "incident.customer_impact_detected"], ["account", "feedback_cluster", "incident"], ["normalizedPayload.accountContext", "normalizedPayload.riskSignals", "evidenceRefs"], ["crm.read", "analytics.read", "support.read"], ["health-risk reason", "intervention plan", "health recovery outcome"], { fanoutPolicy: feedbackFanout, learningConsumers: ["customer_success", "product", "management"] }),
  loop("customer_success", "customer_success-renewal_risk", "customer.renewal_risk", ["renewal.risk_changed", "subscription.renewal_risk"], ["account", "subscription"], ["normalizedPayload.renewalDate", "normalizedPayload.riskDrivers", "evidenceRefs"], ["crm.read", "billing.read", "analytics.read"], ["renewal-risk diagnosis", "save plan", "renewal outcome"], { priority: 70 }),
  loop("customer_success", "strategic-account-escalation", "customer.strategic_account_risk", ["account.executive_escalation", "incident.customer_impact_detected"], ["account", "incident"], ["normalizedPayload.accountTier", "normalizedPayload.businessImpact", "evidenceRefs"], ["crm.read", "support.read", "incident.read"], ["strategic risk case", "account-owner actions", "relationship outcome"], { fanoutPolicy: incidentFanout, priority: 90, supportingLoopTemplateIds: ["customer_success-customer_communication_review"] }),
  loop("customer_success", "customer_success-customer_communication_review", "customer.communication_risk", ["incident.customer_impact_detected", "customer.communication_requested"], ["incident", "account"], ["normalizedPayload.audience", "normalizedPayload.knownFacts", "evidenceRefs"], ["incident.read", "crm.read", "communications.draft"], ["fact-checked communication draft", "approval receipt", "customer response evidence"], { fanoutPolicy: incidentFanout, minimumConfidence: 0.9 }),
  loop("customer_success", "customer_success-qbr_preparation", "customer.business_review", ["qbr.preparation_due"], ["account"], ["normalizedPayload.accountGoals", "normalizedPayload.reviewWindow", "evidenceRefs"], ["crm.read", "analytics.read", "support.read"], ["QBR evidence packet", "goal-progress narrative", "owned next actions"], { minimumConfidence: 0.8 }),

  // Engineering
  loop("engineering", "github-issue-triage", "engineering.issue_triage", ["github.issue_opened", "github.issue_updated"], ["repository_issue"], ["normalizedPayload.issue", "evidenceRefs"], ["repository.read", "policy.read"], ["issue classification", "risk escalation", "maintainer correction evidence"], { learningConsumers: ["engineering", "product"] }),
  loop("engineering", "engineering-issue_to_plan", "engineering.implementation_plan", ["issue.accepted", "implementation.plan_requested"], ["repository_issue", "work_item"], ["normalizedPayload.acceptanceCriteria", "normalizedPayload.affectedSurface", "evidenceRefs"], ["repository.read", "issues.read", "ci.read"], ["implementation plan", "test plan", "dependency risks"], { minimumConfidence: 0.8 }),
  loop("engineering", "engineering-pr_review_prep", "engineering.review_readiness", ["pull_request.review_requested"], ["pull_request"], ["normalizedPayload.diffRef", "normalizedPayload.testEvidence", "evidenceRefs"], ["repository.read", "ci.read"], ["risk summary", "test evidence packet", "review correction learning"], { minimumConfidence: 0.8 }),
  loop("engineering", "engineering-release_readiness", "engineering.release_readiness", ["release.candidate_created"], ["release"], ["normalizedPayload.releaseId", "normalizedPayload.testEvidence", "normalizedPayload.rollbackPlan"], ["repository.read", "ci.read", "deployments.read"], ["release readiness decision", "rollback evidence", "post-release measurement plan"], { minimumConfidence: 0.9 }),
  loop("engineering", "engineering-incident_response", "engineering.production_incident", ["incident.opened", "incident.severity_changed", "incident.customer_impact_detected"], ["incident"], ["normalizedPayload.severity", "normalizedPayload.affectedServices", "evidenceRefs"], ["incident.read", "observability.read", "repository.read"], ["incident state and ownership", "mitigation decision", "customer-impact evidence"], { fanoutPolicy: incidentFanout, priority: 100, supportingLoopTemplateIds: ["strategic-account-escalation", "customer_success-customer_communication_review", "engineering-incident_learning"], learningConsumers: ["engineering", "customer_success", "product", "management"] }),
  loop("engineering", "engineering-incident_learning", "engineering.incident_learning", ["incident.resolved", "incident.customer_impact_detected"], ["incident"], ["normalizedPayload.timeline", "normalizedPayload.rootCause", "evidenceRefs"], ["incident.read", "observability.read", "repository.read"], ["root-cause learning", "prevention actions", "recurrence evidence"], { fanoutPolicy: incidentFanout, learningConsumers: ["engineering", "product", "customer_success"] }),

  // Operations and Finance
  loop("ops_finance", "operations_finance-approval_bottleneck", "operations.approval_bottleneck", ["approval.overdue", "forecast.variance_detected"], ["approval", "forecast"], ["normalizedPayload.owner", "normalizedPayload.age", "evidenceRefs"], ["approvals.read", "project_system.read"], ["bottleneck diagnosis", "owner reminder draft", "approval latency evidence"], { fanoutPolicy: forecastFanout }),
  loop("ops_finance", "operations_finance-forecast_variance", "finance.forecast_variance", ["forecast.variance_detected", "forecast.updated"], ["forecast"], ["normalizedPayload.baseline", "normalizedPayload.current", "evidenceRefs"], ["finance.read", "warehouse.read"], ["variance explanation", "driver evidence", "decision threshold"], { fanoutPolicy: forecastFanout, priority: 90, supportingLoopTemplateIds: ["operations_finance-approval_bottleneck", "management-decision_memo", "management-resource_allocation"] }),
  loop("ops_finance", "operations_finance-vendor_review", "finance.vendor_risk", ["vendor.renewal_due", "vendor.usage_changed"], ["vendor", "contract"], ["normalizedPayload.spend", "normalizedPayload.usage", "evidenceRefs"], ["finance.read", "contracts.read", "usage.read"], ["vendor review packet", "renewal recommendation", "owner decision"], { minimumConfidence: 0.9 }),
  loop("ops_finance", "operations_finance-close_readiness", "finance.close_readiness", ["close.blocker_detected", "close.review_due"], ["accounting_period"], ["normalizedPayload.period", "normalizedPayload.blockers", "evidenceRefs"], ["finance.read", "approvals.read"], ["close blocker ledger", "owner actions", "evidence completeness"], { minimumConfidence: 0.9 }),
  loop("ops_finance", "operations_finance-cash_collection", "finance.collection_risk", ["invoice.overdue", "receivable.risk_changed"], ["invoice", "account"], ["normalizedPayload.invoiceId", "normalizedPayload.amount", "evidenceRefs"], ["finance.read", "crm.read"], ["collection risk note", "internal follow-up", "payment outcome evidence"], { minimumConfidence: 0.9 }),
  loop("ops_finance", "operations_finance-resource_allocation", "finance.resource_tradeoff", ["resource.allocation_requested", "forecast.variance_detected"], ["budget", "forecast"], ["normalizedPayload.constraint", "normalizedPayload.options", "evidenceRefs"], ["finance.read", "capacity.read"], ["allocation tradeoff packet", "financial impact", "leadership decision evidence"], { fanoutPolicy: forecastFanout, minimumConfidence: 0.9 }),

  // HR and Talent
  loop("hr_talent", "hr-candidate_pipeline", "talent.candidate_pipeline", ["candidate.stage_stalled", "interview.feedback_missing"], ["candidate"], ["normalizedPayload.candidateId", "normalizedPayload.stage", "evidenceRefs"], ["ats.read", "calendar.read"], ["pipeline bottleneck", "next-action reminder", "candidate experience outcome"], { minimumConfidence: 0.9 }),
  loop("hr_talent", "hr-onboarding_progress", "talent.onboarding_gap", ["onboarding.task_overdue", "onboarding.progress_changed"], ["employee_onboarding"], ["normalizedPayload.employeeId", "normalizedPayload.missingTasks", "evidenceRefs"], ["hris.read", "project_system.read"], ["onboarding gap", "manager action", "completion outcome"], { minimumConfidence: 0.9 }),
  loop("hr_talent", "hr-manager_coaching", "talent.manager_coaching", ["manager.coaching_review_due"], ["team", "manager"], ["normalizedPayload.reviewWindow", "normalizedPayload.approvedSignals", "evidenceRefs"], ["hris.read", "survey.read"], ["human-reviewed coaching brief", "evidence limitations", "follow-up outcome"], { minimumConfidence: 0.95 }),
  loop("hr_talent", "hr-retention_signal", "talent.retention_risk", ["retention.risk_review_due"], ["employee", "team"], ["normalizedPayload.approvedRiskSignals", "evidenceRefs"], ["hris.read", "survey.read"], ["human review packet", "fairness checks", "owned follow-up"], { minimumConfidence: 0.95 }),
  loop("hr_talent", "hr-performance_review_prep", "talent.performance_review", ["performance.review_due"], ["employee"], ["normalizedPayload.reviewPeriod", "normalizedPayload.goalEvidence", "evidenceRefs"], ["hris.read", "performance.read"], ["balanced evidence packet", "missing-evidence flags", "manager correction history"], { minimumConfidence: 0.95 }),

  // Legal and Compliance
  loop("legal_compliance", "legal_security-contract_triage", "legal.contract_exception", ["contract.redline_received", "contract.review_requested"], ["contract"], ["normalizedPayload.contractId", "normalizedPayload.clauses", "evidenceRefs"], ["contracts.read", "playbook.read", "crm.read"], ["clause extraction", "playbook comparison", "expert exception queue"], { minimumConfidence: 0.95 }),
  loop("legal_compliance", "legal_security-policy_drift", "compliance.policy_drift", ["control.changed", "policy.review_triggered"], ["control", "policy"], ["normalizedPayload.changedControl", "normalizedPayload.policyRef", "evidenceRefs"], ["policy.read", "changes.read"], ["policy drift finding", "owner remediation", "audit evidence"], { minimumConfidence: 0.95 }),
  loop("legal_compliance", "legal_security-access_review", "security.access_exception", ["access.review_due", "privilege.exception_detected"], ["access_grant", "identity"], ["normalizedPayload.principal", "normalizedPayload.system", "evidenceRefs"], ["identity.read", "hris.read", "access_logs.read"], ["access decision packet", "owner approval", "least-privilege outcome"], { minimumConfidence: 0.98 }),
  loop("legal_compliance", "legal_security-incident_evidence", "security.incident_evidence", ["incident.opened", "incident.evidence_requested"], ["incident"], ["normalizedPayload.timeWindow", "normalizedPayload.systems", "evidenceRefs"], ["siem.read", "incident.read", "logs.read"], ["source-cited timeline", "evidence gaps", "chain-of-custody record"], { fanoutPolicy: incidentFanout, minimumConfidence: 0.98 }),
  loop("legal_compliance", "legal_security-security_questionnaire", "security.questionnaire", ["security.questionnaire_received"], ["questionnaire", "account"], ["normalizedPayload.questions", "normalizedPayload.customerId", "evidenceRefs"], ["security_kb.read", "controls.read", "crm.read"], ["evidence-backed draft", "unsupported-claim flags", "approved reusable answer"], { minimumConfidence: 0.98 }),
  loop("legal_compliance", "legal_security-compliance_evidence", "compliance.evidence_gap", ["compliance.evidence_gap_detected", "audit.request_received"], ["control", "audit_request"], ["normalizedPayload.controlId", "normalizedPayload.evidenceWindow", "evidenceRefs"], ["controls.read", "audit_repository.read"], ["evidence packet", "gap register", "review receipt"], { minimumConfidence: 0.98 }),

  // Management
  loop("management", "management-review", "management.operating_review", ["management.review_due", "company.risk_rollup_ready"], ["company", "operating_review"], ["normalizedPayload.reviewWindow", "evidenceRefs"], ["loopgraph.read", "warehouse.read"], ["operating review", "owned decisions", "follow-through evidence"], { minimumConfidence: 0.85 }),
  loop("management", "management-weekly_anomaly_review", "management.company_anomaly", ["company.metric_anomaly", "forecast.variance_detected"], ["company_metric", "forecast"], ["normalizedPayload.baseline", "normalizedPayload.current", "evidenceRefs"], ["warehouse.read", "loopgraph.read"], ["anomaly diagnosis", "decision options", "owner follow-through"], { fanoutPolicy: forecastFanout, minimumConfidence: 0.9 }),
  loop("management", "management-department_loop_review", "management.loop_health", ["loop.health_degraded", "department.review_due"], ["loop", "department"], ["normalizedPayload.health", "normalizedPayload.failureModes", "evidenceRefs"], ["loopgraph.read"], ["loop health review", "improvement owners", "recovery evidence"], { minimumConfidence: 0.85 }),
  loop("management", "management-decision_memo", "management.decision_required", ["decision.requested", "forecast.variance_detected"], ["decision", "forecast"], ["normalizedPayload.options", "normalizedPayload.tradeoffs", "evidenceRefs"], ["warehouse.read", "loopgraph.read"], ["decision memo", "tradeoff record", "accountable decision"], { fanoutPolicy: forecastFanout, minimumConfidence: 0.9 }),
  loop("management", "management-resource_allocation", "management.resource_allocation", ["resource.allocation_requested", "forecast.variance_detected"], ["resource_plan", "forecast"], ["normalizedPayload.constraints", "normalizedPayload.goalImpact", "evidenceRefs"], ["capacity.read", "finance.read", "loopgraph.read"], ["allocation options", "constraint analysis", "decision outcome"], { fanoutPolicy: forecastFanout, minimumConfidence: 0.95 }),
  loop("management", "management-improvement", "management.system_improvement", ["failure.pattern_repeated", "loop.improvement_proposed"], ["loop", "failure_cluster"], ["normalizedPayload.failurePattern", "normalizedPayload.affectedLoops", "evidenceRefs"], ["loopgraph.read", "project_system.read"], ["improvement change set", "acceptance criteria", "post-change evidence"], { minimumConfidence: 0.85 })
];

export const OFFICIAL_APP_CATALOG_SOURCE_DIGEST = GENERATED_OFFICIAL_APP_CATALOG.sourceDigest;
export const PACK_DERIVED_COMPANY_LOOPS: PrebuiltLoopDefinition[] = GENERATED_OFFICIAL_APP_CATALOG.entries
  .map((entry) => prebuiltLoopDefinitionSchema.parse(entry.definition));

export const LEGACY_COMPANY_LOOP_TEMPLATE_ALIASES: Record<string, string> = {
  "product-feedback_to_problem": "product-feedback-clustering",
  "product-problem_to_product_bet": "product-problem-validation",
  "product-release_learning": "product-release-learning",
  "product-bug_cluster_to_problem": "product-bug-clustering",
  "product-roadmap_signal": "product-roadmap-evidence",
  "marketing-campaign_learning": "marketing-campaign-learning",
  "marketing-channel_allocation": "marketing-channel-allocation",
  "marketing-icp_messaging_learning": "marketing-icp-message-learning",
  "sales-lead_qualification": "sales-inbound-lead-qualification",
  "sales-account_research": "sales-inbound-account-research",
  "sales-follow_up": "sales-inbound-follow-up",
  "sales-crm_hygiene": "sales-missing-next-step",
  "sales-deal_risk": "sales-deal-risk-detection",
  "sales-pipeline_outcome": "sales-pipeline-outcome",
  "support-ticket-triage": "customer-success-support-ticket-triage",
  "customer_success-customer_health_risk": "cs-customer-health",
  "customer_success-renewal_risk": "cs-renewal-risk",
  "strategic-account-escalation": "cs-strategic-account-escalation",
  "customer_success-qbr_preparation": "cs-qbr-preparation",
  "github-issue-triage": "engineering-github-issue-triage",
  "engineering-issue_to_plan": "engineering-issue-to-plan",
  "engineering-release_readiness": "engineering-release-readiness",
  "engineering-incident_response": "engineering-incident-response",
  "engineering-incident_learning": "engineering-incident-learning",
  "operations_finance-approval_bottleneck": "ops-finance-approval-bottleneck",
  "operations_finance-forecast_variance": "ops-finance-forecast-variance",
  "operations_finance-vendor_review": "ops-finance-vendor-review",
  "operations_finance-close_readiness": "ops-finance-close-readiness",
  "operations_finance-cash_collection": "ops-finance-cash-collection",
  "operations_finance-resource_allocation": "ops-finance-resource-allocation",
  "hr-candidate_pipeline": "hr-candidate-pipeline",
  "hr-onboarding_progress": "hr-onboarding-progress",
  "hr-manager_coaching": "hr-manager-coaching",
  "hr-retention_signal": "hr-retention-review",
  "hr-performance_review_prep": "hr-performance-review-preparation",
  "legal_security-contract_triage": "legal-contract-exception-triage",
  "legal_security-policy_drift": "legal-policy-control-drift",
  "legal_security-access_review": "legal-privileged-access-review",
  "legal_security-incident_evidence": "legal-incident-evidence",
  "legal_security-security_questionnaire": "legal-security-questionnaire",
  "legal_security-compliance_evidence": "legal-compliance-evidence-gap"
};

const replacedLegacyTemplateIds = new Set(Object.keys(LEGACY_COMPANY_LOOP_TEMPLATE_ALIASES));

/**
 * Canonical Hermes candidate library. Official LoopPacks replace code-defined
 * entries whenever a canonical successor exists. Unmatched legacy entries are
 * an explicit migration fallback, not an alternative definition of an app loop.
 */
export const PREBUILT_COMPANY_LOOPS: PrebuiltLoopDefinition[] = [
  ...PACK_DERIVED_COMPANY_LOOPS,
  ...LEGACY_PREBUILT_COMPANY_LOOPS.filter((item) => !replacedLegacyTemplateIds.has(item.templateId))
].sort((left, right) => left.departmentType.localeCompare(right.departmentType) || left.templateId.localeCompare(right.templateId));

function skill(
  departmentType: DepartmentType,
  name: string,
  mission: string,
  operatingGoals: string[],
  specialization: [string, string, string, string, string],
  boundaries: string[],
  learningQuestions: string[]
): DepartmentOperatingSkill {
  const phases = ["understand", "assemble_context", "decide", "govern", "learn"] as const;
  const outputs = ["Problem and affected company object", "Bounded evidence packet and missing-context list", "Narrow route or explicit abstention", "Approval, escalation, and action boundary receipt", "Outcome evidence and reusable operating learning"];
  return departmentOperatingSkillSchema.parse({
    schemaVersion: COMPANY_LOOP_LIBRARY_SCHEMA_VERSION,
    id: `loopgraph-department-${departmentType.replace(/_/g, "-")}`,
    departmentType,
    name,
    mission,
    operatingGoals,
    taskApproach: phases.map((phase, index) => ({ phase, instruction: specialization[index], requiredOutput: outputs[index] })),
    boundaries,
    learningQuestions,
    defaultLoopTemplateIds: PREBUILT_COMPANY_LOOPS.filter((item) => item.departmentType === departmentType).map((item) => item.templateId)
  });
}

export const DEPARTMENT_OPERATING_SKILLS: DepartmentOperatingSkill[] = [
  skill("product", "Product Operating Skill", "Turn customer and usage evidence into validated problems, reversible bets, and release learning.", ["Reduce feedback noise", "Improve adoption and retention", "Connect roadmap choices to observed outcomes"], ["Separate product problems from feature requests and identify the affected workflow and segment.", "Join feedback, usage, support, sales, release, and roadmap evidence without treating anecdotes as proof.", "Prefer the narrowest validated problem or learning loop; route strategic tradeoffs to accountable product judgment.", "Never change roadmap priority or make customer commitments without approval.", "Compare shipped outcomes to the original problem and feed recurrence, adoption, and support evidence back into discovery."], ["No automatic roadmap commitments", "No solution-first recommendation without problem evidence", "Security, privacy, and strategic-account effects require review"], ["Was the original problem real for the target segment?", "Did the release improve adoption, retention, or support burden?", "Which evidence should change the next product bet?"]),
  skill("marketing", "Marketing Operating Skill", "Optimize qualified customer creation and learning, not surface engagement.", ["Increase qualified pipeline", "Improve message-market fit", "Allocate spend using downstream outcomes"], ["Name the campaign, audience, asset, page, or message affected and the downstream business problem.", "Join spend, funnel, CRM, activation, retention, sales, and content evidence before evaluating performance.", "Choose Ads, Creative, Landing Page, Channel Allocation, or ICP Learning only when the route claim is explicit.", "Require approval for spend changes, publishing, claims, brand-sensitive content, or strategic channel shutdown.", "Return pipeline, customer-quality, and cohort outcomes to the campaign and message libraries."], ["No unapproved spend or publishing", "No unsupported factual claims", "Do not optimize clicks or leads when qualified pipeline is unavailable"], ["Did cheap acquisition create qualified and retained customers?", "Which message and audience evidence repeated across channels?", "Which experiment changed the real funnel constraint?"]),
  skill("sales", "Sales Operating Skill", "Move the right accounts through the pipeline while preserving relationship ownership and forecast truth.", ["Improve qualification", "Reduce follow-up and CRM latency", "Recover actionable deal risk"], ["Identify the lead, account, meeting, opportunity, or commitment affected and the revenue motion at risk.", "Assemble CRM, calendar, call, email, product, enrichment, and campaign context with source timestamps.", "Choose qualification, research, follow-up, hygiene, risk, or pipeline-outcome work based on the current sales object.", "Require seller approval for customer sends, pricing, legal terms, forecast changes, and strategic-account actions.", "Return meeting, opportunity, win-loss, objection, and revenue outcomes to Sales and Marketing."], ["No unapproved customer send", "No fabricated personalization", "No autonomous pricing, legal, or forecast commitment"], ["Which qualification signals predicted real opportunity creation?", "Which objections and follow-up patterns changed deal velocity?", "Which campaign cohorts became customers rather than just leads?"]),
  skill("customer_success", "Customer Success Operating Skill", "Detect customer risk early, route accurate help, and turn relationship evidence into product and company learning.", ["Improve time to useful response", "Reduce preventable churn", "Protect strategic customer relationships"], ["Identify the ticket, account, renewal, incident impact, or business review affected.", "Join support, CRM, usage, billing, incident, renewal, sentiment, and account-goal evidence.", "Distinguish support-process, onboarding, usability, defect, renewal, and strategic-account problems before routing.", "Require account-owner approval for customer communication, commercial commitments, and sensitive escalations.", "Return health recovery, renewal, response, product-gap, and relationship outcomes to Product, Engineering, and Management."], ["No generic automated customer commitment", "No customer-facing incident message without approved facts", "Minimize sensitive account context"], ["Was the issue a support, onboarding, usability, defect, or relationship problem?", "Which intervention actually recovered health or renewal likelihood?", "Which repeated complaints should become product or engineering work?"]),
  skill("engineering", "Engineering Operating Skill", "Turn technical signals into safe delivery, incident response, and prevention learning.", ["Reduce delivery ambiguity", "Improve release confidence", "Prevent incident recurrence"], ["Identify the repository issue, pull request, release, service, or incident and its customer/business impact.", "Assemble code, issue, CI, observability, deployment, incident, product, and customer evidence with exact references.", "Choose triage, planning, review prep, readiness, incident response, or incident learning based on lifecycle state.", "Never merge, deploy, roll back, or alter production without the configured approval and execution policy.", "Return defects, reviewer corrections, incident causes, mitigation outcomes, and release effects to Product and Customer Success."], ["No automatic merge or production change", "Security and data migrations require specialist review", "Do not hide missing tests or rollback evidence"], ["Which review and test evidence predicted escaped defects?", "Which incident causes or customer effects repeated?", "Did the mitigation and prevention work reduce recurrence?"]),
  skill("ops_finance", "Operations and Finance Operating Skill", "Reduce operational friction while keeping every financial commitment controlled and auditable.", ["Reduce approval latency", "Explain forecast variance", "Improve close, vendor, and collection readiness"], ["Identify the approval, invoice, receivable, vendor, forecast, period, budget, or resource decision affected.", "Reconcile finance, warehouse, approval, contract, CRM, capacity, and source-document evidence before calculation.", "Choose bottleneck, variance, vendor, close, collection, or allocation work and expose every assumption.", "Require finance or leadership approval for payment, collection messages, budget, forecast, vendor, and resource changes.", "Return forecast accuracy, resolution time, cash, close, cost, and allocation outcomes to Management."], ["No autonomous payment or budget change", "Numbers must reconcile to source evidence", "Material forecast and resource decisions require accountable approval"], ["Which variance drivers were persistent versus temporary?", "Which approvals repeatedly blocked outcomes?", "Did the resource decision resolve the company constraint?"]),
  skill("hr_talent", "HR and Talent Operating Skill", "Improve talent workflows without automating sensitive employment judgment.", ["Reduce hiring and onboarding friction", "Improve evidence quality for managers", "Protect privacy and fairness"], ["Identify the candidate, employee, manager, team, onboarding plan, or review period affected.", "Use only approved HRIS, ATS, survey, calendar, goal, and project evidence; avoid protected-class inference.", "Choose pipeline, onboarding, coaching, retention-review, or review-prep work and state evidence limits.", "All employment, compensation, performance, retention, and sensitive communication decisions stay human-owned.", "Return process latency, completion, fairness corrections, and human-reviewed outcomes without building hidden employee scores."], ["No autonomous employment decision", "No protected-class or unsupported behavioral inference", "Restricted people data must be minimized and access-controlled"], ["Where did process delay harm candidate or employee experience?", "Which evidence gaps or bias corrections repeated?", "Which manager actions improved onboarding or team outcomes?"]),
  skill("legal_compliance", "Legal and Compliance Operating Skill", "Prepare precise evidence and exceptions while keeping legal and security judgment with qualified owners.", ["Reduce review cycle time", "Improve audit evidence", "Detect control and policy drift"], ["Identify the contract, clause, control, access grant, incident, questionnaire, or audit request affected.", "Assemble exact citations, current playbooks, control state, time-bounded logs, ownership, and customer context.", "Choose triage, drift, access, incident evidence, questionnaire, or compliance evidence work; never infer law or control state.", "Require expert approval for legal interpretation, policy exceptions, privileged access, breach decisions, and customer commitments.", "Return approved clauses, reusable answers, evidence gaps, control fixes, and exception recurrence to Sales, Engineering, and Management."], ["No autonomous legal conclusion", "Every external security claim needs current evidence", "Privileged access and incident evidence require strict minimization and auditability"], ["Which exceptions and evidence gaps repeated?", "Did policy or control remediation close the observed risk?", "Which approved answer can be reused without overstating current controls?"]),
  skill("management", "Management Operating Skill", "Coordinate cross-department evidence into accountable decisions, resource tradeoffs, and system improvement.", ["Reduce decision latency", "Resolve cross-functional constraints", "Improve the company loop system"], ["Identify the company metric, decision, department loop, resource constraint, or repeated failure requiring leadership attention.", "Join department outcomes, value, risk, capacity, finance, customer, and loop-health evidence without collapsing conflicting views.", "Choose review, anomaly, loop-health, memo, allocation, or improvement work and make tradeoffs explicit.", "Leadership retains accountability for strategy, budget, hiring, priority, legal, and high-risk customer decisions.", "Track whether decisions were executed, whether constraints improved, and which loop policies or topology should change."], ["No unapproved strategy or resource change", "No metric theater without source and baseline", "Cross-functional ownership conflicts require explicit human resolution"], ["Did the decision resolve the named constraint?", "Which loops created value after review and supervision cost?", "What repeated failure should change the company topology or operating policy?"])
];

export const CROSS_DEPARTMENT_PLAYBOOKS: CrossDepartmentPlaybook[] = [
  crossPlaybook("feedback-to-product-learning", "Repeated complaints to product and release learning", ["customer.feedback_repeated", "feedback.cluster_ready"], "cs-customer-health", ["product-feedback-clustering", "product-bug-clustering"], ["cs-customer-health", "product-feedback-clustering", "product-bug-clustering", "product-release-learning"], ["cs-customer-health", "product-release-learning"], true, "Create one customer-health problem and independent product problems only when account risk and recurring product pain are both evidenced.", "Hermes learns whether the complaints reflect support process, onboarding, usability, a recurring defect, or strategic-account risk."),
  crossPlaybook("campaign-to-pipeline", "Campaign to qualified pipeline and customer outcome", ["campaign.cohort_outcome_ready"], "marketing-campaign-learning", ["marketing-campaign-lead-qualification", "marketing-campaign-pipeline-outcome"], ["marketing-campaign-learning", "marketing-campaign-lead-qualification", "marketing-campaign-pipeline-outcome"], ["marketing-campaign-learning", "marketing-icp-message-learning"], true, "Fan out only for the same campaign cohort with CRM qualification and customer outcome evidence.", "Hermes learns that cheap leads are not valuable unless they qualify, progress, and become healthy customers."),
  crossPlaybook("incident-to-company-learning", "Production incident to customer and prevention learning", ["incident.customer_impact_detected"], "engineering-incident-response", ["cs-strategic-account-escalation", "engineering-customer-impact", "engineering-incident-learning"], ["engineering-incident-response", "cs-strategic-account-escalation", "engineering-customer-impact", "engineering-incident-learning"], ["engineering-incident-learning", "product-release-learning", "cs-customer-health"], true, "Create one primary incident problem. Invoke customer risk and communication loops only for evidenced affected accounts, then run learning after resolution.", "Hermes connects technical mitigation, customer impact, communication quality, and recurrence prevention."),
  crossPlaybook("forecast-to-resource-decision", "Forecast variance to management resource decision", ["finance.forecast_variance_detected"], "ops-finance-forecast-variance", ["ops-finance-approval-bottleneck", "ops-finance-resource-allocation", "management-decision_memo", "management-resource_allocation"], ["ops-finance-forecast-variance", "ops-finance-approval-bottleneck", "ops-finance-resource-allocation", "management-decision_memo", "management-resource_allocation"], ["management-department_loop_review", "management-improvement"], true, "Fan out only when the same reconciled variance identifies a real approval constraint and a material resource tradeoff.", "Hermes learns whether forecast error came from source quality, operating delay, approval latency, or resource allocation."),
  crossPlaybook("renewal-to-product-signal", "Renewal risk to customer, sales, and product learning", ["renewal.risk_changed"], "cs-renewal-risk", ["sales-deal-risk-detection", "product-feedback-clustering"], ["cs-renewal-risk", "sales-deal-risk-detection", "product-feedback-clustering"], ["cs-renewal-risk", "product-roadmap-evidence"], false, "Supporting routes require independent commercial and product evidence; otherwise keep one renewal problem and append evidence.", "Hermes distinguishes commercial risk, relationship risk, missing value, and recurring product pain."),
  crossPlaybook("contract-to-deal-outcome", "Contract exception to deal and reusable policy learning", ["legal.contract_redline_received"], "legal-contract-exception-triage", ["sales-deal-risk-detection", "legal-policy-control-drift"], ["legal-contract-exception-triage", "sales-deal-risk-detection", "legal-policy-control-drift"], ["legal-contract-exception-triage", "sales-pipeline-outcome"], false, "Legal review stays primary; Sales receives deal-risk evidence, and policy drift is created only for a repeated approved exception.", "Hermes learns which clauses block deals and which approved fallbacks can safely update the playbook." )
].map((item) => crossDepartmentPlaybookSchema.parse(item));

function crossPlaybook(
  id: string,
  name: string,
  triggerEventTypes: string[],
  primaryLoopTemplateId: string,
  supportingLoopTemplateIds: string[],
  orderedLoopTemplateIds: string[],
  learningReturnTemplateIds: string[],
  explicitFanoutPermitted: boolean,
  decisionRule: string,
  sharedLearning: string
): CrossDepartmentPlaybook {
  return {
    schemaVersion: COMPANY_LOOP_LIBRARY_SCHEMA_VERSION,
    id,
    name,
    triggerEventTypes,
    primaryLoopTemplateId,
    supportingLoopTemplateIds,
    orderedLoopTemplateIds,
    learningReturnTemplateIds,
    explicitFanoutPermitted,
    decisionRule,
    sharedLearning
  };
}

export function resolveCompanyLoopTemplateId(templateId: string): string {
  return LEGACY_COMPANY_LOOP_TEMPLATE_ALIASES[templateId] ?? templateId;
}

export function getPrebuiltLoopDefinition(templateId: string): PrebuiltLoopDefinition | undefined {
  const canonicalId = resolveCompanyLoopTemplateId(templateId);
  return PREBUILT_COMPANY_LOOPS.find((item) => item.templateId === canonicalId);
}

export function getDepartmentOperatingSkill(departmentType: DepartmentType): DepartmentOperatingSkill {
  const skill = DEPARTMENT_OPERATING_SKILLS.find((item) => item.departmentType === departmentType);
  if (!skill) throw new Error(`Department operating skill not found: ${departmentType}`);
  return skill;
}

export function getCrossDepartmentPlaybooksForLoop(templateId: string): CrossDepartmentPlaybook[] {
  return CROSS_DEPARTMENT_PLAYBOOKS.filter((playbook) => playbook.orderedLoopTemplateIds.includes(templateId));
}

export function validateCompanyLoopLibraryReferences(knownTemplateIds: Iterable<string>): string[] {
  const known = new Set(knownTemplateIds);
  const errors: string[] = [];
  const loopIds = new Set(PREBUILT_COMPANY_LOOPS.map((item) => item.templateId));

  for (const definition of PREBUILT_COMPANY_LOOPS) {
    if (!known.has(definition.templateId)) errors.push(`Unknown prebuilt template: ${definition.templateId}`);
    for (const supportingId of definition.supportingLoopTemplateIds) {
      if (!loopIds.has(supportingId)) errors.push(`${definition.templateId} references unknown supporting loop ${supportingId}`);
    }
  }
  for (const skill of DEPARTMENT_OPERATING_SKILLS) {
    for (const templateId of skill.defaultLoopTemplateIds) {
      if (!loopIds.has(templateId)) errors.push(`${skill.id} references unknown loop ${templateId}`);
    }
  }
  for (const playbook of CROSS_DEPARTMENT_PLAYBOOKS) {
    for (const templateId of playbook.orderedLoopTemplateIds) {
      if (!loopIds.has(templateId)) errors.push(`${playbook.id} references unknown loop ${templateId}`);
    }
  }
  return errors;
}

function sensitiveConfidence(departmentType: DepartmentType): number {
  if (departmentType === "legal_compliance" || departmentType === "hr_talent") return 0.95;
  if (departmentType === "ops_finance" || departmentType === "management") return 0.9;
  return 0.78;
}
