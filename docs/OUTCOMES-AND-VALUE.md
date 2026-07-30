# Outcomes and value

Loopgraph treats execution as evidence, not proof of value. A completed run says that a loop operated; an `ObservedOutcome` says whether the intended business measurement changed; a `ValueLedgerEntry` records whether the loop was worth operating after human and governance cost.

## Evidence contracts

### `MetricSample`

A source-qualified measurement with:

- project, company, department, loop, and metric-definition identity;
- a measurement window and observation time;
- source type and durable source reference;
- quality, freshness, and evidence references;
- an explicit `observed`, `modeled`, or `incomplete` truth status.

Completed route-job traces automatically contribute samples when a trace metric matches a project metric definition. Hermes can also record verified integration, human-review, or manual samples through the trusted administration surface.

### `ObservedOutcome`

A versioned comparison between a baseline window and an evaluation window. Loopgraph records:

- baseline and observed sample identities;
- absolute and relative changes;
- desired direction and target;
- evidence sufficiency and confidence;
- guardrail results;
- associated run, problem, and evidence references.

Missing baseline or evaluation evidence creates an `incomplete` outcome. It never creates a guessed result.

### `ValueLedgerEntry`

The value ledger subtracts observed operating cost from gross saved time:

```text
net saved minutes =
  gross saved minutes
  - review
  - rework
  - botsitting
  - escalation
  - governance
```

Currency is optional and can be recorded only with an explicit conversion. Modeled gross value remains labeled `modeled`; an observed entry must link to an observed outcome.

## Trusted Hermes tools

The project-bound administration MCP exposure includes:

- `loopgraph_metric_samples_ingest`
- `loopgraph_metric_samples_get`
- `loopgraph_outcomes_evaluate`
- `loopgraph_outcomes_get`
- `loopgraph_value_ledger_record`
- `loopgraph_value_ledger_get`

These tools are not available to isolated webhook-router or lifecycle-router turns. The MCP server ignores caller attempts to redirect them to a different project root.

Schema resources are available at:

- `loopgraph://schemas/metric-sample`
- `loopgraph://schemas/observed-outcome`
- `loopgraph://schemas/value-ledger-entry`

## Project-bound HTTP API

The local Studio exposes equivalent routes:

- `GET|POST /api/outcomes/metric-samples`
- `GET|POST /api/outcomes/observed`
- `GET|POST /api/outcomes/value-ledger`

Write operations are disabled in the hosted preview. The server always binds a request to the configured local project; clients cannot select arbitrary filesystem roots.

## Daily summary truth

The local Daily page reads only the active project's LoopSpecs, traces, reviews, cases, metric evidence, outcomes, and value ledger. A fresh workspace therefore starts empty.

Hosted preview evidence is generated separately and marked `modeled`. The UI distinguishes:

- `observed`: supported by source-qualified evidence;
- `modeled`: an explicitly labeled preview or forecast;
- `incomplete`: not yet measurable.

No default saved-time or value number is generated for a local loop without ledger evidence.

## Storage

Local evidence is stored atomically under:

```text
.loopgraph/
  outcomes/
    metric-samples/
    observed/
    value-ledger/
```

Records are idempotent by their evidence identity, and retention is enforced by the file-backed store. `.loopgraph/` remains local project state and is not committed as sample workspace data.

## Continuous improvement

The [continuous loop controller](./CONTINUOUS-LOOP-CONTROLLER.md) can base create, improve, pause, and retire proposals on durable evidence instead of run counts or invented value. Approved changes, promotion, pause/resume, and rollback now cross the content-bound [semantic graph transaction](./SEMANTIC-GRAPH-TRANSACTIONS.md) boundary. Automatic connector-backed measurement and automatic promotion rehearsal remain follow-on layers.
