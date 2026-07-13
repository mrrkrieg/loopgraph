import { describe, expect, it } from "vitest";

describe("loopgraph package smoke", () => {
  it("exports core, runtime, and sdk entrypoints", async () => {
    const core = await import("loopgraph/core");
    const runtime = await import("loopgraph/runtime");
    const sdk = await import("loopgraph/sdk");

    expect(typeof core.validateLoopSpec).toBe("function");
    expect(typeof runtime.loadLoopSpecFromPath).toBe("function");
    expect(typeof runtime.runLoop).toBe("function");
    expect(sdk.FileStorageAdapter).toBeDefined();
  });
});
