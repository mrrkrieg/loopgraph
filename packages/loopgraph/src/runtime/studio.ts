import { existsSync } from "node:fs";
import path from "node:path";
import { getLoopgraphRoot } from "./storage-resolver";
import { initLoopgraphWorkspace } from "./workspace";

export type LoopgraphStudioPlan = {
  schemaVersion: "loopgraph-studio/v1alpha1";
  projectRoot: string;
  workspaceRoot: string;
  url: string;
  appRoot?: string;
  canStart: boolean;
  start?: {
    command: string;
    args: string[];
    cwd: string;
    env: {
      LOOPGRAPH_PROJECT_ROOT: string;
    };
  };
  nextActions: string[];
};

export type PrepareLoopgraphStudioInput = {
  projectRoot?: string;
  appRoot?: string;
  searchRoots?: string[];
  host?: string;
  port?: number | string;
  now?: Date;
};

export async function prepareLoopgraphStudio(
  input: PrepareLoopgraphStudioInput = {}
): Promise<LoopgraphStudioPlan> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const host = input.host ?? "localhost";
  const port = String(input.port ?? 3000);
  const appRoot = input.appRoot
    ? path.resolve(input.appRoot)
    : findLoopgraphStudioAppRoot(input.searchRoots ?? [process.cwd()]);

  await initLoopgraphWorkspace({
    projectRoot,
    createdBy: "cli",
    now: input.now
  });

  const start = appRoot
    ? {
        command: "npm",
        args: ["run", "dev", "--", "--hostname", host, "--port", port],
        cwd: appRoot,
        env: {
          LOOPGRAPH_PROJECT_ROOT: projectRoot
        }
      }
    : undefined;

  return {
    schemaVersion: "loopgraph-studio/v1alpha1",
    projectRoot,
    workspaceRoot: getLoopgraphRoot(projectRoot),
    url: `http://${host}:${port}/brain`,
    ...(appRoot ? { appRoot } : {}),
    canStart: Boolean(appRoot),
    ...(start ? { start } : {}),
    nextActions: appRoot
      ? [
          "Run the start command to open the local Hermes Brain graph.",
          "Keep LOOPGRAPH_PROJECT_ROOT set so the browser, CLI, and Hermes MCP server read the same .loopgraph workspace."
        ]
      : [
          "This package installation does not include the local Next.js studio app.",
          "Run the command from a Loopgraph repository clone, or install a dedicated studio package when available."
        ]
  };
}

export function findLoopgraphStudioAppRoot(searchRoots: string[]): string | undefined {
  const candidates = uniquePaths(searchRoots.flatMap((root) => {
    const candidatesForRoot: string[] = [];
    let current = path.resolve(root);
    for (let depth = 0; depth < 6; depth += 1) {
      candidatesForRoot.push(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return candidatesForRoot;
  }));

  return candidates.find(isLoopgraphStudioAppRoot);
}

export function isLoopgraphStudioAppRoot(candidate: string): boolean {
  return existsSync(path.join(candidate, "package.json")) &&
    existsSync(path.join(candidate, "app", "brain", "page.tsx"));
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((item) => path.resolve(item)))];
}
