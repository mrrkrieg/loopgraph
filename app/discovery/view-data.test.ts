import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHermesDiscoverySession } from "loopgraph/runtime";
import {
  discoverySteps,
  getDiscoverySessionForView,
  getDiscoverySessionIdFromSearchParams,
  getHermesDiscoverySessionsForView
} from "./view-data";

describe("discovery browser view data", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads project-local Hermes sessions for browser resume", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-discovery-view-"));
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_hermes_view",
      companyId: "company_hermes_view",
      companyName: "Hermes View Co",
      createdByActor: "hermes"
    });

    const sessions = await getHermesDiscoverySessionsForView();
    const selected = await getDiscoverySessionForView("session_hermes_view");

    expect(sessions.map((session) => session.id)).toEqual(["session_hermes_view"]);
    expect(selected).toMatchObject({
      id: "session_hermes_view",
      createdByActor: "hermes",
      companyProfile: { name: "Hermes View Co" }
    });
  });

  it("extracts a session id from async search params", async () => {
    await expect(getDiscoverySessionIdFromSearchParams(Promise.resolve({
      sessionId: ["session_1", "session_2"]
    }))).resolves.toBe("session_1");
  });

  it("keeps Designing as the handoff before Hermes Loops review", () => {
    expect(discoverySteps.map((step) => step.href)).toEqual([
      "/discovery",
      "/discovery/company",
      "/discovery/departments",
      "/discovery/questions",
      "/discovery/designing",
      "/discovery/create-loops"
    ]);
  });
});
