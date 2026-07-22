# Hermes Completion Audit

This audit maps the original Hermes-only objective to current implementation evidence. It treats Hermes Agent as the company brain: provider webhooks terminate at Hermes, Hermes proposes bounded routing decisions, and Loopgraph validates, persists, visualizes, simulates, and gates execution.

## User-facing product requirements

| Requirement | Current evidence |
|---|---|
| A user can clone/install a local project and bind Loopgraph to an explicit project root. | `loopgraph workspace init --project`, `loopgraph hermes install --project`, `loopgraph hermes doctor --project`, and `loopgraph studio --project` are documented in `docs/HERMES-QUICKSTART.md` and `packages/loopgraph/README.md`. `packages/loopgraph/src/runtime/hermes-clean-walkthrough.test.ts` starts from a temp project containing only `package.json` and proves install/doctor/studio preparation. |
| The product is Hermes-specific, with no alternate agent-coding path. | Source scan excluding `.git`, `node_modules`, and built package output returns no alternate agent-coding integration references. Hermes install writes only `loopgraph` and `loopgraph-event-router` skills. |
| Hermes can start/resume discovery and the browser can resume the same session. | `packages/loopgraph/src/runtime/discovery-session.ts` is shared by Hermes MCP tools and browser actions. `app/hermes-browser-flow.test.ts` starts a Hermes-created session, resumes it in the browser, answers bundles, edits proposals, materializes loops, simulates, and submits a human routing correction. |
| Departments are canonical and selectable. | `packages/loopgraph/src/core/department-skills.ts` defines canonical departments and legacy aliases. MCP/browser tests exercise department listing/selection. |
| The question flow asks compact bundles about stack, problem, automation boundaries, ideal outcome, ownership, rollout, and routing policy. | `packages/loopgraph/src/core/question-bundles.ts` defines the five universal bundles. Marketing, Legal/Compliance, and Custom reference fixtures all submit these bundles through runtime services. |
| The high-reasoning design path creates governed proposals and does not expose hidden reasoning. | `packages/loopgraph/src/runtime/design-service.ts` builds bounded `LoopDesignContext`, supports Hermes-hosted/embedded/deterministic providers, persists `DesignRun`, validates `LoopDesignProposalSet`, and records summary metadata only. |
| The user can see proposed loops, evidence, assumptions, risks, required user actions, edit/accept/reject, then materialize valid LoopSpecs. | `packages/loopgraph/src/runtime/loop-materialization.ts` materializes explicitly accepted proposals atomically with provenance, routing cards, generated fixtures, required connections, and graph projection. Browser edit/materialization coverage is in `app/hermes-browser-flow.test.ts` and `app/discovery/actions.test.ts`. |
| The graph shows the intended hierarchy, e.g. `Hermes Brain -> Marketing -> Ads` and `Hermes Brain -> Marketing -> Content Creation`. | `loopgraph_graph_get` design projection and browser graph adapter cover the hierarchy. `hermes-clean-walkthrough.test.ts`, `golden-marketing-flow.test.ts`, and `app/hermes-browser-flow.test.ts` assert the Marketing graph. |
| External webhooks go to Hermes as the company brain. | `packages/loopgraph/src/runtime/hermes-webhooks.ts` plans/syncs non-secret Hermes route metadata and restricted router tools. `/api/webhooks/github` is compatibility-forward-only and returns `410` without Hermes forwarding configured. |
| Hermes decides which loop to trigger, but Loopgraph validates before work starts. | `loopgraph_events_ingest` returns eligible routing cards; `loopgraph_routing_decision_submit` validates decisions against current project routing cards, event subject, input mapping, duplicate/open-problem policy, readiness, activation mode, and queue policy. Routing tests cover good, duplicate, no-match, ambiguous, forged, stale, and nonexistent routes. |
| Users can run/simulate generated loops locally without credentials. | Materialization creates `happy-path`, `missing-context`, and `risk-escalation` fixtures. `loopgraph simulate` and `loopgraph_loops_simulate` run local traces only. `hermes-clean-walkthrough.test.ts` and `hermes-published-examples.test.ts` simulate or rehearse generated fixtures. |
| Live execution is blocked until connectors and policies are ready. | `packages/loopgraph/src/runtime/executor.ts` enforces a live gate requiring Hermes routing, live activation mode, approval/fingerprint binding, separate customer-facing approval, and connected non-simulated capabilities. `execute-path.test.ts` and `hermes-published-examples.test.ts` prove blocking. |

## Definition-of-done audit

| # | Requirement | Evidence |
|---:|---|---|
| 1 | Package installs and tests pass. | `npm test` passes 279 tests across 78 files; `npm run build:package` passes. Package smoke test validates core/runtime/sdk exports. |
| 2 | Workspace init uses explicit project root. | CLI exposes `workspace`; runtime workspace tests and clean walkthrough use temp explicit roots. |
| 3 | Hermes can discover Loopgraph MCP tools. | `hermes-install.test.ts` and `mcp/server.test.ts` verify MCP initialize, tools, resources, and doctor checks. |
| 4 | Hermes can start/resume discovery and is the production webhook brain. | Discovery-session tests plus browser e2e prove shared sessions; webhook planning/sync and GitHub forward-only compatibility keep provider ingress at Hermes. |
| 5 | User sees canonical departments and selects Marketing. | Department catalog and discovery selection services are tested through MCP/browser/runtime flows. |
| 6 | Five main question bundles capture reference answers. | `golden-marketing-reference-flow.json`, `sensitive-legal-reference-flow.json`, and `custom-ops-reference-flow.json` all submit the five bundles. |
| 7 | High-reasoning design run proposes Ads and Content Creation with rationale, assumptions, metrics, owners, policies, connectors, and required actions. | `golden-marketing-flow.test.ts` snapshots proposals, LoopSpecs, graph, routing catalog, and starter fixtures. |
| 8 | Invalid or unsafe model output is rejected before filesystem writes. | Design validation tests, materialization preflight/atomic tests, and threat/privacy tests cover rejection before unsafe commits. |
| 9 | User can edit, accept, or reject proposals. | Browser actions and MCP design edit paths are covered by `app/discovery/actions.test.ts` and `app/hermes-browser-flow.test.ts`. |
| 10 | Accepted proposals materialize atomically into valid LoopSpecs. | `loop-materialization.test.ts` covers success and rollback behavior; generated specs reload through the LoopSpec loader. |
| 11 | Each accepted loop has a routing contract and routing card. | `loopgraph_routing_catalog_get` tests and materialization tests assert compiled routing cards. |
| 12 | External provider test webhooks terminate at Hermes and never call loops directly. | Hermes webhook plan/sync/test coverage plus GitHub forward-only route tests. |
| 13 | Hermes routes Ads, Content Creation, ambiguous, duplicate, and no-match fixtures as expected. | `routing-simulation.test.ts` and `hermes-webhooks.test.ts` cover positives, duplicate suppression, no-match, and ambiguous/human-choice behavior. |
| 14 | Loopgraph rejects nonexistent, stale, incompatible, unready, duplicate, over-limit, and unsafe route selections. | Routing-store/tools tests, MCP schema restrictions, threat/privacy regression, and execute gate tests cover these failure modes. |
| 15 | Accepted routes survive restarts, preserve correlation, and group repeated evidence. | File-backed routing-store tests cover durable receipts, problems, route commits, jobs, duplicate/open-problem handling, and persisted state. |
| 16 | Lifecycle events return to Hermes without recursive re-triggering. | `lifecycle-events.test.ts`, routing tools tests, and event-routing graph tests cover signed notification-only callbacks and recursion prevention. |
| 17 | Local design graph shows Hermes Brain -> Marketing -> Ads and Content Creation in stable hierarchy. | Graph adapter/layout tests, golden Marketing snapshots, clean walkthrough, and browser e2e. |
| 18 | Event-routing projection explains event, candidates, decision, validation, run, and outcome. | `routing-ops-tools.test.ts`, event-routing read model tests, and browser e2e management flow cover the operational projection/timeline. |
| 19 | Each loop can be simulated from generated synthetic fixtures. | Materialization creates fixtures and loop-tools/browser tests simulate them. |
| 20 | Traces appear in browser and review/escalation behavior still works. | Browser flow simulates into a persisted trace/review route; review, case, and escalation tests pass. |
| 21 | No external write occurs without connected capabilities, policy approval, and fingerprint binding. | Executor live gate, approval policy, review service, and sensitive Legal example tests prove gating. |
| 22 | Browser design works without Hermes, while production webhook routing requires Hermes by design. | Browser session/action tests use the package runtime and deterministic local fallback; provider webhook plan/sync and GitHub compatibility route keep production ingress Hermes-owned. |

## Published examples

- Marketing Ads + Content Creation: `packages/loopgraph/src/runtime/fixtures/golden-marketing-reference-flow.json`
- Sensitive Legal / Compliance strict blocking: `packages/loopgraph/src/runtime/fixtures/sensitive-legal-reference-flow.json`
- Custom Field Ops: `packages/loopgraph/src/runtime/fixtures/custom-ops-reference-flow.json`

The example catalog is documented in `docs/HERMES-EXAMPLES.md` and covered by `packages/loopgraph/src/runtime/hermes-published-examples.test.ts`.

## Final validation commands

The current validation set is:

```bash
npm test
npm run typecheck
npm run lint -- --ignore-pattern 'packages/loopgraph/dist/**'
git diff --check
npm run build:package
<run the Hermes-only source cleanup scan excluding .git, node_modules, and built package output>
```

Expected status: all pass; lint reports five pre-existing warnings and zero errors; the Hermes-only source cleanup scan returns no matches.
