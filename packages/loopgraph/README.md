# loopgraph

Install the loop engine in your app without the Loopgraph Design Studio.

## Install

```bash
npm install github:mrrkrieg/loopgraph#packages/v0.2.0
```

Or from a monorepo workspace:

```bash
npm install loopgraph@workspace:*
```

Peer dependencies: `zod`, `yaml`. Optional: `openai` (for execute mode).

## Quick start

### Hermes Agent company brain

```bash
npx loopgraph workspace init --project .
npx loopgraph hermes install --project .
npx loopgraph hermes doctor --project .
npx loopgraph studio --project .
```

Then start Hermes with:

```text
start Loopgraph
```

After materializing loops, rehearse webhook routing locally with synthetic or redacted fixtures:

```bash
npx loopgraph hermes webhooks plan --project .
npx loopgraph hermes webhooks sync --project .
npx loopgraph hermes webhooks doctor --project .
npx loopgraph events test --project . \
  --source google_ads* \
  --fixture .loopgraph/generated/hermes/marketing/marketing_ads/fixtures/happy-path.json \
  --expected-action route \
  --expected-loop marketing_ads \
  --require-synced-manifest
npx loopgraph simulate \
  .loopgraph/generated/hermes/marketing/marketing_ads/loopgraph.yaml \
  --fixture .loopgraph/generated/hermes/marketing/marketing_ads/fixtures/happy-path.json
```

Provider webhooks should point at Hermes, not directly at Loopgraph workflow execution. The route manifest stores non-secret metadata only; provider secrets stay in Hermes.

For proactive Loopgraph-initiated design work, configure the dedicated Hermes `loopgraph.design_requested` webhook described in the [Hermes design bridge](../../docs/HERMES-DESIGN-BRIDGE.md). Hermes reads the durable task and submits evidence/proposals through Loopgraph MCP; the webhook only wakes the agent.

To detect missing or weak loops from accumulated local problems, routing corrections, failed verification, and review friction, use the [Loop opportunity engine](../../docs/LOOP-OPPORTUNITY-ENGINE.md). Qualified opportunities can start a draft Hermes design task but cannot materialize or execute a loop.

Accepted Hermes routes become durable jobs, including shadow and recommendation routes. Process them once or continuously:

```bash
npx loopgraph worker run --project .
npx loopgraph worker run --project . --watch --interval 5
```

The worker atomically claims work, verifies the immutable LoopSpec hash and route binding, enforces activation/connector/approval gates, retries with backoff, dead-letters exhausted jobs, and prepares signed lifecycle evidence for Hermes. See the [route-job worker guide](../../docs/ROUTE-JOB-WORKER.md).

See [Hermes examples](../../docs/HERMES-EXAMPLES.md) for the Marketing reference flow, strict Legal / Compliance sensitive-work example, and Custom field-ops example.

### Runtime API

```typescript
import { validateLoopSpec, loadLoopSpecFromPath } from "loopgraph/core";
import { runLoop, applyReviewDecision } from "loopgraph/runtime";
import type { IntegrationAdapter, StorageAdapter } from "loopgraph/sdk";
```

```bash
npx loopgraph validate loops/my-loop/loopgraph.yaml
npx loopgraph simulate loops/my-loop --fixture fixtures/my-loop/happy-path.json
```

## Minimal adapter stub

```typescript
import type { IntegrationAdapter } from "loopgraph/sdk";

export const inboxAdapter: IntegrationAdapter = {
  id: "inbox",
  name: "Inbox",
  compileContext() {
    return { entries: [], compiledPrompt: "No messages." };
  },
  async prepareAction() {
    return { mode: "draft", summary: "Draft reply prepared." };
  }
};
```

Wire `StorageAdapter` (Postgres, files, etc.) and call `runLoop()` from a cron or webhook handler. See [consumer integration guide](../../docs/consumer-integration.md) in the main repo.

## CLI commands

| Command | Description |
|---------|-------------|
| `validate <spec>` | Validate `loopgraph.yaml` |
| `simulate <spec> --fixture <file>` | Deterministic fixture run |
| `trace <runId>` | Inspect a saved trace |
| `review *` | Approve, reject, request evidence |
| `case *` | List, show, resolve escalation cases |
| `init <template>` | Scaffold hero templates |
| `adapter test` | Mock adapter conformance |
| `worker run` | Claim and process durable Hermes route jobs |
| `worker retry` / `worker cancel` | Explicit operator recovery with actor and reason |

`register` and the full Design Studio template catalog are app-only in the Loopgraph repo.

## License

MIT
