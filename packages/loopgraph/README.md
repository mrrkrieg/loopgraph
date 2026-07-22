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
/loopgraph design automations for a department
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

`register` and the full Design Studio template catalog are app-only in the Loopgraph repo.

## License

MIT
