import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadLoopSpecFromPath } from "./loader";
import { simulateLoop } from "./simulator";
import { formatReviewPacket } from "./review-packet";
import { FileStorageAdapter } from "../loopgraph-sdk/storage";

const repoRoot = path.resolve(__dirname, "../..");

describe("review-packet", () => {
  it("includes decision summary, evidence, and prepared action fingerprints", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"),
      storage
    });

    const packet = formatReviewPacket(result.trace, result.escalationCase);
    expect(packet).toContain("Review decision packet");
    expect(packet).toContain(result.trace.agentOutput!.decisionSummary);
    expect(packet).toContain("fingerprint=");
    expect(packet).toContain("Customer-facing");
    expect(packet).toContain(result.escalationCase!.id);
  });
});
