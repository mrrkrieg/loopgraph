# Distributed opportunity and controller runtime

Loopgraph continuously turns operating evidence into governed work:

```text
events, jobs, reviews, outcomes, and schedules
  -> durable controller trigger
  -> one leased controller run
  -> explainable opportunity score
  -> proposed graph change
  -> Hermes design task or accountable review
```

Local projects keep this state in `.loopgraph/`. Authenticated hosted
deployments use a tenant/project-scoped PostgreSQL store so any replica can
enqueue evidence, claim work, inspect decisions, or render the operating view.

## Storage model

Migration
`supabase/migrations/202607300010_distributed_opportunity_controller.sql`
adds:

| Record | Purpose |
|---|---|
| `loop_opportunities` | Explainable, generation-preserving business opportunities |
| `loop_graph_change_sets` | Versioned graph proposals produced from opportunities |
| `loop_controller_runs` | Idempotent runs, evidence fingerprints, policy decisions, and errors |
| `loop_controller_state` | Saved policy and the latest durable checkpoint |
| `loop_controller_triggers` | Lease-safe event/schedule/review/outcome work queue |
| `loop_controller_leases` | Renewable single-writer leases for controller and maintenance work |

Every primary key includes `organization_id` and `project_key`. Payloads are
bounded. Browser roles have no direct table or function access. Service-role
writes go through security-definer functions with an empty PostgreSQL
`search_path`.

## Trigger correctness

Trigger identity binds the project, trigger type, and source trigger ID.
Enqueue replay returns the existing receipt rather than creating duplicate
work.

Claims use `FOR UPDATE SKIP LOCKED`, increment attempts, and attach a UUID
lease with an explicit expiry. Completion or failure must present that same
lease UUID. A stale worker cannot overwrite the result of a reclaiming worker.

The higher-level controller uses a renewable project lease. It prevents two
replicas from evaluating the same evidence and dispatching competing Hermes
design tasks at the same time. Completed, failed, and disabled controller runs
are terminal and remain bound to their original idempotency key.

## Opportunity correctness

An opportunity ID is permanently bound to its evidence fingerprint and
generation. Later evidence can update score and state, but cannot reuse the
identity for a different opportunity. A new post-implementation recurrence
creates a new generation instead of erasing history.

Proposed graph changes are stored beside opportunities, but they do not grant
graph-mutation authority. Authenticated hosted mode now applies only strict
policy-qualified shadow additions through the distributed semantic graph and
active LoopSpec registry transaction. If any required store is missing or
file-backed, automatic mutation fails closed and returns `review_change`.

## Runtime selection

| Runtime | Store |
|---|---|
| Local CLI, MCP, and browser | `FileLoopControllerStore` and `FileLoopOpportunityStore` |
| Authenticated hosted deployment | `SupabaseLoopControllerStore` and `SupabaseLoopOpportunityStore` |
| Hosted deployment without service storage or tenant binding | Fails closed |

The controller API, controller cron, weekly management cycle, route-job worker,
review actions, opportunities API, graph-change read API, and Operate view use
the shared stores.

## Operations

Protected metrics expose:

- total and currently qualified opportunities;
- proposed graph changes;
- total and failed controller runs;
- pending, processing, and failed controller triggers;
- expired trigger leases and oldest pending age;
- active controller leases.

Alert on expired leases, a growing oldest-pending age, repeated failed runs, or
qualified opportunities that do not progress to Hermes design or accountable
review.

## Verification

Coverage includes:

- local file-store compatibility;
- adapter scope validation and returned-payload validation;
- atomic enqueue, claim, settle, and renewable lease calls;
- hosted resolver isolation and fail-closed behavior;
- API injection and operational metrics;
- full migration-chain execution on PostgreSQL 17;
- behavioral assertions for replay, stale leases, run identity, tenant
  isolation, and direct privilege denial.

## Remaining boundary

Connection/measurement/outcome/value state and real Hermes-owned provider
onboarding still need distributed production implementations.
