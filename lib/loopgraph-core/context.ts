import { z } from "zod";

export const contextSourceSchema = z.object({
  id: z.string(),
  type: z.enum(["policy", "fixture", "integration", "memory", "event", "trace"]),
  adapterId: z.string().optional(),
  variableKey: z.string().optional(),
  title: z.string(),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  trusted: z.boolean().default(true),
  precedence: z.number().int().nonnegative()
});

export const contextPrecedenceRuleSchema = z.object({
  sourceType: z.enum(["policy", "fixture", "integration", "memory", "event", "trace"]),
  rank: z.number().int().nonnegative()
});

export const contextSnapshotEntrySchema = z.object({
  sourceId: z.string(),
  sourceType: z.enum(["policy", "fixture", "integration", "memory", "event", "trace"]),
  title: z.string(),
  value: z.unknown(),
  retrievedAt: z.string().optional(),
  freshness: z.enum(["realtime", "hourly", "daily", "manual", "fixture"]).optional(),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
  trusted: z.boolean(),
  redactionApplied: z.boolean().optional(),
  contentHash: z.string(),
  precedence: z.number().int().nonnegative()
});

export const contextSnapshotSchema = z.object({
  id: z.string(),
  loopId: z.string(),
  loopSpecVersion: z.string(),
  createdAt: z.string(),
  contentHash: z.string(),
  tokenEstimate: z.number().nonnegative(),
  entries: z.array(contextSnapshotEntrySchema),
  compiledPrompt: z.string().optional()
});

export type ContextSource = z.infer<typeof contextSourceSchema>;
export type ContextPrecedenceRule = z.infer<typeof contextPrecedenceRuleSchema>;
export type ContextSnapshotEntry = z.infer<typeof contextSnapshotEntrySchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
