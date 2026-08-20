# Hermes-guided App onboarding journey

Loopgraph Apps have one resumable journey across Hermes, CLI, and browser:

```text
Choose stack → Connect systems → Answer gaps → Confirm fields
→ Review install → Rehearse → Activate shadow → Operate and learn
```

The source of truth is the read-only `loopgraph_app_onboarding_get` tool. It derives progress from the immutable Marketplace artifact, current connector and mapping registries, company configuration, installation lock, conformance evidence, and installed lifecycle state. There is no separate conversational checklist to become stale.

## Contract

The returned `loopgraph-app-onboarding/v1alpha1` object contains:

- the exact App version and declared stack presets;
- eight stable journey steps with one and only one current step;
- only setup questions that are still missing or need confirmation;
- connection, mapping, permission, test, and lifecycle blockers with remediations;
- the current content-bound install plan and field-mapping plan when applicable;
- persisted installation, readiness, and write-blocked evaluation state;
- one exact next action, including a tool name when a safe tool call exists;
- an explicit `requiresHumanConfirmation` boundary.

The journey is derived, not separately mutable. After any connection, answer, field confirmation, install, test, activation, pause, or repair, the caller reads it again. That makes retries and handoff between Hermes, CLI, and browser resumable without trusting chat history.

## Hermes procedure

1. Search by business outcome and inspect the chosen App.
2. Call `loopgraph_app_onboarding_get` with the App ID.
3. If the stage is `choose_preset`, present only the declared presets.
4. Ask only returned questions and resolve only returned blockers.
5. Re-read the journey after every state change.
6. Use only the returned exact install plan and `nextAction.toolName`.
7. Stop whenever `requiresHumanConfirmation` is true.

Installation and shadow activation are deliberately separate approvals. Installation writes generated LoopSpecs and graph assets but cannot enable provider writes. Synthetic conformance runs with writes blocked. Shadow mode records real routing decisions while continuing to block provider writes.

## CLI

```bash
loopgraph apps onboard loopgraph.sales.qualify-route-inbound-leads
loopgraph apps onboard loopgraph.sales.qualify-route-inbound-leads \
  --preset hubspot-gmail-slack \
  --config confirmed-company-answers.json
```

The command prints the same versioned journey Hermes and the browser use. It does not mutate the workspace.

## Browser

The Marketplace installer and Installed App detail page render the same eight-step contract. The current step and human approval boundary remain visible before and after installation, so the user is not dropped into a generic status dashboard and asked to infer what comes next.

## Safety invariants

- The journey never contains provider credentials or unrestricted provider payloads.
- It cannot confirm inferred field mappings or permissions.
- It cannot apply an installation or activate a mode by reading state.
- A failed conformance run stops at `resolve_test_failures`.
- A passing test does not imply permission to activate; shadow requires a separate human decision.
- Revoked, deprecated, or uninstalling Apps do not receive an automatic transition.
