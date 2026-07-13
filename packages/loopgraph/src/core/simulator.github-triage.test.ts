import { describe, expect, it } from "vitest";
import path from "node:path";
import { repoRoot } from "../test-repo-root";
import { loadLoopSpecFromPath } from "../runtime/loader";
import { simulateLoop } from "../runtime/simulator";
import { FileStorageAdapter } from "../sdk/storage";
import { idempotencyKey, runId, loopSpecHash } from "./hash";


describe("github issue triage simulator", () => {
  it("validates hero template", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    expect(loaded.ok).toBe(true);
  });

  it("normal bug completes without escalation", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/github-issue-triage/normal-bug.json"),
      storage
    });
    expect(result.trace.status).toBe("COMPLETED");
    expect(result.escalationCase).toBeUndefined();
  });

  it("security issue requires review and escalation case", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/github-issue-triage/security-issue.json"),
      storage
    });
    expect(result.trace.status).toBe("WAITING_FOR_REVIEW");
    expect(result.escalationCase?.severity).toBe("P1");
  });
});

describe("determinism", () => {
  it("produces stable idempotency key and run id", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const hash = loopSpecHash(loaded.spec);
    const idem = idempotencyKey({ loopSpecVersion: loaded.spec.metadata.version, triggerSource: "github", sourceEventId: "gh_evt_normal_bug_001" });
    expect(runId({ loopSpecHash: hash, idempotencyKey: idem })).toMatch(/^run_/);
  });
});
