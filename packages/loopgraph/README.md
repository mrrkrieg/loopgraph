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
