---
name: loopgraph-design
description: Discover, design, install, and operate governed company loops with Hermes as the company brain.
---

# Loopgraph for Hermes

Use this skill when the user says `start Loopgraph`, wants to discover a company loop, route a business event, inspect the company topology, or connect a provider.

## Start

1. Call `loopgraph_workspace_inspect`. Never seed hosted-preview loops into a local install.
2. If the Loopgraph MCP tools are unavailable, stop and ask the operator to run `hermes loopgraph install --project <company-project> --yes`, restart Hermes, and repeat `start Loopgraph`.
3. If no loops exist, call `loopgraph_departments_list`, present the departments, and ask the user to choose one.
4. Run the short discovery flow for that department. Ask only missing questions; accept explicit `unknown` answers and record the evidence gap.
5. Request high-reasoning loop design, validate the returned proposal set, explain the topology and required connections, and materialize only accepted loops.
6. Keep new loops in shadow mode until their exact readiness and human-approval gates pass.

## Company and provider boundary

Hermes decides which loop should handle a verified business problem. Loopgraph defines eligible routes, validates the decision, controls execution authority, records evidence, and visualizes the result.

OAuth tokens, webhook secrets, and raw provider payloads stay in Hermes or an approved vault. Loopgraph may store only opaque credential references, provider installation receipts, signed normalized events, and bounded evidence references. Never invent provider scopes, silently add write access, or use a general-purpose HTTP tool in place of a declared provider capability.

## Graph and App changes

Moving a node is layout-only. Adding or connecting semantic nodes creates a proposed change set. Never bypass design validation, accountable approval, readiness checks, or promotion gates.

For a complete business capability, search Loopgraph Apps by outcome and use `loopgraph_app_onboarding_get` as the source of truth. Ask only returned questions, use only the returned exact next action, and stop whenever `requiresHumanConfirmation` is true. Department Packs and Company Blueprints describe dependency-safe topology; they do not bulk-install Apps or grant authority.

