import { describe, expect, it } from "vitest";
import { createDefaultAnswers, flattenQuestionGroups, generateQuestions } from "./question-engine";
import { demoLoopBundle } from "./agent";
import { generateLoopSpec } from "./spec-generator";
import { validateLoopSpec } from "./loop-spec-schema";

describe("loop question and spec generation", () => {
  it("generates a valid spec from default answers", () => {
    const bundle = demoLoopBundle();
    const questions = generateQuestions(
      bundle.loop.department,
      bundle.loop.templateId,
      bundle.loop.goal
    );
    const answers = createDefaultAnswers(
      bundle.loop.department,
      bundle.loop.templateId,
      bundle.loop.goal
    );
    const spec = generateLoopSpec(bundle.loop, answers);

    expect(flattenQuestionGroups(questions).length).toBeGreaterThan(10);
    expect(validateLoopSpec(spec).id).toBe(bundle.loop.id);
    expect(spec.measurementPlan.botsittingTime).toContain("context");
    expect(spec.managementReviewOutput.rollupMetrics).toContain("botsitting time");
  });
});
