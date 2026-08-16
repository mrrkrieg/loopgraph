import { describe, expect, it } from "vitest";
import { graphEditorOperationSchema } from "./graph-authoring";

describe("graph editor operation schema", () => {
  it("accepts a bounded merge proposal", () => {
    expect(graphEditorOperationSchema.parse({
      kind: "propose_lifecycle",
      mode: "merge",
      targetNodeIds: ["loop:feedback", "loop:release"],
      reason: "The loops now share the same evidence and accountable owner."
    })).toMatchObject({
      kind: "propose_lifecycle",
      mode: "merge"
    });
  });

  it.each([
    {
      mode: "merge",
      targetNodeIds: ["loop:feedback"],
      message: "Merge proposals require at least two workflow loops"
    },
    {
      mode: "split",
      targetNodeIds: ["loop:feedback", "loop:release"],
      message: "split proposals require exactly one workflow loop"
    },
    {
      mode: "merge",
      targetNodeIds: ["loop:feedback", "loop:feedback"],
      message: "Lifecycle proposals cannot repeat a target node"
    }
  ])("rejects an invalid $mode target set", ({ mode, targetNodeIds, message }) => {
    const result = graphEditorOperationSchema.safeParse({
      kind: "propose_lifecycle",
      mode,
      targetNodeIds,
      reason: "Proposed from the company graph."
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(message);
    }
  });
});
