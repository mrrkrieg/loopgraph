import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGraphAuthoringContext } from "./graph-authoring-store-resolver";

describe("graph authoring store resolver", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps local development file-backed and writable", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-graph-authoring-"));
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);

    await expect(getGraphAuthoringContext("loops.write")).resolves.toMatchObject({
      workspaceId: "local",
      companyId: "local",
      actorId: "loopgraph-ui",
      store: { persistence: "file" }
    });
  });

  it("allows the public preview to render but rejects direct write actions", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-graph-preview-"));
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    vi.stubEnv("LOOPGRAPH_PREVIEW_CONTENT", "1");

    await expect(getGraphAuthoringContext("workspace.read")).resolves.toMatchObject({
      store: { persistence: "file" }
    });
    await expect(getGraphAuthoringContext("loops.write")).rejects.toThrow(
      "public Loopgraph preview is read-only"
    );
  });
});
