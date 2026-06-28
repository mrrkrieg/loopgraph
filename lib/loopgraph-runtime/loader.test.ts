import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadLoopSpecFromPath } from "./loader";

const repoRoot = path.resolve(__dirname, "../..");

describe("loop spec loader", () => {
  it("loads github hero template from directory path", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.spec.metadata.id).toBe("github-issue-triage");
      expect(loaded.sourcePath).toContain("loopgraph.yaml");
    }
  });

  it("loads account escalation hero template from directory path", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.spec.metadata.id).toBe("strategic-account-escalation");
    }
  });

  it("returns diagnostics for invalid yaml path", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "fixtures/github-issue-triage/normal-bug.json"));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.errors.length).toBeGreaterThan(0);
    }
  });
});
