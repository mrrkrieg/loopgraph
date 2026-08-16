# Loopgraph current build state

Last updated: 2026-08-13

## One-line summary

Loopgraph is a local-first governed control plane for Hermes Brain: it discovers recurring business problems, asks only for missing evidence, compiles validated LoopSpecs, validates normalized company-event routes, assigns live work to Hermes, records agent execution and outcomes, and evolves the company graph through accountable transactions.

## Implemented

### Hermes setup and discovery

- A clean local install starts with no demo loops.
- `loopgraph hermes setup` creates project-local admin, webhook-router, and lifecycle-router MCP profiles plus Hermes skills.
- `loopgraph hermes setup --activate` applies those MCP registrations and installs the Loopgraph skill from GitHub in one command after clone, failing with explicit recovery commands when Hermes cannot apply a step.
- Hermes immediately presents canonical departments and guides the user through five compact question bundles.
- Project inspection reads allowlisted manifests and environment key names only after permission.
- Durable Hermes design tasks can be dispatched over a signed transport, request focused evidence gaps, resume after answers, and submit schema-constrained proposals.

### Loop design and graph

- High-reasoning design receives a bounded `LoopDesignContext`; deterministic local design remains a fallback.
- Accepted proposals compile into versioned LoopSpecs, routing cards, connection requirements, graph nodes, and three starter fixtures.
- The company graph visualizes `Hermes Brain → Department → Loop` plus routing signals, evidence returns, opportunities, and graph changes.
- The local and hosted graph editor submits backend transactions for layout moves and governed semantic node, edge, and loop-lifecycle proposals. Users can propose improving, splitting, merging, or retiring registered loops without mutating the active graph; cross-department merges are rejected. Hosted receipts are tenant/project scoped, actor-bound, immutable, and visible in the editor. A compilable semantic proposal automatically opens an idempotent opportunity, graph change set, discovery session, and Hermes design task; invalid decorative edges fail before a receipt is stored. On reload, the editor reconstructs every transaction-to-opportunity/design correlation from durable tenant-matched records, overlays pending changes on every affected registered loop, and restores the exact Hermes-question and change-review handoffs. The operating review page records approve/reject decisions with the authenticated operator identity. Approval fails closed unless the completed Hermes task, immutable design run, validated proposal set, and tenant/opportunity scope agree; rejection can stop unwanted work before design finishes. Application is a separate permissioned action that accepts only the change-set ID from the browser, derives the receipt/design/proposals server-side, rechecks the content binding under the graph lock, snapshots the graph, and atomically commits or restores it. New loops retain their governed rollout mode rather than becoming unrestricted automations. Pending overlays are derived read models only: they add no live node or edge and disappear when the opportunity/change set reaches a terminal state. Semantic edits never bypass Hermes design, approval, readiness, or promotion.
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
- Twenty-four provider onboarding profiles define least-privilege authorization, subscriptions/streams/detectors, signature requirements, and normalization transformers. Trusted Hermes MCP tools expose catalog, preparation, and bounded normalization operations while default-redacting one-time OAuth material.
- BigQuery and Snowflake satisfy the warehouse capabilities already declared by the official Management and Operations/Finance apps through broker-owned, read-only query templates with mandatory time windows, byte/result ceilings, fixed provider endpoints, and no caller-supplied SQL or account context.
- A durable warehouse detector scheduler now provisions company-metric, forecast-variance, and capacity-plan windows, fences concurrent workers with hashed leases, validates explicit material-event rows, signs normalized evidence, forwards it to Hermes with workload identity, retries the exact window, and advances checkpoints only after complete delivery. Raw query rows remain process-local; durable state contains hashes and receipt/event identities only.
- Exact provider aliases resolve Account, Campaign, Incident, Customer, Contract, and related company objects to tenant-scoped canonical entities before routing; ambiguous deterministic matches require human review and fuzzy auto-merge is disabled.
- Loopgraph validates route eligibility, evidence, confidence, readiness, deduplication, cooldown, concurrency, fan-out, policy, and immutable LoopSpec identity.
- Accepted routes create durable jobs with atomic claims, leases, retries, dead-letter state, activation gates, and review reconciliation.
- Shadow, recommendation, and simulation jobs run locally. Live jobs carry an explicit Hermes execution target and are dispatched only to a healthy registered runtime with the required capabilities.
- Hermes reports assignment, run, task, tool, approval, output, outcome, and terminal facts through signed APIs or trusted MCP tools. Loopgraph projects those facts into the same durable run trace without storing provider secrets.
- Signed lifecycle events return route, run, escalation, outcome, and terminal evidence to Hermes.

### Outcomes and continuous improvement

- Metric samples distinguish observed, modeled, and incomplete evidence.
- Exact metric bindings connect primary, leading, and guardrail metrics to one registered Hermes connector capability and structured provider query.
- Aligned schedules create idempotent, leased measurement jobs; trusted Hermes collectors return evidence-qualified results or durable failures.
- Complete baseline/current windows evaluate outcomes automatically only after required guardrails arrive.
- Connection reconciliation checks capabilities, scopes, health freshness, Hermes route manifests, and overdue measurements, then triggers the controller.
- Outcome evaluation compares baselines and post-loop windows without inventing missing measurements.
- The value ledger subtracts review, rework, supervision, escalation, and governance cost.
- Value proof additionally subtracts connector operations, ongoing supervision, and organizational-change time, and remains explicitly unproven without observed evidence and those cost inputs.
- A durable controller reacts to events, jobs, reviews, outcomes, schedules, and management cycles.
- Only policy-approved, low-risk, non-customer-facing additions can be committed automatically, and they remain in shadow mode.

### Operating product views

- One focused **Operate** navigation entry opens Agent Activity, Opportunities, Change Review, Controller, Learning, and Value views.
- Agent Activity visualizes the complete incoming signal → Hermes Brain → business problem → department loop → Hermes runtime → tasks/tools/approvals → outcome path and supports operational filtering.
- Opportunities explain recurrence, impact, evidence, risk, status, and the associated graph change.
- Change Review joins exact semantic operations to accountable approval and transaction receipts.
- Controller runs expose triggers, decisions, failed policy rules, checkpoints, and safety ceilings.
- Learning joins connector bindings, scheduled jobs, samples, outcomes, guardrails, missing evidence, and reconciliation repairs.
- Value keeps observed, modeled, and incomplete net savings separate and shows every hidden cost subtracted.
- Hosted preview records are explicitly illustrative. A local install reads only its active project and presents guided empty states until Hermes produces real records.

### App marketplace and installation

- Official and private LoopPacks are strict, immutable, content-digested data artifacts that compile into existing governed runtime primitives.
- The browser, Hermes MCP tools, and CLI share marketplace search, exact install planning, connection and mapping readiness, atomic install, conformance, replay, promotion recommendation, pause/resume, update, rollback, detach, and uninstall services.
- Signed GitHub catalog taps synchronize only from an allowlisted HTTPS Git host and require an exact commit, canonical catalog snapshot digest, and pinned Ed25519 publisher keys. Remote content is validated in staging before atomic cache promotion and never installs or activates an app by itself.
- Every indexed App version records its exact catalog source, transport, URI/ref, snapshot digest, trust policy, and synchronization time. Catalog refresh removes only versions owned by that source, preserves mirrors from other sources, and rejects one semantic version resolving to different immutable digests.
- A tenant-scoped hosted marketplace registry stores publisher/app ownership, immutable signed versions, file digests, dependencies, connector requirements, presets, evaluation records, release signatures, and explicit private-catalog grants behind RLS. Its private delivery layer now adds department/capability search, MFA-gated digest-addressed uploads, a private 100 MiB object bucket, leased service-role verification, safe rejection codes, crash reconciliation, and 60-second exact-release downloads. Raw signatures and standalone storage-key fields never cross the service boundary; the signed storage capability may contain its scoped path and expires after 60 seconds. Connecting those verified downloads to the existing browser/MCP/CLI conformance and atomic install transaction remains the next marketplace handoff.

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
- Hosted measurement bindings/jobs, reconciliation reports, metric samples, observed outcomes,
  and value-ledger entries use tenant/project-scoped Supabase storage. Due jobs are leased with
  `FOR UPDATE SKIP LOCKED`, and immutable evidence conflicts fail at the database boundary.
- Canonical company entities and exact provider aliases use tenant-scoped Supabase storage with
  a uniqueness boundary that prevents an external object from mapping to multiple entities.
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

1. Apply the new evidence/entity migrations to staging and prove cross-replica measurement claims,
   immutable conflicts, entity aliases, and restore behavior against a real hosted database.
2. Add scoped identities and durable request guards to remaining provider collectors, then add
   user-facing API quotas.
3. Configure a real independent audit-retention receiver and alert manager, then run the included
   staging validation and isolated backup/restore rehearsal on every target environment.
4. Register provider applications and use Hermes-owned credentials to execute the supplied OAuth,
   webhook/stream/detector, signature, and transformer contracts against live tenant accounts.
5. Consolidate the stacked implementation changes, apply the RLS migration to a real Supabase
   staging project, and complete clean-install plus hosted multi-user release audits.
6. Connect the hosted marketplace's RLS-safe search and verified download boundary to the existing
   browser/MCP/CLI local staging, conformance, and atomic install pipeline.

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
- [Hosted marketplace registry](./HOSTED-MARKETPLACE-REGISTRY.md)
- [Hosted marketplace delivery](./HOSTED-MARKETPLACE-DELIVERY.md)
