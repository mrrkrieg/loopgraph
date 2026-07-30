# Continuous loop controller

The controller turns Loopgraph from a collection of manually invoked commands into a durable improvement cycle around Hermes Brain:

```text
business evidence
  -> outcome evaluation
  -> opportunity detection
  -> Hermes design task
  -> policy decision
  -> shadow-only materialization or accountable review
  -> new evidence
```

It does not give Hermes unrestricted execution authority. Hermes identifies the business problem and designs a candidate loop. Loopgraph records the evidence, applies deterministic policy, and blocks any proposal that exceeds the configured boundary.

## Run it locally

Run one auditable cycle:

```bash
npm run loopgraph -- controller run \
  --project . \
  --trigger-type manual \
  --trigger-id first-controller-run
```

Keep the controller active:

```bash
npm run loopgraph -- controller run \
  --project . \
  --trigger-type schedule \
  --watch \
  --interval 900
```

Inspect policy, checkpoint, and recent decisions:

```bash
npm run loopgraph -- controller status --project .
```

Hermes can use the trusted administration surface through:

- `loopgraph_controller_run`
- `loopgraph_controller_runs_get`
- `loopgraph_controller_policy_get`
- `loopgraph_controller_policy_set`

These tools are intended for the project-bound administration profile. They must not be exposed to untrusted webhook or lifecycle turns.

## Durable records

Controller state is stored locally and atomically:

```text
.loopgraph/controller/
  policy.json
  checkpoint.json
  runs/
```

Each run includes:

- a trigger identity and idempotency key;
- the policy hash used for the decision;
- an evidence fingerprint and outcome truth counts;
- explainable decisions with individual policy-rule receipts;
- referenced opportunities, graph changes, Hermes tasks, and outcomes;
- errors and the next eligible evaluation time.

Repeated triggers are idempotent. New triggers with unchanged evidence are suppressed during the configured cooldown.

## Signals and decisions

The controller consumes the existing opportunity engine signals plus:

- outcome regression;
- incomplete outcome evidence;
- negative net value after review, rework, botsitting, escalation, and governance time.

It can decide to:

- take no action;
- request the missing evidence through the durable Hermes design task;
- start or wait for Hermes design;
- request accountable graph-change review;
- materialize an eligible proposal in shadow mode;
- propose pause or retirement for a repeatedly negative-value loop.

Pause and retirement remain human-owned.

## Automatic shadow boundary

Automatic materialization passes only when every configured rule passes. The default policy requires:

- the opportunity to meet the automatic-shadow score;
- the department not to be Finance / Operations, HR / Talent, or Legal / Compliance;
- every graph operation to be an allowed addition;
- signal severity no higher than medium;
- every proposal and route to remain in shadow mode;
- every proposed action to be low-risk, non-customer-facing, and approval-free;
- no unresolved questions, owner decisions, policy decisions, or approvals;
- every routing or simulation capability to be connected or have a declared manual fallback.

A policy-approved shadow loop receives no live credentials and no live write authority. Proposals that fail one rule become review decisions with the failed rule and evidence attached.

## Current boundary

This slice establishes the durable controller, outcome feedback, local CLI, and trusted tool contracts. The following remain separate product layers:

- wiring the controller tools into the MCP administration profile and Hermes installer;
- scheduled hosted execution with tenant authentication and rate limits;
- semantic graph transactions for update, split, merge, retirement, promotion, and rollback;
- automatic rehearsal of every generated fixture before promotion;
- proactive connector-health and webhook-reconciliation triggers;
- dedicated Opportunities, Change Review, Value, Learning, and Controller views.
