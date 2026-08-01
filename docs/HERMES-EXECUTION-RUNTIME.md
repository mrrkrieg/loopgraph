# Hermes execution runtime

Hermes is both Loopgraph's company-event router and the runtime that performs live agent work. Loopgraph is the governed control plane and operational system of record.

```text
provider signal
  -> Hermes normalizes the event and identifies the business problem
  -> Loopgraph validates the proposed department loop
  -> durable RouteCommit + RouteJob
  -> Loopgraph selects a healthy capability-matching Hermes runtime
  -> signed immutable execution assignment
  -> Hermes performs tasks and tool calls under the LoopSpec policy
  -> ordered execution events return to Loopgraph
  -> trace, approval state, output, outcome, value, and future routing evidence
```

## The execution contract

A live assignment binds all of these values before work begins:

- workspace and company
- Hermes agent instance
- source event and business problem
- route attempt, route commit, and route job
- loop ID and immutable LoopSpec hash
- run ID and correlation ID
- activation mode and required connector capabilities

Hermes must return the same binding on every execution event. A mismatch is rejected rather than attached to the wrong company, loop, or run.

The event ledger accepts:

- `assignment.received`
- `run.started`, `run.completed`, `run.failed`
- `task.started`, `task.completed`, `task.failed`
- `tool.started`, `tool.completed`, `tool.failed`
- `approval.requested`, `approval.resolved`
- `output.created`
- `outcome.observed`

Each event has an idempotency key and monotonic run sequence. Retries of the exact event are suppressed. Reusing an idempotency key with changed content or reusing a sequence for a different event fails closed.

## Local MCP integration

The generated `loopgraph_admin` MCP profile exposes four runtime operations:

1. `loopgraph_hermes_agent_register`
2. `loopgraph_hermes_agent_heartbeat`
3. `loopgraph_hermes_execution_event_ingest`
4. `loopgraph_agent_operations_get`

Registration contains only agent identity, version, environment, capability keys, optional loop assignments, and labels. Provider credentials remain inside Hermes.

## HTTP integration

Loopgraph dispatches assignments to `LOOPGRAPH_HERMES_EXECUTION_URL`. Both outbound assignments and inbound callbacks use `timestamp.body` HMAC-SHA256 signatures and a five-minute replay window. Production URLs must use HTTPS.

Hermes calls:

- `POST /api/hermes/agents`
- `POST /api/hermes/agents/:agentId/heartbeat`
- `POST /api/hermes/executions/events`

Hosted mode adds tenant-scoped machine credentials, rate limits, organization binding, PostgreSQL uniqueness, RLS, service-role-only storage, payload caps, and immutable foreign-key bindings back to the route job and registered agent.

## What appears in Agent Activity

Open `/operate/activity` to see:

- incoming source and event type
- the problem Hermes identified
- selected department and LoopSpec
- assigned Hermes runtime and health
- task progress, tool-call count, and approvals
- outputs and observed outcomes
- current route-job and trace status
- failures that need an operator

The hosted preview uses illustrative multi-department activity. A clean local workspace intentionally has no fake agents, events, loops, or outcomes.

## Security rules

- Never send tokens, passwords, cookies, authorization headers, or raw provider payloads in execution events.
- Tool inputs and outputs are represented by durable redacted references.
- An agent heartbeat cannot grant capabilities or re-enable a disabled agent.
- Only a healthy agent in the requested environment with every required capability can receive an assignment.
- Loopgraph does not execute provider tools for Hermes-targeted jobs.
- Customer-facing and high-risk actions remain approval-bound by the LoopSpec and promotion policy.
