# Loopgraph

Open-source infrastructure for defining and operating recurring AI-human loops.

A Loopgraph loop is more than a prompt or a tool chain. It defines what event starts work, what evidence it may observe, which actions it may propose, what policy and verification must pass, when a human must decide, and how the outcome is recorded.

## First 10 minutes

### Hermes-first company brain flow

Use this path when you want Hermes Agent to be the company brain that designs loops and receives all production webhooks.

```bash
git clone <repo>
cd loopgraph
npm install

npm run loopgraph -- workspace init --project .
npm run loopgraph -- hermes install --project .
npm run loopgraph -- hermes doctor --project .
npm run loopgraph -- studio --project . --start
```

Then ask Hermes:

```text
/loopgraph design automations for a department
```

The Hermes skill uses Loopgraph MCP tools to show canonical departments, ask the shared five-bundle discovery questions, design loops such as `Marketing -> Ads` and `Marketing -> Content Creation`, explain required connections, and materialize only the proposals you explicitly accept.

After loops are materialized, keep provider webhooks pointed at Hermes and rehearse routing locally:

```bash
npm run loopgraph -- hermes webhooks plan --project .
npm run loopgraph -- hermes webhooks sync --project .
npm run loopgraph -- hermes webhooks doctor --project .
npm run loopgraph -- events test --project . \
  --source google_ads* \
  --fixture .loopgraph/generated/hermes/company_1/marketing/marketing_ads/fixtures/happy-path.json \
  --expected-action route \
  --expected-loop marketing_ads \
  --require-synced-manifest
```

`events test` uses a synthetic or redacted normalized fixture. It does not send a real provider webhook or store provider secrets in Loopgraph. Provider webhook signing secrets stay in Hermes.

See [Hermes quickstart](docs/HERMES-QUICKSTART.md) and the deeper [Hermes event brain implementation plan](docs/HERMES-EVENT-BRAIN-INTEGRATION-PLAN.md).

### Code-first loop demo

```bash
git clone <repo>
cd loopgraph
npm install

npm run loopgraph -- validate examples/github-issue-triage
npm run loopgraph -- simulate examples/github-issue-triage \
  --fixture fixtures/github-issue-triage/security-issue.json

npm run loopgraph -- init github-issue-triage ./tmp/github-issue-triage
npm run dev
```

Open the web UI for Design Studio and topology. CLI traces are stored under `.loopgraph/`.

After a simulate run, open **Topology** (`/topology`) to see the loop on the company map and click through to runs, reviews, and cases. See [docs/topology-guide.md](docs/topology-guide.md).

## Simulated vs real

| Mode | Command | What it does |
|------|---------|--------------|
| **Simulate** (default) | `loopgraph simulate --fixture …` | Deterministic fixtures + heuristic assessment. **No API keys. No external writes.** |
| **Validate** | `loopgraph validate …` | Schema and policy checks only. |
| **Execute** (experimental) | `LOOPGRAPH_EXECUTE_ENABLED=true loopgraph execute --event …` | Optional OpenAI assessment behind the Hermes live-execution gate: routing contract, live activation mode, connector readiness, fingerprint approval, and customer-facing separation are required. |

For V1, treat **simulate + review + case resolve** as the supported code-first path.

## What Loopgraph is

- A versioned **LoopSpec** contract (`loopgraph/v1alpha1`)
- A local **validate + simulate** runtime with deterministic fixtures
- Reproducible **context snapshots** with provenance and hashes
- **Prepared-action** approval binding (exact payload fingerprints)
- A standardized **EscalationCase** handoff to management loops
- A **Design Studio** and generated topology for blueprinting and debugging

## What Loopgraph is not

Loopgraph does not replace LangGraph, Mastra, Temporal, Langfuse, or HumanLayer. It provides the operating contract around recurring AI work: context, policy, evidence, approval, escalation, and outcome. See [docs/competitive-boundary.md](docs/competitive-boundary.md).

## Hero templates

1. **GitHub Issue Triage** — developer onboarding demo (`examples/github-issue-triage`)
2. **Strategic Account Escalation** — company operating-system demo (`examples/strategic-account-escalation`)
3. **Support Ticket Triage** — Intercom/support inbox triage (`examples/support-ticket-triage`)

## CLI commands

```bash
npm run loopgraph -- init <template> [dir]
npm run loopgraph -- validate <path>
npm run loopgraph -- simulate <path> --fixture <file>
npm run loopgraph -- trace <runId>
npm run loopgraph -- trace <runId> --review          # decision packet for review-required runs
npm run loopgraph -- review packet <runId>           # full human review decision packet
npm run loopgraph -- review approve <runId> --actions <fingerprint>[,...]
npm run loopgraph -- review reject <runId> --comment "..."
npm run loopgraph -- review request-evidence <runId>
npm run loopgraph -- review reassign <runId> --to <role>
npm run loopgraph -- case list
npm run loopgraph -- case show <caseId>
npm run loopgraph -- case resolve <caseId> --summary "..."
npm run loopgraph -- export-graph <path>
npm run loopgraph -- adapter test
```

Experimental (requires env): `loopgraph execute <path> --event <file>` — see [docs/roadmap.md](docs/roadmap.md).

## Architecture

```text
loopgraph.yaml (source of truth)
  → lib/loopgraph-core (contracts)
  → lib/loopgraph-runtime (simulate)
  → scripts/loopgraph.ts (CLI)
  → app/ (Design Studio + topology debugger)
```

## Environment variables

```text
NEXT_PUBLIC_SUPABASE_URL=       # optional Design Studio persistence
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=                 # reserved / experimental
CRON_SECRET=
```

## Docs

- [Current build state](docs/CURRENT-STATE.md)
- [Hermes quickstart](docs/HERMES-QUICKSTART.md)
- [Dan walkthrough (CLI demo)](docs/DAN-WALKTHROUGH.md)
- [Topology guide](docs/topology-guide.md)
- [Next priorities](docs/NEXT-PRIORITIES.md)
- [V1 Launch Context Plan](V1-LAUNCH-CONTEXT-PLAN.md)
- [V1 Execution Plan](docs/V1-EXECUTION-PLAN.md)
- [Competitive boundary](docs/competitive-boundary.md)
- [Loop spec](docs/loop-spec.md)
- [Approval model](docs/approval-model.md)
- [Escalation case](docs/escalation-case.md)
- [Trace model](docs/trace-model.md)

## License

MIT
