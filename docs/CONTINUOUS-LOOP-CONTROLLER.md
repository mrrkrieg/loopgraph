# Continuous loop controller

The controller turns Loopgraph from a collection of manually invoked commands into a durable improvement cycle around Hermes Brain:

```text
business evidence
  -> outcome evaluation
  -> opportunity detection
  -> Hermes design task
  -> policy decision
  -> shadow-only semantic graph transaction or accountable review
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

`loopgraph hermes setup` installs these tools and the controller schema versions into the generated administration profile. The generated Hermes skill explains that a failed policy receipt, review decision, pause, or retirement proposal is not permission to act.

## Durable records

Controller state is stored locally and atomically:

```text
.loopgraph/controller/
  policy.json
  checkpoint.json
  triggers/
  runs/
```

Each run includes:

- a trigger identity and idempotency key;
- the policy hash used for the decision;
- an evidence fingerprint and outcome truth counts;
- explainable decisions with individual policy-rule receipts;
- referenced opportunities, graph changes, Hermes tasks, and outcomes;
- errors and the next eligible evaluation time.

Repeated triggers are idempotent. A separate trigger lock allows multiple schedulers to compete safely while only one claims a pending trigger. Failed or abandoned claims can be retried within bounded attempt and lease limits. New triggers with unchanged evidence are suppressed during the configured cooldown.

## Automatic triggers

Loopgraph now enqueues controller work after:

- normalized Hermes event intake and routing decisions;
- route-job batches, including terminal failures and reconciled reviews;
- explicit human review decisions;
- metric samples, outcome evaluation, and value-ledger writes;
- authenticated management and controller schedules.

Untrusted webhook turns cannot call the controller. They can only create durable bounded routing evidence; Loopgraph internally enqueues the controller trigger, and a trusted scheduler drains it.

Operate the authenticated HTTP worker with:

```text
GET|POST /api/controller
GET|POST /api/cron/controller
```

`/api/controller` requires `LOOPGRAPH_WORKER_API_TOKEN`. The scheduled route requires `CRON_SECRET`. Both fail closed when their secret is absent.

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
- commit an eligible proposal through a content-bound shadow-mode semantic graph transaction;
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

A policy-approved shadow loop receives no live credentials and no live write authority. The controller creates a policy approval receipt and applies the addition through the same atomic graph transaction boundary used by human-approved changes. Proposals that fail one rule become review decisions with the failed rule and evidence attached.

## Current boundary

The durable controller, trigger queue, authenticated scheduler, outcome feedback, semantic graph transaction engine, local CLI, MCP administration tools, authenticated transaction API, and Hermes installer integration are implemented. The following remain separate product layers:

- hosted tenant authentication, role authorization, rate limits, and database-backed scheduling;
- automatic rehearsal of every generated fixture before promotion;
- proactive connector-health and webhook-reconciliation triggers;
- dedicated Opportunities, Change Review, Value, Learning, and Controller views.
