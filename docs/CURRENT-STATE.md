# Loopgraph current build state

Last updated: 2026-08-23

## One-line summary

Loopgraph is a local-first governed control plane for Hermes Brain: it discovers recurring business problems, asks only for missing evidence, compiles validated LoopSpecs, validates normalized company-event routes, assigns live work to Hermes, records agent execution and outcomes, and evolves the company graph through accountable transactions.

## Implemented

### Hermes setup and discovery

- A clean local install starts with no demo loops.
- `loopgraph setup` now prepares the empty workspace, project-local Hermes contract, synchronized route manifest, and Studio plan through one safe path; `--activate` is explicit because it updates Hermes registrations.
- `loopgraph start` now owns the local Studio plus an exclusive, gracefully stopped supervisor for route synchronization, connector checks, measurement scheduling, route jobs, opportunity scans, app update checks, controller scheduling, and aggregate health. Component cadences prevent expensive reconciliation work from running at the fast worker poll rate, errors are secret-redacted, and status is atomically persisted for the Brain UI.
- `loopgraph hermes setup` creates project-local admin, webhook-router, and lifecycle-router MCP profiles plus Hermes skills.
- `loopgraph hermes setup --activate` applies those MCP registrations and installs the Loopgraph design plus isolated event-router skills from GitHub in one command after clone, failing with explicit recovery commands when Hermes cannot apply a step.
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

- Provider webhooks are planned to terminate at Hermes, which normalizes the event and submits one bounded routing decision. Loopgraph can now compile content-bound, secret-free desired state into a Hermes Route Controller request and verify an exact receipt for the route profile, restricted MCP tools, transformer, signature state, and provider subscription state. Local desired state remains project-portable through the registered LoopSpecs, App/connection projection, and synchronized route manifest. Hosted desired state instead comes from one tenant/project snapshot of the distributed LoopSpec registry, distributed App ownership and exact connection bindings, and the secret-free Hermes Connector Broker projection; a two-phase revision/digest check rejects concurrent drift, and no replica-local manifest is accepted as authority. Activation uses a projected workload token, stores only a validated secret-free receipt, permits additions/updates in shadow mode only, and never authorizes deletion or live execution. Local receipts use an atomic owner-private file; hosted receipts use an append-only organization/project/workspace-scoped Supabase ledger with RLS, revoked direct writes, and bounded audited RPC persistence. A workload-authenticated hosted boundary exposes the current plan and accepts only its exact confirmation digest; tenant, project, controller target, audience, outbound identity, stores, routes, connections, and receipt are server-derived. App readiness/onboarding, Management routing views, and hosted reconciliation use the same authority and receipt. A real Hermes controller deployment and provider-domain registration remain environment-specific.
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
- Connection reconciliation now distinguishes a synchronized local route manifest from an actually applied Hermes route. Provider routing remains blocked when the controller receipt is missing or stale, or when any exact route is still awaiting its connection, provider confirmation, signature verifier, transformer, or subscription. The Event Routing UI shows planned-only, pending, and exact applied route states, while trusted Hermes admin turns can read the same activation plan/status without receiving mutation authority.
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
- Pre-install onboarding is now genuinely resumable across Hermes restarts, CLI calls, browser refreshes, hosted handoffs, and replicas. One versioned draft stores only the complete selected preset/modules, declared App answers, and confirmed mapping IDs in the existing tenant-scoped revision-leased registry. App-ID-only CLI and browser reads omit empty overrides, resume a saved stack, present stack choice only when none exists, and redirect installed Apps to operation. An explicitly different preset produces an isolated preview with prior answers/modules/draft mappings excluded; replacing the saved preset requires exact-revision confirmation. Saving rejects stale writers, unknown keys, invalid value types, oversized values, and secret-shaped material. Explicit start-over is bound to the current draft identity and revision, receives a new identity on recreation, and leaves shared connections, mappings, approved context, installed assets, permissions, and runtime state untouched. Drafts grant no authority and are removed atomically when installation succeeds.
- Hosted onboarding save/reset mutations now append actor-attributed `app.onboarding_draft.saved` and `app.onboarding_draft.reset` events in the same revision/lease-fenced database transaction as the draft change. The strict 4 KiB audit envelope keeps only draft identity, revisions, SHA-256 App/preset identity digests, preset-change status, and bounded module/answer/mapping counts; setup answers, provider fields, tokens, credentials, mapping contents, and raw App/preset identifiers are excluded. Idempotent no-ops produce no mutation event.
- App activation now consumes the existing evidence ladder rather than treating it as a display-only score. One shared read-only gate tells Hermes, MCP, CLI, and browser whether shadow, recommend, or execute-with-approval is ready and why. Shadow requires connected maturity; recommend additionally requires passing, completely reviewed historical replay whose source window ended within 30 days; execute-with-approval requires production-proven completed-run, observed-outcome, and observed-value evidence whose source windows are also within 30 days, while every execute capability remains approval-bound. Evidence more than five minutes in the future fails closed. New historical runs retain the structured source window, while older records use their existing bounded-window evidence reference. New version-2 approvals embed the canonical gate snapshot and activation re-evaluates it before one-time consumption. Legacy approvals remain readable but cannot authorize a transition.
- Hosted App activation authority is audited at both boundaries. Creating a content-bound, gate-bearing receipt appends `app.activation.approved`; consuming it while changing the installed state appends `app.activation.consumed`. Each event commits atomically with the exact registry revision and retains only the accountable actor, receipt identity, hashed App/installation identities, pinned artifact and approval digests, source state, requested mode, expiry, and operator-supplied evidence count. The approval digest binds the full authoritative gate-bearing receipt. Approval reasons, evidence references, provider data, credentials, and raw App/install identifiers do not enter the audit chain.
- App activation now has a durable cross-store recovery protocol. Loopgraph journals the exact approval receipt/digest, artifact, source state, target mode, actor, and owned LoopSpec inventory before changing routing state. A worker or registry-commit interruption leaves the operation visibly reconcilable, blocks competing lifecycle work, and gives Hermes and the browser one exact retry. Recovery can finish after receipt expiry only when the journal proves the attempt started while authority was valid; topology drift fails closed, successful completion consumes authority once, and completed retries do not create another revision or audit event.
- App modules now control the compiled and materialized backend composition. Only core assets and selected-module loops are installed; exclusive skills, routes, metrics, permissions, graph nodes, and edges are removed with their loop. Shared skills required by active loops remain present, module dependencies are enforced, empty compositions fail closed, and synthetic evaluation rewrites disabled-loop expectations to prove that Hermes leaves those routes unhandled. A reviewed module overlay atomically rematerializes the LoopSpecs and asset ownership, removes disabled loops, and resets the App to write-blocked testing; new permissions or connector requirements require a fresh install plan.
- Browser duplication now completes its handoff instead of leaving the operator on the upstream App. The action derives the actor from the authenticated session, validates the returned private installation identity, revalidates the App/company graph views, and redirects to that exact installation. The derived view uses its private App ID, exposes upstream version/provenance, and supplies a bounded Hermes capture → preview → validate → sign → private-publish prompt that explicitly blocks signing or publishing until the final artifact and permission plan is approved.
- Private-App detach now prepares an actor-bound, metadata-only recovery contract before copying anything. It binds the exact source artifact/revision, installation and ownership digests, unchanged owned LoopSpec inventory, confined snapshot path, verified snapshot artifact digest, and deterministic detached installation. Snapshot bytes move through operation-owned staging and are verified before atomic promotion; exact retries survive unrelated workspace revisions, reject source or owned-topology drift, and return the original receipt without copying secrets or creating another registry revision.
- Installed-App promotion in the browser now obeys the runtime's two-step receipt contract. An authenticated operator must enter a reason, explicitly confirm the exact shadow/recommend transition, and pass hosted step-up authentication before Loopgraph records a 15-minute content-bound approval. The refreshed page exposes a separate activation action only for an unconsumed receipt matching the current workspace installation, App, artifact, state, and mode; the runtime revalidates and consumes that exact receipt atomically.
- Nine generated Department Packs give every official department a curated App topology with an explicit default App, dependency-safe install order, shared company-context keys, shared logical capabilities, and typed cross-App handoffs. Hermes, MCP, CLI, and browser read the same catalog and current installation progress. Packs never bulk-install or activate Apps; every App retains its own governed onboarding and approval boundaries.
- The generated SaaS Company Operating System Blueprint composes all nine Department Packs beneath one Hermes Brain, defines seven canonical company object contracts, and declares conditional cross-department evidence handoffs and learning returns. Hermes, MCP, CLI, and browser expose the same read-only company topology, current Pack/App progress, and one dependency-safe next Pack. The Blueprint grants no routing, installation, activation, or provider-write authority.
- Signed GitHub catalog taps synchronize only from an allowlisted HTTPS Git host and require an exact commit, canonical catalog snapshot digest, and pinned Ed25519 publisher keys. Remote content is validated in staging before atomic cache promotion and never installs or activates an app by itself.
- App publishers can now run a declarative developer inventory and write-blocked synthetic preview before validation, signing, packing, or publishing. The preview exposes the compiled Hermes graph plus every expected and actual routing decision, abstention, deferral, and approval requirement without installing the pack, invoking providers, or executing pack code.
- Marketplace discovery cards now expose immutable included-loop counts, required and optional capabilities, compatible stack counts, evidence-derived maturity, publisher, artifact trust, and historical-preview readiness. A catalog signature proves origin but never upgrades maturity: releases without exact digest-bound conformance evidence remain `concept`, while `tested` shows the passing scenario count from a zero-write receipt. The historical state is derived from installation, connection readiness, and passing synthetic or replay evidence; an installed result opens the installed App rather than returning to its Marketplace detail.
- Every Marketplace App detail now explains the accountable team, business problem, Hermes behavior, included loops, declared output metrics, setup questions, permissions, compatible stacks, graph topology, proof modes, explicit limitations, maturity, immutable version provenance, deprecation history, and packaged changelog. Synthetic and sample previews are distinguished from historical read-only replay; the latter is shown as available only for an installed App with a passing connection-readiness check.
- Installed Apps now show a four-gate operational maturity assessment tied to the pinned artifact: tested, connected, production proven, and Loopgraph verified. Production proof requires reviewed historical decisions plus durable completed-run, observed-outcome, and observed-value references; mere activity is insufficient. Each proof timestamp must bind one of those exact App-owned references, stay within the shared 30-day horizon, and avoid excessive future clock skew. Expired proof automatically lowers maturity to connected, which also prevents an old independent-verification receipt from preserving Loopgraph-verified status. The final verification gate accepts only a content-bound Ed25519 receipt whose verifier key is explicitly trusted and not revoked. The page exposes the evidence and the exact remediation for every blocked gate.
- Operational maturity is now a shared Hermes/runtime service rather than browser-only derivation. `loopgraph_app_maturity_get` joins exact-digest evaluations, current readiness, App-owned completed Hermes runs, observed outcomes/value, and workspace verification state. Its v1alpha2 response gives Hermes, CLI, and browser consumers one ordered evidence clock with each proof status, the earliest valid-until time, and a seven-day renewal recommendation; the installed-App page exposes those details before maturity expires. Admin tools and matching CLI commands add approved public verifier trust, revoke it with accountable references, and verify/import exact-installation receipts. The local registry is atomic, workspace-bound, `0600`, and never accepts verifier private keys.
- App proof renewal is now actionable across a tenant fleet instead of visible only one installation at a time. `loopgraph_apps_renewal_plan` batch-joins App-owned run, outcome, value, replay, readiness, and verifier evidence once; reports complete counts for `not_applicable`, `incomplete`, `current`, `renew_soon`, `expired`, and `invalid`; ranks at most 100 results by deterministic urgency; and returns an exact setup, replay, operating-evidence, repair, renewal, or monitoring action. The tool is read-only and shared by Hermes/MCP, CLI, and the Installed Apps overview. It never invokes providers or turns a recommendation into authority.
- The local supervisor now evaluates App updates and fleet proof freshness in one hourly component. Invalid evidence blocks aggregate supervisor health; expired or renew-soon proof degrades it; incomplete proof remains an honest maturity gap without making a healthy new installation look broken. The owner-private status projection retains bounded fleet counts and the first exact renewal action, and recommended actions hand that work to Hermes without starting replay, creating approval, promoting an App, or calling a provider.
- Hosted App evidence health now has an executable, no-write staging validator rather than a manual checklist. It proves unauthenticated and cross-tenant denial, workload request replay rejection, exact workspace and clock binding, a strict aggregate-only response, complete status-count invariants, exact parity with protected Prometheus gauges, all six fixed evidence-classification outcomes through the same core function used by hosted operations, and the accepted schedule request inside a separately authorized verified audit checkpoint. It reads separate schedule and observability workload JWTs only from projected `0600` files and emits a secret-free `hosted-app-evidence-health-staging-validation/v3` receipt. The environment-specific run remains external evidence.
- Hosted operations now evaluate that same versioned fleet proof contract on every protected metrics snapshot and through an hourly `schedule.app_evidence_health` job. Prometheus receives tenant-aggregate invalid, expired, renew-soon, incomplete, current, not-applicable, returned-item, and truncation gauges without App IDs or provider data. Evidence drift degrades operations while an unavailable, malformed, cross-workspace, stale, or future-dated projection fails readiness closed; neither scraper nor scheduler can execute the recommended action.
- Hosted verification trust and receipts now use an organization/project/workspace-scoped Supabase store behind the same runtime contract. Its tables are RLS-enabled and service-role-only; bounded trust, revoke, and import functions enforce immutable identities and append accepted changes to the tamper-evident security audit chain. Hosted resolution fails closed when the distributed store is unavailable rather than writing verification authority to ephemeral deployment disk.
- The App verification registry is now available through a read-only Hermes/MCP/CLI tool and a dedicated Settings console. Admins can add reviewed Ed25519 public keys, import signed exact-artifact receipts, and revoke trust; hosted mutations require `integrations.manage` plus step-up authentication and derive the actor from the session. The UI displays fingerprints rather than full key material, while shared validation rejects private-key PEM input before persistence.
- Hosted App installation state now resolves through the same shared runtime contract to a tenant/project/workspace-scoped Supabase registry. Revision-bound database leases serialize lifecycle mutations across serverless instances, the registry and lock commit together through bounded service-role RPCs, and accepted revisions enter the tamper-evident audit chain. Hosted App calls use the server-derived project key as workspace/company identity, browser mutations derive their actor from the authenticated session, and generated LoopSpecs materialize through the distributed LoopSpec registry. Detached private App artifacts use immutable, tenant-scoped objects in a private Supabase Storage bucket and verified per-replica caches instead of deployment-local authoritative files; database or snapshot-store unavailability fails closed.
- Install and uninstall now prepare a bounded, metadata-only lifecycle recovery record before changing LoopSpecs, connector-field-mapping ownership, or approved company-context ownership. Exact retries reuse the same materialization receipt and idempotent ownership mutations, then complete the operation with the installation-registry commit; conflicting lifecycle work is blocked while recovery remains outstanding. App status and the audit chain expose the operation and status without persisting provider payloads, credentials, or raw failure text.
- Hosted observability aggregates unfinished App lifecycle operations by tenant/project into protected
  Prometheus counts and age. Interrupted work marks operations degraded immediately; stale work
  raises the production alert contract without making otherwise healthy workers fail public
  readiness. The snapshot never emits App IDs, installation IDs, actors, or owned-resource names.
- The shared onboarding contract now promotes unfinished install, activation, pause, resume, configure, overlay, update, rollback, and uninstall work to a `recover_lifecycle` stage with affected resource counts and one accountable exact-retry boundary. Hermes instructions, the Installed Apps list, and Installed App detail use that same state; ordinary lifecycle/runtime controls are suppressed or rejected until recovery completes.
- Installed App readiness and activation now consume the exact Hermes Route Controller receipt rather than treating a synchronized local manifest as runtime proof. Each App is matched to event routes through its owned Loop IDs. Provider-agnostic routes specialize to the exact provider connections selected during installation, while Hermes- and Loopgraph-generated business events use internal routes without fake provider subscriptions. Missing manifest coverage, a stale receipt, absent authentication verification, or a required provider subscription that is not active blocks connected maturity and approval creation. Unrelated pending routes do not block the App. Hosted App tools, Management operations, and measurement reconciliation use the same tenant-scoped distributed receipt and fail closed when hosted persistence is unavailable; they do not silently read an ephemeral replica file. The shared onboarding journey proactively moves from conformance to manifest synchronization, controller-plan preparation, and only then an accountable shadow approval.
- App installation planning now resolves each logical capability through its immutable Connector Recipe to an exact bounded Connector Broker or governed Loopgraph runtime operation. Required scope and authority checks use the broker descriptor as well as the recipe, so a self-claimed connection cannot make an unsupported operation ready. Applied installations persist the secret-free operation contract through update and rollback; readiness and operational maturity require it, while older label-only installations fail closed and ask for a fresh plan. Default Product, Sales, and Marketing presets have required-operation conformance coverage.
- Hermes now has a read-only, installation-scoped operation resolver. The caller supplies only an installation ID, owned loop ID, and logical capability; Loopgraph derives the pinned artifact, active LoopSpec hash, exact provider/runtime binding, permission, scopes, and connection. It blocks undeclared cross-loop capabilities, inactive or recovering Apps, unresolved permissions, and changed connection bindings, and returns a five-minute content-digested `invoke_read`, `invoke_loopgraph_runtime`, `prepare_action`, or `blocked` disposition. It does not accept provider IDs, operations, URLs, headers, or credentials and does not execute the resolved operation.
- Installed Connector Broker bindings now have an executable Hermes bridge. The workload supplies only installation, owned loop, logical capability, durable route job, registered agent, call identity, and bounded input. Loopgraph re-resolves the operation, verifies the exact active LoopSpec hash, fresh capable assigned agent, event/problem company object, tenant, environment, scopes, and current healthy Broker projection, then derives the Broker envelope server-side. Reads execute through the allowlisted operation; writes stop at a fingerprint-bound prepared action for separate approval and commit. The workload-authenticated API requires a dedicated tenant-scoped `hermes.app_operations` grant, derives the machine tenant without a browser session, rejects caller-selected providers, operations, connections, tenants, URLs, workspace identities, and project roots, and fails secret-shaped input before the Broker.
- The same route-bound executor now supports a fixed governed Loopgraph runtime registry for `graph.read`, `routing-decisions.read`, and `outcomes-value.read`. The handlers return only bounded topology summaries, provider-payload-free routing decisions, and tenant-filtered observed outcome/value records; they use strict operation-specific schemas, content-digested results, central secret rejection, and no dynamic code, filesystem path, SQL, URL, or write authority. Internal reads work without configuring an external provider Broker. Graph-change proposals continue through the separate semantic graph review/transaction path.
- Every provider action prepared through an installed App now creates a second durable, secret-free ownership record before invocation returns. It binds the Broker action and receipt to the exact workspace/company, installation and artifact digest, active LoopSpec version, logical capability, route job, assigned Hermes agent, provider binding, environment, and company-object identity digest without copying canonical provider input. Local storage is atomic and `0600`; hosted storage is tenant/project/workspace-scoped, RLS-enabled, direct-write-revoked, size-bounded, idempotent, and audited through a service-role-only RPC. The read-only `loopgraph_app_operation_actions_get` tool and Installed App operations view expose the same installation-filtered records and render prepared actions plus approval gates in the operating topology. This ledger proves preparation ownership only; it does not approve or commit a provider write.
- Hosted App administrators can approve an exact App-owned prepared action without supplying provider identity, connection, operation, Broker action ID, or fingerprint. The server re-derives those fields from the immutable action and current pinned installation, requires MFA step-up, and appends receipt-bound lifecycle evidence while leaving execution to a separate Hermes commit boundary.
- Hosted App administrators can also revoke one exact prepared or approved action without disconnecting the provider. The server re-derives its Broker identity, atomically revokes the prepared action and unused Connector approvals, records only a reason digest in the App ledger, and blocks every later Hermes commit attempt.
- The assigned Hermes route now has a separate narrow App action commit tool and workload-authenticated API. It accepts no provider-facing fields, reloads the immutable action plus unexpired approval, re-resolves the pinned App operation, and revalidates the route, LoopSpec, company object, agent assignment, connection, environment, scopes, Broker action, and fingerprint before deriving the commit. Append-only requested/succeeded/failed events reference the Connector Broker receipt without copying canonical provider input.
- Interrupted App commits now have a separate receipt-only reconciliation path. The assigned Hermes route names only the App action, route, agent, and reconciliation call; Loopgraph re-derives the Broker identity and asks for the original idempotency receipt. A matching response appends terminal App evidence without invoking the provider again, while pending and unresolved outcomes remain visibly nonterminal and block replacement work.
- Hosted App commit recovery is scheduled every five minutes behind its own machine capability. The bounded worker discovers only old, nonterminal `commit_requested` events, uses stable reconciliation identities, skips revoked/finished work, and returns secret-free counts while reusing the same no-provider-call boundary as Hermes.
- Production promotion evidence now consumes the protected aggregate action-reconciliation metrics. The `staging-validation/v5` receipt requires zero pending/stale App commits, records only bounded counts and the reviewed stale threshold, and the production evidence compiler rejects older receipts or any nonterminal action backlog.
- The release workflow now runs a no-network, no-credential App action fault-injection proof against the real Connector Broker state machine. It models a lost terminal App-ledger write, resolves the original durable receipt, replays the commit, and blocks the `loopgraph-production-promotion-evidence/v16` manifest unless the fixture handler ran exactly once and the receipt is bound to the promoted source commit.
- Hosted detached-App reconciliation now closes both inventory directions. It first uses a service-role-only catalog attestation to prove the exact registry and private-bucket triggers are installed with their full unconditional row-level event masks in the deployed Supabase project, and independently pins the generation and attestation function bodies, owners, hardened search paths, and effective execute capabilities. It then verifies current registry authority against exact immutable archives, inventories the exact tenant/project Storage prefix back to those registries, and requires two identical full passes within a bounded stability window so offset pagination cannot silently miss a concurrent detach. Registry and private-bucket triggers transactionally advance one durable tenant/project generation whenever authoritative registry payloads or archive objects change; every pass reads it before the registry and after the final Storage page, and both accepted passes bind the same generation. It rejects malformed objects and binds intentionally retained unreferenced archives to an independently reviewed opaque digest. The pinned origin is verified before privileged credentials are read, the release compiler rechecks the live-fence and retention digests, receipts expose counts and digests only, and no archive is deleted automatically.
- Production evidence now binds the separate active staging mutation-fence receipt. The compiler independently reconstructs its scope from the validated Storage origin, lowercase organization UUID, and reserved probe namespace; requires the exact eight registry/Storage mutation and cleanup controls; rechecks freshness during production approval; and includes the complete receipt digest in `loopgraph-production-promotion-evidence/v16`.
- The protected snapshot staging job now actively rehearses that fence in a random reserved project scope. It proves registry insert/update/delete and Storage upload/replace/delete each advance generation, removes the probe registry and object, deletes the synthetic generation row, and exposes only eight booleans plus the pinned staging scope digest. The probe is never part of local startup or production reconciliation and refuses to run without an explicit staging mutation confirmation.
- The protected release workflow now runs the hosted learning/entity staging probe with two independent Supabase clients in a random reserved project scope. It proves one-winner measurement claims, stale-lease rejection, cross-client finalization visibility, canonical JSONB replay, immutable metric/outcome/value conflicts at the database boundary, canonical-entity visibility, single-owner provider aliases, and exact evidence/entity/alias cleanup. Cleanup is authorized by a short-lived one-time nonce only after the scope is proven empty; the authority is consumed atomically, and a bounded expired-run sweeper can recover an interrupted probe without granting a general reserved-prefix delete primitive. The protected job reads the service role only from a projected `0600` file after the bare HTTPS origin and independently pinned scope digest pass, emits nine booleans without probe identities, nonce, or payloads, and never runs during local startup or live request handling. Evidence compilation and production verification independently reconstruct its `learning_probe` scope, require the exact nine controls and freshness, and bind the complete receipt into `loopgraph-production-promotion-evidence/v16`.
- Production promotion now requires the protected hosted App evidence-health staging receipt. The release compiler independently rechecks its exact deployment origin, tenant/project, clock window, eight controls and statuses, fleet-count coverage, derived health, schedule/metrics parity, the exact six-case classifier rehearsal, and accepted-request audit checkpoint; the external retention drain must prove that exact checkpoint before production verification re-reads the immutable artifacts. `loopgraph-production-promotion-evidence/v16` includes aggregate proof-state counts, bounded audit identity, classifier case count, and receipt digest, never App identities, provider data, actions, or workload tokens.
- App rollout now changes executable graph state as well as installation metadata. Activation revision-binds and synchronizes every LoopSpec owned by the installation to shadow, recommend, or execute-with-approval; pause moves the owned graph back to shadow and resume restores the last approved mode. Each pause/resume transition is journaled first with its exact source and target state/mode, pinned artifact, actor, and owned loop inventory. A worker interruption therefore exposes one exact recovery action instead of leaving the App registry and executable graph silently split. Missing or changed owned specs, a competing actor, or a changed transition fails closed; completed retries are revision-stable, while a later pause/resume cycle receives a new graph transaction identity.
- App uninstall recovery now binds the complete source-installation and ownership digests, source workspace revision, exact pre-removal and permitted shared post-removal LoopSpec inventories, accountable actor, and normalized reason digest before any destructive side effect. The recovery journal stores no raw reason. A retry accepts only the original actor and exact reason and fails closed on source, ownership, or topology drift; legacy unfinished removals without the stronger binding require administrator reconciliation.
- App duplication now uses the same prepared/materialized/completed recovery discipline across the installation registry, namespaced LoopSpec registry, shared field-mapping consumers, and approved company-context consumers. The request is bound to the exact source artifact and revision, source installation/ownership/mapping digests, accountable actor, private App ID, overlay digest, deterministic derived installation/ownership, and exact target LoopSpec inventory. Lost responses return the original receipt; substituted inputs or a third target topology fail closed.
- App rollback recovery now journals the exact source installation, ownership graph, prior revision, source workspace revision, accountable actor, and source/target LoopSpec inventories before rematerializing anything. A worker may stop after the target LoopSpecs commit and later resume against that exact target without duplicating the App lifecycle receipt. A third topology, changed owner set, stale installation, different actor, or substituted target fails closed; Hermes and the browser expose the exact recovery request while competing lifecycle work stays blocked.
- App update recovery now journals the exact reviewed plan digest, normalized permission approval set, accountable actor, source installation and ownership digests, source workspace revision, target installation and ownership digests, and source/target LoopSpec inventories before materialization. A prepared exact update may finish after its original plan window expires, but a replacement plan, different actor or approvals, changed ownership, stale installation, or third topology fails closed. Completion binds one lifecycle receipt to the journal, exact replay returns it without another revision, and a later update cycle receives a new identity.
- App configure now has exact request and replay authority. Before applying confirmed values, Loopgraph journals only the accountable actor, source installation/configuration digests, submitted-values digest, and deterministic target digests. It never copies values into lifecycle metadata. An interrupted commit blocks replacement mutations; the original values, prior digest, and actor resume once, exact replay returns the same receipt without another revision, and a later configure cycle gets a distinct identity.
- App overlay now has exact cross-store request and replay authority. Before rematerializing owned LoopSpecs, Loopgraph journals the accountable actor, pinned artifact, prior overlay revision, source installation and ownership digests, source workspace revision, submitted-operations digest, deterministic target installation/ownership digests, and exact source/target LoopSpec inventories. It never copies overlay operations into lifecycle metadata. Recovery accepts only the recorded source or already-materialized target topology; substitutions, stale state, ownership drift, and competing lifecycle work fail closed. Exact replay returns one receipt without another revision, and a later overlay cycle gets a distinct identity.
- App repair now has exact cross-store recovery authority. It journals the actor, pinned artifact, full source installation and ownership digests, source workspace revision, exact registered loop IDs, an observed inventory that can represent missing or unreadable generated specs, and deterministic regenerated installation, ownership, and LoopSpec digests before touching the graph. Recovery accepts only the recorded pre-repair or regenerated topology, always returns to simulation, and completes one replayable receipt. Browser repair submissions carry the exact source artifact and revision; Hermes receives the same bounded retry input from onboarding.
- App cross-store recovery no longer deadlocks when an unrelated App advances the company-wide LoopSpec workspace revision. Update, rollback, overlay, repair, and uninstall retain the original revision as evidence, re-prove the exact installation-owned LoopSpec IDs and version hashes, then commit against the freshly observed revision. A mutation racing after that read still fails optimistic concurrency, and any change to the owned inventory still requires administrator reconciliation.
- Hosted App provider-schema metadata and confirmed field mappings now resolve through tenant/project/workspace-scoped Supabase stores shared by Hermes, browser onboarding, and installation planning. Provider sample values are stripped before persistence, secret-shaped and sample-bearing payloads are rejected again in SQL, direct client writes are revoked, mapping ownership survives reuse and is released on uninstall, and accepted metadata changes append security-audit events. Hosted resolution fails closed instead of using deployment-local mapping files.
- Approved company context now has shared Hermes/MCP read and explicit-approval tools plus tenant/project/workspace/company-scoped Supabase persistence. Hermes inference cannot verify itself: an accountable operator must approve the exact proposal against the current revision. Declared types, tenant identity, bounded collection sizes, secret scanning, optimistic concurrency, consumer ownership, and audit-chain recording are enforced. Installation apply rejects context that changed after planning and attaches the installed App as a consumer; hosted resolution fails closed without the distributed store.
- Every Installed App now has an installation-scoped operations view and bounded operating topology. It joins recent incoming events, Hermes routes, business problems, agent tasks, tool calls, approval counts, failures, durable outcomes, human-labeled routing quality, review minutes, and value-ledger records only through the exact runtime loop IDs owned by that installation. The topology preserves the required Hermes Brain → accountable department → Installed App → owned loops hierarchy, adds at most the latest source/agent/run/approval/outcome evidence per loop, returns outcome evidence to Hermes visually, and links recorded runs and waiting decisions to their durable trace/review surfaces. Empty or unrelated global records remain excluded, and modeled/incomplete value remains separate from observed evidence.
- Every indexed App version records its exact catalog source, transport, URI/ref, snapshot digest, trust policy, and synchronization time. Catalog refresh removes only versions owned by that source, preserves mirrors from other sources, and rejects one semantic version resolving to different immutable digests.
- A tenant-scoped hosted marketplace registry stores publisher/app ownership, immutable signed versions, file digests, dependencies, connector requirements, presets, evaluation records, release signatures, and explicit private-catalog grants behind RLS. Its private delivery layer adds department/capability search, MFA-gated digest-addressed uploads, a private 100 MiB object bucket, leased service-role verification, safe rejection codes, crash reconciliation, and 60-second exact-release downloads. Raw signatures and standalone storage-key fields never cross the service boundary; the signed storage capability may contain its scoped path and expires after 60 seconds.
- In hosted mode, the browser server bridge merges RLS-visible metadata with official, local, and signed GitHub results without eagerly downloading artifacts. Opening, mapping, planning, or applying a hosted app stages only the selected exact version into a content-addressed cache after a second archive/file/signature verification, then invokes the existing governed App Platform service. Cached hosted releases are re-authorized before use, revoked/unshared identities are evicted, corrupt entries are rebuilt, immutable cross-source conflicts fail closed, and installation still cannot enable provider writes.
- Hermes MCP and managed CLI runners can use the hosted marketplace through short-lived ambient OIDC workload identity. The API requires tenant/project claims, a durable `marketplace.consume` grant, fresh replay metadata, rate limits, and organization visibility; it proxies one exact private archive without exposing service credentials or reusable object keys. The package re-verifies and atomically stages the release before invoking the existing app tools.
- Interactive terminals can use browser-approved device authorization without receiving a workload identity or Supabase cookie. Device/user codes and access/refresh credentials are stored only as hashes server-side; access lasts 15 minutes, refresh rotates, membership is checked on every request, the only grant is `marketplace.consume`, and the local credential profile is atomic, current-user-only, and never printed by status output.
- Hosted admins and owners have a paged, token-free human CLI session inventory. MFA-gated emergency controls revoke one device, one user's sessions, or every organization session in the exact tenant/project scope, while the revocation and immutable reason-digest audit event commit atomically.
- Human CLI refresh rotation now retains prior generations only as private, expiry-bounded SHA-256
  digests. Reuse of any replaced generation locks and revokes the current session family, records one
  digest-free tenant audit event, appears in the safe admin inventory, and removes the rejected local
  profile. Random invalid tokens remain indistinguishable and generate no audit amplification.
- Human CLI deployment behavior now has an executable two-replica staging drill. It proves the fixed
  device-issuance ceiling, polling slowdown, two cross-replica refresh rotations, stale metadata
  denial, suspended membership, pre-revoked session denial, a bounded shared request-rate window,
  prior-generation family revocation, and the exact accepted request in the verified audit chain.
  Returned credentials remain process-local; the receipt is aggregate and secret-free.
- The protected release chain now runs that CLI drill as its own `cli-session-staging` trust
  boundary. The external retention drain proves the accepted CLI request as a fourth named audit
  checkpoint, while the separate administrator drill adds a fifth exact revocation checkpoint. It
  emits `audit-drain/v8`, and the v16 production manifest rechecks both distinct origins,
  tenant/project, freshness, ten exact controls/statuses, bounded rate policy, family revocation,
  and the full receipt digest before the prebuilt deployment can be promoted.
- The separate CLI administrator staging validator now proves the deployed MFA boundary with one
  AAL1 denial and one AAL2 exact-session revocation. It confirms the disposable session remains
  revocable after denial, projects the committed revocation through the token-free inventory, denies
  the revoked CLI token, and finds the exact correlation/target/reason digest in the verified audit
  chain. The protected `cli-admin-staging` job validates and retains that receipt, the external
  drain proves its fifth audit checkpoint, and the v16 promotion manifest rechecks and binds the full
  receipt. Its output excludes browser sessions, user identities, CLI tokens, and the target session ID.
- Hosted readiness and protected Prometheus metrics now consume a tenant/project-scoped,
  service-role-only CLI security projection. It separates active, refresh-required, expired, and
  revoked sessions; reports recent refresh replay, impossible unrevoked replay families, pending
  device-flow age, and no identities or credential digests. Contained replay degrades operations for
  review; an unrevoked replay or unavailable projection fails readiness closed. The v2 SLO contract
  assigns both conditions to the security runbook.
- Production promotion now compiles staging readiness, hosted-marketplace isolation, snapshot-consistent recovery, and independently acknowledged audit-retention receipts into one content-bound manifest. The workflow attests that exact manifest with GitHub OIDC, reconstructs it in the protected production job, verifies the upstream digest and provenance, and only then promotes the same prebuilt deployment. Receipt freshness is rechecked against the actual promotion time; deployment origin, tenant/project, database identity, marketplace artifact, exact audit sequence/hash checkpoints, acknowledgement digest, and restored-table fingerprints all fail closed.
- Hosted App snapshot activation now has a dedicated protected staging gate. It proves the real
  bucket is private and bounded, exercises authenticated read/insert/update/delete denial, replays
  one first-writer upload, recovers the exact LoopPack through a second empty replica cache, and
  verifies cleanup. Its content- and Storage-origin-bound receipt is a mandatory input to the
  production promotion manifest; only a private projected service-role file enters the gate.
- Hosted App snapshot recovery now has a separate cross-origin rehearsal. It uses distinct projected
  source and target service roles, an explicit reviewed target origin, and a random exact probe to
  prove export, immutable restore, clean-target loading, source preservation, and exact cleanup. The
  secret-free receipt is required by promotion and must match both the validated source Storage
  origin and the same signed App payload; PostgreSQL recovery is no longer presented as proof of
  external detached-App bytes.
- Current detached Apps now carry their complete immutable snapshot descriptor instead of depending
  on a bounded lifecycle journal for recovery. A protected scheduled tenant/project reconciliation
  verifies every archive through the signed LoopPack loader, fails on missing, corrupt, untracked,
  or unavailable recovery authority, and retains only aggregate health evidence.
- Production promotion now requires a second fresh reconciliation receipt bound to the exact
  validated Storage origin and marketplace tenant/project. The v16 manifest rejects scope
  substitution, incomplete controls, empty inventory without explicit policy, every non-zero
  failure class, and stale evidence. The release workflow is repository-dispatch-only so the
  credential-bearing chain always resolves from the protected default branch.
- Every third-party action in that release chain is now pinned to an immutable commit, and all jobs
  explicitly check out the dispatch SHA with persisted Git credentials disabled. Mutable action
  tags can no longer change staging, evidence, attestation, or promotion behavior between reviews.

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
- Workload issuer rotation no longer waits for the cached JWKS TTL. A new key ID or a same-ID key
  replacement triggers one bounded refresh; each verifier deduplicates concurrent loads, caps and
  validates key documents, rejects redirects and fetch failures, and throttles attacker-controlled
  misses.
- A protected issuer-rotation staging validator now drives one disposable previous/next key through
  a fixed two-operation controller protocol, observes the live old-only, overlap, and new-only JWKS
  states, exercises two deployed origins, waits beyond the verifier's five-minute maximum cache
  lifetime, proves retired-key denial and continued next-key acceptance, and finds the final request
  in the verified tenant audit chain. The secret-free receipt stores only public identity plus
  controller-receipt digests. Its protected workflow is implemented, the external retention drain
  binds it as the seventh exact checkpoint in `audit-drain/v8`, and the v16 production manifest
  independently pins and rechecks its issuer/JWKS/rotation/key scope.
- Hosted marketplace release deprecation and revocation now cross an MFA-gated API and a separate
  service-role RPC. The database rechecks active administrator ownership, permits only monotonic
  lifecycle transitions, and commits the exact transition with a reason digest in the append-only
  tenant audit chain. The older direct authenticated RPC path is revoked, so clients cannot bypass
  the step-up and audit boundary.
- A destructive, disposable-release staging validator now proves that boundary end to end. It
  verifies and caches one exact active signed release, proves AAL1 denial does not mutate it, uses
  AAL2 to revoke it, re-authorizes through the workload API, proves exact cache eviction, and finds
  the correlated active-to-revoked event in the verified audit chain. Its secret-free receipt is
  implemented. The protected job serializes behind the CLI administrator drill, validates the exact
  six controls, and contributes a sixth sequence/hash checkpoint to `audit-drain/v8`. The v16
  promotion manifest independently pins the disposable artifact digest and rechecks the complete
  receipt. Only the first environment-specific execution remains external.
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

The repository now also includes a Hermes-native distribution boundary at `integrations/hermes-plugin`. It provides direct GitHub installation through `hermes plugins install mrrkrieg/loopgraph/integrations/hermes-plugin --enable`, an official-Doctor-compatible manifest, bundled design and isolated event-router skills, a read-only install plan, an exact-revision and package-lock-bound runtime bootstrap, and Hermes-native plan/install/doctor/start/webhook commands. Registration performs no disk or network work, and the provider credential boundary is unchanged.

1. Apply the evidence/entity/probe migrations to each staging environment, configure the protected
   `learning-entity-staging` runner and independently pinned scope digest, and produce the first
   environment-specific receipt through the now-mandatory release gate. Isolated database restore
   proof remains part of the separate recovery rehearsal.
2. Apply the hosted user-quota migration and staging-only `admin` override, project the three
   short-lived user sessions into the protected runner, and run the supplied
   `staging-validation/v5` gate against the real database. The repository now compiles exact
   unauthenticated, cross-tenant, suspended-membership, and quota-saturation results into production
   promotion evidence together with a zero-pending/zero-stale App action reconciliation checkpoint;
   only the environment-specific live receipt remains external.
3. Configure a real independent audit-retention receiver and alert manager, then run the included
   protected audit drain, staging validation, and isolated backup/restore rehearsal on every target
   environment. The code now requires workload-authenticated export, a stable verified checkpoint,
   receiver receipt continuity, and an Ed25519-signed immutability acknowledgement; the repository
   cannot contain a receipt proving a customer storage account actually enabled WORM enforcement.
4. Register provider applications and use Hermes-owned credentials to execute the supplied OAuth,
   webhook/stream/detector, signature, and transformer contracts against live tenant accounts. Deploy
   the narrow Hermes Route Controller endpoint, bind its workload-identity audience, and produce the
   first real `hermes-route-controller-receipt/v1alpha1`; Loopgraph now validates and stores that
   receipt but cannot manufacture evidence for an external Hermes gateway.
5. Consolidate the stacked implementation changes, apply the RLS migration to a real Supabase
   staging project, run the App snapshot staging gate, and complete clean-install plus hosted
   multi-user release audits. The executable gate is present; the environment-specific receipt
   remains external.
6. Configure the protected `cli-session-staging` runner with two real replica origins and disposable
   session projections, then produce the first deployment-specific CLI receipt through the now-mandatory
   release gate. Run issuer rotation against the real identity provider, MFA administrator
   controls, and hosted App release revocation as separate staging drills.
   The verifier now handles new-`kid` and same-`kid` rotation immediately with a deduplicated,
   throttled, fail-closed JWKS refresh. Refresh-token reuse now revokes its current family and enters
   the audit chain atomically. Durable workload grant revocation, cross-tenant denial, request replay
   rejection, exact signed staging, and audit presence are already part of the executable marketplace
   gate. The CLI-session matrix, exact workflow validator, seven retained audit checkpoints, and v16
   promotion binding are implemented. The bounded live issuer-rotation validator and its protected
   workflow/promotion binding are implemented; its first environment-specific receipt,
   first live MFA administrator-control receipt, first live release-revocation receipt,
   migration application, and real alert delivery remain external. The aggregate CLI security
   projection, v2 SLO/runbook contract, and bounded MFA staging validator are implemented in the
   repository.
7. Configure the protected App evidence-health staging workload identities and run
   `validate:app-evidence-health-staging` against each deployed environment. The executable gate is
   present; only the first deployment-specific receipt remains external. The gate now runs the
   invalid, expired, renew-soon, incomplete, current, and not-applicable classification rehearsal
   without tenant data or mutation authority.

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
- [Hosted learning and entity staging gate](./HOSTED-LEARNING-ENTITY-STAGING-GATE.md)
- [Scoped machine request guards](./MACHINE-REQUEST-GUARDS.md)
- [Hosted user API quotas](./USER-API-QUOTAS.md)
- [Operational audit and observability](./OPERATIONAL-AUDIT-OBSERVABILITY.md)
- [Hosted App evidence-health staging gate](./HOSTED-APP-EVIDENCE-HEALTH-STAGING-GATE.md)
- [Hosted marketplace registry](./HOSTED-MARKETPLACE-REGISTRY.md)
- [Hosted marketplace delivery](./HOSTED-MARKETPLACE-DELIVERY.md)
- [Hosted marketplace installation](./HOSTED-MARKETPLACE-INSTALL.md)
- [Hermes-guided App onboarding journey](./APP-ONBOARDING-JOURNEY.md)
- [Department Packs](./DEPARTMENT-PACKS.md)
- [Company Blueprints](./COMPANY-BLUEPRINTS.md)
- [Hosted marketplace access for Hermes and CLI](./HOSTED-MARKETPLACE-WORKLOAD-ACCESS.md)
- [Interactive CLI device authorization](./CLI-DEVICE-AUTHORIZATION.md)
- [Hosted CLI session staging gate](./HOSTED-CLI-SESSION-STAGING-GATE.md)
- [Hosted workload issuer rotation staging gate](./HOSTED-WORKLOAD-ISSUER-ROTATION-STAGING-GATE.md)
