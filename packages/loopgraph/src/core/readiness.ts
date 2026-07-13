import { z } from "zod";

export const ReadinessLevelSchema = z.enum(["L0", "L1", "L2", "L3", "L4"]);

export const LoopReadinessSchema = z.object({
  level: ReadinessLevelSchema,
  score: z.number().min(0).max(100),
  blockers: z.array(z.string()),
  warnings: z.array(z.string())
});

export type ReadinessLevel = z.infer<typeof ReadinessLevelSchema>;
export type LoopReadiness = z.infer<typeof LoopReadinessSchema>;

