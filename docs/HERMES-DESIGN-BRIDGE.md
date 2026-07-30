# Hermes Design Bridge

The Hermes design bridge lets Loopgraph initiate design work when a user requests a loop, an unhandled problem needs coverage, an opportunity is detected, or an existing loop needs improvement.

Loopgraph remains the durable source of truth. The Hermes webhook wakes the agent; it is not the task queue.

## Architecture

```text
Loopgraph discovery/opportunity
  -> durable HermesDesignTask + EvidenceGapSet
  -> signed loopgraph.design_requested webhook
  -> Hermes loads the loopgraph skill
  -> Hermes reads the task through Loopgraph MCP
  -> Hermes asks only the supplied evidence-gap questions
  -> Hermes submits a LoopDesignProposalSet
  -> Loopgraph validates it through the existing compiler
  -> explicit user review/materialization remains required
```

The webhook body includes `event_type: "loopgraph.design_requested"` and a durable task ID. Delivery uses Hermes's generic webhook V2 contract:

- `X-Webhook-Signature-V2`: hex HMAC-SHA256 of `<unix-seconds>.<raw-body>`;
- `X-Webhook-Timestamp`: Unix seconds;
- `X-Request-ID`: the Loopgraph task idempotency key;
- `X-Loopgraph-Task-ID`: the durable Loopgraph task ID.

Loopgraph accepts duplicate callbacks and repeated task starts safely. A repeated start for the same discovery revision, department, reason, opportunity, and problem set reuses the existing task.

Local projects enforce those guarantees with an atomic file store. Authenticated hosted
deployments select a tenant/project-scoped Supabase store, so task creation, evidence resume,
controller inspection, and callback completion can occur on different replicas without losing
state. See [Distributed Hermes design store](./DISTRIBUTED-HERMES-DESIGN-STORE.md).

When the task originated from the [Loop opportunity engine](./LOOP-OPPORTUNITY-ENGINE.md), it includes `originOpportunityId`. Hermes reads the explainable score, durable signal references, and proposed graph change through Loopgraph MCP before asking for missing evidence.

## Configure proactive Hermes activation

Enable the Hermes webhook gateway, then create a dedicated route:

```bash
hermes gateway setup

hermes webhook subscribe loopgraph-design \
  --events "loopgraph.design_requested" \
  --prompt "Loopgraph design task {task.id} is ready. Load the loopgraph skill, call loopgraph_hermes_design_tasks_get with taskId {task.id}, resolve only its supplied evidence gaps, and submit a schema-constrained proposal through Loopgraph MCP." \
  --skills "loopgraph" \
  --description "Wake Hermes for governed Loopgraph design work"
```

The command returns the route URL and HMAC secret. Store them in the environment or approved local secret store used to run Loopgraph:

```bash
LOOPGRAPH_HERMES_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/loopgraph-design
LOOPGRAPH_HERMES_WEBHOOK_SECRET=<route-secret>
```

Do not commit the secret or write it into `.loopgraph/`.

The older `LOOPGRAPH_HERMES_TASK_URL` and `LOOPGRAPH_HERMES_TASK_SECRET` names remain temporary compatibility aliases. New installations should use the webhook names.

## MCP operations

The trusted/admin Loopgraph MCP exposure provides:

| Tool | Purpose |
|---|---|
| `loopgraph_hermes_design_start` | Create or reuse a durable task for a discovery session |
| `loopgraph_hermes_design_tasks_get` | Read one task or list task state |
| `loopgraph_evidence_gaps_get` | Compile gaps and return at most three focused questions |
| `loopgraph_evidence_gap_answer` | Persist a user-confirmed answer and resume the active task |
| `loopgraph_opportunities_get` | Read the scored operating evidence and proposed graph change that initiated a task |
| `loopgraph_design_context_get` | Read the bounded design context once blocking gaps are resolved |
| `loopgraph_design_submit` | Submit a structured proposal through the canonical compiler |

These operations are not exposed to the isolated provider-webhook or lifecycle-router MCP surfaces.

## HTTP operations

The local Design Studio exposes project-bound routes:

```text
GET  /api/hermes/design-tasks
POST /api/hermes/design-tasks
GET  /api/hermes/design-tasks/:taskId
POST /api/hermes/design-tasks/:taskId/callback
GET  /api/discovery/session/:sessionId/evidence-gaps
POST /api/discovery/session/:sessionId/evidence-gaps
```

The callback route requires `LOOPGRAPH_HERMES_CALLBACK_SECRET` (or the compatibility task secret), a fresh `X-Hermes-Timestamp`, and `X-Hermes-Signature`. It is an optional remote-worker path; the recommended local Hermes path submits answers and proposals through Loopgraph MCP.

When `LOOPGRAPH_PUBLIC_URL` is set, design requests include the callback URL. When it is absent, Hermes uses MCP only.

## Evidence-gap rules

- Blocking design gaps prevent a proposal from being compiled.
- Loopgraph returns at most three user questions at once.
- Hermes must preserve the supplied `gapId`.
- Answers relayed by Hermes are persisted as user-confirmed discovery answers.
- Connection, baseline, routing-subject, and completion-signal gaps may remain non-blocking for draft design while still blocking their declared later stage.
- Hermes may propose an additional gap, but it cannot waive a blocking gap or invent the missing answer.

## Trust boundary

The design bridge may:

- ask focused questions;
- inspect bounded, redacted project context through approved Loopgraph tools;
- request high-reasoning design;
- persist validated draft proposals.

It may not:

- materialize a LoopSpec without explicit acceptance;
- connect providers or store provider credentials;
- change activation mode;
- execute a business action;
- expose hidden reasoning;
- bypass Loopgraph schema, policy, evidence, or readiness validation.

## Local fallback

If no Hermes webhook URL is configured, the task is still persisted with delivery state `not_configured`. Hermes can claim it later through `loopgraph_hermes_design_tasks_get`, so missing gateway configuration never discards discovery work.
