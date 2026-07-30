import { z } from "zod";
import {
  DepartmentTypeSchema,
  loopOpportunityStatusSchema,
  type GraphChangeSet,
  type LoopOpportunity
} from "../core";
import {
  dismissLoopOpportunity,
  getGraphChangeSet,
  getLoopOpportunity,
  listGraphChangeSets,
  listLoopOpportunities,
  scanLoopOpportunities,
  type ScanLoopOpportunitiesResult
} from "./loop-opportunity-engine";

export const LOOPGRAPH_OPPORTUNITY_TOOL_NAMES = [
  "loopgraph_opportunities_scan",
  "loopgraph_opportunities_get",
  "loopgraph_opportunity_dismiss",
  "loopgraph_graph_changes_get"
] as const;

export type LoopgraphOpportunityToolName = (typeof LOOPGRAPH_OPPORTUNITY_TOOL_NAMES)[number];

export type LoopgraphOpportunityToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

export type LoopgraphOpportunityToolResult =
  | ScanLoopOpportunitiesResult
  | { opportunity?: LoopOpportunity; opportunities?: LoopOpportunity[] }
  | { opportunity: LoopOpportunity }
  | { changeSet?: GraphChangeSet; changeSets?: GraphChangeSet[] };

export const opportunitiesScanInputSchema = z.object({
  projectRoot: z.string().optional(),
  workspaceId: z.string().optional(),
  companyId: z.string().optional(),
  qualifyThreshold: z.number().min(0).max(100).default(45),
  autoDesignThreshold: z.number().min(0).max(100).default(65),
  autoStartDesign: z.boolean().default(true)
}).default({});

export const opportunitiesGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  opportunityId: z.string().optional(),
  status: loopOpportunityStatusSchema.optional(),
  department: DepartmentTypeSchema.optional(),
  minimumScore: z.number().min(0).max(100).optional()
}).default({});

export const opportunityDismissInputSchema = z.object({
  projectRoot: z.string().optional(),
  opportunityId: z.string().min(1),
  reason: z.string().min(1)
});

export const graphChangesGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  changeSetId: z.string().optional(),
  opportunityId: z.string().optional()
}).default({});

export const loopgraphOpportunityToolDefinitions = [
  {
    name: "loopgraph_opportunities_scan",
    description: "Scan durable routing, run, verification, and review evidence for explainable loop opportunities and start qualified Hermes design tasks.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_opportunities_get",
    description: "Read detected loop opportunities, their score explanations, evidence, graph changes, and Hermes design state.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_opportunity_dismiss",
    description: "Dismiss one loop opportunity with an explicit reason so repeated scans do not restart its design flow.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_graph_changes_get",
    description: "Read versioned proposed graph changes associated with loop opportunities.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphOpportunityToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export function callLoopgraphOpportunityTool(
  name: "loopgraph_opportunities_scan",
  input: unknown,
  options?: LoopgraphOpportunityToolRuntimeOptions
): Promise<ScanLoopOpportunitiesResult>;
export function callLoopgraphOpportunityTool(
  name: "loopgraph_opportunities_get",
  input: unknown,
  options?: LoopgraphOpportunityToolRuntimeOptions
): Promise<{ opportunity?: LoopOpportunity; opportunities?: LoopOpportunity[] }>;
export function callLoopgraphOpportunityTool(
  name: "loopgraph_opportunity_dismiss",
  input: unknown,
  options?: LoopgraphOpportunityToolRuntimeOptions
): Promise<{ opportunity: LoopOpportunity }>;
export function callLoopgraphOpportunityTool(
  name: "loopgraph_graph_changes_get",
  input: unknown,
  options?: LoopgraphOpportunityToolRuntimeOptions
): Promise<{ changeSet?: GraphChangeSet; changeSets?: GraphChangeSet[] }>;
export function callLoopgraphOpportunityTool(
  name: LoopgraphOpportunityToolName,
  input: unknown,
  options?: LoopgraphOpportunityToolRuntimeOptions
): Promise<LoopgraphOpportunityToolResult>;
export async function callLoopgraphOpportunityTool(
  name: LoopgraphOpportunityToolName,
  input: unknown,
  options: LoopgraphOpportunityToolRuntimeOptions = {}
): Promise<LoopgraphOpportunityToolResult> {
  if (name === "loopgraph_opportunities_scan") {
    const parsed = opportunitiesScanInputSchema.parse(input);
    return scanLoopOpportunities({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      workspaceId: parsed.workspaceId,
      companyId: parsed.companyId,
      thresholds: {
        qualify: parsed.qualifyThreshold,
        autoDesign: parsed.autoDesignThreshold
      },
      autoStartDesign: parsed.autoStartDesign,
      now: options.now
    });
  }
  if (name === "loopgraph_opportunities_get") {
    const parsed = opportunitiesGetInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
    if (parsed.opportunityId) {
      return {
        opportunity: await getLoopOpportunity(parsed.opportunityId, projectRoot)
      };
    }
    return {
      opportunities: await listLoopOpportunities(projectRoot, {
        status: parsed.status,
        department: parsed.department,
        minimumScore: parsed.minimumScore
      })
    };
  }
  if (name === "loopgraph_opportunity_dismiss") {
    const parsed = opportunityDismissInputSchema.parse(input);
    return {
      opportunity: await dismissLoopOpportunity({
        projectRoot: parsed.projectRoot ?? options.projectRoot,
        opportunityId: parsed.opportunityId,
        reason: parsed.reason,
        now: options.now
      })
    };
  }
  if (name === "loopgraph_graph_changes_get") {
    const parsed = graphChangesGetInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
    if (parsed.changeSetId) {
      return {
        changeSet: await getGraphChangeSet(parsed.changeSetId, projectRoot)
      };
    }
    return {
      changeSets: await listGraphChangeSets(projectRoot, parsed.opportunityId)
    };
  }
  throw new Error(`Unknown Loopgraph opportunity tool: ${String(name)}`);
}
