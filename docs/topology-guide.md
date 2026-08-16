# Topology guide

Topology is Loopgraph's **operating map**: a derived view of Hermes Brain, company loops, departments, routing signals, evidence returns, runtime traces, escalation cases, and review pressure. Runnable behavior still comes from versioned LoopSpecs and approved semantic graph transactions.

## What to use it for

1. **Orient** — see how loops roll up from departments to the management loop.
2. **Triage** — filter by department, attention, open cases, failed runs, or high hidden labor.
3. **Inspect** — select a node and read health, connections, and runtime status in the Inspector.
4. **Act** — use Inspector and Trace links to open loop detail, runs, reviews, cases, or management.
5. **Author** — drag nodes to save a visual layout or propose a loop/connection from the graph editor.

## Recommended workflow

### Code-first path (primary)

```bash
npm run loopgraph -- simulate examples/strategic-account-escalation \
  --fixture fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json
```

Then open `/topology`, select **Strategic Account Escalation**, and use:

- **Review pending** → approve fingerprints in the browser
- **Open case** → resolve the escalation case
- **Open trace** → inspect the full run record

### Design Studio path

Create or configure loops via **New Loop**, then return to Topology to see them on the map.

## Workspace modes

| Banner | Meaning |
|--------|---------|
| Demo catalog | Acme template loops for exploration; runtime data comes from `.loopgraph/` when you run CLI simulates |
| Local LoopSpecs | Registered specs from your workspace |
| Supabase / persisted | Loops stored in your database |
| Empty workspace | No loops yet — create one or run the CLI walkthrough |

## Snapshot filters

- **Needs attention** — low health, open reviews, waiting runs, or open cases
- **Open cases** — loops with persisted escalation cases
- **Failed runs** — latest run status is failed or blocked
- **High hidden labor** — health below threshold or elevated botsitting

URL params are bookmarkable, e.g. `/topology?node=loop:catalog_strategic-account-escalation&attention=1`.

## Governed graph editing

Moving nodes creates a layout-only backend receipt and never changes routing. Proposing a workflow loop or valid workflow connection creates an immutable `proposal_pending` receipt, an explainable loop opportunity, and a versioned graph change set, then starts or reuses a durable Hermes design task. If the company context is incomplete, the editor points to the exact discovery questions that block design. In hosted mode every receipt is scoped to the authenticated organization and project, records the operator, and is written through a membership-checking database function. The normal approval, rehearsal, readiness, and promotion gates still apply before the topology becomes runnable.

The relationship selector is semantic rather than decorative: `Hermes routes to` must connect Hermes Brain to a workflow loop, `Department owns loop` must connect a department to a workflow loop, and `Evidence returns to` must start from a workflow loop. Unsupported edges are rejected before persistence because Loopgraph cannot compile them into an accountable loop change.

The editor intentionally does not:

- mutate an active routing graph directly;
- live execute, pause, approve, or promote work from the canvas;
- accept arbitrary edge kinds or unbounded graph payloads;
- expose provider secrets or raw company records.

Use the Hermes activity trace pages for full routing and execution provenance.

See [DAN-WALKTHROUGH.md](./DAN-WALKTHROUGH.md) for the full governance demo.
