import { describe, expect, it } from "vitest";
import { allMockAdapters } from "../loopgraph-sdk/adapters/mock-adapters";
import { runAdapterConformance } from "../loopgraph-sdk/conformance";

describe("adapter conformance", () => {
  it("all mock adapters pass", async () => {
    for (const adapter of allMockAdapters) {
      const errors = await runAdapterConformance(adapter);
      expect(errors, adapter.id).toEqual([]);
    }
  });
});
