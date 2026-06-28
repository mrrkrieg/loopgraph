import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLoopSpecFromPath } from "../lib/loopgraph-runtime/loader";
import { simulateLoop } from "../lib/loopgraph-runtime/simulator";
import { FileStorageAdapter } from "../lib/loopgraph-sdk/storage";
import { summarizeTrace } from "../lib/loopgraph-core/trace-summary";

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const outDir = path.join(repoRoot, "fixtures/expected-traces");
  mkdirSync(outDir, { recursive: true });

  const matrix = [
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
  ];

  for (const group of matrix) {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples", group.example));
    if (!loaded.ok) throw new Error(`load failed: ${group.example}`);

    for (const fixture of group.fixtures) {
      const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph-test"));
      const result = await simulateLoop({
        spec: loaded.spec,
        fixture: path.join(repoRoot, "fixtures", group.example, fixture),
        storage
      });
      const summary = summarizeTrace(result.trace, result.escalationCase);
      const name = fixture.replace(/\.json$/, ".summary.json");
      writeFileSync(path.join(outDir, name), `${JSON.stringify(summary, null, 2)}\n`);
      console.log(`wrote ${name} (${summary.status})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
