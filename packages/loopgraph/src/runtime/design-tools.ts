import { z } from "zod";
import { loopDesignProposalSetSchema } from "../core";
import {
  buildLoopDesignContext,
  editLoopDesignProposal,
  generateDeterministicLoopDesign,
  loopDesignProposalEditSchema,
  submitLoopDesignProposalSet
} from "./design-service";

export const LOOPGRAPH_DESIGN_TOOL_NAMES = [
  "loopgraph_design_context_get",
  "loopgraph_design_generate",
  "loopgraph_design_submit",
  "loopgraph_design_edit"
] as const;

export type LoopgraphDesignToolName = (typeof LOOPGRAPH_DESIGN_TOOL_NAMES)[number];

export type LoopgraphDesignToolRuntimeOptions = {
  projectRoot?: string;
};

export const designContextGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string(),
  department: z.string().optional()
});

export const designGenerateInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string(),
  department: z.string().optional(),
  maxProposals: z.number().int().min(1).max(5).default(2),
  reasoningProfile: z.enum(["standard", "high"]).default("high"),
  allowNovelDesigns: z.boolean().default(false),
  redactionPolicy: z.enum(["safe_summary_only", "bounded_context_without_secrets"]).default("safe_summary_only"),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  repairAttemptLimit: z.number().int().min(0).max(1).default(1)
});

export const designSubmitInputSchema = z.object({
  projectRoot: z.string().optional(),
  sessionId: z.string(),
  department: z.string().optional(),
  proposalSet: loopDesignProposalSetSchema,
  providerName: z.string().optional(),
  modelIdentifier: z.string().optional(),
  reasoningProfile: z.enum(["standard", "high"]).default("high"),
  providerMetadata: z.record(z.string(), z.unknown()).optional()
});

export const designEditInputSchema = z.object({
  projectRoot: z.string().optional(),
  designRunId: z.string(),
  proposalId: z.string(),
  expectedOutputHash: z.string().optional(),
  updates: loopDesignProposalEditSchema,
  editedBy: z.string().optional()
});

export type DesignContextGetInput = z.input<typeof designContextGetInputSchema>;
export type DesignGenerateInput = z.input<typeof designGenerateInputSchema>;
export type DesignSubmitInput = z.input<typeof designSubmitInputSchema>;
export type DesignEditInput = z.input<typeof designEditInputSchema>;

export const loopgraphDesignToolDefinitions = [
  {
    name: "loopgraph_design_context_get",
    description: "Compile the bounded LoopDesignContext Hermes should use for high-reasoning loop design.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_design_generate",
    description: "Generate and validate deterministic fallback loop proposals for the active discovery session.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_design_submit",
    description: "Validate and persist a Hermes-hosted LoopDesignProposalSet.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_design_edit",
    description: "Apply a structured user edit to one loop proposal, preserve design history, and revalidate it before materialization.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphDesignToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphDesignTool(
  name: LoopgraphDesignToolName,
  input: unknown,
  options: LoopgraphDesignToolRuntimeOptions = {}
) {
  if (name === "loopgraph_design_context_get") {
    const parsed = designContextGetInputSchema.parse(input);
    return buildLoopDesignContext({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      department: parsed.department
    });
  }
  if (name === "loopgraph_design_generate") {
    const parsed = designGenerateInputSchema.parse(input);
    return generateDeterministicLoopDesign({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      department: parsed.department,
      maxProposals: parsed.maxProposals,
      reasoningProfile: parsed.reasoningProfile,
      allowNovelDesigns: parsed.allowNovelDesigns,
      redactionPolicy: parsed.redactionPolicy,
      timeoutMs: parsed.timeoutMs,
      repairAttemptLimit: parsed.repairAttemptLimit
    });
  }
  if (name === "loopgraph_design_submit") {
    const parsed = designSubmitInputSchema.parse(input);
    return submitLoopDesignProposalSet({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      sessionId: parsed.sessionId,
      department: parsed.department,
      proposalSet: parsed.proposalSet,
      providerName: parsed.providerName,
      modelIdentifier: parsed.modelIdentifier,
      reasoningProfile: parsed.reasoningProfile,
      providerMetadata: parsed.providerMetadata
    });
  }
  if (name === "loopgraph_design_edit") {
    const parsed = designEditInputSchema.parse(input);
    return editLoopDesignProposal({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      designRunId: parsed.designRunId,
      proposalId: parsed.proposalId,
      expectedOutputHash: parsed.expectedOutputHash,
      updates: parsed.updates,
      editedBy: parsed.editedBy ?? "hermes"
    });
  }
  throw new Error(`Unknown Loopgraph design tool: ${String(name)}`);
}
