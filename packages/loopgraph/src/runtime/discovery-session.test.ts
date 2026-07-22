import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmDiscoveryProjectContext,
  getNextDiscoveryQuestions,
  listHermesDiscoverySessions,
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";
import { getDiscoverySession } from "./discovery-session";

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-discovery-"));
}

describe("Hermes discovery sessions", () => {
  it("starts a project-bound session, selects canonical departments, and advances question bundles", async () => {
    const projectRoot = await temporaryProjectRoot();
    const session = await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_marketing",
      companyId: "company_1",
      companyName: "Acme",
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(session).toMatchObject({
      id: "session_marketing",
      companyId: "company_1",
      activeStage: "workspace",
      revision: 0,
      createdByActor: "hermes"
    });

    const selected = await selectDiscoveryDepartments({
      projectRoot,
      sessionId: session.id,
      departments: ["operations_finance", "marketing"],
      activeDepartment: "marketing",
      expectedRevision: 0,
      now: new Date("2026-07-21T12:01:00.000Z")
    });

    expect(selected.revision).toBe(1);
    expect(selected.selectedDepartmentIds).toEqual(["ops_finance", "marketing"]);
    expect(selected.activeDepartmentId).toBe("marketing");
    expect(selected.activeQuestionBundleId).toBe("current_stack_sources");
    expect(selected.questionQueue).toHaveLength(5);

    const next = await getNextDiscoveryQuestions({ projectRoot, sessionId: session.id });
    expect(next.nextAction).toBe("answer_bundle");
    expect(next.bundle?.id).toBe("current_stack_sources");
    expect(next.bundle?.fields.map((field) => field.id)).toEqual(expect.arrayContaining([
      "event_sources_subjects"
    ]));
    expect(next.departmentBranchQuestions[0]).toContain("paid ads");

    const answered = await submitDiscoveryAnswers({
      projectRoot,
      sessionId: session.id,
      bundleId: "current_stack_sources",
      expectedRevision: 1,
      now: new Date("2026-07-21T12:02:00.000Z"),
      answers: {
        systems: ["Google Ads", "HubSpot"],
        source_of_truth: "HubSpot defines qualified leads.",
        safe_reads: ["campaign performance", "qualified lead status"],
        manual_fallbacks: ["weekly CSV export"],
        existing_automations: []
      }
    });

    expect(answered.revision).toBe(2);
    expect(answered.activeQuestionBundleId).toBe("biggest_recurring_problem");
    expect(answered.answers).toContainEqual(expect.objectContaining({
      questionId: "current_stack_sources.systems",
      departmentId: "company_1:marketing",
      value: ["Google Ads", "HubSpot"],
      valueType: "string_array",
      source: "user",
      confirmedByUser: true
    }));

    const persisted = await getDiscoverySession(session.id, projectRoot);
    expect(persisted?.revision).toBe(2);
  });

  it("confirms safe project context into a ProjectProfile and auditable answers", async () => {
    const projectRoot = await temporaryProjectRoot();
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "acme-growth",
      packageManager: "npm@11.0.0",
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0",
        "@supabase/supabase-js": "^2.0.0",
        "posthog-js": "^1.0.0"
      }
    }, null, 2));
    await writeFile(path.join(projectRoot, ".env"), "SECRET_TOKEN=do-not-read\n");
    const session = await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_project_context",
      companyId: "company_project_context",
      companyName: "Acme Growth",
      createdByActor: "browser",
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    const result = await confirmDiscoveryProjectContext({
      projectRoot,
      sessionId: session.id,
      expectedRevision: 0,
      displayName: "Acme Growth App",
      sourceOfTruth: "HubSpot defines qualified customers.",
      additionalTools: ["HubSpot"],
      actor: "browser",
      now: new Date("2026-07-21T12:01:00.000Z")
    });

    expect(result.projectProfile).toMatchObject({
      schemaVersion: "project-profile/v1alpha1",
      displayName: "Acme Growth App",
      repoType: "application",
      confirmedByUser: true,
      inspectionVersion: "project-inspection/v1alpha1"
    });
    expect(result.projectProfile.frameworks).toEqual(expect.arrayContaining(["Next.js", "React"]));
    expect(result.projectProfile.datastores).toContain("Supabase");
    expect(result.inspection.policy.ignoredPaths).toContain(".env");
    expect(JSON.stringify(result)).not.toContain("do-not-read");

    const persisted = await getDiscoverySession(session.id, projectRoot);
    expect(persisted).toMatchObject({
      projectProfileId: result.projectProfile.projectRootId,
      projectProfile: {
        displayName: "Acme Growth App",
        confirmedByUser: true
      },
      companyProfile: {
        name: "Acme Growth App",
        tools: expect.arrayContaining(["Next.js", "Supabase", "PostHog", "HubSpot"])
      },
      activeStage: "department_selection",
      status: "company_questions",
      revision: 1,
      lastActor: "browser"
    });
    expect(persisted?.answers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        questionId: "project_context.detected_stack",
        source: "project_detector",
        confirmedByUser: true
      }),
      expect.objectContaining({
        questionId: "project_context.source_of_truth",
        value: "HubSpot defines qualified customers.",
        source: "user"
      })
    ]));
  });

  it("rejects stale discovery mutations by revision", async () => {
    const projectRoot = await temporaryProjectRoot();
    const session = await startHermesDiscoverySession({ projectRoot, sessionId: "session_stale" });

    await selectDiscoveryDepartments({
      projectRoot,
      sessionId: session.id,
      departments: ["marketing"],
      expectedRevision: 0
    });

    await expect(selectDiscoveryDepartments({
      projectRoot,
      sessionId: session.id,
      departments: ["sales"],
      expectedRevision: 0
    })).rejects.toThrow("Discovery session revision mismatch");
  });

  it("lists project-local Hermes and browser sessions newest first", async () => {
    const projectRoot = await temporaryProjectRoot();
    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_hermes",
      companyId: "company_hermes",
      companyName: "Hermes Co",
      createdByActor: "hermes",
      now: new Date("2026-07-21T12:00:00.000Z")
    });
    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_browser",
      companyId: "company_browser",
      companyName: "Browser Co",
      createdByActor: "browser",
      now: new Date("2026-07-21T12:05:00.000Z")
    });

    const sessions = await listHermesDiscoverySessions(projectRoot);

    expect(sessions.map((session) => session.id)).toEqual(["session_browser", "session_hermes"]);
    expect(sessions.map((session) => session.createdByActor)).toEqual(["browser", "hermes"]);
  });
});
