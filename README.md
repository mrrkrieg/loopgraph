# Loopgraph

Open-source infrastructure for defining and operating recurring AI-human loops.

A Loopgraph loop is more than a prompt or a tool chain. It defines what event starts work, what evidence it may observe, which actions it may propose, what policy and verification must pass, when a human must decide, and how the outcome is recorded.

## First 10 minutes

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

## CLI commands

```bash
npm run loopgraph -- init <template> [dir]
npm run loopgraph -- validate <path>
npm run loopgraph -- simulate <path> --fixture <file>
npm run loopgraph -- trace <runId>
npm run loopgraph -- export-graph <path>
npm run loopgraph -- adapter test
npm run loopgraph -- review approve <runId> --actions <fingerprint>
npm run loopgraph -- case show <caseId>
```

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
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=                 # reserved / experimental
CRON_SECRET=
```

## Docs

- [ADR-001](docs/ADR-001-v1-architecture.md)
- [V1 Launch Context Plan](V1-LAUNCH-CONTEXT-PLAN.md)
- [V1 Execution Plan](docs/V1-EXECUTION-PLAN.md)
- [Competitive boundary](docs/competitive-boundary.md)
- [Loop spec](docs/loop-spec.md)

## License

MIT
