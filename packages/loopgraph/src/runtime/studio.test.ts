import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLoopgraphStudioAppRoot, prepareLoopgraphStudio } from "./studio";

async function createFakeStudioApp() {
  const appRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-studio-app-"));
  await mkdir(path.join(appRoot, "app", "brain"), { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), `${JSON.stringify({ scripts: { dev: "next dev" } }, null, 2)}\n`);
  await writeFile(path.join(appRoot, "app", "brain", "page.tsx"), "export default function Page() { return null; }\n");
  return appRoot;
}

describe("Loopgraph studio planner", () => {
  it("prepares a project-bound local studio launch plan", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-studio-project-"));
    const appRoot = await createFakeStudioApp();

    const plan = await prepareLoopgraphStudio({
      projectRoot,
      appRoot,
      host: "127.0.0.1",
      port: 3456,
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(plan).toMatchObject({
      schemaVersion: "loopgraph-studio/v1alpha1",
      projectRoot,
      workspaceRoot: path.join(projectRoot, ".loopgraph"),
      url: "http://127.0.0.1:3456/brain",
      appRoot,
      canStart: true,
      start: {
        command: "npm",
        args: ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3456"],
        cwd: appRoot,
        env: {
          LOOPGRAPH_PROJECT_ROOT: projectRoot
        }
      }
    });

    const workspace = JSON.parse(await readFile(path.join(projectRoot, ".loopgraph", "workspace.json"), "utf8"));
    expect(workspace.projectRoot).toBe(projectRoot);
    expect(workspace.demoCatalogEnabled).toBe(false);
  });

  it("detects a Loopgraph studio app root from nearby search roots", async () => {
    const appRoot = await createFakeStudioApp();
    const nested = path.join(appRoot, "packages", "loopgraph", "dist");
    await mkdir(nested, { recursive: true });

    expect(findLoopgraphStudioAppRoot([nested])).toBe(appRoot);
  });
});
