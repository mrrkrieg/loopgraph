import { LOOPGRAPH_API_VERSION, LOOP_KIND, validateLoopSpec, type LoopSpec } from "loopgraph/core";
import { getDepartmentTemplate, getTemplateById } from "./templates";
import type { DepartmentKey, LoopTemplate } from "./types";

export type CreateSpecFromTemplateOptions = {
  id?: string;
  name?: string;
  goal?: string;
  ownerRole?: string;
};

export function createSpecFromTemplate(
  templateId: string,
  options: CreateSpecFromTemplateOptions = {}
): LoopSpec {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const department = getDepartmentTemplate(template.department);
  const loopId = options.id ?? template.id;
  const ownerRole = options.ownerRole ?? template.defaultOwners?.[0] ?? "loop_owner";
  const dataSources = template.requiredDataSources ?? department?.commonDataSources ?? ["manual"];
  const metrics = template.defaultMetrics ?? [
    template.primaryMetric ?? department?.commonMetrics[0] ?? "Quality-adjusted output"
  ];
  const safeLoopType = slug(template.loopType);
  const primaryToolKey = `draft_${safeLoopType}_summary`;
  const reviewToolKey = `create_${safeLoopType}_review_task`;

  return validateLoopSpec({
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: loopId,
      name: options.name ?? template.name,
      version: "0.1.0",
      description: template.description,
      labels: {
        department: template.department,
        templateId: template.id,
        runtimeLevel: template.runtimeLevel
      },
      owner: {
        role: ownerRole
      }
    },
    trigger: {
      type: "manual",
      source: "loopgraph",
      event: `${safeLoopType}.requested`
    },
    input: {
      schema: {
        type: "object",
        required: ["eventId", "workItem"],
        properties: {
          eventId: { type: "string" },
          workItem: { type: "object" }
        }
      },
      fixtures: template.fixturePaths?.map((fixturePath, index) => ({
        id: `${safeLoopType}-fixture-${index + 1}`,
        path: relativeFixturePath(fixturePath)
      }))
    },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: {
      sources: [
        {
          id: "loop_policy",
          type: "policy",
          title: `${template.name} policy`,
          sensitivity: "internal",
          trusted: true,
          precedence: 0
        },
        ...dataSources.slice(0, 5).map((source, index) => ({
          id: slug(source),
          type: "integration" as const,
          adapterId: `mock-${slug(source)}`,
          variableKey: `workItem.${slug(source).replace(/-/g, "_")}`,
          title: source,
          sensitivity: "internal" as const,
          trusted: index === 0,
          precedence: index + 1
        }))
      ],
      precedence: [
        { sourceType: "policy", rank: 0 },
        { sourceType: "integration", rank: 1 }
      ],
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: (template.routine?.length ? template.routine : defaultRoutine(template)).map((step, index) => ({
        id: `step_${index + 1}`,
        name: step,
        stepType: index === 0 ? "observe" : index === 1 ? "assess" : "prepare",
        actor: index === 0 ? "system" : index === 1 ? "agent" : "system",
        description: step
      }))
    },
    tools: [
      {
        key: primaryToolKey,
        adapterId: "mock-loopgraph",
        label: `Draft ${template.name} output`,
        writeCapable: false,
        riskLevel: "low"
      },
      {
        key: reviewToolKey,
        adapterId: "mock-loopgraph",
        label: `Create ${template.name} review task`,
        writeCapable: true,
        riskLevel: "medium"
      }
    ],
    policy: {
      allowedActions: [
        {
          toolKey: primaryToolKey,
          allowed: true,
          requiresApproval: false,
          customerFacing: false,
          riskLevel: "low"
        },
        {
          toolKey: reviewToolKey,
          allowed: true,
          requiresApproval: true,
          customerFacing: false,
          riskLevel: "medium"
        }
      ],
      forbiddenActions: [
        {
          toolKey: `execute_${safeLoopType}_without_review`,
          reason: "Template-generated loops must start in reviewable mode."
        }
      ],
      escalationRules: [
        {
          id: `${safeLoopType}-low-confidence`,
          when: {
            any: [
              "confidence < 0.7",
              "required context missing",
              "human judgment required"
            ]
          },
          createEscalationCase: {
            category: escalationCategory(template.department),
            severity: "P2"
          },
          routeTo: {
            primaryOwner: ownerRole,
            reviewers: (template.defaultOwners ?? []).slice(1, 3).map(slug),
            responseSla: "4h"
          },
          requiresApproval: ["review_task", "policy_exception"],
          decisionsRequired: [`Review ${template.name} low-confidence output`]
        }
      ]
    },
    verification: [
      { id: "schema", type: "schema" },
      { id: "policy", type: "policy" },
      { id: "evidence", type: "evidence" },
      { id: "approval_required", type: "approval_required" }
    ],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["approver", "reviewer", "owner"]
    },
    persistence: {
      idempotency: {
        enabled: true
      }
    },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true
    },
    topology: {
      department: template.department,
      tags: [template.runtimeLevel, template.loopType, ...(metrics.slice(0, 2).map(slug))]
    },
    studioExtension: {
      templateId: template.id,
      runtimeLevel: template.runtimeLevel,
      goal: options.goal ?? template.goal,
      businessOutcome: template.businessOutcome,
      metrics,
      connections: template.connections ?? [],
      hiddenLabor: template.defaultHiddenLabor
    }
  });
}

function defaultRoutine(template: LoopTemplate) {
  return [
    `Observe ${template.name} work item and relevant context`,
    `Assess goal, risk, and next best action for ${template.name}`,
    `Prepare reviewable output, evidence, and escalation if needed`
  ];
}

function escalationCategory(department: DepartmentKey) {
  if (department === "customer_success") return "customer_risk";
  if (department === "sales") return "revenue_risk";
  if (department === "engineering") return "delivery_risk";
  if (department === "legal_security") return "security";
  if (department === "operations_finance") return "operational_risk";
  if (department === "hr") return "people_risk";
  if (department === "management") return "management_decision";
  return "workflow_risk";
}

function relativeFixturePath(fixturePath: string) {
  return fixturePath.startsWith("fixtures/") ? `../../${fixturePath}` : fixturePath;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
