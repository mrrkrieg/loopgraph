import { z } from "zod";

export const IntegrationTypeSchema = z.enum([
  "crm",
  "ads",
  "analytics",
  "support",
  "ticketing",
  "calendar",
  "email",
  "github",
  "linear",
  "slack",
  "database",
  "spreadsheet",
  "docs",
  "finance",
  "usage",
  "website_cms",
  "custom_api",
  "manual_upload"
]);

export const AccessRequirementSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentId: z.string(),
  loopRecommendationId: z.string().optional(),
  loopId: z.string().optional(),
  integrationType: IntegrationTypeSchema,
  accessLevel: z.enum(["read", "write", "approve_write"]),
  requiredVariables: z.array(z.string()).default([]),
  requiredActions: z.array(z.string()).default([]),
  reason: z.string(),
  blockingLevel: z.enum(["blocking", "degrades_quality", "optional"]),
  status: z.enum([
    "not_requested",
    "requested",
    "connected",
    "failed",
    "waived",
    "manual_fallback"
  ])
});

export const HumanInputRequirementSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentId: z.string(),
  loopRecommendationId: z.string().optional(),
  loopId: z.string().optional(),
  ownerRole: z.string(),
  requirementType: z.enum([
    "loop_owner",
    "approval",
    "customer_facing_review",
    "metric_owner",
    "rollout_decision",
    "review_budget"
  ]),
  prompt: z.string(),
  reason: z.string(),
  blocking: z.boolean(),
  status: z.enum(["open", "answered", "waived"])
});

export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;
export type AccessRequirement = z.infer<typeof AccessRequirementSchema>;
export type HumanInputRequirement = z.infer<typeof HumanInputRequirementSchema>;

