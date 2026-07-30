# Consumer integration

How to embed Loopgraph in an app like [raisi-growth-os](https://github.com/mrrkrieg/raisi-growth-os).

## Install

```json
{
  "dependencies": {
    "loopgraph": "github:mrrkrieg/loopgraph#packages/v0.2.0"
  }
}
```

Pin a git tag — do not track `main` in production.

## Repo layout

```text
your-app/
├── loops/investor-reply-triage/loopgraph.yaml
├── lib/loopgraph/
│   ├── storage.ts              # StorageAdapter (Postgres, etc.)
│   └── adapters/inbox.ts       # IntegrationAdapter
├── fixtures/investor-reply-triage/
└── scripts/run-loop.ts          # cron → runLoop()
```

Loop specs and domain adapters stay **in your repo**. Loopgraph ships contracts + runtime only.

## StorageAdapter

Implement persistence for traces, reviews, and escalation cases:

```typescript
import type { StorageAdapter } from "loopgraph/sdk";

export function createAppStorage(): StorageAdapter {
  return {
    async saveRun(trace) { /* upsert trace */ },
    async getRun(runId) { /* load trace */ },
    async saveReview(review) { /* ... */ },
    async saveEscalationCase(caseItem) { /* ... */ },
    async getEscalationCase(caseId) { /* ... */ },
    async listRuns() { /* index for UI */ },
    async listCases() { /* index for UI */ }
  };
}
```

For local dev, use `FileStorageAdapter` from `loopgraph/sdk` with a `.loopgraph/` directory.

## Trigger wiring

```typescript
import { loadLoopSpecFromPath, runLoop } from "loopgraph/runtime";
import { createAppStorage } from "../lib/loopgraph/storage";
import { inboxAdapter } from "../lib/loopgraph/adapters/inbox";

const spec = await loadLoopSpecFromPath("loops/investor-reply-triage");
if (!spec.ok) throw new Error(spec.errors.join("\n"));

const result = await runLoop({
  spec: spec.spec,
  mode: "simulate", // or "execute" with LOOPGRAPH_EXECUTE_ENABLED
  fixture: "fixtures/investor-reply-triage/new-message.json",
  eventId: "evt_123",
  startedAt: new Date().toISOString(),
  storage: createAppStorage()
});
```

Register adapters in your context compiler or pass them when compiling context (see hero examples in the Loopgraph repo).

## Review governance

```typescript
import { applyReviewDecision } from "loopgraph/runtime";

await applyReviewDecision(storage, {
  runId: "run_abc",
  status: "approved",
  reviewerId: "reviewer_alice",
  role: "approver",
  approvedFingerprints: ["fp1", "fp2"]
}, {
  projectRoot: process.cwd()
});
```

CLI parity: `npx loopgraph review approve run_abc --actions fp1,fp2 --by reviewer_alice --role approver --project .`

## CI recipe

```yaml
- run: npm ci
- run: npx loopgraph validate loops/investor-reply-triage
- run: npx loopgraph simulate loops/investor-reply-triage --fixture fixtures/investor-reply-triage/happy-path.json
```

## Git install reference

```bash
npm install github:mrrkrieg/loopgraph#packages/v0.2.0
```

Tag `packages/v0.2.0` on the loopgraph repo when cutting a package release.

## Related

- [M4 package plan](./M4-PACKAGE-PLAN.md)
- [Template authoring](./template-authoring.md)
- [Package README](../packages/loopgraph/README.md)
