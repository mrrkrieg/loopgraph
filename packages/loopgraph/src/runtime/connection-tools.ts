import { z } from "zod";
import {
  buildConnectionPlan,
  setManualConnectionFallback
} from "./connection-plan";

export const LOOPGRAPH_CONNECTION_TOOL_NAMES = [
  "loopgraph_connections_plan",
  "loopgraph_connections_set_manual_fallback"
] as const;

export type LoopgraphConnectionToolName = (typeof LOOPGRAPH_CONNECTION_TOOL_NAMES)[number];

export type LoopgraphConnectionToolRuntimeOptions = {
  projectRoot?: string;
};

export const connectionsPlanInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const connectionsSetManualFallbackInputSchema = z.object({
  projectRoot: z.string().optional(),
  capability: z.string().min(1),
  label: z.string().min(1),
  instructions: z.string().optional(),
  updatedBy: z.string().optional()
});

export type ConnectionsPlanInput = z.input<typeof connectionsPlanInputSchema>;
export type ConnectionsSetManualFallbackInput = z.input<typeof connectionsSetManualFallbackInputSchema>;

export const loopgraphConnectionToolDefinitions = [
  {
    name: "loopgraph_connections_plan",
    description: "Return the non-secret connection checklist required by materialized LoopSpecs.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_connections_set_manual_fallback",
    description: "Record a non-secret manual fallback for a missing capability so local simulation/routing can proceed safely.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphConnectionToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphConnectionTool(
  name: LoopgraphConnectionToolName,
  input: unknown,
  options: LoopgraphConnectionToolRuntimeOptions = {}
) {
  if (name === "loopgraph_connections_plan") {
    const parsed = connectionsPlanInputSchema.parse(input);
    return buildConnectionPlan({
      projectRoot: parsed.projectRoot ?? options.projectRoot
    });
  }
  if (name === "loopgraph_connections_set_manual_fallback") {
    const parsed = connectionsSetManualFallbackInputSchema.parse(input);
    return setManualConnectionFallback({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      capability: parsed.capability,
      label: parsed.label,
      instructions: parsed.instructions,
      updatedBy: parsed.updatedBy
    });
  }
  throw new Error(`Unknown Loopgraph connection tool: ${String(name)}`);
}
