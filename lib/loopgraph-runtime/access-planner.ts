import {
  AccessRequirementSchema,
  IntegrationTypeSchema,
  type AccessRequirement
} from "loopgraph/core";
import type { DepartmentSkillPack } from "loopgraph/core";
import type { LoopRecommendation } from "loopgraph/core";
import type { ProcessInventoryItem } from "loopgraph/core";

export function generateAccessRequirements(
  recommendation: LoopRecommendation,
  skillPack?: DepartmentSkillPack,
  process?: ProcessInventoryItem
): AccessRequirement[] {
  const required = (skillPack?.requiredIntegrations ?? [])
    .filter((integration) => integration.requiredForLoopBlueprints.includes(recommendation.blueprintId));
  const sources = new Set([
    ...required.map((integration) => integration.integrationType),
    ...(process?.systemsTouched ?? []),
    ...recommendation.observes.map((observe) => observe.source)
  ]);

  return Array.from(sources)
    .map((source) => normalizeIntegration(source))
    .filter((source): source is AccessRequirement["integrationType"] => Boolean(source))
    .map((integrationType) => {
      const packRequirement = required.find((item) => normalizeIntegration(item.integrationType) === integrationType);
      const writeAction = packRequirement?.actions.some((action) => action.includes("write") || action.includes("draft"));
      const approvalAction = packRequirement?.actions.some((action) => action.includes("approve"));
      return AccessRequirementSchema.parse({
        id: `${recommendation.id}:access:${integrationType}`,
        companyId: recommendation.companyId,
        departmentId: recommendation.departmentId,
        loopRecommendationId: recommendation.id,
        integrationType,
        accessLevel: approvalAction ? "approve_write" : writeAction ? "write" : "read",
        requiredVariables: packRequirement?.variables ?? [`${integrationType}.read`],
        requiredActions: packRequirement?.actions ?? [],
        reason: packRequirement?.reason ?? `${recommendation.name} observes ${integrationType} signals for safe recommendations.`,
        blockingLevel: packRequirement ? "blocking" : "degrades_quality",
        status: integrationType === "manual_upload" ? "manual_fallback" : "not_requested"
      });
    });
}

export function generateAccessPlan(
  recommendations: LoopRecommendation[],
  skillPacks: DepartmentSkillPack[] = [],
  processes: ProcessInventoryItem[] = []
) {
  return recommendations.flatMap((recommendation) => generateAccessRequirements(
    recommendation,
    skillPacks.find((pack) => pack.id === recommendation.skillPackId),
    processes.find((process) => recommendation.sourceProcessIds.includes(process.id))
  ));
}

function normalizeIntegration(value: string) {
  const normalized = value.toLowerCase().replace(/[\s.-]+/g, "_");
  const aliases: Record<string, string> = {
    cms: "website_cms",
    docs_write: "docs",
    google_docs: "docs",
    financial_system: "finance",
    product_usage: "usage",
    manual: "manual_upload"
  };
  const candidate = aliases[normalized] ?? normalized;
  return IntegrationTypeSchema.safeParse(candidate).success
    ? candidate as AccessRequirement["integrationType"]
    : undefined;
}

