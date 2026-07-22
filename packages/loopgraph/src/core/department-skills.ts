import { z } from "zod";

export const DEPARTMENT_TYPES = [
  "management",
  "marketing",
  "sales",
  "product",
  "customer_success",
  "engineering",
  "ops_finance",
  "hr_talent",
  "legal_compliance",
  "custom"
] as const;

export const DepartmentTypeSchema = z.enum(DEPARTMENT_TYPES);

export type DepartmentType = z.infer<typeof DepartmentTypeSchema>;

export const DEPARTMENT_TYPE_ALIASES: Record<string, DepartmentType> = {
  operations_finance: "ops_finance",
  hr: "hr_talent",
  legal_security: "legal_compliance"
};

export const DEPARTMENT_LABELS = {
  management: "Management",
  marketing: "Marketing",
  sales: "Sales",
  product: "Product",
  customer_success: "Customer Success",
  engineering: "Engineering",
  ops_finance: "Ops / Finance",
  hr_talent: "HR / Talent",
  legal_compliance: "Legal / Compliance",
  custom: "Custom"
} satisfies Record<DepartmentType, string>;

export const DEPARTMENT_DESCRIPTIONS = {
  management: "Company operating cadence, executive decisions, cross-functional priorities, and rollups from department loops.",
  marketing: "Paid acquisition, content creation, lifecycle marketing, SEO, events, partnerships, brand, and market learning.",
  sales: "Lead qualification, account research, buyer follow-up, pipeline hygiene, forecasting, and deal-risk preparation.",
  product: "Feedback synthesis, discovery preparation, roadmap evidence, spec drafting, release learning, and product-quality loops.",
  customer_success: "Customer health, support escalation, renewal risk, QBR preparation, knowledge base maintenance, and proactive outreach.",
  engineering: "Issue triage, implementation planning, PR review preparation, QA checks, release readiness, and incident learning.",
  ops_finance: "Approvals, invoice and billing exceptions, variance analysis, close readiness, procurement, forecasting, and audit evidence.",
  hr_talent: "Candidate pipeline, onboarding, manager follow-up, performance-review preparation, learning, and sensitive people workflows.",
  legal_compliance: "Contract triage, compliance evidence, policy drift, access reviews, security questionnaires, and expert-reviewed risk workflows.",
  custom: "A specific recurring workflow that does not fit one built-in department."
} satisfies Record<DepartmentType, string>;

export type DepartmentCatalogItem = {
  id: DepartmentType;
  label: string;
  description: string;
  aliases: string[];
};

export function normalizeDepartmentType(value: string): DepartmentType | undefined {
  const normalized = value.trim().toLowerCase();
  if (DepartmentTypeSchema.safeParse(normalized).success) {
    return normalized as DepartmentType;
  }
  return DEPARTMENT_TYPE_ALIASES[normalized];
}

export function requireDepartmentType(value: string): DepartmentType {
  const department = normalizeDepartmentType(value);
  if (!department) {
    throw new Error(`Unknown department type: ${value}`);
  }
  return department;
}

export function formatDepartmentType(departmentType: DepartmentType): string {
  return DEPARTMENT_LABELS[departmentType];
}

export function listDepartmentCatalog(options: { includeCustom?: boolean } = {}): DepartmentCatalogItem[] {
  const includeCustom = options.includeCustom ?? true;
  return DEPARTMENT_TYPES
    .filter((departmentType) => includeCustom || departmentType !== "custom")
    .map((departmentType) => ({
      id: departmentType,
      label: DEPARTMENT_LABELS[departmentType],
      description: DEPARTMENT_DESCRIPTIONS[departmentType],
      aliases: Object.entries(DEPARTMENT_TYPE_ALIASES)
        .filter(([, canonical]) => canonical === departmentType)
        .map(([alias]) => alias)
    }));
}

export const DiscoveryQuestionTypeSchema = z.enum([
  "text",
  "textarea",
  "single_select",
  "multi_select",
  "number",
  "boolean",
  "integration_picker",
  "metric_picker",
  "owner_picker",
  "risk_level",
  "autonomy_level"
]);

export const DiscoveryQuestionProducesSchema = z.enum([
  "company_context",
  "department_context",
  "process_inventory",
  "goal",
  "signal",
  "integration_requirement",
  "metric",
  "human_review_rule",
  "risk_rule",
  "loop_candidate"
]);

export const DiscoveryQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  helpText: z.string().optional(),
  type: DiscoveryQuestionTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  produces: z.array(DiscoveryQuestionProducesSchema)
});

export const LoopBlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  processType: z.string(),
  defaultTrigger: z.string(),
  defaultRoutine: z.array(z.string()),
  defaultVerifier: z.array(z.string()),
  defaultHumanReview: z.array(z.string()),
  defaultMetrics: z.array(z.string()),
  defaultRiskLevel: z.enum(["low", "medium", "high", "critical"]),
  defaultAutonomyLevel: z.enum(["L0", "L1", "L2", "L3", "L4"])
});

export const DepartmentSkillPackSchema = z.object({
  id: z.string(),
  departmentType: DepartmentTypeSchema,
  name: z.string(),
  description: z.string(),
  purpose: z.string(),
  commonGoals: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    exampleMetrics: z.array(z.string()),
    typicalPainPoints: z.array(z.string())
  })),
  discoveryQuestions: z.array(DiscoveryQuestionSchema),
  loopBlueprints: z.array(LoopBlueprintSchema),
  requiredIntegrations: z.array(z.object({
    integrationType: z.string(),
    reason: z.string(),
    variables: z.array(z.string()),
    actions: z.array(z.string()),
    requiredForLoopBlueprints: z.array(z.string())
  })),
  defaultMetrics: z.array(z.object({
    key: z.string(),
    label: z.string(),
    description: z.string(),
    source: z.enum(["integration", "trace", "human_review", "manual", "modeled", "undefined"]),
    formula: z.string().optional(),
    baselineRequired: z.boolean()
  })),
  humanReviewRules: z.array(z.object({
    id: z.string(),
    condition: z.string(),
    reviewerRole: z.string(),
    reason: z.string()
  })).default([]),
  riskRules: z.array(z.object({
    id: z.string(),
    condition: z.string(),
    requiredAction: z.enum(["allow", "review", "block", "escalate"]),
    reason: z.string()
  })),
  dailySummaryFields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    source: z.string(),
    displayType: z.enum(["number", "currency", "duration", "status", "text", "trend"])
  }))
});

export type DiscoveryQuestion = z.infer<typeof DiscoveryQuestionSchema>;
export type LoopBlueprint = z.infer<typeof LoopBlueprintSchema>;
export type DepartmentSkillPack = z.infer<typeof DepartmentSkillPackSchema>;
