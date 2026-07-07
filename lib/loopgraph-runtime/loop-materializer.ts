import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "../loopgraph-core/constants";
import { validateLoopSpec, type LoopSpec } from "../loopgraph-core/loop-spec";
import type { AccessRequirement, HumanInputRequirement } from "../loopgraph-core/access-requirements";
import type { CompanyDiscoveryProfile, DepartmentProfile } from "../loopgraph-core/discovery";
import type { LoopRecommendation } from "../loopgraph-core/loop-recommendation";
import type { MetricDefinition } from "../loopgraph-core/metric-definition";

export type MaterializeLoopRecommendationInput = {
  recommendation: LoopRecommendation;
  companyProfile: CompanyDiscoveryProfile;
  departmentProfile: DepartmentProfile;
  accessRequirements: AccessRequirement[];
  metricDefinitions: MetricDefinition[];
  humanRequirements: HumanInputRequirement[];
};

export type MaterializeLoopRecommendationResult =
  | { ok: true; spec: LoopSpec }
  | { ok: false; errors: string[] };

export function materializeLoopRecommendation(input: MaterializeLoopRecommendationInput): LoopSpec {
  const result = tryMaterializeLoopRecommendation(input);
  if (!result.ok) {
    throw new Error(`Cannot materialize recommendation:\n- ${result.errors.join("\n- ")}`);
  }
  return result.spec;
}

export function tryMaterializeLoopRecommendation(
  input: MaterializeLoopRecommendationInput
): MaterializeLoopRecommendationResult {
  const { recommendation, companyProfile, departmentProfile, accessRequirements, metricDefinitions, humanRequirements } = input;

  if (recommendation.status !== "accepted" && recommendation.status !== "materialized") {
    return { ok: false, errors: [`Recommendation ${recommendation.id} is ${recommendation.status}, not accepted.`] };
  }

  if (recommendation.readiness.blockers.some((blocker) => blocker.toLowerCase().includes("missing business goal"))) {
    return { ok: false, errors: recommendation.readiness.blockers };
  }

  const tools = uniqueBy([
    ...recommendation.allowedActions.map((action) => ({
      key: action.key,
      adapterId: action.key.split(".")[0],
      label: action.label,
      writeCapable: action.requiresApproval || action.riskLevel !== "low",
      riskLevel: action.riskLevel
    })),
    ...accessRequirements
      .filter((access) => access.accessLevel !== "read")
      .map((access) => ({
        key: `${access.integrationType}.${access.accessLevel}`,
        adapterId: access.integrationType,
        label: `${access.integrationType} ${access.accessLevel}`,
        writeCapable: true,
        riskLevel: access.accessLevel === "approve_write" ? "high" as const : "medium" as const
      }))
  ], (tool) => tool.key);

  const policyAllowedActions = uniqueBy([
    ...recommendation.allowedActions.map((action) => ({
      toolKey: action.key,
      allowed: true,
      requiresApproval: action.requiresApproval,
      customerFacing: departmentProfile.departmentType === "sales" || departmentProfile.departmentType === "customer_success",
      riskLevel: action.riskLevel
    })),
    ...tools
      .filter((tool) => tool.writeCapable)
      .map((tool) => ({
        toolKey: tool.key,
        allowed: true,
        requiresApproval: true,
        customerFacing: departmentProfile.departmentType === "sales" || departmentProfile.departmentType === "customer_success",
        riskLevel: tool.riskLevel
      }))
  ], (action) => action.toolKey);

  const spec: LoopSpec = {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: loopId(recommendation.id),
      name: recommendation.name,
      version: "1.0.0",
      description: `${recommendation.goal}. ${recommendation.whyRecommended}`,
      labels: {
        companyId: companyProfile.id,
        department: departmentProfile.departmentType,
        recommendationId: recommendation.id,
        readiness: recommendation.readiness.level,
        source: "business-discovery"
      },
      owner: {
        role: humanRequirements.find((item) => item.requirementType === "loop_owner")?.ownerRole ??
          departmentProfile.ownerRole ??
          "Department owner"
      }
    },
    trigger: {
      type: recommendation.trigger.type,
      source: recommendation.trigger.type === "schedule" ? "loopgraph.scheduler" : "business.discovery",
      event: slugify(recommendation.trigger.description),
      schedule: recommendation.trigger.cadence === "daily"
        ? "0 9 * * 1-5"
        : recommendation.trigger.cadence === "weekly"
          ? "0 9 * * 1"
          : undefined
    },
    input: {
      schema: {
        type: "object",
        properties: Object.fromEntries(recommendation.observes.map((observe) => [
          observe.key,
          { type: "string", description: observe.label }
        ])),
        additionalProperties: true
      }
    },
    output: {
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          recommendation: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                quote: { type: "string" }
              }
            }
          },
          metrics: {
            type: "array",
            items: { type: "object" }
          }
        },
        required: ["summary", "evidence"]
      }
    },
    context: {
      sources: recommendation.observes.map((observe, index) => ({
        id: `context_${index + 1}_${observe.key}`,
        type: observe.source === "manual_upload" ? "fixture" : "integration",
        adapterId: observe.source,
        variableKey: observe.key,
        title: observe.label,
        sensitivity: "internal",
        trusted: observe.required,
        precedence: index + 1
      })),
      precedence: [
        { sourceType: "policy", rank: 1 },
        { sourceType: "integration", rank: 2 },
        { sourceType: "fixture", rank: 3 },
        { sourceType: "trace", rank: 4 }
      ],
      tokenBudget: 8000,
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: [
        {
          id: "observe",
          name: "Observe process state",
          stepType: "observe",
          actor: "agent",
          description: `Collect signals for ${recommendation.name}.`
        },
        ...recommendation.allowedActions.map((action, index) => ({
          id: `action_${index + 1}`,
          name: action.label,
          stepType: "prepare_action",
          actor: "agent" as const,
          description: action.label
        })),
        {
          id: "verify",
          name: "Verify output",
          stepType: "verify",
          actor: "system",
          description: "Run configured verifiers before any human approval or execution."
        }
      ]
    },
    tools,
    policy: {
      allowedActions: policyAllowedActions,
      forbiddenActions: recommendation.forbiddenActions.map((reason, index) => ({
        toolKey: `forbidden_${index + 1}`,
        reason
      })),
      escalationRules: [
        {
          id: "human_escalation_required",
          when: {
            ambiguous: true,
            missingEvidence: true,
            riskLevel: ["high", "critical"]
          },
          createEscalationCase: {
            category: departmentProfile.departmentType === "legal_compliance" ? "legal_risk" : "operational_blocker",
            severity: "P2"
          },
          routeTo: {
            primaryOwner: departmentProfile.ownerRole ?? "Department owner",
            reviewers: humanRequirements.map((item) => item.ownerRole),
            responseSla: "1 business day"
          },
          requiresApproval: policyAllowedActions
            .filter((action) => action.requiresApproval)
            .map((action) => action.toolKey),
          decisionsRequired: [
            "Approve, reject, or request changes before any external write."
          ]
        }
      ]
    },
    verification: recommendation.verifierDraft.map((verifier, index) => ({
      id: `verifier_${index + 1}`,
      type: verifierType(verifier.type),
      config: {
        description: verifier.description
      }
    })),
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["approver", "owner", "reviewer"]
    },
    persistence: {
      idempotency: { enabled: true },
      timeout: { seconds: 120 },
      retry: { maxAttempts: 1 }
    },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true,
      exportOpenTelemetry: false
    },
    topology: {
      department: departmentProfile.departmentType,
      tags: [
        recommendation.blueprintId,
        recommendation.readiness.level,
        ...metricDefinitions.slice(0, 3).map((metric) => metric.key)
      ]
    },
    studioExtension: {
      discovery: {
        recommendationId: recommendation.id,
        goal: recommendation.goal,
        readiness: recommendation.readiness,
        accessRequirements,
        metricDefinitions,
        humanRequirements
      }
    }
  };

  try {
    return { ok: true, spec: validateLoopSpec(spec) };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function verifierType(type: LoopRecommendation["verifierDraft"][number]["type"]) {
  if (type === "numeric") return "numeric_threshold" as const;
  if (type === "human_review") return "approval_required" as const;
  if (type === "custom") return "mock_judge" as const;
  return type;
}

function loopId(recommendationId: string) {
  return slugify(recommendationId.replace(/^[^:]+:/, ""));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "loop";
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
