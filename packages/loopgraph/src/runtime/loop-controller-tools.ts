import { z } from "zod";
import {
  loopControllerPolicySchema,
  loopControllerTriggerTypeSchema,
  type LoopControllerPolicy,
  type LoopControllerRun
} from "../core";
import { runLoopController } from "./loop-controller";
import { FileLoopControllerStore } from "./loop-controller-store";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOPGRAPH_CONTROLLER_TOOL_NAMES = [
  "loopgraph_controller_run",
  "loopgraph_controller_runs_get",
  "loopgraph_controller_policy_get",
  "loopgraph_controller_policy_set"
] as const;

export type LoopgraphControllerToolName = (typeof LOOPGRAPH_CONTROLLER_TOOL_NAMES)[number];

export type LoopgraphControllerToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

export const controllerRunInputSchema = z.object({
  projectRoot: z.string().optional(),
  triggerType: loopControllerTriggerTypeSchema.default("manual"),
  triggerId: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  requestedBy: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)).default([])
}).default({});

export const controllerRunsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  runId: z.string().min(1).optional()
}).default({});

export const controllerPolicyGetInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const controllerPolicySetInputSchema = z.object({
  projectRoot: z.string().optional(),
  policy: loopControllerPolicySchema
});

export const loopgraphControllerToolDefinitions = [
  {
    name: "loopgraph_controller_run",
    description: "Run one durable Loopgraph controller cycle so Hermes can evaluate evidence, design qualified loops, and apply only policy-approved shadow changes.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_controller_runs_get",
    description: "Read controller runs, decisions, policy receipts, evidence fingerprints, and errors.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_controller_policy_get",
    description: "Read the project-local continuous-controller policy.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_controller_policy_set",
    description: "Replace the project-local controller policy after validating all thresholds and safety boundaries.",
    readOnly: false,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphControllerToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export type LoopgraphControllerToolResult =
  | { run: LoopControllerRun; duplicate: boolean }
  | { run?: LoopControllerRun; runs?: LoopControllerRun[] }
  | { policy: LoopControllerPolicy };

export async function callLoopgraphControllerTool(
  name: LoopgraphControllerToolName,
  input: unknown,
  options: LoopgraphControllerToolRuntimeOptions = {}
): Promise<LoopgraphControllerToolResult> {
  if (name === "loopgraph_controller_run") {
    const parsed = controllerRunInputSchema.parse(input);
    return runLoopController({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      trigger: {
        type: parsed.triggerType,
        ...(parsed.triggerId ? { id: parsed.triggerId } : {}),
        ...(parsed.sourceRef ? { sourceRef: parsed.sourceRef } : {}),
        ...(parsed.requestedBy ? { requestedBy: parsed.requestedBy } : {}),
        evidenceRefs: parsed.evidenceRefs
      },
      now: options.now
    });
  }

  const parsedProject = (
    name === "loopgraph_controller_runs_get"
      ? controllerRunsGetInputSchema
      : name === "loopgraph_controller_policy_get"
        ? controllerPolicyGetInputSchema
        : controllerPolicySetInputSchema
  ).parse(input) as { projectRoot?: string; runId?: string; policy?: LoopControllerPolicy };
  const projectRoot = parsedProject.projectRoot ?? options.projectRoot ?? process.cwd();
  const store = new FileLoopControllerStore(getLoopgraphRoot(projectRoot));

  if (name === "loopgraph_controller_runs_get") {
    return parsedProject.runId
      ? { run: await store.getRun(parsedProject.runId) }
      : { runs: await store.listRuns() };
  }
  if (name === "loopgraph_controller_policy_get") {
    return { policy: (await store.readPolicy()) ?? loopControllerPolicySchema.parse({}) };
  }
  if (name === "loopgraph_controller_policy_set") {
    const policy = loopControllerPolicySchema.parse(parsedProject.policy);
    await store.savePolicy(policy);
    return { policy };
  }
  throw new Error(`Unknown Loopgraph controller tool: ${String(name)}`);
}
