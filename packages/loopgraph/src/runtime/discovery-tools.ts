import { z } from "zod";
import {
  confirmDiscoveryProjectContext,
  getDiscoverySession,
  getNextDiscoveryQuestions,
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";

export const LOOPGRAPH_DISCOVERY_TOOL_NAMES = [
  "loopgraph_discovery_start",
  "loopgraph_discovery_get",
  "loopgraph_discovery_confirm_project_context",
  "loopgraph_discovery_select_departments",
  "loopgraph_discovery_next_questions",
  "loopgraph_discovery_submit_answers"
] as const;

export type LoopgraphDiscoveryToolName = (typeof LOOPGRAPH_DISCOVERY_TOOL_NAMES)[number];

export type LoopgraphDiscoveryToolRuntimeOptions = {
  projectRoot?: string;
};

export const discoveryStartInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string().optional(),
  companyId: z.string().optional(),
  companyName: z.string().optional()
}).default({});

export const discoveryGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string()
});

export const discoveryConfirmProjectContextInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string(),
  expectedRevision: z.number().int().min(0).optional(),
  displayName: z.string().optional(),
  companyDescription: z.string().optional(),
  customerType: z.string().optional(),
  primaryGoal: z.string().optional(),
  northStarMetric: z.string().optional(),
  sourceOfTruth: z.string().optional(),
  additionalTools: z.array(z.string()).default([]),
  confirmationNotes: z.string().optional(),
  confirmedStack: z.boolean().default(true)
});

export const discoverySelectDepartmentsInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string(),
  departments: z.array(z.string()).min(1),
  activeDepartment: z.string().optional(),
  expectedRevision: z.number().int().min(0).optional()
});

export const discoveryNextQuestionsInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string()
});

export const discoverySubmitAnswersInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string(),
  bundleId: z.string(),
  answers: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().int().min(0).optional()
});

export type DiscoveryStartInput = z.input<typeof discoveryStartInputSchema>;
export type DiscoveryGetInput = z.input<typeof discoveryGetInputSchema>;
export type DiscoveryConfirmProjectContextInput = z.input<typeof discoveryConfirmProjectContextInputSchema>;
export type DiscoverySelectDepartmentsInput = z.input<typeof discoverySelectDepartmentsInputSchema>;
export type DiscoveryNextQuestionsInput = z.input<typeof discoveryNextQuestionsInputSchema>;
export type DiscoverySubmitAnswersInput = z.input<typeof discoverySubmitAnswersInputSchema>;

export const loopgraphDiscoveryToolDefinitions = [
  {
    name: "loopgraph_discovery_start",
    description: "Start or resume a project-local Loopgraph discovery session for Hermes.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_discovery_get",
    description: "Read a project-local Loopgraph discovery session.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_discovery_confirm_project_context",
    description: "Confirm safe detected project context and store a ProjectProfile on the shared discovery session.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_discovery_select_departments",
    description: "Select canonical departments for a discovery session using optimistic revision checks.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_discovery_next_questions",
    description: "Return the next Loopgraph-supplied question bundle Hermes should ask.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_discovery_submit_answers",
    description: "Submit answers for the active Loopgraph question bundle using optimistic revision checks.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphDiscoveryToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphDiscoveryTool(
  name: LoopgraphDiscoveryToolName,
  input: unknown,
  options: LoopgraphDiscoveryToolRuntimeOptions = {}
) {
  if (name === "loopgraph_discovery_start") {
    const parsed = discoveryStartInputSchema.parse(input);
    return startHermesDiscoverySession({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      companyId: parsed.companyId,
      companyName: parsed.companyName,
      createdByActor: "hermes"
    });
  }
  if (name === "loopgraph_discovery_get") {
    const parsed = discoveryGetInputSchema.parse(input);
    const session = await getDiscoverySession(parsed.sessionId, parsed.projectRoot ?? options.projectRoot);
    if (!session) throw new Error(`Discovery session not found: ${parsed.sessionId}`);
    return session;
  }
  if (name === "loopgraph_discovery_confirm_project_context") {
    const parsed = discoveryConfirmProjectContextInputSchema.parse(input);
    return confirmDiscoveryProjectContext({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      expectedRevision: parsed.expectedRevision,
      displayName: parsed.displayName,
      companyDescription: parsed.companyDescription,
      customerType: parsed.customerType,
      primaryGoal: parsed.primaryGoal,
      northStarMetric: parsed.northStarMetric,
      sourceOfTruth: parsed.sourceOfTruth,
      additionalTools: parsed.additionalTools,
      confirmationNotes: parsed.confirmationNotes,
      confirmedStack: parsed.confirmedStack,
      actor: "hermes"
    });
  }
  if (name === "loopgraph_discovery_select_departments") {
    const parsed = discoverySelectDepartmentsInputSchema.parse(input);
    return selectDiscoveryDepartments({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      departments: parsed.departments,
      activeDepartment: parsed.activeDepartment,
      expectedRevision: parsed.expectedRevision,
      actor: "hermes"
    });
  }
  if (name === "loopgraph_discovery_next_questions") {
    const parsed = discoveryNextQuestionsInputSchema.parse(input);
    return getNextDiscoveryQuestions({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId
    });
  }
  if (name === "loopgraph_discovery_submit_answers") {
    const parsed = discoverySubmitAnswersInputSchema.parse(input);
    return submitDiscoveryAnswers({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      bundleId: parsed.bundleId,
      answers: parsed.answers,
      expectedRevision: parsed.expectedRevision,
      actor: "hermes"
    });
  }
  throw new Error(`Unknown Loopgraph discovery tool: ${String(name)}`);
}
