# Loopgraph current build state

Last updated: 2026-07-30

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
- Ordered promotion, automatic content-bound rehearsal gates, pause/resume lifecycle changes, and exact-state rollback are implemented.
- Trusted Hermes admin MCP tools, explicit CLI commands, and a bearer-authenticated API expose the transaction workflow.
- Graph mutation tools are unavailable to webhook-router and lifecycle-router turns.

### Hermes event brain and durable execution

- Provider webhooks are planned to terminate at Hermes, which normalizes the event and submits one bounded routing decision.
- Loopgraph validates route eligibility, evidence, confidence, readiness, deduplication, cooldown, concurrency, fan-out, policy, and immutable LoopSpec identity.
- Accepted routes create durable jobs with atomic claims, leases, retries, dead-letter state, activation gates, and review reconciliation.
- Signed lifecycle events return route, run, escalation, outcome, and terminal evidence to Hermes.

### Outcomes and continuous improvement

- Metric samples distinguish observed, modeled, and incomplete evidence.
- Exact metric bindings connect primary, leading, and guardrail metrics to one registered Hermes connector capability and structured provider query.
- Aligned schedules create idempotent, leased measurement jobs; trusted Hermes collectors return evidence-qualified results or durable failures.
- Complete baseline/current windows evaluate outcomes automatically only after required guardrails arrive.
- Connection reconciliation checks capabilities, scopes, health freshness, Hermes route manifests, and overdue measurements, then triggers the controller.
- Outcome evaluation compares baselines and post-loop windows without inventing missing measurements.
- The value ledger subtracts review, rework, supervision, escalation, and governance cost.
- A durable controller reacts to events, jobs, reviews, outcomes, schedules, and management cycles.
- Only policy-approved, low-risk, non-customer-facing additions can be committed automatically, and they remain in shadow mode.

### Operating product views

- One focused **Operate** navigation entry opens Opportunities, Change Review, Controller, Learning, and Value views.
- Opportunities explain recurrence, impact, evidence, risk, status, and the associated graph change.
- Change Review joins exact semantic operations to accountable approval and transaction receipts.
- Controller runs expose triggers, decisions, failed policy rules, checkpoints, and safety ceilings.
- Learning joins connector bindings, scheduled jobs, samples, outcomes, guardrails, missing evidence, and reconciliation repairs.
- Value keeps observed, modeled, and incomplete net savings separate and shows every hidden cost subtracted.
- Hosted preview records are explicitly illustrative. A local install reads only its active project and presents guided empty states until Hermes produces real records.

### Verification

- TypeScript, package and Next.js production builds, deterministic fixture simulation, MCP exposure, installer safety, API authorization, routing, worker, outcome, controller, semantic transaction behavior, and operating-view truth separation are covered by automated tests.
- Production dependency auditing is separate from development-tool audit output through `npm run audit:prod`.

### Hosted identity and tenant boundary

- Supabase magic-link authentication is enforced for configured production deployments.
- User-facing requests use cookie-bound Supabase clients; the service-role client is server-only.
- Organization membership and `viewer` / `operator` / `admin` / `owner` capabilities are
  authoritative; editable profile metadata cannot grant access.
- The Design Studio resolves the active member organization instead of the first database row.
- Every current public Supabase table has an RLS policy, and anonymous table access is revoked.
- Runtime Supabase persistence requires and filters by an explicit organization ID.
- Hosted file runtime state resolves under a validated organization/project namespace on an
  explicit persistent root; the application checkout and generic project-root override are ignored.
- File storage adapters are cached per resolved namespace instead of globally.
- Hosted worker, cron, signed Hermes callback, and signed GitHub-forwarder calls carry a configured
  machine identity, tenant/project scope, durable replay receipt, and database-enforced rate
  window. Bearer routes additionally bind a fresh request identity to the bounded request body.
- The controller schedule is registered every 15 minutes alongside hourly measurement
  reconciliation and weekly management review.
- Hosted machine authorization decisions append to a tenant/project hash-chained security audit
  ledger in the same database transaction as replay and rate enforcement.
- Hosted routing state, route jobs, Hermes design tasks, and Hermes callback receipts use
  tenant/project-scoped Supabase stores. Active design-task creation is idempotent, and task plus
  callback updates use revision fencing so independent replicas cannot overwrite one another.
- Hosted initial design dispatch and evidence-resume dispatch use a tenant/project-scoped outbound
  queue. Task changes and enqueue are transactional; leased workers retry, dead-letter, reconcile
  task delivery receipts, and expose queue health through protected metrics.
- Signed inbound Hermes callbacks use a tenant/project-scoped callback inbox. Replay authorization
  and enqueue commit together; leased workers compile callbacks with retries, dead-letter state,
  lease fencing, idempotent proposal artifacts, and protected queue metrics.
- Discovery sessions, evidence-gap sets, bounded design contexts, design runs, and proposal sets
  use one tenant/project-scoped hosted store. Session writes use revision compare-and-swap,
  evidence derivations are monotonic, and immutable design artifacts plus the session transition
  commit in one database transaction. Local projects keep the equivalent atomic file store.
- Accepted proposals commit immutable full-digest LoopSpec versions, the active workspace
  registry, generated fixtures, and the discovery-session transition in one tenant/project
  transaction. Design, routing, route-job workers, routing operations, and the hosted graph read
  the same active registry; local projects keep portable files.
- Public liveness/readiness endpoints reveal only status; protected Prometheus metrics expose the
  authorization plane, queue health, active discovery age, and design-artifact counters through a
  separate observability credential.
- Organization admins and owners can export cursor-paged audit events with database-side chain
  verification.
- Same-origin browser mutations, signed machine callbacks, worker bearer auth, cron auth, and
  baseline security headers are separated at the web boundary.
- See [Hosted authentication and tenant security](./HOSTED-SECURITY.md).

## Safety boundary

- Webhook turns cannot invoke discovery, design, controller, worker, graph mutation, promotion, lifecycle, or rollback tools.
- Provider secrets, OAuth tokens, signing keys, and raw payloads remain in Hermes or an approved credential store. Loopgraph accepts only constrained opaque credential references.
- Model output, repository text, and webhook text are untrusted until validated by Loopgraph contracts.
- Simulation and shadow routing do not perform external writes.
- Live execution remains experimental and requires connector readiness, policy, approvals, and exact prepared-action fingerprints.

## Remaining product layers

1. Continue the database migration beyond routing, route jobs, design tasks, callbacks, outbound
   Hermes dispatch, discovery/design artifacts, the versioned LoopSpec registry, opportunities,
   proposed graph changes, controller state, and semantic graph transactions: move measurements,
   outcomes, and value-ledger records to tenant-scoped atomic stores.
2. Add scoped identities and durable request guards to remaining provider collectors, then add
   user-facing API quotas.
3. Send the tamper-evident audit stream to independent retention, add distributed tracing and
   deployed alerts/SLOs, and prove restore procedures with scheduled backups and migration
   rollback rehearsals.
4. Implement provider API clients and apply provider subscriptions through Hermes-owned connector
   onboarding; Loopgraph intentionally stores only non-secret references, route metadata,
   contracts, and receipts.
5. Consolidate the stacked implementation changes, apply the RLS migration to a real Supabase
   staging project, and complete clean-install plus hosted multi-user release audits.

## Key documentation

- [Hermes quickstart](./HERMES-QUICKSTART.md)
- [Hermes design bridge](./HERMES-DESIGN-BRIDGE.md)
- [Loop opportunity engine](./LOOP-OPPORTUNITY-ENGINE.md)
- [Semantic graph transactions](./SEMANTIC-GRAPH-TRANSACTIONS.md)
- [Promotion rehearsal](./PROMOTION-REHEARSAL.md)
- [Durable route-job worker](./ROUTE-JOB-WORKER.md)
- [Distributed Hermes routing store](./DISTRIBUTED-ROUTING-STORE.md)
- [Distributed Hermes design store](./DISTRIBUTED-HERMES-DESIGN-STORE.md)
- [Hermes design dispatch queue](./HERMES-DESIGN-DISPATCH-QUEUE.md)
- [Hermes design callback inbox](./HERMES-DESIGN-CALLBACK-INBOX.md)
- [Distributed discovery and design artifacts](./DISTRIBUTED-DISCOVERY-DESIGN-STORE.md)
- [Versioned LoopSpec registry](./VERSIONED-LOOPSPEC-REGISTRY.md)
- [Distributed opportunity and controller runtime](./DISTRIBUTED-OPPORTUNITY-CONTROLLER.md)
- [Outcomes and value](./OUTCOMES-AND-VALUE.md)
- [Hermes connector measurements](./CONNECTOR-MEASUREMENTS.md)
- [Continuous loop controller](./CONTINUOUS-LOOP-CONTROLLER.md)
- [Hosted runtime namespaces](./HOSTED-RUNTIME-NAMESPACES.md)
- [Scoped machine request guards](./MACHINE-REQUEST-GUARDS.md)
- [Operational audit and observability](./OPERATIONAL-AUDIT-OBSERVABILITY.md)
