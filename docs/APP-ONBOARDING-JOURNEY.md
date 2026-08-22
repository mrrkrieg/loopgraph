# Hermes-guided App onboarding journey

Loopgraph Apps have one resumable journey across Hermes, CLI, and browser:

```text
Choose stack → Connect systems → Answer gaps → Confirm fields
→ Review install → Rehearse → Activate shadow → Operate and learn
```

The source of truth is the read-only `loopgraph_app_onboarding_get` tool. It derives progress from the immutable Marketplace artifact, current connector and mapping registries, a durable pre-install onboarding draft, company configuration, installation lock, conformance evidence, and installed lifecycle state. There is no conversational checklist to become stale. Calling it with only the App ID resumes the last saved draft.

Before installation, `loopgraph_app_onboarding_save` persists one complete snapshot of the selected preset, modules, declared setup answers, and optional confirmed mapping IDs. It requires the revision returned by the last journey read, rejects stale writers, undeclared keys, invalid value types, oversized data, and secret-shaped material, and returns the newly derived journey. The draft is stored through the same tenant-scoped, revision-leased registry used by Hermes, CLI, and browser; installation removes it in the same atomic registry transaction that pins the App.

In hosted mode, an accepted save or reset also appends one action-specific event to the tenant/project tamper-evident audit chain in the same database transaction as the registry revision. The audit envelope is deliberately metadata-only: authenticated actor, draft identity, registry and draft revisions, SHA-256 App/preset identity digests, preset-change status, and bounded module/answer/mapping counts. It contains no answer values, provider fields, mapping contents, credentials, tokens, raw provider payloads, or raw App/preset identifiers. If audit validation or append fails, the registry mutation rolls back. An identical save retry or already-cleared reset changes no revision and creates no new mutation event.

If the operator abandons those choices, `loopgraph_app_onboarding_reset` clears only the exact draft named by its current identity and revision after explicit confirmation. The draft identity changes if setup starts again, preventing a delayed reset from erasing a newer journey. Resetting does not disconnect providers, remove confirmed reusable mappings, change approved company context, touch an installed App, grant or revoke permissions, or mutate the runtime graph.

An explicit request for another preset is a preview, not an implicit migration. The returned journey retains the saved draft identity and revision but marks `draft.applied: false`; its plan excludes the previous preset's saved answers, selected modules, and draft mapping IDs. Replacing the draft requires a complete new snapshot, the current revision, and `confirmPresetChange: true`. App-only reads and browser URLs omit the preset entirely, so they resume the saved stack instead of triggering this transition.

Before asking a reusable business question, Hermes reads `loopgraph_company_context_get`. A proposed shared answer remains untrusted until an accountable operator approves its value, provenance, confidence, owner, visibility, and current revision through `loopgraph_company_context_approve`. Secret-like material and declared-type mismatches are rejected. A stale revision or changed value requires a fresh read and plan; Hermes cannot silently preserve an earlier inference.

## Contract

The returned `loopgraph-app-onboarding/v1alpha1` object contains:

- the exact App version and declared stack presets;
- the saved draft revision, accountable actor, and timestamp when pre-install progress exists;
- the saved preset plus whether that draft was actually applied to the returned preview;
- eight stable journey steps with one and only one current step;
- only setup questions that are still missing or need confirmation;
- connection, mapping, permission, test, and lifecycle blockers with remediations;
- the current content-bound install plan and field-mapping plan when applicable;
- an exact impact projection of every LoopSpec, skill, route, event contract, schedule, metric, fixture, evaluation, dashboard, connector binding, field mapping, and graph asset to create or reuse, including conflicts, permissions, and evidence/learning edges;
- persisted installation, readiness, and write-blocked evaluation state;
- an unfinished install, activation, pause, resume, configure, overlay, update, rollback, or uninstall recovery identity, status, affected resource counts, and exact retry boundary when a worker or response failed;
- one exact next action, including a tool name when a safe tool call exists;
- an explicit `requiresHumanConfirmation` boundary.

The journey remains a derived read model. Pre-install mutations are limited to replacing the complete bounded draft snapshot through `loopgraph_app_onboarding_save` or explicitly clearing that exact snapshot through `loopgraph_app_onboarding_reset`; neither grants permission or creates a runtime asset. After any connection, draft save/reset, field confirmation, install, test, activation, pause, or repair, the caller reads the journey again. That makes refreshes, agent restarts, retries, and handoff between Hermes, CLI, and browser resumable without trusting chat history.

Module selection is part of the content-bound plan. Unselected module loops and their exclusive assets do not reach the workspace registry or Hermes candidate library. Dependencies and shared skills are closed automatically, while invalid or empty compositions are rejected. Changing modules after installation is a reviewed overlay transaction that rematerializes the backend in write-blocked simulation; an enablement that would add authority or require another connector must return to planning.

## Hermes procedure

1. Search by business outcome and inspect the chosen App.
2. Call `loopgraph_app_onboarding_get` with the App ID.
3. If the stage is `choose_preset`, present only the declared presets.
4. After the user chooses a preset or answers a setup question, call `loopgraph_app_onboarding_save` with the complete current snapshot and exact draft revision. Never store credentials or raw provider data in the draft.
5. If the user explicitly asks to start over, explain the resources that remain unchanged, obtain confirmation, and call `loopgraph_app_onboarding_reset` with the latest draft ID and revision. Re-read instead of clearing anything after an identity or revision conflict.
6. If the user asks for another preset, preview it without draft values. When `draft.applied` is false, explain that isolation and require confirmation before saving the complete replacement snapshot with `confirmPresetChange: true`.
7. If the stage is `recover_lifecycle`, stop all competing App mutations and ask the operator to retry the returned exact install, activation, pause, resume, configure, overlay, update, rollback, or uninstall identity.
8. Ask only returned questions and resolve only returned blockers.
9. Re-read the journey after every state change; the App ID alone resumes saved progress.
10. Use only the returned exact install plan and `nextAction.toolName`.
11. Stop whenever `requiresHumanConfirmation` is true.

Installation and shadow activation are deliberately separate approvals. Installation writes only the immutable asset inventory approved in the content-bound plan and cannot enable provider writes. Duplicate LoopSpecs and incompatible shared contracts block before the transaction starts. Synthetic conformance runs with writes blocked. Shadow mode records real routing decisions while continuing to block provider writes.

Activation is a two-step runtime protocol, not a prompt convention. After the accountable operator accepts an exact transition, `loopgraph_app_activation_approve` records a short-lived receipt bound to the workspace, installation, pinned artifact digest, current state, requested mode, approver, reason, and evidence. `loopgraph_app_activate` must consume that exact receipt. A receipt is rejected when it is missing, expired, already consumed, or no longer matches the artifact, state, installation, or requested mode.

The installed-App browser follows the same boundary. It never combines approval and activation into one button: the first form requires an explicit reason and confirmation (plus step-up authentication in hosted mode), then the refreshed read model exposes only an unconsumed, unexpired receipt matching the exact current App. A second form consumes that receipt. Stale, cross-App, cross-artifact, wrong-state, wrong-mode, expired, or already-consumed approvals are not offered by the UI and are rejected again by the runtime.

Hosted approval creation and receipt consumption are also audit-fenced registry mutations. Each accepted transition appends `app.activation.approved` or `app.activation.consumed` to the tenant/project security chain in the same database transaction as the registry revision. The bounded event contains the accountable actor, content-addressed receipt ID, hashed installation and App identities, pinned artifact and approval digests, source state, requested mode, expiry, and evidence-reference count. Approval text, evidence references, provider data, credentials, tokens, and raw App or installation identifiers remain outside the audit envelope. A failed audit validation or append rolls back the authority change.

Activation also uses a durable cross-store recovery journal. Before changing any owned LoopSpec, Loopgraph records the exact receipt ID and digest, pinned artifact, source state, target mode, actor, and owned loop set. If a worker stops after LoopSpecs change but before the installation registry consumes the receipt, every competing lifecycle mutation is blocked and the journey returns one exact `retry_exact_request`. That retry may finish after the original receipt expiry only when the journal proves the approved attempt began before expiry; it revalidates the same artifact, state, authority, and loop inventory, then consumes the receipt once. A completed retry is an idempotent read of the resulting state, not a second activation.

Pause and resume use the same journal boundary without creating new rollout authority. The operation records the exact source state and revision timestamp, approved mode, target state and mode, pinned artifact, actor, and owned LoopSpec IDs before changing the runtime graph. Pause reconciles those loops to shadow while retaining the last approved mode in the App registry; resume reconciles them back to that exact mode. A retry is accepted only for the same actor and unchanged source revision, artifact, and owned-loop inventory. A completed immediate retry does not advance the registry again, while a later pause/resume cycle has a new source revision and therefore a new transaction identity.

Rollback also crosses the App registry and LoopSpec registry, so it is prepared before rematerialization. Its journal binds the exact source installation and ownership digests, source workspace revision, prior installation snapshot, accountable actor, and both source and target LoopSpec inventories. A retry may observe only the exact source graph or the exact already-materialized target graph. Any third topology, changed ownership, changed installation revision, different actor, or replacement rollback target fails closed. Completion records one lifecycle receipt and returns the App to write-blocked conformance.

Uninstall recovery is bound to the exact destructive intent rather than only the installation ID. Before any LoopSpec, mapping, context, or generated-file side effect, Loopgraph records digests of the complete source installation and its ownership graph, the source workspace revision, exact pre-removal loop inventory, exact shared-loop inventory allowed to remain, accountable actor, and normalized reason. Only the reason digest enters recovery metadata. A retry must provide the same actor and exact original reason, and the current graph must match either the recorded pre-removal state or the exact post-removal shared state. Any third topology, ownership change, source-installation change, or legacy unfinished record without this binding requires administrator reconciliation instead of automatic continuation.

Configure recovery is bound to the accountable actor, exact source installation and configuration digests, a digest of the submitted confirmed values, and deterministic target installation and configuration digests. The journal never copies configuration values. A lost response or interrupted registry completion can be retried only from the session that still holds the original values; exact completion returns the original receipt, while replacement values, another actor, or source drift remain blocked.

Overlay recovery is bound to the accountable actor, pinned artifact, prior overlay revision, complete source installation and ownership digests, source workspace revision, submitted-operations digest, deterministic target installation and ownership digests, and exact source/target LoopSpec inventories. The journal never copies overlay operations. A retry must come from the session that still holds the original operations and may reconcile only the recorded source or already-materialized target topology; a replacement operation set, another actor, stale source, ownership drift, or third topology fails closed. Exact completion returns the original receipt, while a later overlay revision receives a distinct identity.

## CLI

```bash
loopgraph apps onboard loopgraph.sales.qualify-route-inbound-leads
loopgraph apps onboard-save loopgraph.sales.qualify-route-inbound-leads \
  --preset hubspot-gmail-slack \
  --expected-revision 0 \
  --config confirmed-company-answers.json
loopgraph apps onboard loopgraph.sales.qualify-route-inbound-leads
loopgraph apps onboard-reset loopgraph.sales.qualify-route-inbound-leads \
  --draft <draft-id> --expected-revision <revision> --confirm RESET
loopgraph apps onboard-save loopgraph.sales.qualify-route-inbound-leads \
  --preset salesforce-outlook-teams \
  --expected-revision <revision> \
  --config confirmed-salesforce-answers.json \
  --confirm-preset-change
```

`apps onboard` is read-only and sends no empty version or configuration override when those flags are omitted. `apps onboard-save` persists only the bounded pre-install draft, then prints the same versioned journey Hermes and the browser use; it does not install assets or enable provider writes. `apps onboard-reset` is an explicitly confirmed, exact-draft deletion and leaves reusable and runtime state intact.

## Browser

The Marketplace installer and Installed App detail page render the same eight-step contract. Opening the App-only install URL resumes a saved Hermes/CLI/browser preset; when none exists, that URL presents the declared stacks rather than returning a 404. An already installed App opens its operating view. Validated answers save through the shared draft tool, and a reload resumes the saved stack, modules, answers, and current blockers. Choosing another stack produces a clean preview, labels the saved stack that was excluded, and requires an explicit replacement checkbox. An explicit “start over” disclosure shows exactly what remains untouched and submits the current draft identity and revision through the shared reset tool. Before approval, the installer expands the content-bound plan into an exact impact review: every created asset, reused company resource, blocking shared-object conflict, provider-authority decision, declared outcome metric, and signed evidence edge is visible. The current step and human approval boundary remain visible before and after installation, so the user is not dropped into a generic status dashboard and asked to infer what comes next. The Installed Apps list and detail page also render unfinished lifecycle recovery above normal controls, show the affected LoopSpec/mapping/context counts, and replace competing actions with the exact reconciliation path.

Update apply follows the same resumable rule. Before changing an owned LoopSpec, Loopgraph journals the content-bound plan digest, exact permission approval set, accountable actor, source installation and ownership digests, original workspace revision, and the complete expected source and target LoopSpec inventories. If the worker stops after materialization, the original Hermes, CLI, or browser session may retry the same reviewed plan after its normal plan window expires. A different actor, approval set, plan, installation revision, ownership graph, or third topology is rejected, and successful replay returns the original lifecycle receipt instead of creating another update.

## Safety invariants

- The journey never contains provider credentials or unrestricted provider payloads.
- A draft accepts only declared App setup keys and bounded JSON values; secret-shaped keys or values fail before persistence.
- Draft updates use optimistic revision checks and cannot grant connector, permission, installation, activation, or provider-write authority.
- Hosted draft saves and resets commit their bounded action-specific audit event atomically with the registry revision; audit metadata cannot contain setup answers, provider fields, tokens, credentials, mapping contents, or raw App/preset identifiers.
- Idempotent save retries and already-cleared resets do not append misleading mutation events.
- Draft reset requires explicit confirmation plus the exact identity and revision; a delayed reset cannot clear a replacement draft.
- A different preset never inherits the prior preset's draft values; replacing it requires explicit confirmation against the current revision.
- It cannot confirm inferred field mappings or permissions.
- It cannot apply an installation or activate a mode by reading state.
- A blocking conflict is returned for review but the installation service rejects apply until it is resolved.
- A failed conformance run stops at `resolve_test_failures`.
- A passing test does not imply permission to activate; shadow requires a separate human decision.
- Revoked, deprecated, or uninstalling Apps do not receive an automatic transition.
- An unfinished install, activation, pause, resume, configure, overlay, update, rollback, or uninstall returns `recover_lifecycle`; every competing test, activation, configuration, overlay, repair, update, rollback, duplicate, detach, pause, resume, or removal mutation remains blocked until the exact operation completes.
