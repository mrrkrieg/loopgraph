# Loopgraph current build state

Last updated: 2026-07-29

## One-line summary

Loopgraph is a local-first governed control plane for Hermes Brain: it discovers recurring business problems, asks only for missing evidence, compiles validated LoopSpecs, routes normalized company events, runs durable jobs, records outcomes, and evolves the company graph through accountable transactions.

## Implemented

### Hermes setup and discovery

- A clean local install starts with no demo loops.
- `loopgraph hermes setup` creates project-local admin, webhook-router, and lifecycle-router MCP profiles plus Hermes skills.
- Hermes immediately presents canonical departments and guides the user through five compact question bundles.
- Project inspection reads allowlisted manifests and environment key names only after permission.
- Durable Hermes design tasks can be dispatched over a signed transport, request focused evidence gaps, resume after answers, and submit schema-constrained proposals.

### Loop design and graph

- High-reasoning design receives a bounded `LoopDesignContext`; deterministic local design remains a fallback.
- Accepted proposals compile into versioned LoopSpecs, routing cards, connection requirements, graph nodes, and three starter fixtures.
- The company graph visualizes `Hermes Brain → Department → Loop` plus routing signals, evidence returns, opportunities, and graph changes.
- Local workspaces show only their registered loops; the hosted preview can show a rich demonstration graph.

### Automatic opportunity detection

- Durable problems, routing corrections, failed evaluations, jobs, runs, reviews, human friction, and outcome evidence feed explainable opportunity scoring.
- Qualified opportunities can proactively dispatch Hermes design tasks.
- Opportunity generations preserve history instead of silently mutating earlier evidence.

### Semantic graph governance

- `add`, `update`, `split`, `merge`, and `retire` changes are bound to exact content-derived graph hashes.
- Accountable approval receipts record actor, role, policy, reason, evidence, and approved operations.
- Atomic transactions capture base/result snapshots, operation receipts, generated assets, and recovery state.
- Ordered promotion, pause/resume lifecycle changes, and exact-state rollback are implemented.
- Trusted Hermes admin MCP tools, explicit CLI commands, and a bearer-authenticated API expose the transaction workflow.
- Graph mutation tools are unavailable to webhook-router and lifecycle-router turns.

### Hermes event brain and durable execution

- Provider webhooks are planned to terminate at Hermes, which normalizes the event and submits one bounded routing decision.
- Loopgraph validates route eligibility, evidence, confidence, readiness, deduplication, cooldown, concurrency, fan-out, policy, and immutable LoopSpec identity.
- Accepted routes create durable jobs with atomic claims, leases, retries, dead-letter state, activation gates, and review reconciliation.
- Signed lifecycle events return route, run, escalation, outcome, and terminal evidence to Hermes.

### Outcomes and continuous improvement

- Metric samples distinguish observed, modeled, and incomplete evidence.
- Outcome evaluation compares baselines and post-loop windows without inventing missing measurements.
- The value ledger subtracts review, rework, supervision, escalation, and governance cost.
- A durable controller reacts to events, jobs, reviews, outcomes, schedules, and management cycles.
- Only policy-approved, low-risk, non-customer-facing additions can be committed automatically, and they remain in shadow mode.

### Verification

- TypeScript, package build, deterministic fixture simulation, MCP exposure, installer safety, API authorization, routing, worker, outcome, controller, and semantic transaction behavior are covered by the Vitest suite.
- Production dependency auditing is separate from development-tool audit output through `npm run audit:prod`.

## Safety boundary

- Webhook turns cannot invoke discovery, design, controller, worker, graph mutation, promotion, lifecycle, or rollback tools.
- Provider secrets, OAuth tokens, signing keys, and raw payloads remain in Hermes or an approved credential store.
- Model output, repository text, and webhook text are untrusted until validated by Loopgraph contracts.
- Simulation and shadow routing do not perform external writes.
- Live execution remains experimental and requires connector readiness, policy, approvals, and exact prepared-action fingerprints.

## Remaining product layers

1. Automatically run the full positive, missing-context, ambiguity, duplicate, risk, and regression fixture suite before issuing promotion-ready evidence.
2. Bind LoopSpec metrics to real connector fields, schedule measurement windows, and reconcile connector/webhook health.
3. Add dedicated Opportunities, Change Review, Controller, Learning, and Value product views.
4. Add hosted authentication, organization/role authorization, tenant-isolated persistence, rate limits, distributed scheduling, immutable audit export, production observability, and backups.
5. Apply provider subscriptions and credentials through Hermes-owned connector onboarding; Loopgraph intentionally stores only non-secret route and capability metadata.
6. Consolidate the stacked implementation changes, migrate existing local state where required, and complete a clean-install production release audit.

## Key documentation

- [Hermes quickstart](./HERMES-QUICKSTART.md)
- [Hermes design bridge](./HERMES-DESIGN-BRIDGE.md)
- [Loop opportunity engine](./LOOP-OPPORTUNITY-ENGINE.md)
- [Semantic graph transactions](./SEMANTIC-GRAPH-TRANSACTIONS.md)
- [Durable route-job worker](./ROUTE-JOB-WORKER.md)
- [Outcomes and value](./OUTCOMES-AND-VALUE.md)
- [Continuous loop controller](./CONTINUOUS-LOOP-CONTROLLER.md)
