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
npx loopgraph setup --project . --activate
npx loopgraph start --project . --no-studio
```

The package does not bundle the Next.js Studio, so `start` runs the local supervisor headlessly. From the full repository clone, omit `--no-studio` to start the Hermes Brain UI and supervisor together. Use `npx loopgraph start --project . --once` for one complete health and work cycle.

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

To run the full evidence-to-design cycle, use `loopgraph controller run --project .`. The [continuous loop controller](../../docs/CONTINUOUS-LOOP-CONTROLLER.md) persists idempotent decisions, asks Hermes for missing design evidence, and materializes only strict low-risk additions in shadow mode.

Accepted Hermes routes become durable jobs, including shadow and recommendation routes. Process them once or continuously:

```bash
npx loopgraph worker run --project .
npx loopgraph worker run --project . --watch --interval 5
```

The worker atomically claims work, verifies the immutable LoopSpec hash and route binding, enforces activation/connector/approval gates, retries with backoff, dead-letters exhausted jobs, and prepares signed lifecycle evidence for Hermes. See the [route-job worker guide](../../docs/ROUTE-JOB-WORKER.md).

See [Hermes examples](../../docs/HERMES-EXAMPLES.md) for the Marketing reference flow, strict Legal / Compliance sensitive-work example, and Custom field-ops example.

### Private hosted apps from Hermes or CLI

For an interactive terminal, authorize once in the hosted browser. The CLI persists
the origin and tenant binding, so later app commands do not require token or tenant
environment variables:

```bash
npx loopgraph auth login \
  --url https://loopgraph.example \
  --audience https://loopgraph.example/marketplace

npx loopgraph apps search "renewal risk" --department customer_success
npx loopgraph auth logout
```

The session grants only `marketplace.consume`, uses a 15-minute access token with a
rotating refresh token, and is stored in a `0600` current-user file. See the
[interactive CLI authorization guide](../../docs/CLI-DEVICE-AUTHORIZATION.md).

For Hermes or a managed CLI runner, use workload identity instead:

Managed Hermes and CLI processes can use private hosted LoopPacks with a
short-lived workload identity—never a Supabase service key or provider token:

```bash
export LOOPGRAPH_MARKETPLACE_URL=https://loopgraph.example/
export LOOPGRAPH_MARKETPLACE_AUDIENCE=https://loopgraph.example/marketplace
export LOOPGRAPH_MARKETPLACE_ORGANIZATION_ID=YOUR_ORGANIZATION_UUID
export LOOPGRAPH_MARKETPLACE_PROJECT_KEY=main
export LOOPGRAPH_WORKLOAD_IDENTITY_TOKEN_FILE=/absolute/path/to/projected.jwt

npx loopgraph apps search "renewal risk" --department customer_success
```

The hosted admin must grant the workload `marketplace.consume`. Existing app
detail, planning, mapping, and apply tools then fetch only the selected release,
recheck tenant visibility, verify its signature and file digests, and use the
normal write-blocked installer. See the [workload access guide](../../docs/HOSTED-MARKETPLACE-WORKLOAD-ACCESS.md).

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
| `setup` | Prepare an empty workspace, Hermes contract, safe routes, and Studio plan |
| `start` | Supervise routes, connections, measurements, workers, opportunities, app updates, controller, and aggregate health |
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
