# Loop Opportunity Engine

Loopgraph should not wait for an operator to notice every missing automation. The opportunity engine turns durable operating evidence into explainable proposals to create or revise loops, then lets Hermes gather only the missing context.

It does not let a model silently rewrite the company graph. Detection and design initiation are automatic; every resulting mutation crosses the semantic transaction boundary, and live execution remains separately governed.

## Evidence sources

A scan reads project-local, schema-validated records:

- unhandled business problems and human route choices;
- repeated routing corrections;
- failed routing evaluation fixtures;
- failed or dead-letter route jobs;
- failed, rejected, escalated, or policy-blocked loop runs;
- failed verification checks;
- reviews that requested evidence, changes, reassignment, or rejection;
- review, rework, and monitoring minutes;
- explicit `improvement_signal` run outputs.

Raw provider payloads and credentials are not copied into opportunity records. Opportunities keep stable references to the durable evidence.

## Explainable score

Every `LoopOpportunity` receives a 0–100 score:

| Component | Maximum | Meaning |
|---|---:|---|
| Recurrence | 25 | How many independent observations support the pattern |
| Business impact | 25 | Highest recorded problem/failure severity |
| Coverage gap | 25 | Whether no registered loop owns the problem |
| Evidence confidence | 15 | Variety of durable signal types and linked problems |
| Human friction | 15 | Recorded review, rework, and monitoring effort |
| Risk penalty | −20 | Ambiguous/custom classification or thin evidence |

Default thresholds:

- `45`: qualify the opportunity and make it visible;
- `65`: create or reuse a discovery session and start a draft Hermes design task.

Thresholds are explicit inputs to a scan. Automatic design creates only a durable draft task. It never materializes a LoopSpec, connects a provider, changes rollout mode, or executes an action.

## Graph changes

Each opportunity creates a versioned `GraphChangeSet` against a hash of the registered LoopSpecs. Operations are:

- `add`: no current loop owns the recurring problem;
- `update`: a current loop has failures, verification gaps, or review friction;
- `split`: repeated corrections show that one loop/routing contract covers distinct work;
- `merge`: reserved for evidence that multiple loops duplicate the same business problem;
- `retire`: reserved for evidence that a loop no longer has a valid outcome.

Every change requires a content-bound approval receipt. User-driven and higher-risk changes require an accountable human decision. The controller can issue a policy receipt only for a low-risk, non-customer-facing `add` that stays in shadow mode. Accepted changes are applied atomically against the exact reviewed graph hash, and the Loopgraph registry remains authoritative.

The design graph includes non-executable `opportunity` and `graph_change` nodes so users can see:

```text
Hermes Brain
  -> Department
     -> observed opportunity
        -> proposed graph change
           -> affected loop (for updates/splits)
```

## Hermes flow

```text
durable events/problems/runs/reviews
  -> Loopgraph opportunity scan
  -> scored LoopOpportunity
  -> proposed GraphChangeSet
  -> durable HermesDesignTask
  -> focused EvidenceGap questions
  -> schema-constrained proposal
  -> Loopgraph compiler
  -> content-bound approval
  -> atomic semantic graph transaction
  -> result snapshot and operation receipts
```

Hermes reads the opportunity through `loopgraph_opportunities_get`. The opportunity is context and evidence, not an instruction to execute. Hermes still uses the bounded design context and the canonical proposal compiler.

## MCP operations

| Tool | Purpose |
|---|---|
| `loopgraph_opportunities_scan` | Detect missing/weak loops and optionally start qualified draft design tasks |
| `loopgraph_opportunities_get` | Read opportunities, scores, signals, graph-change references, and design state |
| `loopgraph_graph_changes_get` | Read versioned proposed graph changes |
| `loopgraph_opportunity_dismiss` | Record an explicit dismissal reason and suppress automatic redesign |
| `loopgraph_graph_change_decide` | Approve or reject exact semantic operations with actor, policy, reason, and evidence |
| `loopgraph_graph_change_apply` | Atomically apply the approved add/update/split/merge/retire change set |
| `loopgraph_graph_history_get` | Inspect graph snapshots, approvals, transactions, promotions, and rollbacks |

These tools are available only in the trusted/admin MCP exposure. Provider-webhook and lifecycle-router turns cannot scan, dismiss, start design work, approve graph changes, or mutate the graph.

## Local API

```text
GET  /api/opportunities
POST /api/opportunities
GET  /api/opportunities/:opportunityId
POST /api/opportunities/:opportunityId
GET  /api/graph/change-sets
GET  /api/graph/transactions
POST /api/graph/transactions
```

Example local scan without automatically waking Hermes:

```bash
curl -X POST http://localhost:3000/api/opportunities \
  -H 'content-type: application/json' \
  -d '{"autoStartDesign":false}'
```

Example dismissal:

```bash
curl -X POST http://localhost:3000/api/opportunities/OPPORTUNITY_ID \
  -H 'content-type: application/json' \
  -d '{"action":"dismiss","reason":"Planned experiment; do not automate this pattern."}'
```

The local server binds all operations to `LOOPGRAPH_PROJECT_ROOT`; a request body cannot redirect a scan or transaction to another filesystem path. The transaction endpoint requires `LOOPGRAPH_WORKER_API_TOKEN`.

HTTP scans default to detection only. Set `"autoStartDesign":true` explicitly to allow the request to wake Hermes. The trusted MCP and local CLI scan commands default to starting qualified draft tasks.

## Scheduling

The engine is deterministic and idempotent, so it can be called after a routing batch, from a daily local management job, or manually from Hermes. A repeated scan reuses the same opportunity, discovery session, graph change, and Hermes design task for the same evidence fingerprint.

After an opportunity is implemented, later evidence does not mutate its historical record. A new signal creates the next opportunity generation with `supersedesOpportunityId`, allowing Loopgraph to improve the same business capability again without losing the earlier decision and graph-change trail.

Run one trusted local scan:

```bash
npx loopgraph opportunities scan --project .
```

Keep the opportunity monitor running locally (15-minute default):

```bash
npx loopgraph opportunities scan --project . --watch
```

To observe and score without waking Hermes:

```bash
npx loopgraph opportunities scan --project . --no-auto-start-design
```

A production scheduler/worker should call the same scan operation; it should not contain separate scoring logic.

See [Semantic graph transactions](SEMANTIC-GRAPH-TRANSACTIONS.md) for approval, apply, promotion, lifecycle, rollback, CLI, API, and storage contracts.
