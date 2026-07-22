import {
  routingEvaluationRunInputSchema,
  runHermesRoutingEvaluation,
  type RoutingEvaluationRunInput
} from "./routing-simulation";

export { routingEvaluationRunInputSchema } from "./routing-simulation";

export const LOOPGRAPH_ROUTING_EVALUATION_TOOL_NAMES = [
  "loopgraph_routing_evaluation_run"
] as const;

export type LoopgraphRoutingEvaluationToolName = (typeof LOOPGRAPH_ROUTING_EVALUATION_TOOL_NAMES)[number];

export type LoopgraphRoutingEvaluationToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

export const loopgraphRoutingEvaluationToolDefinitions = [
  {
    name: "loopgraph_routing_evaluation_run",
    description: "Run a trusted local Hermes routing fixture batch, persist expected-vs-actual evaluations, and report the shadow-to-recommend promotion gate.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphRoutingEvaluationToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphRoutingEvaluationTool(
  name: LoopgraphRoutingEvaluationToolName,
  input: unknown,
  options: LoopgraphRoutingEvaluationToolRuntimeOptions = {}
) {
  if (name === "loopgraph_routing_evaluation_run") {
    const parsed = routingEvaluationRunInputSchema.parse(input);
    return runHermesRoutingEvaluation({
      ...parsed,
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    } satisfies RoutingEvaluationRunInput);
  }
  throw new Error(`Unknown Loopgraph routing evaluation tool: ${String(name)}`);
}
