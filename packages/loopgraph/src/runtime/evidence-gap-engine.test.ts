import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileEvidenceGaps,
  getNextEvidenceGapQuestions,
  submitEvidenceGapAnswer
} from "./evidence-gap-engine";
import {
  confirmDiscoveryProjectContext,
  selectDiscoveryDepartments,
  startHermesDiscoverySession
} from "./discovery-session";

describe("evidence gap engine", () => {
  it("turns missing design evidence into at most three focused questions", async () => {
    const projectRoot = await tempProject();
    const session = await preparedSession(projectRoot);

    const gapSet = await compileEvidenceGaps({
      projectRoot,
      sessionId: session.id,
      now: new Date("2026-07-29T10:00:00.000Z")
    });
    const next = await getNextEvidenceGapQuestions({
      projectRoot,
      sessionId: session.id,
      limit: 3
    });

    expect(gapSet.gaps.some((gap) => gap.questionId === "current_stack_sources.systems")).toBe(true);
    expect(next.completeForDesign).toBe(false);
    expect(next.blockingGapCount).toBeGreaterThan(0);
    expect(next.questions).toHaveLength(3);
    expect(next.questions.every((question) => question.blocking)).toBe(true);
  });

  it("stores a gap answer in the shared discovery session and advances the gap set", async () => {
    const projectRoot = await tempProject();
    const session = await preparedSession(projectRoot);
    const first = await getNextEvidenceGapQuestions({
      projectRoot,
      sessionId: session.id,
      limit: 1
    });
    const question = first.questions[0]!;
    const answer = answerForValueType(question.valueType);
    const result = await submitEvidenceGapAnswer({
      projectRoot,
      sessionId: session.id,
      gapId: question.gapId,
      answer,
      expectedRevision: session.revision,
      answeredBy: "hermes",
      now: new Date("2026-07-29T10:05:00.000Z")
    });

    expect(result.session.revision).toBe(session.revision + 1);
    expect(result.session.answers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        questionId: question.questionId,
        value: answer,
        source: "user",
        confirmedByUser: true
      })
    ]));
    expect(result.gaps.gaps.find((gap) => gap.id === question.gapId)?.status).toBe("resolved");
    expect(result.nextQuestions.questions.map((item) => item.gapId)).not.toContain(question.gapId);
  });
});

async function tempProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-evidence-gaps-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "evidence-gap-project",
    dependencies: {
      next: "^15.0.0"
    }
  }));
  return projectRoot;
}

async function preparedSession(projectRoot: string) {
  let session = await startHermesDiscoverySession({
    projectRoot,
    sessionId: "session_evidence_gaps",
    companyId: "company_evidence_gaps",
    companyName: "Evidence Gap Company",
    createdByActor: "hermes",
    now: new Date("2026-07-29T09:00:00.000Z")
  });
  const confirmed = await confirmDiscoveryProjectContext({
    projectRoot,
    sessionId: session.id,
    expectedRevision: session.revision,
    displayName: "Evidence Gap Company",
    primaryGoal: "Improve product activation",
    northStarMetric: "Activation rate",
    confirmedStack: true,
    actor: "hermes",
    now: new Date("2026-07-29T09:05:00.000Z")
  });
  session = await selectDiscoveryDepartments({
    projectRoot,
    sessionId: session.id,
    departments: ["product"],
    activeDepartment: "product",
    expectedRevision: confirmed.session.revision,
    actor: "hermes",
    now: new Date("2026-07-29T09:10:00.000Z")
  });
  return session;
}

function answerForValueType(valueType: string): unknown {
  if (valueType === "string_array") return ["PostHog", "GitHub"];
  if (valueType === "number") return 10;
  if (valueType === "boolean") return false;
  if (valueType === "object") return { source: "test" };
  return "Confirmed answer";
}
