import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadLoopSpecFromPath } from "../loopgraph-runtime/loader";
import { simulateLoop } from "../loopgraph-runtime/simulator";
import { FileStorageAdapter } from "../loopgraph-sdk/storage";
import { summarizeTrace } from "./trace-summary";

const repoRoot = path.resolve(__dirname, "../..");
const expectedDir = path.join(repoRoot, "fixtures/expected-traces");

const FIXTURE_MATRIX = [
  {
    example: "github-issue-triage",
    fixtures: ["normal-bug.json", "security-issue.json", "duplicate-feature-request.json", "unclear-reproduction.json"]
  },
  {
    example: "strategic-account-escalation",
    fixtures: [
      "enterprise-outage-near-renewal.json",
      "low-risk-product-question.json",
      "incomplete-account-context.json",
      "billing-dispute-without-renewal-risk.json",
      "executive-escalation.json"
    ]
  }
] as const;

describe("fixture trace snapshots", () => {
  for (const group of FIXTURE_MATRIX) {
    for (const fixture of group.fixtures) {
      it(`${group.example}/${fixture} matches expected summary`, async () => {
        const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples", group.example));
        if (!loaded.ok) throw new Error("load failed");

        const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
        const result = await simulateLoop({
          spec: loaded.spec,
          fixture: path.join(repoRoot, "fixtures", group.example, fixture),
          storage
        });

        const summary = summarizeTrace(result.trace, result.escalationCase);
        const expectedPath = path.join(expectedDir, fixture.replace(/\.json$/, ".summary.json"));
        const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
        expect(summary).toEqual(expected);
      });
    }
  }
});

describe("idempotency", () => {
  it("produces identical trace summaries for repeated runs", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/github-issue-triage"));
    if (!loaded.ok) throw new Error("load failed");
    const fixturePath = path.join(repoRoot, "fixtures/github-issue-triage/security-issue.json");
    const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));

    const first = await simulateLoop({ spec: loaded.spec, fixture: fixturePath, storage });
    const second = await simulateLoop({ spec: loaded.spec, fixture: fixturePath, storage });

    expect(summarizeTrace(first.trace)).toEqual(summarizeTrace(second.trace));
    expect(first.trace.idempotencyKey).toBe(second.trace.idempotencyKey);
  });
});
