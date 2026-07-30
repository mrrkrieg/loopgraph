# Hermes design dispatch queue

Hosted Loopgraph deployments must not depend on a single web request remaining alive long enough
to deliver design work to Hermes. Migration
`supabase/migrations/202607300006_hermes_design_dispatch_queue.sql` adds a tenant-scoped outbound
queue and makes design-task creation plus initial dispatch enqueue one database transaction.

Local CLI and MCP projects remain file-backed and dispatch directly when a Hermes webhook is
configured. The file store also records a small recovery transaction before it writes a task and
job, so interrupted local queued operations can be repaired on the next store operation.

## Delivery lifecycle

```text
discovery / opportunity / controller
  -> HermesDesignTask + HermesDesignDispatchJob (one commit)
  -> queued
  -> claimed with an expiring lease
  -> signed Hermes webhook
  -> completed
       or failed -> exponential retry -> dead_letter
  -> task delivery receipt reconciled from terminal job state
```

The dispatch request is the validated `hermes-design-request/v1alpha1` contract. Its idempotency
key is derived from the task and request content. Repeated starts or evidence resumes therefore
reuse the same outbound job when the request has not changed, while a materially changed request
creates a new job.

Workers increment the attempt count when they claim work, not after network completion. A worker
that stops after sending cannot silently reclaim the same lease. When the lease expires, another
worker may retry until `maxAttempts` is reached. The worker reconciles completed and dead-lettered
jobs back into the task receipt before claiming new work, repairing a process stop between the
job transition and task update.

## Hosted endpoints

The dedicated worker endpoint is:

```text
POST /api/hermes/design-dispatch/worker
```

It requires `Authorization: Bearer $LOOPGRAPH_WORKER_API_TOKEN` and the
`hermes.design_dispatch` machine capability.

The scheduled endpoint is:

```text
GET|POST /api/cron/hermes-design
```

It requires `Authorization: Bearer $CRON_SECRET` and the `schedule.hermes_design` capability.
`vercel.json` runs it every five minutes. A separate worker service may call the worker endpoint
more frequently when lower dispatch latency is required.

Required Hermes delivery configuration:

```bash
LOOPGRAPH_HERMES_WEBHOOK_URL=https://hermes.example/webhooks/loopgraph-design
LOOPGRAPH_HERMES_WEBHOOK_SECRET=<dedicated-route-secret>
```

Do not reuse the worker, cron, callback, or provider secrets for outbound webhook signing.

## Database boundary

`hermes_design_dispatch_jobs` stores normalized status, attempt, schedule, and lease columns plus
the schema-validated job payload. Browser roles have no access. The service role may select
tenant-scoped records but may mutate them only through bounded functions:

- `create_hermes_design_task_with_dispatch`
- `compare_and_swap_hermes_design_task_with_dispatch`
- `enqueue_hermes_design_dispatch_job`
- `claim_hermes_design_dispatch_jobs`
- `compare_and_swap_hermes_design_dispatch_job`

Claims use `FOR UPDATE SKIP LOCKED`. Updates require both the expected revision and, for a claimed
job, the expected lease token. Payloads are capped at 1 MiB. Organization and project scope are
part of every key and database operation.

## Operations

The protected operational snapshot and Prometheus endpoint expose:

- queued and running Hermes dispatch jobs;
- dead-letter jobs;
- jobs currently due;
- expired leases;
- age of the oldest due job.

Alert on any dead-letter job, sustained expired leases, or oldest-due age above the expected
delivery service level. A dead-letter job leaves its task failed unless that task was already
completed or cancelled.

## Remaining boundary

This queue closes the outbound task-delivery gap. Incoming Hermes callbacks are still compiled
inline after the replay guard accepts them. A process stop in that interval requires a durable
callback inbox and callback worker; that is a separate control-plane slice.
