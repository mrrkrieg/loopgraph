import { z } from "zod";
import { evidenceGapRequiredForSchema, hermesDesignTaskStatusSchema } from "../core";
import {
  getNextEvidenceGapQuestions,
  readEvidenceGapSet,
  submitEvidenceGapAnswer
} from "./evidence-gap-engine";
import {
  getHermesDesignTask,
  listHermesDesignTasks,
  resumeHermesDesignTasksForSession,
  startHermesDesignTask
} from "./hermes-design-bridge";

export const LOOPGRAPH_HERMES_DESIGN_TOOL_NAMES = [
  "loopgraph_hermes_design_start",
  "loopgraph_hermes_design_tasks_get",
  "loopgraph_evidence_gaps_get",
  "loopgraph_evidence_gap_answer"
] as const;

export type LoopgraphHermesDesignToolName = (typeof LOOPGRAPH_HERMES_DESIGN_TOOL_NAMES)[number];

export type LoopgraphHermesDesignToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

export const hermesDesignStartInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string().min(1),
  department: z.string().optional(),
  reason: z.enum(["user_requested", "loop_opportunity", "unhandled_problem", "improvement"]).default("user_requested"),
  originProblemIds: z.array(z.string().min(1)).default([]),
  originOpportunityId: z.string().optional(),
  requestedBy: z.string().default("hermes")
});

export const hermesDesignTasksGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  status: hermesDesignTaskStatusSchema.optional()
}).default({});

export const evidenceGapsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string().min(1),
  requiredFor: evidenceGapRequiredForSchema.optional(),
  limit: z.number().int().min(1).max(3).default(3)
});

export const evidenceGapAnswerInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string().min(1),
  gapId: z.string().min(1),
  answer: z.unknown(),
  expectedRevision: z.number().int().min(0).optional(),
  answeredBy: z.enum(["user", "hermes", "browser", "api"]).default("hermes"),
  evidenceRefs: z.array(z.string()).default([])
});

export const loopgraphHermesDesignToolDefinitions = [
  {
    name: "loopgraph_hermes_design_start",
    description: "Start or reuse a durable Loopgraph-initiated Hermes design task for a discovery session.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_hermes_design_tasks_get",
    description: "Inspect durable Hermes design tasks and their delivery, evidence-gap, and compiler state.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_evidence_gaps_get",
    description: "Compile current evidence gaps and return at most three focused questions required for the next stage.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_evidence_gap_answer",
    description: "Resolve one evidence gap, update the shared discovery session, and return the next focused questions.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphHermesDesignToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphHermesDesignTool(
  name: LoopgraphHermesDesignToolName,
  input: unknown,
  options: LoopgraphHermesDesignToolRuntimeOptions = {}
) {
  if (name === "loopgraph_hermes_design_start") {
    const parsed = hermesDesignStartInputSchema.parse(input);
    return startHermesDesignTask({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      department: parsed.department,
      reason: parsed.reason,
      originProblemIds: parsed.originProblemIds,
      originOpportunityId: parsed.originOpportunityId,
      requestedBy: parsed.requestedBy,
      now: options.now
    });
  }
  if (name === "loopgraph_hermes_design_tasks_get") {
    const parsed = hermesDesignTasksGetInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
    if (parsed.taskId) {
      return {
        task: await getHermesDesignTask(parsed.taskId, projectRoot)
      };
    }
    return {
      tasks: await listHermesDesignTasks(projectRoot, {
        sessionId: parsed.sessionId,
        status: parsed.status
      })
    };
  }
  if (name === "loopgraph_evidence_gaps_get") {
    const parsed = evidenceGapsGetInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot;
    const next = await getNextEvidenceGapQuestions({
      projectRoot,
      sessionId: parsed.sessionId,
      requiredFor: parsed.requiredFor,
      limit: parsed.limit
    });
    return {
      ...next,
      gapSet: await readEvidenceGapSet(parsed.sessionId, projectRoot)
    };
  }
  if (name === "loopgraph_evidence_gap_answer") {
    const parsed = evidenceGapAnswerInputSchema.parse(input);
    const result = await submitEvidenceGapAnswer({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      gapId: parsed.gapId,
      answer: parsed.answer,
      expectedRevision: parsed.expectedRevision,
      answeredBy: parsed.answeredBy,
      evidenceRefs: parsed.evidenceRefs,
      now: options.now
    });
    return {
      ...result,
      resumedTasks: await resumeHermesDesignTasksForSession({
        projectRoot: parsed.projectRoot ?? options.projectRoot,
        sessionId: parsed.sessionId,
        now: options.now
      })
    };
  }
  throw new Error(`Unknown Loopgraph Hermes design tool: ${String(name)}`);
}
