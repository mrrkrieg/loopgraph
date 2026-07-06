# Topology guide

Topology is Loopgraph's **operating map**: a derived view of company loops, departments, runtime traces, escalation cases, and review pressure. It is not the source of truth — `loopgraph.yaml` and LoopSpecs are.

## What to use it for

1. **Orient** — see how loops roll up from departments to the management loop.
2. **Triage** — filter by department, attention, open cases, failed runs, or high hidden labor.
3. **Inspect** — select a node and read health, connections, and runtime status in the Inspector.
4. **Act** — use Inspector and Trace links to open loop detail, runs, reviews, cases, or management.

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

## What Topology does not do (V1)

- Drag-and-drop loop authoring
- Live execute or pause from the canvas
- Full context provenance inspector (see trace detail pages instead)

See [DAN-WALKTHROUGH.md](./DAN-WALKTHROUGH.md) for the full governance demo.
