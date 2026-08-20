# Department Packs

Department Packs are Loopgraph's opinionated starting topologies for a complete company function. They answer a question that individual Apps cannot: which governed capabilities normally belong together, what context they share, and which evidence handoffs Hermes may consider across them?

## Contract

Every Pack is strict, versioned, generated from [`packs/official/department-packs.yaml`](../packs/official/department-packs.yaml), and validated against the official App catalog. It declares:

- one department and one default App;
- an exact dependency-safe App installation order;
- business outcomes, shared context keys, and shared logical capabilities;
- typed `supports`, `handoff`, or `evidence_return` edges between Apps in that Pack.

The generator fails when a Pack references an unknown official App. Runtime validation rejects duplicate App IDs or install orders, missing dependencies, unknown topology endpoints, self-edges, and duplicate edge IDs.

## Safety boundary

A Department Pack is read-only guidance. Selecting or inspecting one never installs, configures, tests, activates, or grants a provider capability. Hermes receives one exact next App and must use that App's normal eight-stage onboarding journey. Installation and shadow activation remain separate human-confirmation boundaries. A topology edge permits Hermes to consider a handoff only when the receiving App is installed, connected, active at an allowed mode, has the required context, matches no exclusion rule, and independently passes routing eligibility.

## Official catalog

| Department | Pack | Included Apps |
|---|---|---:|
| Product | Product Learning | 1 |
| Sales | Revenue Pipeline | 2 |
| Marketing | Qualified Pipeline Marketing | 1 |
| Customer Success | Customer Retention | 3 |
| Engineering | Engineering Reliability | 2 |
| Operations & Finance | Financial Operations | 1 |
| HR & Talent | People Operations | 1 |
| Legal & Compliance | Legal and Compliance Evidence | 1 |
| Management | Company Operating System | 1 |

## Use with Hermes or CLI

Hermes calls `loopgraph_department_packs_search`, then `loopgraph_department_pack_get`. The response includes installed progress and one dependency-safe `loopgraph_app_onboarding_get` action. Re-read the Pack after each App installation instead of inferring progress from the conversation.

```bash
npm run loopgraph -- apps departments "pipeline"
npm run loopgraph -- apps department loopgraph.department.sales
```

The browser Marketplace uses these same tools. It shows the Pack's business outcomes, ordered Apps, shared context, shared capabilities, topology, current progress, and exact next App.

## Extend the catalog

Add or modify a Pack in `packs/official/department-packs.yaml`, reference only immutable official App IDs, and run:

```bash
npm run generate:app-catalog
npm run check:app-catalog
```

CI must validate the generated catalog and tests before the Pack can ship. Private cross-department compositions should use a separately versioned private Pack contract rather than mutating the official catalog.
