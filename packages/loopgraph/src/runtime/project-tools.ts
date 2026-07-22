import { z } from "zod";
import { inspectProjectManifests } from "./project-inspection";

export const LOOPGRAPH_PROJECT_TOOL_NAMES = [
  "loopgraph_project_inspect"
] as const;

export type LoopgraphProjectToolName = (typeof LOOPGRAPH_PROJECT_TOOL_NAMES)[number];

export type LoopgraphProjectToolRuntimeOptions = {
  projectRoot?: string;
};

export const projectInspectInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export type ProjectInspectInput = z.input<typeof projectInspectInputSchema>;

export const loopgraphProjectToolDefinitions = [
  {
    name: "loopgraph_project_inspect",
    description: "Inspect allowlisted local project manifests to infer stack details without reading secret values.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphProjectToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function loopgraph_project_inspect(
  input: ProjectInspectInput = {},
  options: LoopgraphProjectToolRuntimeOptions = {}
) {
  const parsed = projectInspectInputSchema.parse(input);
  return inspectProjectManifests({
    projectRoot: parsed.projectRoot ?? options.projectRoot
  });
}

export async function callLoopgraphProjectTool(
  name: LoopgraphProjectToolName,
  input: unknown,
  options: LoopgraphProjectToolRuntimeOptions = {}
) {
  if (name === "loopgraph_project_inspect") {
    return loopgraph_project_inspect(input as ProjectInspectInput, options);
  }
  throw new Error(`Unknown Loopgraph project tool: ${String(name)}`);
}
