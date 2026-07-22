import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { DiscoveryAnswerValueTypeSchema } from "./discovery";
import { projectInspectionReportSchema } from "./project-inspection";
import { loopRoutingContractSchema } from "./routing";

export const LOOP_DESIGN_CONTEXT_SCHEMA_VERSION = "loop-design-context/v1alpha1" as const;
export const LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION = "loop-design-proposal-set/v1alpha1" as const;
export const DESIGN_RUN_SCHEMA_VERSION = "design-run/v1alpha1" as const;

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const loopDesignContextSchema = z.object({
  schemaVersion: z.literal(LOOP_DESIGN_CONTEXT_SCHEMA_VERSION).default(LOOP_DESIGN_CONTEXT_SCHEMA_VERSION),
  sessionId: z.string(),
  companyId: z.string(),
  departmentType: DepartmentTypeSchema,
  readiness: z.enum(["needs_answers", "ready_for_design"]),
  blockers: z.array(z.string()).default([]),
  projectSummary: z.object({
    projectRootId: z.string(),
    displayName: z.string(),
    registeredSpecCount: z.number().int().min(0),
    registeredDepartments: z.array(DepartmentTypeSchema),
    routingReadySpecCount: z.number().int().min(0)
  }),
  projectInspection: projectInspectionReportSchema,
  confirmedAnswers: z.array(z.object({
    answerId: z.string(),
    questionId: z.string(),
    bundleId: z.string(),
    fieldId: z.string(),
    valueType: DiscoveryAnswerValueTypeSchema,
    value: z.unknown(),
    evidenceRefs: z.array(z.string()).default([])
  })).default([]),
  departmentBranchQuestions: z.array(z.string()).default([]),
  deterministicCandidates: z.array(z.object({
    id: z.string(),
    name: z.string(),
    whyCandidate: z.string(),
    expectedRoutingProblemTypes: z.array(z.string()).default([]),
    requiredCapabilities: z.array(z.string()).default([])
  })).default([]),
  connectorStatus: z.array(z.object({
    capability: z.string(),
    status: z.enum(["missing", "manual_fallback", "connected", "degraded"]),
    sourceAnswerIds: z.array(z.string()).default([])
  })).default([]),
  existingLoops: z.array(z.object({
    loopId: z.string(),
    name: z.string(),
    department: DepartmentTypeSchema,
    routingReady: z.boolean().default(false)
  })).default([]),
  companyBoundaries: z.array(z.string()).default([]),
  outputSchema: z.object({
    proposalSetSchemaVersion: z.literal(LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION),
    privateReasoningAllowed: z.literal(false)
  }).default({
    proposalSetSchemaVersion: LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION,
    privateReasoningAllowed: false
  }),
  contextHash: z.string()
});

export const loopDesignProposalSchema = z.object({
  proposalId: z.string(),
  loopSpecId: z.string(),
  shortName: z.string(),
  department: DepartmentTypeSchema,
  parentLoopId: z.string().optional(),
  goal: z.string(),
  businessOutcome: z.string(),
  reasoningSummary: z.string(),
  assumptions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  alternativesConsidered: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  trigger: z.object({
    type: z.enum(["event", "schedule", "manual", "webhook"]),
    description: z.string(),
    cadence: z.string().optional()
  }),
  workItem: z.string(),
  observedSignals: z.array(z.string()).default([]),
  contextSources: z.array(z.string()).default([]),
  routineSteps: z.array(z.object({
    id: z.string(),
    label: z.string(),
    actor: z.enum(["agent", "human", "system"]),
    description: z.string()
  })).min(1),
  proposedActions: z.array(z.object({
    key: z.string(),
    label: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    requiresApproval: z.boolean(),
    customerFacing: z.boolean().default(false)
  })).default([]),
  verifiers: z.array(z.object({
    type: z.enum(["schema", "policy", "evidence", "numeric", "human_review", "custom"]),
    description: z.string()
  })).default([]),
  metrics: z.object({
    primary: z.string(),
    leading: z.string().optional(),
    guardrails: z.array(z.string()).default([]),
    baselineState: z.string().optional()
  }),
  ownerRole: z.string(),
  reviewerRoles: z.array(z.string()).default([]),
  escalationConditions: z.array(z.string()).default([]),
  forbiddenActions: z.array(z.string()).default([]),
  connectorRequirements: z.array(z.object({
    capability: z.string(),
    reason: z.string(),
    requiredFor: z.enum(["design", "simulation", "execution", "routing"])
  })).default([]),
  manualFallbacks: z.array(z.string()).default([]),
  readinessTarget: z.enum(["discovery_ready", "simulation_ready", "shadow_ready", "execution_ready"]).default("simulation_ready"),
  rolloutStage: z.enum(["shadow", "recommend", "simulate", "execute_with_approval", "autonomous_low_risk"]).default("shadow"),
  requiredFromUser: z.array(z.object({
    type: z.enum(["connection", "owner", "policy", "sample_data", "baseline", "approval"]),
    label: z.string(),
    reason: z.string()
  })).default([]),
  topologyPreview: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      label: z.string(),
      type: z.enum(["company_brain", "department", "loop", "connector", "metric"])
    })).default([]),
    edges: z.array(z.object({
      source: z.string(),
      target: z.string(),
      label: z.string(),
      executable: z.boolean().default(false)
    })).default([])
  }),
  routing: loopRoutingContractSchema
});

export const loopDesignProposalSetSchema = z.object({
  schemaVersion: z.literal(LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION).default(LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION),
  sessionId: z.string(),
  departmentType: DepartmentTypeSchema,
  providerMode: z.enum(["deterministic", "hermes_host", "embedded"]),
  reasoningProfile: z.enum(["standard", "high"]).default("high"),
  proposals: z.array(loopDesignProposalSchema).min(1),
  globalAssumptions: z.array(z.string()).default([]),
  validationSummary: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()).default([])
  }).default({ valid: false, errors: [] })
});

export const designRunSchema = z.object({
  schemaVersion: z.literal(DESIGN_RUN_SCHEMA_VERSION).default(DESIGN_RUN_SCHEMA_VERSION),
  id: z.string(),
  sessionId: z.string(),
  departmentType: DepartmentTypeSchema,
  providerMode: z.enum(["deterministic", "hermes_host", "embedded"]),
  providerName: z.string().optional(),
  modelIdentifier: z.string().optional(),
  reasoningProfile: z.enum(["standard", "high"]),
  promptVersion: z.string(),
  inputHash: z.string(),
  outputHash: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  validationAttempts: z.number().int().min(0).default(0),
  validationErrors: z.array(z.string()).default([]),
  finalProposalIds: z.array(z.string()).default([]),
  metadata: jsonObjectSchema.default({})
});

export type LoopDesignContext = z.infer<typeof loopDesignContextSchema>;
export type LoopDesignProposal = z.infer<typeof loopDesignProposalSchema>;
export type LoopDesignProposalSet = z.infer<typeof loopDesignProposalSetSchema>;
export type DesignRun = z.infer<typeof designRunSchema>;
