# Loopgraph App Platform contracts

Status: accepted for the local-first App Platform implementation.

## Decision

Loopgraph will expose an outcome-oriented application model while retaining the existing loop runtime as its execution substrate.

An installed app is computed from:

```text
immutable LoopPack version and digest
+ selected modules
+ connector recipe
+ preset
+ approved company context
+ installation configuration
+ typed workspace overlay
+ policy and rollout mode
```

The result is compiled into the existing Loopgraph primitives: LoopSpecs, Hermes skills, routing cards, event contracts, connection bindings, field mappings, schedules, metrics, fixtures, evaluations, graph nodes and edges, readiness checks, and asset ownership records.

## Why the boundary matters

The repository already has the technical pieces needed to run governed loops. It did not have one immutable, distributable unit that a company can discover, inspect, configure, rehearse, install, operate, update, and remove as a coherent product. `LoopPack` supplies that unit. `WorkspaceAppInstallation` records how a company uses it without mutating the upstream artifact.

## Three separate registries

The platform must not collapse three different sources of truth:

1. The marketplace registry lists available apps and immutable versions.
2. The installation registry records workspace configuration, overlays, provider bindings, permissions, lifecycle state, and owned assets.
3. The runtime registry contains the generated LoopSpecs and active runtime resources Hermes can route to.

Marketplace metadata cannot prove that an app is installed. An installation record cannot prove that its generated loops are active. Runtime resources cannot reconstruct publisher provenance or installation intent on their own.

The Installed App operating view therefore performs an explicit ownership join rather than copying global operations into an application page. The installation registry supplies the exact generated runtime loop IDs; recent Hermes event/run activity, outcome evaluations, and value-ledger entries are admitted only when their `loopId` belongs to that set. Routing accuracy and review burden come from the latest human-labeled historical replay for the same installation. An empty ownership set must return an empty operating view, never all workspace activity.

In hosted mode, installation registry ownership is not deployment-local. The server derives the workspace identity from the authenticated project scope, derives browser lifecycle actors from the authenticated user, and resolves `AppInstallationStore` to Supabase. A revision-bound, expiring database lease gives one lifecycle operation exclusive mutation authority; commit requires the same lease token and expected revision and stores the registry plus lock atomically. Registry and lock JSON are schema-checked and size-bounded, tables are RLS-enabled and service-role-only, and accepted revisions append an accountable security-audit event. Generated LoopSpecs use the distributed LoopSpec registry in the same service call. Local mode implements the identical contract with an atomic owner-private file and process-safe lock.

The application topology is a bounded projection of that same join, not a second source of truth. It always contains Hermes Brain → accountable department → Installed App → installation-owned loops, then adds only the latest runtime evidence per loop: event source, executing agent, run/task state, approval gate, and durable outcome. Outcome edges return to Hermes as learning evidence. Run and review links are emitted only from persisted trace or waiting-review identities; graph interaction cannot itself execute work or change the installation.

## Trust and safety boundary

A pack is data, not executable code. It is untrusted until all of these checks pass:

- strict, versioned schema validation;
- safe relative-path and file-enumeration validation;
- canonical per-file and artifact digest verification;
- compatibility and dependency resolution;
- credential, token, and private-data scanning;
- explicit logical-capability and permission review;
- generated LoopSpec validation;
- synthetic conformance tests and promotion rehearsals.

Installation is content-bound by an `AppInstallPlan` digest and committed atomically. Provider writes are never enabled by installation. Every new app starts in simulation or shadow mode.

## Quality evidence and historical replay

Marketplace maturity is derived from recorded evidence, not publisher claims or signatures. A discovered artifact without a digest-bound evaluation receipt is `concept`, including trusted local and official artifacts. `tested` requires a receipt for the exact immutable artifact digest proving that every required synthetic category passed while writes were blocked and provider writes remained zero. The categories are happy path, missing context, exclusions, duplicates, ambiguity, low confidence, unavailable connectors, missing fields, approval gates, customer-facing actions, missing outcomes, retries/idempotency, and upgrade/rollback. Signatures establish publisher provenance; they do not establish behavioral maturity. `connected`, `production_proven`, and `loopgraph_verified` remain reserved for later connection, outcome, and independent-verification evidence.

Installed App maturity is a separate, non-skippable evidence ladder. `connected` requires exact-digest synthetic proof plus every required logical capability binding and all mapping, configuration, and permission checks. `production_proven` additionally requires at least five bounded historical decisions with complete human review, 95% or better labeled routing accuracy, zero replay writes, completed App-owned work, and observed outcome plus net-value records. Replay source data and the latest completed-run, outcome, and value windows must each be bound to the returned App evidence references, no older than 30 days, and no more than five minutes in the future; otherwise the assessment automatically decays to `connected`. `loopgraph_verified` additionally requires an Ed25519-signed receipt for the exact installation, App, and artifact digest from a configured, non-revoked verifier key, but cannot outlive the production proof it verifies. The runtime rejects self-asserted, unknown-key, revoked-key, stale-digest, and malformed receipts. A failed or expired earlier gate caps every later level even if later evidence exists.

Operational maturity is one shared runtime contract, exposed as `loopgraph_app_maturity_get` to Hermes, MCP, CLI, and the browser. The service joins exact App evaluations, current installation readiness, App-owned completed Hermes runs, observed outcomes, observed value-ledger entries, and independent verification receipts. Local deployments persist verifier trust and receipts in a workspace-bound, atomically replaced `0600` registry. Adding trust requires an approver, approval reference, and timestamp; revocation requires a separate accountable actor, reference, and timestamp. Receipt import verifies the Ed25519 signature against an active key before writing and rechecks the exact installed `installationId`, `appId`, and `artifactDigest`. The registry stores only public keys and signed receipts; verifier private keys remain in the independent verifier's own HSM, KMS, or vault.

Hosted deployments resolve the same `AppVerificationStore` contract to tenant-isolated Supabase persistence keyed by organization, project, and workspace. Direct browser and authenticated-role table access is revoked. Trust, revocation, and receipt import use bounded service-role RPCs with immutable identity checks, active-key enforcement, secret-shaped field rejection, and an audit event appended to the tamper-evident security chain. The hosted resolver requires this distributed store and fails closed if it is unavailable; ephemeral deployment storage is never an accepted fallback.

The registry is inspectable through the read-only `loopgraph_app_verification_registry_get` contract and the `/settings/app-verification` console. Hosted viewers may inspect public-key fingerprints and receipt provenance, while mutations require organization admin/owner authority and step-up authentication. The console derives the hosted actor from the authenticated identity rather than accepting it from a form. Local operators must provide their accountable identity explicitly. Private-key PEM input is rejected at the shared core schema and runtime cryptographic validation confirms the trusted public key is Ed25519.

Marketplace discovery metadata is also artifact-derived rather than marketing copy. Each immutable version records its exact loop count, required and optional logical capabilities, stack presets, maturity, publisher provenance, and whether synthetic suites or sample fixtures exist. The browser joins that immutable contract with the current installation, connection-readiness, and evaluation records to describe historical-preview readiness. A card cannot claim an installed or preview-ready state from catalog metadata alone, and an installed card must link to the installation identity rather than back to the catalog entry.

The App detail contract is compiled from the selected immutable artifact rather than maintained as separate marketing content. It exposes the accountable audience, problem statement, Hermes summary, loops, expected outcome artifacts, setup questions, permission boundaries, compatible presets, typed graph, explicit limitations, maturity, version history, and optional packaged changelog. A synthetic preview is available only when evaluation suites exist, and a sample-data preview only when fixtures exist. Historical read-only replay additionally requires an installed App and a passing connection-readiness check; availability never implies provider-write authority or production value proof.

Synthetic conformance evaluates the declared fixture through the compiled routing contract and policy surface; referencing an existing fixture or loop ID alone is not a passing test. Historical replay accepts only a bounded normalized dataset:

- no more than 500 events;
- no more than a 90-day range;
- every event inside the approved range;
- read capabilities only and zero provider writes;
- payloads reduced to decision evidence in the durable evaluation record;
- entity ambiguity, missing context, connection state, exclusions, and approval policy remain active.

Reviewers may label each historical decision `correct`, `incomplete`, or `false_positive` and record review minutes. The promotion recommendation separates routing quality from review burden and always returns `canAutoPromote: false`; an accountable owner must still approve a lifecycle transition.

Activation is an evidence-gated two-mutation protocol over the same App service used by Hermes, MCP, CLI, and the browser. `loopgraph_app_activation_gate_get` is read-only and evaluates the exact pinned artifact, ordered source state, current maturity, historical-review recommendation, evidence freshness, and permission boundary. Shadow requires `connected`; recommend additionally requires the evidence-derived recommendation to be `recommend` and a replay source window ending within 30 days; `execute_with_approval` requires `production_proven`, a recent completed App run plus observed outcome/value windows within 30 days, and no direct `allow` decision for an execute capability. More than five minutes of future clock skew fails closed. Historical runs persist the structured source window; backward-compatible reads recover the same window end from the existing bounded-window evidence reference. Approval creation fails while any gate is blocked and embeds the canonical `AppActivationGate` snapshot in a version-2 receipt. Consumption recomputes the current gate, requires every approved evidence reference to remain present, and then consumes the receipt once. Version-1 receipts remain parseable for audit continuity but are never accepted as activation authority.

The status projection returns only activation approvals belonging to the requested installation set. The browser further selects a receipt only when it is evidence-bound and its installation, App, artifact digest, source state, requested mode, expiry, and consumption state match the current view. Hosted approval requires step-up authentication, and activation receives the exact receipt ID; neither the browser, a caller-supplied actor label, nor a human approval can synthesize missing evidence.

Approval creation and receipt consumption return strict audit contexts from that shared service. In hosted mode the Supabase installation-store adapter commits the registry revision and appends `app.activation.approved` or `app.activation.consumed` through one service-role-only database function. The 4 KiB allowlist accepts only the actor, content-addressed receipt ID, hashed App/installation identities, exact artifact and approval digests, source state, requested mode, expiry, and evidence count. Review reasons and evidence references remain in the authoritative receipt; they are not duplicated into the security chain. Invalid audit metadata, an unavailable audit append, or a registry revision that does not advance aborts the transaction.

The LoopSpec registry and App installation registry are separate durable stores, so activation is journaled before crossing that boundary. The lifecycle operation binds the exact approval, artifact, source state, target mode, actor, and owned LoopSpec IDs. Prepared or interrupted work blocks every unrelated lifecycle mutation. Retrying the same request verifies that the recorded attempt began while its receipt was valid, asserts the owned loop inventory has not drifted, makes LoopSpec activation idempotently current, and atomically completes the operation with installation state, receipt consumption, and the action-specific audit event. Exact retries after completion return the current installation without advancing a revision or re-consuming authority.

Rollback uses the same cross-store rule but binds two complete graph states. Before rematerialization, Loopgraph records the source installation and ownership digests, source workspace revision and LoopSpec inventory, exact prior installation snapshot digest, target ownership digest, target LoopSpec inventory, and accountable actor. Recovery accepts only the recorded source state or the exact already-materialized target state. It then commits the installation snapshot and one lifecycle receipt together; no retry may choose another revision or adopt a third graph topology.

Update uses that two-state protocol before applying a reviewed immutable version. Its journal additionally binds the content-bound update plan digest and normalized permission approval set. The target installation snapshot is derived with the operation start time so an interruption cannot produce a new configuration, overlay, history, ownership, or receipt identity on retry. New updates require an unexpired plan; only an already-prepared exact attempt can finish after expiry. Completion atomically commits the target App registry snapshot, ownership graph, lifecycle receipt, and journal result after the LoopSpec store proves it contains either the recorded source inventory or the exact materialized target inventory.

Repair is also a two-state cross-store operation. Before regeneration it binds the accountable actor, pinned artifact, complete source installation and ownership digests, source workspace revision, the exact registered LoopSpec IDs, an observed inventory digest that can represent missing or unreadable generated specs, and deterministic target installation, ownership, and LoopSpec digests. Recovery accepts only that recorded pre-repair state or the exact regenerated topology, returns the App to simulation, and completes one receipt. The browser always supplies the current artifact digest and installation revision; Hermes receives the same values in the recovery journey, making response-loss replay distinct from a later repair cycle.

Cross-store recovery records the source workspace revision for evidence, but does not treat an unrelated later workspace revision as topology drift. After proving that the installation's exact owned LoopSpec IDs and version hashes still match the recorded source, recovery commits against the freshly read workspace revision. A mutation racing after that read still fails optimistic concurrency, while activity in another App or department cannot permanently strand an otherwise exact update, rollback, overlay, repair, or uninstall recovery.

Configure is a registry-only mutation, but it still uses the journal to make a lost response exactly replayable. Its identity binds the actor, prior installation and configuration digests, submitted-values digest, and deterministic target installation/configuration digests. The journal contains no value names or values. Preparation and completion are separate revision-leased commits, so an interruption becomes visible and blocks competing lifecycle work; the exact request finishes once and completed replay returns the recorded receipt without adding history.

Pause and resume are also cross-store rollout transactions. Their journal binds the exact source state and revision timestamp, retained approved mode, target state and mode, pinned artifact, actor, and owned LoopSpec IDs before the runtime registry changes. Pause may only move an active installation's owned loops to shadow while retaining its approved mode; resume may only restore a paused installation to that same mode. Recovery rejects a different actor, App, artifact, topology, source revision, source state, or target mode. Once the App registry records completion, an immediate exact replay is revision-stable and cannot manufacture another lifecycle event; a later cycle derives a new identity from its newer source revision.

## Configuration precedence

Configuration is resolved in this deterministic order:

```text
pack default
< selected preset
< approved company context
< installation configuration
< workspace overlay
```

Every resolved value retains its winning layer and provenance. Hermes should infer values from trusted context first, explain the evidence, ask only for missing or uncertain values, and request confirmation for high-impact values before saving them to shared company context.

Pre-install progress is a bounded, secret-free draft rather than conversational memory. The same tenant-scoped registry serves Hermes, CLI, browser, and hosted replicas. An App-only handoff omits optional overrides and therefore resumes the saved preset. An explicit different preset creates an isolated preview: saved answers, modules, and draft mapping IDs are excluded and the journey reports `draft.applied: false`. Saves replace the complete snapshot under optimistic revision control, and a cross-preset replacement also requires explicit confirmation. An explicit reset is bound to both draft identity and revision; recreating a draft receives a new identity so a delayed retry cannot erase newer setup. Reset removes no shared connection, confirmed mapping, approved company context, installed asset, permission, or runtime state.

Hosted save/reset accountability is part of the mutation contract, not asynchronous telemetry. The Supabase adapter selects a service-role-only audited commit wrapper whenever the shared operation returns an audit context. That wrapper validates a strict 4 KiB allowlist, delegates to the existing tenant-scoped lease/revision commit, requires the registry revision to advance, and appends the exact `app.onboarding_draft.saved` or `app.onboarding_draft.reset` event before the transaction returns. The event contains only the authenticated actor, draft identity, registry/draft revisions, SHA-256 App and preset identity digests, preset-change flag, and bounded counts. Draft answers, provider fields, mapping contents, credentials, tokens, provider payloads, and raw App/preset identifiers never enter the audit chain. Shared no-op semantics omit the audit context, so an identical retry or already-cleared reset does not manufacture evidence of a state change.

Hermes reads shared context through `loopgraph_company_context_get`; inference remains a proposal until an accountable operator calls `loopgraph_company_context_approve` against the exact current revision. The shared schema requires the JSON value to match its declared type, and the persistence boundary rejects secret-like material. Hosted context uses an organization/project/workspace/company-scoped, service-role-only Supabase record with optimistic revision checks and audit-chain receipts. Installation apply revalidates every company-context-derived configuration value against the current approved record and attaches consumer ownership. Changed context invalidates the stale plan instead of silently installing the old value.

## Connector recipes and field mappings

A multi-provider recipe resolves each capability against the provider that owns its declared operation. The recipe's primary provider does not implicitly satisfy mail, messaging, analytics, or other secondary capabilities. Broad connection grants such as `crm.read` may satisfy narrower read-only requirements such as `crm.lead.read`, but never create write authority.

Provider field discovery is also separate from permission discovery. An authenticated connector records a connection-bound, expiring schema snapshot with a mandatory `redacted_only` sample policy. Loopgraph may use that snapshot—or clearly labelled connector metadata when no live snapshot exists—to produce explainable suggestions. Suggestions are never trusted automatically. A named operator or Hermes acting for that operator must confirm each logical-to-provider mapping before it can satisfy an installation plan. Confirmed mappings are workspace resources and may be reused by later apps without being deleted when one app is uninstalled.

Hosted schema snapshots and confirmed mappings implement the same runtime store interfaces as local owner-private files, but resolve to organization/project/workspace-scoped Supabase records. Snapshot samples are transient input: the hosted adapter removes every `sampleValues` element before parsing and persistence, and the database rejects any sample-bearing or secret-shaped snapshot. Direct browser and authenticated-role writes are revoked. Service-role RPCs bound payload size and identity, preserve installation ownership during mapping updates, and append confirmations, attachments, and detachments to the tamper-evident audit chain. If distributed connector metadata is unavailable, hosted App planning fails closed rather than consulting an ephemeral filesystem.

The pre-install impact review is a projection of the same content-bound plan, not a second planner. It enumerates the exact LoopSpecs, Hermes skills, routing cards, event contracts, schedules, metrics, fixtures, evaluation suites, dashboards, connector bindings, field mappings, graph nodes, and graph edges to create or reuse, with their immutable digests, source paths, and dependencies where applicable. Duplicate LoopSpecs, incompatible asset contracts, and shared company objects whose installed digest differs from the proposal are returned as blocking conflicts before the transaction begins. Reused assets retain every owner installation reference. Exact provider authority decisions, declared outcome metrics, and signed evidence/learning edges remain part of the same plan. The service-level install blocker enforces the contract for browser, Hermes, MCP, and CLI callers.

Pre-install choices are durable but non-authoritative. `AppOnboardingDraft` is a versioned, workspace/company/App-scoped snapshot of one selected version range, preset, module set, declared configuration answers, and optional confirmed mapping identities. It lives in the same revision-leased local or hosted installation registry, uses an independent optimistic draft revision, and is replaced as a whole so partial conversational memory cannot silently win. The shared service rejects undeclared configuration keys, type mismatches, oversized payloads, and secret-shaped material before persistence. A draft contains no connector credential, raw provider record, permission grant, install approval, activation receipt, or provider-write authority. Successful install removes the draft in the same registry transaction that pins the installation.

Selected modules define an immutable composition inside that plan. The compiler includes unclaimed core assets plus assets owned by selected modules, closes required skill dependencies, filters routes and topology flows that reference disabled loops, and derives permissions from the resulting LoopSpecs. Module dependencies and the non-empty-loop invariant fail closed. Synthetic conformance keeps the full safety taxonomy but treats an event whose expected loop is disabled as an explicit `unhandled` expectation. Post-install module overlays rematerialize the same composition atomically in simulation mode; they cannot introduce an unreviewed permission, missing connector binding, or conflicting shared asset. The overlay journal binds the accountable actor, pinned artifact, prior overlay revision, source installation and ownership digests, source workspace revision, submitted-operations digest, deterministic target installation and ownership digests, and exact source/target LoopSpec inventories. It retains no operation body, accepts only the recorded source or target graph during recovery, and returns the original receipt for an exact replay.

Every field mapping in an official multi-provider connector recipe declares the provider that owns the provider-side field. Catalog generation rejects an official pack when that ownership is absent. This prevents a same-named field from being silently resolved against the recipe's primary provider.

### Broker-to-App connection projection

Hosted Connector Broker installations are authoritative for hosted connection readiness. App Platform consumes them through a trusted server dependency, never from a browser, CLI, or MCP request body. The projection is intentionally secret-free and contains only:

- the broker installation ID as the stable connection identity;
- normalized provider ID, environment, lifecycle status, health, and granted scopes;
- broker-authorized capabilities and derived read/write policy flags; and
- no credential reference, token, vault locator, or provider payload.

`active` and `connected` installations may satisfy capability requirements. Pending, degraded, rotating, disconnected, revoked, expired, and error states remain visible but fail readiness or require repair. Broker-authorized capabilities can narrow an OAuth grant; they cannot expand it. Logical App Platform capabilities are matched to provider operations only when the provider, OAuth scope, and broker policy all agree.

Local registry connections and hosted projections use the same `ConnectionInstance` contract. They are merged by stable connection ID, with the current broker projection winning over stale local metadata for the same hosted installation. Provider aliases are normalized before matching. A provider without an App Platform manifest or Connector Broker onboarding contract fails closed and is presented as a custom-connector requirement.

## Updates and customization

Published artifacts are immutable. Company changes are typed overlay operations. Updates use a three-way merge between the original base, the company overlay, and the new base. Permission changes and graph changes are visible before apply. Unresolved conflicts block the update. Rollback restores the previous pinned version and digest.

Every configure, overlay, repair, duplicate, detach, update, rollback, and uninstall mutation records a versioned lifecycle receipt with the previous and resulting registry revisions, artifact digests, accountable actor, retained-evidence flag, removed assets, and preserved shared assets. Mutations use optimistic content bindings so stale CLI, Hermes, or browser clients cannot overwrite a newer configuration, overlay, or artifact.

Duplication is a recoverable multi-store transaction rather than a fire-and-forget copy. Its journal binds the exact source revision, source installation and ownership, semantic field-mapping inventory, actor, private App ID, overlay digest, deterministic target installation and ownership, and namespaced LoopSpec inventory. Recovery accepts only an absent target namespace or the exact recorded target, idempotently attaches shared mappings and approved context, then commits the derived installation and receipt together. Overlay values and company values are never copied into lifecycle metadata.

Detach is a recoverable snapshot-store-and-registry transaction. Its metadata-only journal binds the accountable actor, source artifact and installation revision, full installation and ownership digests, original workspace revision, exact unchanged owned LoopSpec inventory, confined logical snapshot path, semantic artifact digest, full-file digest including detached signature material, and deterministic detached installation. Local runtimes copy through an operation-owned staging directory, parse and content-verify it, then atomically rename it. Hosted runtimes create a tenant-scoped immutable LoopPack archive in a private Supabase Storage bucket with `upsert: false`; an already-existing object is accepted only after exact download verification. Each hosted replica re-verifies the durable archive before promoting a disposable local cache. Only after snapshot materialization does the installation registry commit the detached installation, receipt, and completed operation together. Recovery accepts only the exact verified snapshot and unchanged App-owned topology; unrelated workspace revisions do not strand it, and neither configuration values nor provider data enter the journal.

Install and uninstall cross the installation registry, LoopSpec registry, field-mapping ownership, and company-context ownership boundaries. A bounded lifecycle-operation journal is therefore committed before those side effects begin. The journal contains only immutable digests and resource identifiers, never credentials or provider payloads. New uninstall operations additionally bind the complete source-installation digest, relevant registry-ownership digest, source workspace revision, exact source LoopSpec inventory, exact shared LoopSpec inventory allowed to remain, accountable actor, and a digest of the normalized reason. Recovery accepts the graph only in its exact recorded pre-removal or post-removal state; a changed source installation, ownership graph, actor, reason, or third topology fails closed. Legacy completed entries remain readable, but a legacy unfinished uninstall without this binding is not automatically resumed. Interrupted operations remain `prepared` or `requires_reconciliation`; retrying the exact idempotency identity safely replays LoopSpec materialization and idempotent ownership changes before the registry mutation and operation completion commit together. A different lifecycle action for the same installation is blocked until that recovery record is completed.

Private duplication namespaces every generated LoopSpec and installation-owned asset, so a derived app can coexist with its upstream installation without overwriting active routes. A successful browser mutation must consume the returned installation identity and open that exact private installation; continuing to render the source App would hide the newly created operating unit and make repeat submissions likely. The derived view identifies the private App ID separately from the upstream display name and exposes the pinned upstream version, digest provenance, parent installation, and accountable creator. It may offer an exact Hermes publisher handoff, but capture, validation, signing, and private-catalog publishing remain separate governed operations and require a final human approval before signing or publishing. Detach copies the exact verified LoopPack bytes into a confined workspace snapshot, records the snapshot path, and disables future upstream updates. It does not rewrite the original marketplace artifact.

## Removal and shared assets

Every generated asset records owner installation IDs and a reference count. Uninstall removes only assets exclusively owned by the target installation. Shared connections, field mappings, company context, entity identities, and historical evidence remain available to other installations.

The runtime LoopSpec registry supports content-bound writes and removals in one revision. App uninstall removes the target installation's active generated LoopSpecs, releases its asset references, detaches—but does not delete—shared mapping and context consumer references, preserves evaluation history, and writes a final uninstall receipt.

## Public contracts

The strict Zod schemas and generated JSON Schemas live in `packages/loopgraph/src/core/app-platform.ts`. They are exported from `loopgraph/core` and must be reused by runtime services, CLI, MCP, and browser APIs. A client-specific shadow schema is not allowed.

## Publisher and catalog trust

The local-first publisher is a project-confined service shared by Hermes, MCP, and the CLI. `app init` creates a complete private starter and `app capture` derives a pack from an exact installed artifact. `app dev` inventories the compiled loops, skills, graph, setup, connectors, permissions, and validation blockers without installing the pack. `app preview` returns the full expected-versus-actual synthetic routing decision set with provider writes blocked. Capture never copies installation configuration values, secrets, credentials, or provider payloads; it reports only key names and overlay paths that require deliberate parameterization.

Before signing, the service performs strict pack validation, generated LoopSpec compilation, connector/setup/evaluation parsing, secret scanning, and the complete deterministic conformance suite with provider writes blocked. Third-party packs cannot mark their publisher verified or claim official visibility.

Pack signatures use a detached `loopgraph.pack.signature.json` sidecar over the canonical artifact digest. Project-local Ed25519 private keys are mode `0600` and excluded from Git through `.loopgraph/`. APIs return only the public key and its fingerprint. The detached signature is excluded from the content digest so a pack has one stable content identity, but archive and directory readers still verify the signature bytes and provenance.

A signed catalog trust policy pins all four trust attributes:

```text
publisher ID
+ signature algorithm
+ key ID
+ exact normalized public key
```

Key-ID equality alone is insufficient and is explicitly rejected. Marketplace refresh cryptographically verifies every signed pack against the source's pinned keys, and cached artifact reads reapply the same trust policy. Published `appId@version` content is immutable: the same digest is idempotent, while a different digest for the same version is rejected. Catalog release metadata can mark an exact digest deprecated or revoked; neither status is eligible for new resolution.

Private filesystem catalogs and immutable signed GitHub taps are the current distribution boundary. GitHub taps require an allowlisted HTTPS Git host, a full commit hash, a canonical catalog snapshot digest, and exact publisher public keys. Checkouts remain untrusted staging data until every pack and catalog digest verifies, then move into a content-addressed local cache; synchronization never installs or activates an app. Hosted organization catalogs still require authenticated tenant isolation, remote signing or customer-managed key custody, replicated immutable object storage, audit retention, revocation fan-out, and marketplace control-plane operations before being described as production hosted publishing.

Marketplace provenance is version-scoped rather than inferred from the current source list. Each indexed version binds the catalog source ID, transport, URI, immutable ref, whole-catalog snapshot digest, trust policy, and synchronization time. Refresh is a source-owned reconciliation: it may add, update, or remove only that source's version records. Mirrors with the same `appId@version` and digest may coexist, but divergent digests for one semantic version are an immutable conflict and fail before the index changes. Resolution prefers bundled official artifacts, then signed sources, then explicit local sources, with source ID as the stable tie-breaker.

The hosted registry keeps the same immutable identity but separates publication authority from cryptographic verification. An organization owner may stage a signed private `appId@version`; it cannot claim the reserved official namespace, self-verify its publisher or maturity, assert `provenanceVerified`, or activate the release. Namespace claims are transaction-serialized and ownership is rechecked after conflicts. A service-role verifier must bind the exact artifact, manifest, and file-index digests plus their verified JSON projections to a verification-receipt digest before the release is readable by the install catalog. Tenant ownership and private catalog grants are RLS-enforced, client catalog reads omit object keys and raw signatures, and artifact bytes stay behind an opaque, tenant-prefixed object key for a separate short-lived delivery service. See [Hosted marketplace registry](../HOSTED-MARKETPLACE-REGISTRY.md).
