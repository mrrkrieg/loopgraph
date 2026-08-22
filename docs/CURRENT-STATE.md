# Loopgraph current build state

Last updated: 2026-08-20

## One-line summary

Loopgraph is a local-first governed control plane for Hermes Brain: it discovers recurring business problems, asks only for missing evidence, compiles validated LoopSpecs, validates normalized company-event routes, assigns live work to Hermes, records agent execution and outcomes, and evolves the company graph through accountable transactions.

## Implemented

### Hermes setup and discovery

- A clean local install starts with no demo loops.
- `loopgraph setup` now prepares the empty workspace, project-local Hermes contract, synchronized route manifest, and Studio plan through one safe path; `--activate` is explicit because it updates Hermes registrations.
- `loopgraph start` now owns the local Studio plus an exclusive, gracefully stopped supervisor for route synchronization, connector checks, measurement scheduling, route jobs, opportunity scans, app update checks, controller scheduling, and aggregate health. Component cadences prevent expensive reconciliation work from running at the fast worker poll rate, errors are secret-redacted, and status is atomically persisted for the Brain UI.
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
- A versioned, read-only App onboarding journey now derives the same eight-step progress for Hermes, CLI, and browser from durable connector, mapping, configuration, install, test, and lifecycle state. It returns only unresolved questions and blockers plus one exact safe next action, and stops separately for installation and shadow-activation approval. Its content-bound impact review exposes every LoopSpec, Hermes skill, route, event contract, schedule, metric, fixture, evaluation, dashboard, connector binding, field mapping, and graph asset that will be created or reused. Duplicate LoopSpecs, incompatible asset contracts, permissions, output metrics, evidence edges, and shared-object conflicts are visible and blocking before a transaction begins. Shared reused resources retain installation ownership references so removing one App cannot remove resources another App still needs. Non-live mode activation is enforced with a short-lived, content-bound, one-time approval receipt rather than an actor label or prompt-only confirmation.
- App modules now control the compiled and materialized backend composition. Only core assets and selected-module loops are installed; exclusive skills, routes, metrics, permissions, graph nodes, and edges are removed with their loop. Shared skills required by active loops remain present, module dependencies are enforced, empty compositions fail closed, and synthetic evaluation rewrites disabled-loop expectations to prove that Hermes leaves those routes unhandled. A reviewed module overlay atomically rematerializes the LoopSpecs and asset ownership, removes disabled loops, and resets the App to write-blocked testing; new permissions or connector requirements require a fresh install plan.
- Nine generated Department Packs give every official department a curated App topology with an explicit default App, dependency-safe install order, shared company-context keys, shared logical capabilities, and typed cross-App handoffs. Hermes, MCP, CLI, and browser read the same catalog and current installation progress. Packs never bulk-install or activate Apps; every App retains its own governed onboarding and approval boundaries.
- The generated SaaS Company Operating System Blueprint composes all nine Department Packs beneath one Hermes Brain, defines seven canonical company object contracts, and declares conditional cross-department evidence handoffs and learning returns. Hermes, MCP, CLI, and browser expose the same read-only company topology, current Pack/App progress, and one dependency-safe next Pack. The Blueprint grants no routing, installation, activation, or provider-write authority.
- Signed GitHub catalog taps synchronize only from an allowlisted HTTPS Git host and require an exact commit, canonical catalog snapshot digest, and pinned Ed25519 publisher keys. Remote content is validated in staging before atomic cache promotion and never installs or activates an app by itself.
- App publishers can now run a declarative developer inventory and write-blocked synthetic preview before validation, signing, packing, or publishing. The preview exposes the compiled Hermes graph plus every expected and actual routing decision, abstention, deferral, and approval requirement without installing the pack, invoking providers, or executing pack code.
- Marketplace discovery cards now expose immutable included-loop counts, required and optional capabilities, compatible stack counts, evidence-derived maturity, publisher, artifact trust, and historical-preview readiness. A catalog signature proves origin but never upgrades maturity: releases without exact digest-bound conformance evidence remain `concept`, while `tested` shows the passing scenario count from a zero-write receipt. The historical state is derived from installation, connection readiness, and passing synthetic or replay evidence; an installed result opens the installed App rather than returning to its Marketplace detail.
- Every Marketplace App detail now explains the accountable team, business problem, Hermes behavior, included loops, declared output metrics, setup questions, permissions, compatible stacks, graph topology, proof modes, explicit limitations, maturity, immutable version provenance, deprecation history, and packaged changelog. Synthetic and sample previews are distinguished from historical read-only replay; the latter is shown as available only for an installed App with a passing connection-readiness check.
- Installed Apps now show a four-gate operational maturity assessment tied to the pinned artifact: tested, connected, production proven, and Loopgraph verified. Production proof requires reviewed historical decisions plus durable completed-run, observed-outcome, and observed-value references; mere activity is insufficient. The final verification gate accepts only a content-bound Ed25519 receipt whose verifier key is explicitly trusted and not revoked. The page exposes the evidence and the exact remediation for every blocked gate.
- Operational maturity is now a shared Hermes/runtime service rather than browser-only derivation. `loopgraph_app_maturity_get` joins exact-digest evaluations, current readiness, App-owned completed Hermes runs, observed outcomes/value, and workspace verification state. Admin tools and matching CLI commands add approved public verifier trust, revoke it with accountable references, and verify/import exact-installation receipts. The local registry is atomic, workspace-bound, `0600`, and never accepts verifier private keys.
- Hosted verification trust and receipts now use an organization/project/workspace-scoped Supabase store behind the same runtime contract. Its tables are RLS-enabled and service-role-only; bounded trust, revoke, and import functions enforce immutable identities and append accepted changes to the tamper-evident security audit chain. Hosted resolution fails closed when the distributed store is unavailable rather than writing verification authority to ephemeral deployment disk.
- The App verification registry is now available through a read-only Hermes/MCP/CLI tool and a dedicated Settings console. Admins can add reviewed Ed25519 public keys, import signed exact-artifact receipts, and revoke trust; hosted mutations require `integrations.manage` plus step-up authentication and derive the actor from the session. The UI displays fingerprints rather than full key material, while shared validation rejects private-key PEM input before persistence.
- Hosted App installation state now resolves through the same shared runtime contract to a tenant/project/workspace-scoped Supabase registry. Revision-bound database leases serialize lifecycle mutations across serverless instances, the registry and lock commit together through bounded service-role RPCs, and accepted revisions enter the tamper-evident audit chain. Hosted App calls use the server-derived project key as workspace/company identity, browser mutations derive their actor from the authenticated session, and generated LoopSpecs materialize through the distributed LoopSpec registry; database unavailability fails closed instead of silently using deployment-local installation state.
- Install and uninstall now prepare a bounded, metadata-only lifecycle recovery record before changing LoopSpecs, connector-field-mapping ownership, or approved company-context ownership. Exact retries reuse the same materialization receipt and idempotent ownership mutations, then complete the operation with the installation-registry commit; conflicting lifecycle work is blocked while recovery remains outstanding. App status and the audit chain expose the operation and status without persisting provider payloads, credentials, or raw failure text.
- Hosted observability aggregates unfinished App lifecycle operations by tenant/project into protected
  Prometheus counts and age. Interrupted work marks operations degraded immediately; stale work
  raises the production alert contract without making otherwise healthy workers fail public
  readiness. The snapshot never emits App IDs, installation IDs, actors, or owned-resource names.
- The shared onboarding contract now promotes unfinished App work to a `recover_lifecycle` stage with affected resource counts and one accountable exact-retry boundary. Hermes instructions, the Installed Apps list, and Installed App detail use that same state; ordinary lifecycle/runtime controls are suppressed or rejected until recovery completes.
- App installation planning now resolves each logical capability through its immutable Connector Recipe to an exact bounded Connector Broker or governed Loopgraph runtime operation. Required scope and authority checks use the broker descriptor as well as the recipe, so a self-claimed connection cannot make an unsupported operation ready. Applied installations persist the secret-free operation contract through update and rollback; readiness and operational maturity require it, while older label-only installations fail closed and ask for a fresh plan. Default Product, Sales, and Marketing presets have required-operation conformance coverage.
- Hermes now has a read-only, installation-scoped operation resolver. The caller supplies only an installation ID, owned loop ID, and logical capability; Loopgraph derives the pinned artifact, active LoopSpec hash, exact provider/runtime binding, permission, scopes, and connection. It blocks undeclared cross-loop capabilities, inactive or recovering Apps, unresolved permissions, and changed connection bindings, and returns a five-minute content-digested `invoke_read`, `invoke_loopgraph_runtime`, `prepare_action`, or `blocked` disposition. It does not accept provider IDs, operations, URLs, headers, or credentials and does not execute the resolved operation.
- Installed Connector Broker bindings now have an executable Hermes bridge. The workload supplies only installation, owned loop, logical capability, durable route job, registered agent, call identity, and bounded input. Loopgraph re-resolves the operation, verifies the exact active LoopSpec hash, fresh capable assigned agent, event/problem company object, tenant, environment, scopes, and current healthy Broker projection, then derives the Broker envelope server-side. Reads execute through the allowlisted operation; writes stop at a fingerprint-bound prepared action for separate approval and commit. The workload-authenticated API requires a dedicated tenant-scoped `hermes.app_operations` grant, derives the machine tenant without a browser session, rejects caller-selected providers, operations, connections, tenants, URLs, workspace identities, and project roots, and fails secret-shaped input before the Broker.
- The same route-bound executor now supports a fixed governed Loopgraph runtime registry for `graph.read`, `routing-decisions.read`, and `outcomes-value.read`. The handlers return only bounded topology summaries, provider-payload-free routing decisions, and tenant-filtered observed outcome/value records; they use strict operation-specific schemas, content-digested results, central secret rejection, and no dynamic code, filesystem path, SQL, URL, or write authority. Internal reads work without configuring an external provider Broker. Graph-change proposals continue through the separate semantic graph review/transaction path.
- Every provider action prepared through an installed App now creates a second durable, secret-free ownership record before invocation returns. It binds the Broker action and receipt to the exact workspace/company, installation and artifact digest, active LoopSpec version, logical capability, route job, assigned Hermes agent, provider binding, environment, and company-object identity digest without copying canonical provider input. Local storage is atomic and `0600`; hosted storage is tenant/project/workspace-scoped, RLS-enabled, direct-write-revoked, size-bounded, idempotent, and audited through a service-role-only RPC. The read-only `loopgraph_app_operation_actions_get` tool and Installed App operations view expose the same installation-filtered records and render prepared actions plus approval gates in the operating topology. This ledger proves preparation ownership only; it does not approve or commit a provider write.
- App rollout now changes executable graph state as well as installation metadata. Activation revision-binds and atomically synchronizes every LoopSpec owned by the installation to shadow, recommend, or execute-with-approval; pause moves the owned graph back to shadow and resume restores the last approved mode. Missing owned specs or routing contracts fail closed, exact retries remain idempotent, and a later pause/resume cycle receives a new graph transaction identity.
- Hosted App provider-schema metadata and confirmed field mappings now resolve through tenant/project/workspace-scoped Supabase stores shared by Hermes, browser onboarding, and installation planning. Provider sample values are stripped before persistence, secret-shaped and sample-bearing payloads are rejected again in SQL, direct client writes are revoked, mapping ownership survives reuse and is released on uninstall, and accepted metadata changes append security-audit events. Hosted resolution fails closed instead of using deployment-local mapping files.
- Approved company context now has shared Hermes/MCP read and explicit-approval tools plus tenant/project/workspace/company-scoped Supabase persistence. Hermes inference cannot verify itself: an accountable operator must approve the exact proposal against the current revision. Declared types, tenant identity, bounded collection sizes, secret scanning, optimistic concurrency, consumer ownership, and audit-chain recording are enforced. Installation apply rejects context that changed after planning and attaches the installed App as a consumer; hosted resolution fails closed without the distributed store.
- Every Installed App now has an installation-scoped operations view and bounded operating topology. It joins recent incoming events, Hermes routes, business problems, agent tasks, tool calls, approval counts, failures, durable outcomes, human-labeled routing quality, review minutes, and value-ledger records only through the exact runtime loop IDs owned by that installation. The topology preserves the required Hermes Brain → accountable department → Installed App → owned loops hierarchy, adds at most the latest source/agent/run/approval/outcome evidence per loop, returns outcome evidence to Hermes visually, and links recorded runs and waiting decisions to their durable trace/review surfaces. Empty or unrelated global records remain excluded, and modeled/incomplete value remains separate from observed evidence.
- Every indexed App version records its exact catalog source, transport, URI/ref, snapshot digest, trust policy, and synchronization time. Catalog refresh removes only versions owned by that source, preserves mirrors from other sources, and rejects one semantic version resolving to different immutable digests.
- A tenant-scoped hosted marketplace registry stores publisher/app ownership, immutable signed versions, file digests, dependencies, connector requirements, presets, evaluation records, release signatures, and explicit private-catalog grants behind RLS. Its private delivery layer adds department/capability search, MFA-gated digest-addressed uploads, a private 100 MiB object bucket, leased service-role verification, safe rejection codes, crash reconciliation, and 60-second exact-release downloads. Raw signatures and standalone storage-key fields never cross the service boundary; the signed storage capability may contain its scoped path and expires after 60 seconds.
- In hosted mode, the browser server bridge merges RLS-visible metadata with official, local, and signed GitHub results without eagerly downloading artifacts. Opening, mapping, planning, or applying a hosted app stages only the selected exact version into a content-addressed cache after a second archive/file/signature verification, then invokes the existing governed App Platform service. Cached hosted releases are re-authorized before use, revoked/unshared identities are evicted, corrupt entries are rebuilt, immutable cross-source conflicts fail closed, and installation still cannot enable provider writes.
- Hermes MCP and managed CLI runners can use the hosted marketplace through short-lived ambient OIDC workload identity. The API requires tenant/project claims, a durable `marketplace.consume` grant, fresh replay metadata, rate limits, and organization visibility; it proxies one exact private archive without exposing service credentials or reusable object keys. The package re-verifies and atomically stages the release before invoking the existing app tools.
- Interactive terminals can use browser-approved device authorization without receiving a workload identity or Supabase cookie. Device/user codes and access/refresh credentials are stored only as hashes server-side; access lasts 15 minutes, refresh rotates, membership is checked on every request, the only grant is `marketplace.consume`, and the local credential profile is atomic, current-user-only, and never printed by status output.
- Hosted admins and owners have a paged, token-free human CLI session inventory. MFA-gated emergency controls revoke one device, one user's sessions, or every organization session in the exact tenant/project scope, while the revocation and immutable reason-digest audit event commit atomically.
- Production promotion now compiles staging readiness, hosted-marketplace isolation, snapshot-consistent recovery, and independently acknowledged audit-retention receipts into one content-bound manifest. The workflow attests that exact manifest with GitHub OIDC, reconstructs it in the protected production job, verifies the upstream digest and provenance, and only then promotes the same prebuilt deployment. Receipt freshness is rechecked against the actual promotion time; deployment origin, tenant/project, database identity, marketplace artifact, exact audit sequence/hash checkpoints, acknowledgement digest, and restored-table fingerprints all fail closed.

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
2. Apply the hosted user-quota migration and staging-only `admin` override, project the three
   short-lived user sessions into the protected runner, and run the supplied
   `staging-validation/v4` gate against the real database. The repository now compiles exact
   unauthenticated, cross-tenant, suspended-membership, and quota-saturation results into production
   promotion evidence; only the environment-specific live receipt remains external.
3. Configure a real independent audit-retention receiver and alert manager, then run the included
   protected audit drain, staging validation, and isolated backup/restore rehearsal on every target
   environment. The code now requires workload-authenticated export, a stable verified checkpoint,
   receiver receipt continuity, and an Ed25519-signed immutability acknowledgement; the repository
   cannot contain a receipt proving a customer storage account actually enabled WORM enforcement.
4. Register provider applications and use Hermes-owned credentials to execute the supplied OAuth,
   webhook/stream/detector, signature, and transformer contracts against live tenant accounts.
5. Consolidate the stacked implementation changes, apply the RLS migration to a real Supabase
   staging project, and complete clean-install plus hosted multi-user release audits.
6. Validate issuer rotation, device-code and request rate-limit saturation, refresh-token replay,
   cross-replica session/cache behavior, membership removal, and release revocation in staging.
   Durable workload grant revocation, cross-tenant denial, replay rejection, exact signed staging,
   and audit presence are already part of the executable marketplace gate.

## Key documentation

- [Hermes quickstart](./HERMES-QUICKSTART.md)
- [Local supervisor](./LOCAL-SUPERVISOR.md)
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
- [Hosted user API quotas](./USER-API-QUOTAS.md)
- [Operational audit and observability](./OPERATIONAL-AUDIT-OBSERVABILITY.md)
- [Hosted marketplace registry](./HOSTED-MARKETPLACE-REGISTRY.md)
- [Hosted marketplace delivery](./HOSTED-MARKETPLACE-DELIVERY.md)
- [Hosted marketplace installation](./HOSTED-MARKETPLACE-INSTALL.md)
- [Hermes-guided App onboarding journey](./APP-ONBOARDING-JOURNEY.md)
- [Department Packs](./DEPARTMENT-PACKS.md)
- [Company Blueprints](./COMPANY-BLUEPRINTS.md)
- [Hosted marketplace access for Hermes and CLI](./HOSTED-MARKETPLACE-WORKLOAD-ACCESS.md)
- [Interactive CLI device authorization](./CLI-DEVICE-AUTHORIZATION.md)
