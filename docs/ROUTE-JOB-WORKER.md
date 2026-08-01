# Durable Hermes Route-Job Worker

Hermes decides which registered loop should handle a business problem. Loopgraph turns that bounded decision into a durable route commit and route job. The worker is the only runtime component allowed to move that job from an accepted route into a governed loop run.

```text
provider event
  -> Hermes Brain
  -> validated RoutingDecision
  -> immutable RouteCommit + RouteJob
  -> Loopgraph worker validates immutable bindings
  -> local simulation OR signed live assignment to Hermes
  -> Hermes task / tool / approval / output / outcome events
  -> Loopgraph trace and operational read model
```

## Run it

Process one batch:

```bash
npm run loopgraph -- worker run --project .
```

Keep a local worker polling:

```bash
npm run loopgraph -- worker run --project . --watch --interval 5
```

Hermes can invoke the same bounded admin operation with `loopgraph_route_worker_run`. That tool is intentionally absent from the isolated `webhook_router` and `lifecycle_router` MCP exposure profiles.

Inspect jobs with `loopgraph_route_jobs_get`. A failed or dead-letter job can be requeued only with an explicit actor and reason:

```bash
npm run loopgraph -- worker retry --project . \
  --job <job-id> \
  --by operator@example.com \
  --reason "Connector recovered after credential rotation"
```

Cancellation uses the same explicit audit fields:

```bash
npm run loopgraph -- worker cancel --project . \
  --job <job-id> \
  --by operator@example.com \
  --reason "Business problem was closed manually"
```

## Activation behavior

| Loop activation mode | Worker behavior |
|---|---|
| `shadow` | Runs a deterministic local simulation and records evidence; no provider write is committed. |
| `recommend` | Prepares the governed recommendation and review evidence; no provider write is committed. |
| `simulate` | Runs locally with the normalized event and immutable route binding. |
| `execute_with_approval` | Dispatches to a healthy capability-matching Hermes runtime. Hermes reports any exact approval request and does not continue a rejected action. |
| `autonomous_low_risk` | Dispatches to Hermes only after the routing and promotion policy has bounded the loop to low-risk execution. |

All accepted activation modes produce route jobs. This is intentional: shadow and recommendation traffic must also produce traces and outcomes so Loopgraph can evaluate routing quality and identify missing or weak loops.

## Safety invariants

- Local claims are serialized with an atomic project-local file lock.
- Hosted claims use tenant-scoped PostgreSQL rows, `FOR UPDATE SKIP LOCKED`, revisions, and lease
  fencing so independent replicas cannot claim the same job.
- Every claim has a unique lease token; a stale worker cannot finish a job after another worker reclaims it.
- Expired `claimed` or `running` jobs are reclaimable, while active leases suppress duplicate work.
- The worker reloads the registered LoopSpec and compares its hash to both the route commit and job before every run.
- Event, problem, route attempt, loop, and LoopSpec bindings must agree.
- Loopgraph notification-only lifecycle events are blocked from re-entering business execution.
- Provider webhook text is never used as a direct execution instruction.
- Simulation, shadow, and recommendation modes cannot perform live writes.
- Loopgraph never executes provider tools for a route job whose `executionTarget.runtime` is `hermes`.
- A live job remains `dispatched` until its assigned Hermes runtime reports `run.started`.
- Every Hermes execution event is bound to workspace, company, agent, route job, route commit, route attempt, source event, problem, loop, LoopSpec hash, run, correlation, and monotonic sequence.
- Duplicate event deliveries are idempotent; reused sequence numbers or changed idempotency payloads fail closed.
- `execute_with_approval` rejects allowed actions that are not explicitly approval-bound.
- Retry uses bounded exponential backoff; exhausted work moves to `dead_letter`.
- Manual retry and cancellation require an actor and reason.
- Started, review-required, completed, failed, and escalation states are prepared as signed notification-only lifecycle events for Hermes.

## HTTP operation

The Studio exposes `POST /api/routing/worker` and `POST /api/routing/jobs/:jobId`. These HTTP endpoints always require `LOOPGRAPH_WORKER_API_TOKEN`, including on localhost. Local CLI and project-scoped MCP operations do not use the HTTP endpoint and remain available to the trusted local operator.

HTTP-based Hermes execution additionally requires:

```bash
LOOPGRAPH_WORKER_API_TOKEN=<strong-random-token>
LOOPGRAPH_PUBLIC_URL=https://loopgraph.example.com
LOOPGRAPH_HERMES_EXECUTION_URL=https://hermes.example.com/loopgraph/assignments
LOOPGRAPH_HERMES_EXECUTION_SECRET=<outbound-shared-secret-at-least-32-characters>
LOOPGRAPH_HERMES_EXECUTION_CALLBACK_SECRET=<inbound-shared-secret-at-least-32-characters>
LOOPGRAPH_HERMES_EXECUTION_ENVIRONMENT=production
```

`LOOPGRAPH_HERMES_LIFECYCLE_SECRET` is optional for a local-only project. When it is absent, Loopgraph creates a project-local random signing key at `.loopgraph/hermes/lifecycle-signing.key` with owner-only permissions. Do not commit that generated key. Hosted or multi-process installations should provide the shared secret through their approved secret store.

Do not store environment-provided secrets in `.loopgraph/` or commit them to Git.

See [Distributed Hermes routing store](./DISTRIBUTED-ROUTING-STORE.md) for hosted persistence,
atomic claim semantics, and the remaining horizontal-scaling boundary.
