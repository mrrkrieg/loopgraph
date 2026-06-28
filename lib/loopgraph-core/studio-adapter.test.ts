import { describe, expect, it } from "vitest";
import { demoLoopBundle } from "../loop-engineering-builder/agent";
import { exportPublicLoopSpec } from "../loop-engineering-builder/spec-generator";
import { validateLoopSpec } from "./loop-spec";
import { v1alpha1ToFlat } from "./studio-adapter";

describe("studio adapter", () => {
  it("exports Design Studio spec to valid v1alpha1", () => {
    const bundle = demoLoopBundle();
    const exported = exportPublicLoopSpec(bundle.loop, bundle.answers);
    expect(() => validateLoopSpec(exported)).not.toThrow();
    expect(exported.metadata.id).toBeTruthy();
  });

  it("round trips required semantics", () => {
    const bundle = demoLoopBundle();
    const exported = exportPublicLoopSpec(bundle.loop, bundle.answers);
    const flat = v1alpha1ToFlat(exported);
    expect(flat.goal).toContain(bundle.loop.goal.slice(0, 20));
    expect(flat.routine.length).toBeGreaterThan(0);
  });
});
