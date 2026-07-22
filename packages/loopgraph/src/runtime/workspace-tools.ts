import { z } from "zod";
import { listDepartmentCatalog } from "../core";
import { inspectLoopgraphWorkspace } from "./workspace";

export const LOOPGRAPH_WORKSPACE_TOOL_NAMES = [
  "loopgraph_workspace_inspect",
  "loopgraph_departments_list"
] as const;

export type LoopgraphWorkspaceToolName = (typeof LOOPGRAPH_WORKSPACE_TOOL_NAMES)[number];

export type LoopgraphWorkspaceToolRuntimeOptions = {
  projectRoot?: string;
};

export const workspaceInspectInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const departmentsListInputSchema = z.object({
  includeCustom: z.boolean().default(true)
}).default({});

export type WorkspaceInspectInput = z.input<typeof workspaceInspectInputSchema>;
export type DepartmentsListInput = z.input<typeof departmentsListInputSchema>;

export const loopgraphWorkspaceToolDefinitions = [
  {
    name: "loopgraph_workspace_inspect",
    description: "Inspect the bound local Loopgraph workspace without reading secrets or external files.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_departments_list",
    description: "Return the canonical Loopgraph department catalog Hermes should present to the user.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphWorkspaceToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function loopgraph_workspace_inspect(
  input: WorkspaceInspectInput = {},
  options: LoopgraphWorkspaceToolRuntimeOptions = {}
) {
  const parsed = workspaceInspectInputSchema.parse(input);
  return inspectLoopgraphWorkspace({
    projectRoot: parsed.projectRoot ?? options.projectRoot
  });
}

export async function loopgraph_departments_list(input: DepartmentsListInput = {}) {
  const parsed = departmentsListInputSchema.parse(input);
  const departments = listDepartmentCatalog({ includeCustom: parsed.includeCustom });
  return {
    schemaVersion: "departments/v1alpha1",
    departments,
    count: departments.length
  };
}

export async function callLoopgraphWorkspaceTool(
  name: LoopgraphWorkspaceToolName,
  input: unknown,
  options: LoopgraphWorkspaceToolRuntimeOptions = {}
) {
  if (name === "loopgraph_workspace_inspect") {
    return loopgraph_workspace_inspect(input as WorkspaceInspectInput, options);
  }
  if (name === "loopgraph_departments_list") {
    return loopgraph_departments_list(input as DepartmentsListInput);
  }
  throw new Error(`Unknown Loopgraph workspace tool: ${String(name)}`);
}
