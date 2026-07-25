# Hermes Quickstart

This is the local-first path for using Loopgraph with Hermes Agent as the company brain.

Hermes owns the conversation and all production webhook ingress. Loopgraph owns the local workspace, discovery state, validated LoopSpecs, routing contracts, durable receipts, route validation, simulation, traces, and approvals.

## 1. Install Hermes and clone Loopgraph

Install Hermes Agent from the upstream GitHub project first:

[github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

Then confirm the Hermes CLI is visible in your shell:

```bash
hermes --version
```

Clone Loopgraph into a normal local folder:

```bash
git clone https://github.com/mrrkrieg/loopgraph.git
cd loopgraph
npm ci --no-audit
npm run audit:prod
```

Use `npm run loopgraph --` from this repository clone. Do not use `npx loopgraph` for this quickstart unless you have confirmed the published package version includes the Hermes commands; older npm-published CLI builds may not expose `hermes setup`, `workspace inspect`, or the event-routing commands.

`npm install` runs npm's full audit, including developer-only lint/build tooling. If you see dev-tooling findings there, do not connect live credentials until `npm run audit:prod` is clean; use the full audit output as a contributor backlog, not as the Hermes live-use gate.

## 2. Run the guided Hermes setup

From a Loopgraph clone:

```bash
npm run loopgraph -- hermes setup --project .
```

The setup command does the safe local work in one step:

- initializes `.loopgraph/workspace.json`;
- writes `.loopgraph/hermes/install.json`;
- writes `.loopgraph/hermes/mcp.loopgraph.yaml`;
- writes the generated Hermes skills under `.loopgraph/hermes/skills/`;
- runs the same protocol, MCP, workspace, and catalog checks as `hermes doctor`;
- prints the exact file paths and first Hermes prompt.

From an installed package, use `loopgraph hermes setup --project .` instead.

If setup says Hermes is not on `PATH`, the local Loopgraph files were still generated. Install Hermes, confirm `hermes --version`, then rerun:

```bash
npm run loopgraph -- hermes doctor --project .
```

## 3. Connect the generated Loopgraph integration to Hermes

Open the generated snippet:

```bash
less .loopgraph/hermes/mcp.loopgraph.yaml
```

Merge that YAML into your Hermes config:

```text
~/.hermes/config.yaml
```

The generated snippet registers:

- the Loopgraph MCP server named `loopgraph`;
- the command Hermes should use to start the local MCP server;
- the exact project root;
- the generated Loopgraph skills directory.

It does not contain provider credentials. Google Ads, HubSpot, Notion, Slack, billing, email, CRM, analytics, and other provider credentials should remain in Hermes or an approved credential store.

## 4. Start discovery from Hermes

In Hermes, start with:

```text
start Loopgraph
```

Hermes should:

1. Inspect the Loopgraph workspace through MCP.
2. Show the canonical department list immediately and ask you to pick one or more departments.
3. Start or resume the shared discovery session.
4. Ask one compact Loopgraph-supplied question bundle at a time.
5. Request high-reasoning design using the bounded `LoopDesignContext`.
6. Submit structured proposals back to Loopgraph for validation.
7. Explain proposals, assumptions, risks, metrics, and required user actions.
8. Materialize only proposals you explicitly accept.

The browser can resume the same session at `/discovery`; it uses the same package runtime and schemas as Hermes.

## 5. Open the local graph

From the clone:

```bash
npm run loopgraph -- studio --project . --start
```

Open the printed local URL and use the Hermes Brain view. After accepting the Marketing reference loops, the design graph should show:

```text
Hermes Brain -> Marketing -> Ads
Hermes Brain -> Marketing -> Content Creation
```

Selecting a workflow node shows its goal, routing readiness, required connections, generated fixtures, latest run status, and safe local validation/simulation controls.

## 6. Plan Hermes webhook routes

After materializing loops:

```bash
npm run loopgraph -- hermes webhooks plan --project .
```

This derives one Hermes route family per provider source pattern, not one public webhook per loop. It also includes the dedicated `loopgraph-lifecycle-events` route for signed notification-only callbacks from Loopgraph back to Hermes. For the Marketing reference flow, Google Ads and Notion-like content events become Hermes route families that point at the `loopgraph-event-router` skill.

## 7. Sync and check the local route manifest

```bash
npm run loopgraph -- hermes webhooks sync --project .
npm run loopgraph -- hermes webhooks doctor --project .
```

Sync writes `.loopgraph/hermes-routes.json` with non-secret route metadata only, including the lifecycle callback route. It preserves unrelated external route references in sanitized form and removes stale Loopgraph-managed entries.

Doctor checks whether the manifest still matches the current routing catalog. Applying those routes to real provider subscriptions remains a Hermes-owned/configured step.

## 8. Rehearse an event before live webhooks

Use a generated fixture or a redacted normalized event:

```bash
npm run loopgraph -- events test --project . \
  --source google_ads* \
  --fixture .loopgraph/generated/hermes/marketing/marketing_ads/fixtures/happy-path.json \
  --expected-action route \
  --expected-loop marketing_ads \
  --require-synced-manifest
```

Equivalent Hermes-scoped aliases:

```bash
npm run loopgraph -- hermes webhooks test --project . --fixture <event.json>
npm run loopgraph -- hermes events test --project . --fixture <event.json>
```

The fixture test:

- loads only a normalized `EventEnvelope` or generated synthetic fixture;
- verifies the source and event family match a planned Hermes route;
- optionally requires the synced manifest to be current;
- persists the event through Loopgraph durable ingest;
- asks the local shadow router for a decision;
- validates expected action and loop IDs.

It does not send a real provider webhook, apply a live Hermes route, or store provider credentials.

## 9. Simulate the generated loop locally

The same generated fixture can run the accepted LoopSpec in local simulation mode:

```bash
npm run loopgraph -- simulate \
  .loopgraph/generated/hermes/marketing/marketing_ads/loopgraph.yaml \
  --fixture .loopgraph/generated/hermes/marketing/marketing_ads/fixtures/happy-path.json
```

This creates a local trace/review packet only. It does not prove that Google Ads, HubSpot, Notion, or any write connector is connected.

## 10. Safe defaults

- All new materialized loops start in shadow routing.
- Local simulation uses synthetic/redacted fixtures by default.
- No live external write can occur without connected capabilities, policy approval, and fingerprint-bound prepared actions.
- Provider webhooks should terminate at Hermes, not at Loopgraph workflow routes.
- Webhook secrets, OAuth tokens, and API keys stay in Hermes or an approved credential store, never in chat or `.loopgraph`.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `loopgraph: command not found` | You are inside a clone, not using an installed package binary | Prefix commands with `npm run loopgraph --` |
| `npx loopgraph ...` does not recognize `hermes` or `workspace` | npm resolved an older published CLI | Use the GitHub clone quickstart, or install a package version that explicitly includes Hermes commands |
| `cd /workspace/loopgraph` fails | `/workspace/loopgraph` was an example path, not your local clone path | `cd` into the folder created by `git clone`, usually `loopgraph` |
| `Hermes CLI was not found on PATH` | Hermes is not installed or your shell cannot find it | Install Hermes from GitHub, restart the shell if needed, then run `hermes --version` |
| `hermes webhooks doctor` fails | The local route manifest is stale after loop changes | Rerun `npm run loopgraph -- hermes webhooks sync --project .` |

## 12. Dependency and vulnerability checks

Before connecting live provider credentials or webhook routes, run:

```bash
npm run audit:prod
```

Treat production audit findings as blockers for live credentials. The local setup and fixture simulation path is still useful for design work because it does not store provider secrets and does not perform live external writes.

The full `npm audit` command also includes developer tooling such as ESLint and tsup. Do not run `npm audit fix --force` blindly; npm currently proposes breaking lint-toolchain changes for some dev-only findings.

## 13. Regression coverage

The package runtime includes a clean local walkthrough regression at `packages/loopgraph/src/runtime/hermes-clean-walkthrough.test.ts`. It starts from a temp project with only `package.json`, installs and doctors Hermes, verifies the restricted webhook-router MCP tool surface, completes the Marketing discovery bundles, generates and materializes Ads plus Content Creation, syncs Hermes webhook routes, rehearses the generated Ads event fixture, renders design/event graph projections, and simulates the generated Ads loop locally.

For the published example catalog, see `docs/HERMES-EXAMPLES.md`. It covers the Marketing reference flow, a strict Legal / Compliance sensitive-department example, and a Custom field-ops example.

For the implementation evidence map, see `docs/HERMES-COMPLETION-AUDIT.md`.
