import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  selectDiscoveryDepartments,
  startHermesDiscoverySession
} from "./discovery-session";
import {
  callLoopgraphHermesDesignTool,
  loopgraphHermesDesignToolDefinitions
} from "./hermes-design-tools";

describe("Hermes design MCP tools", () => {
  it("starts a durable task, returns focused questions, and resumes after a confirmed answer", async () => {
    const projectRoot = await temporaryProjectRoot();
    const session = await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_design_tools",
      companyId: "company_design_tools",
      companyName: "Design Tools Co",
      createdByActor: "hermes",
      now: new Date("2026-07-29T14:00:00.000Z")
    });
    const selected = await selectDiscoveryDepartments({
      projectRoot,
      sessionId: session.id,
      departments: ["product"],
      activeDepartment: "product",
      expectedRevision: session.revision,
      actor: "hermes",
      now: new Date("2026-07-29T14:01:00.000Z")
    });

    const started = await callLoopgraphHermesDesignTool("loopgraph_hermes_design_start", {
      sessionId: session.id,
      reason: "user_requested"
    }, {
      projectRoot,
      now: new Date("2026-07-29T14:02:00.000Z")
    }) as {
      task: { id: string; status: string };
      request: { nextQuestions: Array<{ gapId: string }> };
    };
    expect(started.task.status).toBe("needs_input");
    expect(started.request.nextQuestions).toHaveLength(3);

    const gaps = await callLoopgraphHermesDesignTool("loopgraph_evidence_gaps_get", {
      sessionId: session.id,
      limit: 3
    }, {
      projectRoot,
      now: new Date("2026-07-29T14:03:00.000Z")
    }) as {
      revision: number;
      questions: Array<{ gapId: string; prompt: string }>;
    };
    expect(gaps.revision).toBe(selected.revision);
    expect(gaps.questions).toHaveLength(3);

    const answered = await callLoopgraphHermesDesignTool("loopgraph_evidence_gap_answer", {
      sessionId: session.id,
      gapId: gaps.questions[0]!.gapId,
      answer: "PostHog, Linear, Intercom, Notion, and Slack",
      expectedRevision: selected.revision,
      answeredBy: "hermes"
    }, {
      projectRoot,
      now: new Date("2026-07-29T14:04:00.000Z")
    }) as {
      session: { revision: number; answers: Array<{ confirmedByUser: boolean; source: string }> };
      resumedTasks: Array<{ task: { id: string } }>;
    };

    expect(answered.session.revision).toBe(selected.revision + 1);
    expect(answered.session.answers).toContainEqual(expect.objectContaining({
      confirmedByUser: true,
      source: "user"
    }));
    expect(answered.resumedTasks[0]?.task.id).toBe(started.task.id);
  });

  it("advertises evidence answers as a state-changing non-idempotent operation", () => {
    expect(loopgraphHermesDesignToolDefinitions).toContainEqual(expect.objectContaining({
      name: "loopgraph_evidence_gap_answer",
      readOnly: false,
      idempotent: false
    }));
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-design-tools-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "hermes-design-tools-project",
    dependencies: {
      next: "^15.0.0"
    }
  }));
  return projectRoot;
}
