---
name: loopgraph
description: Install and operate Loopgraph with Hermes as the company event router and reasoning brain.
---

# Loopgraph for Hermes

Use this skill when the user says `start Loopgraph`, wants to discover a company loop, route a business event, inspect the company topology, or connect a provider.

## Start

1. Locate the company project root.
2. Run `loopgraph hermes setup --project . --activate` (or `npm run loopgraph -- hermes setup --project . --activate` from a source clone).
3. Call `loopgraph_workspace_inspect`. Never seed demo loops into a local install.
4. If no loops exist, immediately call `loopgraph_departments_list`, present the departments, and ask the user to choose one.
5. Run the short discovery flow for that department. Ask only missing questions; accept explicit “unknown” answers and record the evidence gap.
6. Request high reasoning loop design, validate the returned proposal set, and keep new loops in shadow mode.

## Provider boundary

OAuth tokens, webhook secrets, and raw provider payloads stay in Hermes or an approved vault. Loopgraph may store only opaque credential references, provider installation receipts, signed normalized EventEnvelopes, and bounded evidence references.

For provider onboarding, use the Loopgraph provider catalog and follow its declared least-privilege scopes, subscription mode, signature strategy, and transformer. Do not invent provider scopes or silently add write access.

## Routing decision

For every event determine: what happened; canonical company object; new problem versus more evidence; candidate loop claims; required context; activation and connection state; exclusions; ambiguity; permitted fan-out; and whether to abstain. Submit the decision and durable evidence to Loopgraph. Hermes makes the routing decision; Loopgraph validates, records, visualizes, and measures it.

## Graph changes

Moving a node is a layout-only transaction. Adding or connecting semantic nodes creates a proposed change set. Never bypass design validation, approval, readiness checks, or promotion gates.

## Installable company Apps

When the user wants a complete business capability, search the Marketplace by outcome and inspect the selected App. Then call `loopgraph_app_onboarding_get` as the source of truth for the rest of the journey.

When the user wants to start an entire department, asks what a company function can run, or needs several Apps to share context, call `loopgraph_department_packs_search` first. Inspect the selected Pack with `loopgraph_department_pack_get`, explain its ordered Apps, shared context, shared capabilities, and permitted evidence handoffs, then use only the returned exact next App action.

- A Department Pack is a declarative topology, not a bulk installer. Never install or activate every App automatically.
- Re-read `loopgraph_department_pack_get` after each App installation to derive the next dependency-safe App.
- Every App still requires its own preset, connections, field mappings, company answers, exact install approval, conformance, and separate shadow approval.
- Treat cross-App edges as permission to consider a handoff. They never authorize provider writes or override the receiving App's eligibility rules.

- Present its declared stack presets when the stage is `choose_preset`.
- Ask only the returned `questions`; do not repeat answers or invent missing company context.
- Resolve only the returned connector, mapping, and permission blockers.
- After every connection, answer, mapping, install, test, or lifecycle change, call `loopgraph_app_onboarding_get` again instead of guessing the next step.
- Use only the exact `nextAction.toolName` and content-bound plan returned by the journey.
- Stop whenever `requiresHumanConfirmation` is true. Installation and shadow activation are separate approval boundaries.
- Conformance and historical replay remain write-blocked. A passing test never authorizes live provider work.
