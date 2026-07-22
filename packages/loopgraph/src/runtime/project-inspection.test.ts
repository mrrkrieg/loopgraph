import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectProjectManifests } from "./project-inspection";
import {
  callLoopgraphProjectTool,
  loopgraph_project_inspect
} from "./project-tools";

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-project-inspect-"));
}

describe("project manifest inspection", () => {
  it("detects stack from allowlisted manifests without reading secret env values", async () => {
    const projectRoot = await temporaryProjectRoot();
    await mkdir(path.join(projectRoot, "app"), { recursive: true });
    await mkdir(path.join(projectRoot, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "acme-web",
      private: true,
      packageManager: "pnpm@10.0.0",
      scripts: {
        dev: "next dev",
        deploy: "vercel --token $SECRET_DEPLOY_TOKEN"
      },
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0",
        "@supabase/supabase-js": "^2.0.0",
        "posthog-js": "^1.0.0",
        stripe: "^17.0.0",
        openai: "^5.0.0"
      },
      devDependencies: {
        vitest: "^3.0.0",
        playwright: "^1.0.0"
      }
    }, null, 2));
    await writeFile(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(path.join(projectRoot, ".env.example"), "SUPABASE_URL=\nOPENAI_API_KEY=\n# COMMENTED_SECRET=value\n");
    await writeFile(path.join(projectRoot, ".env"), "SECRET_DEPLOY_TOKEN=do-not-read-me\n");
    await writeFile(path.join(projectRoot, ".github", "workflows", "ci.yml"), "name: ci\n");

    const report = await inspectProjectManifests({ projectRoot });

    expect(report).toMatchObject({
      schemaVersion: "project-inspection/v1alpha1",
      policy: {
        secretsRead: false,
        allowlistedManifestOnly: true,
        ignoredPaths: [".env"]
      },
      packageJson: {
        name: "acme-web",
        private: true,
        packageManager: "pnpm@10.0.0",
        scripts: ["deploy", "dev"]
      },
      env: {
        exampleFiles: [".env.example"],
        keys: ["OPENAI_API_KEY", "SUPABASE_URL"],
        ignoredEnvFiles: [".env"]
      }
    });
    expect(report.stack.frameworks).toEqual(expect.arrayContaining(["Next.js", "React"]));
    expect(report.stack.databases).toContain("Supabase");
    expect(report.stack.analytics).toContain("PostHog");
    expect(report.stack.ai).toContain("OpenAI SDK");
    expect(report.stack.testing).toEqual(expect.arrayContaining(["Playwright", "Vitest"]));
    expect(report.manifests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "package.json", kind: "package_json", readable: true }),
      expect.objectContaining({ path: ".github/workflows/ci.yml", kind: "ci_workflow", readable: false }),
      expect.objectContaining({ path: "app", kind: "directory_marker", readable: false })
    ]));
    expect(JSON.stringify(report)).not.toContain("do-not-read-me");
    expect(JSON.stringify(report)).not.toContain("SECRET_DEPLOY_TOKEN");
    expect(JSON.stringify(report)).not.toContain("vercel --token");
  });

  it("is exposed through the readonly project MCP tool dispatcher", async () => {
    const projectRoot = await temporaryProjectRoot();
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
      dependencies: { next: "^15.0.0" }
    }));

    const direct = await loopgraph_project_inspect({}, { projectRoot });
    const dispatched = await callLoopgraphProjectTool("loopgraph_project_inspect", { projectRoot });

    expect(direct.stack.frameworks).toContain("Next.js");
    expect(dispatched).toMatchObject({
      schemaVersion: "project-inspection/v1alpha1",
      projectRootId: direct.projectRootId
    });
  });

  it("skips allowlisted manifests when symlinks escape the selected project root", async () => {
    const projectRoot = await temporaryProjectRoot();
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-project-inspect-outside-"));
    await writeFile(path.join(outsideRoot, "package.json"), JSON.stringify({
      dependencies: {
        "secret-provider-sdk": "^1.0.0",
        next: "^15.0.0"
      },
      scripts: {
        deploy: "deploy --token outside-secret-token"
      }
    }, null, 2));
    await writeFile(path.join(outsideRoot, ".env.example"), "OUTSIDE_SECRET=outside-secret-value\n");
    await symlink(path.join(outsideRoot, "package.json"), path.join(projectRoot, "package.json"));
    await symlink(path.join(outsideRoot, ".env.example"), path.join(projectRoot, ".env.example"));

    const report = await inspectProjectManifests({ projectRoot });
    const serialized = JSON.stringify(report);

    expect(report.manifests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "package.json",
        kind: "package_json",
        readable: false,
        notes: expect.arrayContaining(["Skipped because symlink target escapes the selected project root."])
      }),
      expect.objectContaining({
        path: ".env.example",
        kind: "env_example",
        readable: false,
        notes: expect.arrayContaining(["Skipped because symlink target escapes the selected project root."])
      })
    ]));
    expect(report.warnings).toEqual(expect.arrayContaining([
      "Skipped symlink escape: package.json",
      "Skipped symlink escape: .env.example"
    ]));
    expect(report.packageJson).toBeUndefined();
    expect(report.env.keys).toEqual([]);
    expect(report.stack.frameworks).not.toContain("Next.js");
    expect(serialized).not.toContain("secret-provider-sdk");
    expect(serialized).not.toContain("outside-secret-token");
    expect(serialized).not.toContain("OUTSIDE_SECRET");
    expect(serialized).not.toContain("outside-secret-value");
  });
});
