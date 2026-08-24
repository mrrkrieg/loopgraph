# Hermes Quickstart

This is the local-first path for using Loopgraph with Hermes Agent as the company brain.

Hermes owns the conversation and all production webhook ingress. Loopgraph owns the local workspace, discovery state, validated LoopSpecs, routing contracts, durable receipts, route validation, simulation, traces, and approvals.

## 1. Install Hermes and choose an integration path

Install Hermes Agent from the upstream GitHub project first:

[github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

Then confirm the Hermes CLI is visible in your shell:

```bash
hermes --version
```

### Recommended: install the native Hermes plugin

Create or open the directory that should own this company's empty Loopgraph workspace:

```bash
mkdir loopgraph-company
cd loopgraph-company
hermes plugins install mrrkrieg/loopgraph/integrations/hermes-plugin --enable
hermes plugins doctor loopgraph --ci
```

Preview and confirm the immutable runtime bootstrap:

```bash
hermes loopgraph plan --project .
hermes loopgraph install --project . --yes
```

Hermes records the plugin's exact repository revision. The adapter fetches only that 40-character commit, requires the package-lock digest declared by that same revision, installs with npm lifecycle scripts disabled, builds the Loopgraph CLI, and requires `npm audit --omit=dev` to pass before it initializes the project. The plugin is dependency-free at Hermes registration time and stores no provider credentials.

Restart Hermes after setup so it discovers the three generated MCP profiles. Then say `start Loopgraph`.

### Alternative: use a source checkout

Clone Loopgraph into a normal local folder:

```bash
git clone https://github.com/mrrkrieg/loopgraph.git
cd loopgraph
npm ci --no-audit
npm run audit:prod
```

Use `npm run loopgraph --` from this repository clone. Do not use `npx loopgraph` for this quickstart unless you have confirmed the published package version includes the Hermes commands; older npm-published CLI builds may not expose `hermes setup`, `workspace inspect`, or the event-routing commands.

`npm install` runs npm's full audit, including developer-only lint/build tooling. If you see dev-tooling findings there, do not connect live credentials until `npm run audit:prod` is clean; use the full audit output as a contributor backlog, not as the Hermes live-use gate.

## 2. Run the guided Loopgraph and Hermes setup

The native plugin path already ran setup. From the company project, use these commands afterward:

```bash
hermes loopgraph doctor --project .
hermes loopgraph start --project .
```

For the source-checkout path, run:

```bash
npm run loopgraph -- setup --project . --activate
```

The setup command does the safe local work in one step:

- initializes `.loopgraph/workspace.json`;
- writes `.loopgraph/hermes/install.json`;
- writes `.loopgraph/hermes/mcp.loopgraph.yaml`;
- writes the generated Hermes skills under `.loopgraph/hermes/skills/`;
- registers the admin, webhook-router, and lifecycle-router MCP servers with Hermes;
- installs the Loopgraph design and isolated event-router skills from the GitHub skill tap;
- synchronizes the project-local, non-secret Hermes route manifest;
- prepares the local Studio launch plan without copying preview loops;
- runs the same protocol, MCP, workspace, and catalog checks as `hermes doctor`;
- prints the exact file paths and first Hermes prompt.

From an installed npm package, use `loopgraph setup --project . --activate` instead. Omit `--activate` to review the generated configuration before Loopgraph asks Hermes to apply it. With the native plugin, pass `--no-activate` to `hermes loopgraph install` for the same review-first behavior.

If setup says Hermes is not on `PATH`, the local Loopgraph files were still generated. Install Hermes, confirm `hermes --version`, then rerun:

```bash
npm run loopgraph -- hermes doctor --project .
```

## 3. Verify the generated Loopgraph integration

With `--activate`, the setup command already applies the MCP and skill registrations. Inspect the generated recovery artifacts if doctor reports a problem:

Open the generated snippet:

```bash
less .loopgraph/hermes/mcp.loopgraph.yaml
```

Without `--activate`, merge that YAML into your Hermes config manually:

```text
~/.hermes/config.yaml
```

The generated snippet registers:

- the Loopgraph MCP server named `loopgraph`;
- the command Hermes should use to start the local MCP server;
- the exact project root;
- the generated Loopgraph skills directory.

It does not contain provider credentials. Google Ads, HubSpot, Notion, Slack, billing, email, CRM, analytics, and other provider credentials should remain in Hermes or an approved credential store.

List the executable provider contracts or prepare one OAuth handoff:

```bash
npm run loopgraph -- hermes providers list
npm run loopgraph -- hermes providers prepare \
  --provider hubspot --workspace workspace_acme --company company_acme \
  --redirect-uri https://hermes.example/oauth/callback
```

Hermes can call the same catalog, installer preparation, and normalization transformer through the trusted admin MCP surface. See [Hermes provider onboarding](./HERMES-PROVIDER-ONBOARDING.md).

### Optional: let Loopgraph wake Hermes for design work

Interactive discovery works immediately after MCP setup. To let Loopgraph proactively wake Hermes when it creates a durable design task, add a dedicated Hermes webhook subscription:

```bash
hermes gateway setup
hermes webhook subscribe loopgraph-design \
  --events "loopgraph.design_requested" \
  --prompt "Loopgraph design task {task.id} is ready. Load the loopgraph skill, read task {task.id} through Loopgraph MCP, resolve only its evidence gaps, and submit the validated proposal through Loopgraph." \
  --skills "loopgraph" \
  --description "Wake Hermes for governed Loopgraph design work"
```

Put the returned URL and secret in the environment used to run Loopgraph:

```bash
LOOPGRAPH_HERMES_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/loopgraph-design
LOOPGRAPH_HERMES_WEBHOOK_SECRET=<route-secret>
```

Do not commit the secret or store it in `.loopgraph/`. The route uses Hermes webhook V2 signatures, timestamp replay protection, and request-ID deduplication. See the [Hermes design bridge](./HERMES-DESIGN-BRIDGE.md) for the task, evidence-gap, callback, and trust-boundary contracts.

## 4. Start discovery from Hermes

In Hermes, start with:

```text
start Loopgraph
```

Hermes should:

1. Inspect the Loopgraph workspace through MCP.
2. Show the canonical department list immediately, recommend Product as the easiest first example, and ask you to pick one or more departments.
3. Start or resume the shared discovery session.
4. Ask one compact Loopgraph-supplied question bundle at a time.
5. Request high-reasoning design using the bounded `LoopDesignContext`.
6. Submit structured proposals back to Loopgraph for validation.
7. Explain proposals, assumptions, risks, metrics, and required user actions.
8. Materialize only proposals you explicitly accept.

The browser can resume the same session at `/discovery`; it uses the same package runtime and schemas as Hermes.

## 5. Start the local operating plane and graph

From the clone:

```bash
npm run loopgraph -- start --project .
```

This starts the Studio UI plus one lease-owning local supervisor. The supervisor runs route synchronization, connector reconciliation, measurement scheduling, durable route jobs, opportunity detection, app update checks, and controller triggers at bounded component-specific cadences. It persists only redacted aggregate status under `.loopgraph/supervisor/status.json` and stops the Studio and supervisor cleanly together.

Use a complete one-cycle diagnostic when you do not want a daemon:

```bash
npm run loopgraph -- start --project . --once
```

Open the printed local URL and use the Hermes Brain view. It shows the current supervisor state and latest aggregate health. A fresh local install stays empty until you accept real loops. If you choose Product first and accept a feedback loop plus a release-learning loop, the design graph should show:

```text
Hermes Brain -> Product -> Feedback Clustering
Hermes Brain -> Product -> Release Learning
```

Selecting a workflow node shows its goal, routing readiness, the concrete "connect next" checklist, generated fixtures, latest run status, and safe local validation/simulation controls.

## 6. Inspect advanced route operations when needed

`loopgraph start` keeps the project-local route manifest synchronized. To inspect the exact plan manually after materializing loops:

```bash
npm run loopgraph -- hermes webhooks plan --project .
```

This derives one Hermes route family per provider source pattern, not one public webhook per loop. It also includes the dedicated `loopgraph-lifecycle-events` route for signed notification-only callbacks from Loopgraph back to Hermes. For a Product flow, product analytics, support, CRM, roadmap, or release events become Hermes route families that point at the `loopgraph-event-router` skill.

## 7. Manually sync and check the local route manifest

```bash
npm run loopgraph -- hermes webhooks sync --project .
npm run loopgraph -- hermes webhooks doctor --project .
```

Sync writes `.loopgraph/hermes-routes.json` with non-secret route metadata only, including the lifecycle callback route. It preserves unrelated external route references in sanitized form and removes stale Loopgraph-managed entries.

Doctor checks whether the manifest still matches the current routing catalog. These commands are advanced recovery controls; the supervisor performs the same safe local synchronization.

For an enterprise Hermes deployment, prepare and apply the exact shadow-route contract through a Hermes-owned Route Controller:

```bash
npm run loopgraph -- hermes webhooks prepare --project .

npm run loopgraph -- hermes webhooks activate --project . \
  --controller-url https://hermes.example.com/v1/loopgraph/routes/reconcile \
  --token-file /run/secrets/loopgraph/hermes-route-controller.jwt \
  --confirm <planDigest>

npm run loopgraph -- hermes webhooks activation-status --project .
```

The first command returns the digest to confirm. Activation accepts only a short-lived workload token from an absolute, user-only file. Hermes retains provider credentials and signing material; Loopgraph persists only a secret-free receipt proving the exact profile, skill, tool boundary, transformer, signature state, and provider subscription state. The v1 protocol can add or update shadow routes but cannot delete routes or enable live execution. See [Hermes Route Controller contract](./HERMES-ROUTE-CONTROLLER.md).

Hermes can call the read-only `loopgraph_hermes_webhooks_prepare` and `loopgraph_hermes_webhooks_activation_status` admin tools to explain this state. It never receives the mutating controller call or token. Connection reconciliation and the Event Routing screen treat a local manifest without a current controller receipt as planned-only, not ready event intake.

Installed App onboarding enforces the same boundary. After conformance, the shared Hermes/browser/CLI journey first asks to synchronize a missing or stale local manifest, then prepares the exact controller plan when activation proof is absent. The App cannot reach `connected` maturity or create a shadow approval until every event route covering its owned Loop IDs has a current controller receipt and verified authentication, with every required provider subscription active. Provider-agnostic App routes bind to the exact provider connections selected during installation. Hermes- and Loopgraph-generated business events use authenticated internal routes without inventing provider subscriptions. A pending route owned only by another App does not block it.

## 8. Rehearse an event before live webhooks

Use a generated fixture or a redacted normalized event:

```bash
npm run loopgraph -- events test --project . \
  --source product_analytics* \
  --fixture .loopgraph/generated/hermes/product/<accepted-loop-id>/fixtures/happy-path.json \
  --expected-action route \
  --expected-loop <accepted-loop-id> \
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

It does not send a real provider webhook, apply a Hermes route, or store provider credentials. Route activation is the separate confirmed controller operation above.

## 9. Run the durable local worker separately only for diagnosis

The top-level supervisor owns the normal worker lifecycle. Every accepted route—including shadow and recommendation routes—creates a durable route job. To process one batch independently during diagnosis:

```bash
npm run loopgraph -- worker run --project .
```

Keep it polling during local use:

```bash
npm run loopgraph -- worker run --project . --watch --interval 5
```

The worker does not trust the model decision by itself. It atomically claims the job, reloads the registered LoopSpec, verifies its immutable hash and all event/problem/commit bindings, enforces the activation and connector gates, records the trace, pauses for exact fingerprint approval when required, and prepares signed lifecycle evidence for Hermes.

See [Durable Hermes Route-Job Worker](./ROUTE-JOB-WORKER.md) for retry, dead-letter, API authentication, and live-execution requirements.

## 9. Bind automatic outcome measurements

Provider credentials stay in Hermes. Register only the connector's non-secret contract:

```bash
npm run loopgraph -- connections register --project . --file connection.json
npm run loopgraph -- connections health --project . --file connection-health.json
```

Then bind an accepted LoopSpec metric to an exact provider field, aggregation, window, and cadence:

```bash
npm run loopgraph -- measurements bindings set --project . --file metric-binding.json
npm run loopgraph -- measurements schedule --project . --backfill 2
npm run loopgraph -- connections reconcile --project .
```

In the trusted Hermes administration profile, the collector uses `loopgraph_measurement_jobs_claim`, executes the exact structured query through the referenced connector, then calls `loopgraph_measurement_jobs_complete` with provider evidence. These tools are absent from webhook and lifecycle profiles.

See [Hermes connector measurements](./CONNECTOR-MEASUREMENTS.md) for schemas, CLI/API operations, guardrails, leases, storage, and the Hermes/Loopgraph ownership boundary.

## 10. Simulate the generated loop locally

The same generated fixture can run the accepted LoopSpec in local simulation mode:

```bash
npm run loopgraph -- simulate \
  .loopgraph/generated/hermes/product/<accepted-loop-id>/loopgraph.yaml \
  --fixture .loopgraph/generated/hermes/product/<accepted-loop-id>/fixtures/happy-path.json
```

This creates a local trace/review packet only. It does not prove that Productboard, Linear, PostHog, Intercom, Notion, Slack, or any write connector is connected.

## 11. Keep detecting missing and weak loops

Run a one-time scan over the durable local routing, run, verification, and review evidence:

```bash
npm run loopgraph -- opportunities scan --project .
```

Keep a trusted local monitor running every 15 minutes:

```bash
npm run loopgraph -- opportunities scan --project . --watch
```

Qualified evidence may start a draft Hermes design task. It cannot materialize a loop or perform a business action. Use `--no-auto-start-design` when you want scoring and graph visualization only.

See the [Loop opportunity engine](./LOOP-OPPORTUNITY-ENGINE.md) for scoring, dismissal, versioned graph-change, and safety contracts.

## 12. Keep the continuous controller active

Run one project-local controller cycle:

```bash
npm run loopgraph -- controller run --project . --trigger-type manual
```

Keep the trusted trigger queue draining:

```bash
npm run loopgraph -- controller run --project . --trigger-type schedule --watch --interval 900
```

Hermes can inspect the same durable policy and decision receipts through `loopgraph_controller_policy_get`, `loopgraph_controller_runs_get`, and `loopgraph_controller_run`. Event-router and lifecycle-router turns never receive those tools.

## 13. Inspect the ongoing operating cycle

Start Studio and select **Operate**:

```bash
npm run loopgraph -- studio --project . --start
```

Use the five focused views as one evidence chain:

1. **Opportunities** — recurring business problems Hermes thinks need a new or improved loop.
2. **Change Review** — exact semantic operations waiting for approval or already committed.
3. **Controller** — triggers, decisions, abstentions, and failed policy rules.
4. **Learning** — connector bindings, scheduled measurements, samples, outcomes, guardrails, and missing evidence.
5. **Value** — observed net savings after operating cost, with modeled and incomplete claims shown separately.

The hosted preview uses labeled example records. Local mode reads only the active project under `.loopgraph/`; it does not copy preview opportunities, controller runs, measurements, or value into a new install.

## 14. Safe defaults

- All new materialized loops start in shadow routing.
- Local simulation uses synthetic/redacted fixtures by default.
- No live external write can occur without connected capabilities, policy approval, and fingerprint-bound prepared actions.
- Provider webhooks should terminate at Hermes, not at Loopgraph workflow routes.
- Webhook secrets, OAuth tokens, and API keys stay in Hermes or an approved credential store, never in chat or `.loopgraph`.

## 15. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `loopgraph: command not found` | You are inside a clone, not using an installed package binary | Prefix commands with `npm run loopgraph --` |
| `npx loopgraph ...` does not recognize `hermes` or `workspace` | npm resolved an older published CLI | Use the GitHub clone quickstart, or install a package version that explicitly includes Hermes commands |
| `cd /workspace/loopgraph` fails | `/workspace/loopgraph` was an example path, not your local clone path | `cd` into the folder created by `git clone`, usually `loopgraph` |
| `Hermes CLI was not found on PATH` | Hermes is not installed or your shell cannot find it | Install Hermes from GitHub, restart the shell if needed, then run `hermes --version` |
| Durable design task says `not_configured` | No proactive Hermes design webhook is configured | Configure `LOOPGRAPH_HERMES_WEBHOOK_URL` and `LOOPGRAPH_HERMES_WEBHOOK_SECRET`, or let Hermes claim the task through MCP |
| Hermes design webhook returns `401` | The route secret or V2 signature inputs do not match | Confirm the URL/secret pair returned by `hermes webhook subscribe` and verify the machines' clocks |
| `hermes webhooks doctor` fails | The local route manifest is stale after loop changes | Rerun `npm run loopgraph -- hermes webhooks sync --project .` |

## 16. Dependency and vulnerability checks

Before connecting live provider credentials or webhook routes, run:

```bash
npm run audit:prod
```

Treat production audit findings as blockers for live credentials. The local setup and fixture simulation path is still useful for design work because it does not store provider secrets and does not perform live external writes.

The full `npm audit` command also includes developer tooling such as ESLint and tsup. Do not run `npm audit fix --force` blindly; npm currently proposes breaking lint-toolchain changes for some dev-only findings.

## 17. Regression coverage

The package runtime includes a clean local walkthrough regression at `packages/loopgraph/src/runtime/hermes-clean-walkthrough.test.ts`. It starts from a temp project with only `package.json`, installs and doctors Hermes, verifies the restricted webhook-router MCP tool surface, completes the Marketing discovery bundles, generates and materializes Ads plus Content Creation, syncs Hermes webhook routes, rehearses the generated Ads event fixture, renders design/event graph projections, and simulates the generated Ads loop locally. Marketing remains the golden regression fixture; Product is the recommended first product story in the README and hosted preview.

For the published example catalog, see `docs/HERMES-EXAMPLES.md`. It covers the Marketing reference flow, a strict Legal / Compliance sensitive-department example, and a Custom field-ops example.

For the implementation evidence map, see `docs/HERMES-COMPLETION-AUDIT.md`.
