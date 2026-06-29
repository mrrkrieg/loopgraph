import type { LoopSpec as FlatLoopSpec } from "../loop-engineering-builder/loop-spec-schema";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "./constants";
import { type LoopSpec, validateLoopSpec } from "./loop-spec";

export function flatSpecToV1alpha1(flat: FlatLoopSpec): LoopSpec {
  const spec: LoopSpec = {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: flat.id,
      name: flat.name,
      version: "1.0.0",
      description: flat.goal,
      owner: { role: flat.humanOwner, name: flat.humanOwner }
    },
    trigger: {
      type: "manual",
      source: "design-studio",
      event: "manual.run"
    },
    input: {
      schema: {
        type: "object",
        properties: Object.fromEntries(flat.inputs.map((input) => [input.name, { type: "string", description: input.description }]))
      }
    },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          assumptions: { type: "array" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" },
          goal: { type: "string" },
          targetMetric: { type: "string" },
          businessOutcome: { type: "string" }
        }
      }
    },
    context: {
      sources: flat.dataSources.map((source, index) => ({
        id: `source_${index + 1}`,
        type: "fixture" as const,
        title: source.name,
        sensitivity: "internal" as const,
        trusted: true,
        precedence: index
      })),
      precedence: [{ sourceType: "fixture", rank: 0 }],
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: flat.routine.map((step, index) => ({
        id: `step_${index + 1}`,
        name: step.stepName,
        stepType: step.stepType,
        actor: step.actor,
        description: step.description
      }))
    },
    tools: flat.routine
      .filter((step) => step.toolRequired)
      .map((step) => ({
        key: step.toolRequired!,
        adapterId: "local-json",
        label: step.toolRequired!,
        writeCapable: true,
        riskLevel: "medium" as const
      })),
    policy: {
      allowedActions: flat.routine
        .filter((step) => step.toolRequired)
        .map((step) => ({
          toolKey: step.toolRequired!,
          allowed: true,
          requiresApproval: flat.autonomyLevel !== "execute_with_limits",
          customerFacing: false,
          riskLevel: "medium" as const
        })),
      forbiddenActions: [],
      escalationRules: flat.escalation.map((rule, index) => ({
        id: `escalation_${index + 1}`,
        when: { summary: rule.condition },
        routeTo: {
          primaryOwner: rule.ownerRole,
          reviewers: [rule.ownerRole],
          responseSla: "60m"
        },
        requiresApproval: ["human_review"],
        decisionsRequired: [rule.reason]
      }))
    },
    verification: flat.verification.map((item, index) => ({
      id: `verifier_${index + 1}`,
      type: item.checkType === "deterministic" ? "schema" : item.checkType === "human_review" ? "approval_required" : "mock_judge"
    })),
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["approver", "reviewer", "owner"]
    },
    persistence: { idempotency: { enabled: true } },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true
    },
    topology: {
      department: flat.department,
      tags: [flat.loopType]
    },
    studioExtension: {
      workItem: flat.workItem,
      cadence: flat.cadence,
      measurementPlan: flat.measurementPlan,
      managementReviewOutput: flat.managementReviewOutput,
      metrics: flat.metrics,
      traceSchema: flat.traceSchema
    }
  };

  return validateLoopSpec(spec);
}

export function v1alpha1ToFlat(spec: LoopSpec): FlatLoopSpec {
  const ext = (spec.studioExtension ?? {}) as Record<string, unknown>;
  return {
    id: spec.metadata.id,
    name: spec.metadata.name,
    department: spec.topology?.department ?? "custom",
    loopType: spec.topology?.tags?.[0] ?? "workflow",
    goal: spec.metadata.description ?? spec.metadata.name,
    targetMetric: "Quality-adjusted output",
    businessOutcome: "Improve measurable business outcome",
    workItem: String(ext.workItem ?? "Recurring work item"),
    trigger: `${spec.trigger.source}.${spec.trigger.event}`,
    cadence: String(ext.cadence ?? "Weekly"),
    inputs: spec.context.sources.map((source) => ({
      name: source.title,
      source: source.adapterId ?? source.type,
      required: true,
      description: source.title
    })),
    dataSources: spec.context.sources.map((source) => ({
      name: source.title,
      type: source.type,
      purpose: source.title,
      required: true
    })),
    routine: spec.routine.steps.map((step) => ({
      stepName: step.name,
      stepType: step.stepType,
      description: step.description,
      actor: step.actor,
      toolRequired: spec.tools.find((tool) => tool.label === step.name)?.key
    })),
    verification: spec.verification.map((item) => ({
      name: item.id,
      checkType: item.type === "approval_required" ? "human_review" : item.type === "mock_judge" ? "llm_judge" : "deterministic",
      description: item.id,
      passCriteria: "Configured in LoopSpec verifier binding"
    })),
    escalation: spec.policy.escalationRules.map((rule) => ({
      condition: JSON.stringify(rule.when),
      reason: rule.decisionsRequired[0] ?? "Escalation required",
      ownerRole: rule.routeTo.primaryOwner,
      severity: "high"
    })),
    humanOwner: spec.metadata.owner?.role ?? "owner",
    autonomyLevel: "draft_for_review",
    traceSchema: (ext.traceSchema as Record<string, unknown>) ?? {},
    metrics: (ext.metrics as FlatLoopSpec["metrics"]) ?? [],
    measurementPlan: (ext.measurementPlan as FlatLoopSpec["measurementPlan"]) ?? {
      baselineWorkVolume: "Unknown",
      baselineHumanTime: "Unknown",
      loopHumanExecutionTime: "Unknown",
      reviewTime: "Unknown",
      reworkTime: "Unknown",
      botsittingTime: "Unknown",
      escalationTime: "Unknown",
      qualityMetric: "Unknown",
      businessOutcomeMetric: "Unknown",
      reviewCadence: "Weekly"
    },
    managementReviewOutput: (ext.managementReviewOutput as FlatLoopSpec["managementReviewOutput"]) ?? {
      cadence: "Weekly",
      questions: [],
      decisionsNeeded: [],
      rollupMetrics: []
    }
  };
}
