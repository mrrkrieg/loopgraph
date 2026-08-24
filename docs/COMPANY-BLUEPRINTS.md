# Company Blueprints

A Company Blueprint is the versioned, read-only topology above Department Packs. It tells Hermes which company objects must stay consistent across providers and departments, where verified evidence may move, and which conditions must be true before a receiving department may consider work.

## Why this layer exists

Individual loops optimize one recurring task. Apps package cooperating loops for one business result. Department Packs organize Apps for one function. A Company Blueprint connects those functions without collapsing them into an unrestricted company agent.

The official `loopgraph.company.saas-operating-system` Blueprint currently includes all nine Department Packs and begins with Product. It is designed for a software company with recurring revenue, a digital product, cross-functional customer ownership, and accountable approval for material decisions.

## Canonical company objects

The Blueprint defines stable contracts for:

- `company.account`
- `company.campaign`
- `company.product_problem`
- `company.incident`
- `company.contract`
- `company.forecast`
- `company.decision`

Each contract declares identity keys, producing Department Packs, consuming Department Packs, and required evidence fields. A provider record is not automatically a company object. Hermes must use enterprise entity resolution, preserve provider evidence references, and abstain when identity is ambiguous.

## Cross-department routing

Every edge has a source Pack, target Pack, canonical object, relationship type, reason, and required condition. For example:

- Marketing campaign responses may hand off to Sales only when trusted evidence links the person and account to the canonical campaign.
- Sales pipeline outcomes return to Marketing only when the outcome resolves to the same campaign and account.
- Engineering incidents may request Customer Success support only when customer impact is known or reasonably suspected and the incident permits fan-out.
- Finance forecast variance may enter Management only after it crosses materiality or a control deadline is at risk.

An edge is not execution authority. The receiving App must be installed, connected, active at an allowed mode, have the required context, match no exclusion, and pass its own routing and approval policy.

## Use

```bash
npm run loopgraph -- apps company-blueprints
npm run loopgraph -- apps company-blueprint loopgraph.company.saas-operating-system
```

Hermes uses `loopgraph_company_blueprints_search` and `loopgraph_company_blueprint_get`. The detail response reports Pack and App progress and returns exactly one dependency-safe `loopgraph_department_pack_get` action. Re-read the Blueprint after any Department Pack changes.

The Marketplace company map uses the same service and shows Hermes Brain, all departments, canonical objects, cross-department evidence contracts, progress, and the exact next Pack. Viewing it does not seed a local workspace.

## Extend

The source is [`packs/official/company-blueprints.yaml`](../packs/official/company-blueprints.yaml). Add a new profile only when its company object model, Department Pack dependencies, and cross-department evidence conditions are meaningfully different. Then run:

```bash
npm run generate:app-catalog
npm run check:app-catalog
```

The generator rejects unknown Department Packs and runtime schema validation rejects unknown object contracts, Pack endpoints, duplicate orders, self-edges, and dependency errors.
