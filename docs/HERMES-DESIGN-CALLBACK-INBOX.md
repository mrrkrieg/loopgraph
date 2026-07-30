# Hermes design callback inbox

Hermes design callbacks are signed external requests. Verifying a signature is not enough: a
hosted replica must persist the accepted callback before it can acknowledge delivery. Migration
`supabase/migrations/202607300007_hermes_design_callback_inbox.sql` adds that durable boundary.

## Acceptance contract

```text
Hermes signed callback
  -> verify HMAC, timestamp, route task ID, and 1 MiB body limit
  -> authorize replay/rate policy + enqueue callback job (one database transaction)
  -> return 202 with the durable job receipt
  -> leased worker compiles and applies the callback
       -> completed
       or failed -> exponential retry -> dead_letter
```

The callback job is a versioned `hermes-design-callback-job/v1alpha1` object. Its immutable
identity binds:

- organization and project scope;
- design task ID;
- callback ID;
- deterministic job and idempotency keys;
- the SHA-256 digest of the exact signed request body.

An exact retry returns the existing job with HTTP `200`. Reusing the callback identity with a
different body hash is rejected. The first accepted request calls
`authorize_machine_request` and `enqueue_hermes_design_callback_job` inside
`authorize_and_enqueue_hermes_design_callback`. If enqueue validation fails, PostgreSQL rolls
back the replay receipt, rate counter, audit append, and callback write together.

Local projects use the same job contract in `.loopgraph/hermes/design-callback-jobs/`. After
persisting the callback, the local route opportunistically runs the callback worker so MCP-first
development remains immediate without requiring a scheduler.

## Worker lifecycle

Workers claim due callbacks using `FOR UPDATE SKIP LOCKED`, increment the attempt count at claim
time, and receive an expiring lease token. Every completion or failure update requires both the
expected revision and expected lease token.

The worker invokes the canonical `processHermesDesignCallback` path. That path may:

- acknowledge task delivery;
- merge focused evidence gaps;
- compile a submitted proposal set;
- update task failure state.

Proposal callbacks pass a callback-derived submission idempotency key into the design compiler.
If a worker stops after writing the design run but before recording the callback on the task, the
retry resolves to the same design-run ID instead of creating another proposal artifact. If the
task already contains the callback ID, the worker treats processing as a successful duplicate and
completes the inbox job.

Claims that fail use bounded exponential retry. A final failed attempt becomes `dead_letter` and
retains the bounded error and callback receipt for operator inspection.

## Hosted endpoints

Hermes submits signed callbacks to:

```text
POST /api/hermes/design-tasks/:taskId/callback
```

Required callback configuration:

```dotenv
LOOPGRAPH_HERMES_CALLBACK_SECRET=<dedicated-signing-secret>
LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID=hermes_callback
LOOPGRAPH_HERMES_CALLBACK_RATE_LIMIT_PER_MINUTE=60
```

The dedicated worker endpoint is:

```text
POST /api/hermes/design-callbacks/worker
```

It requires `Authorization: Bearer $LOOPGRAPH_WORKER_API_TOKEN` and the
`hermes.design_callback_process` capability.

The scheduled endpoint is:

```text
GET|POST /api/cron/hermes-callbacks
```

It requires `Authorization: Bearer $CRON_SECRET` and the `schedule.hermes_callbacks` capability.
`vercel.json` invokes it every five minutes.

Callback signing, worker, cron, outbound Hermes webhook, and provider credentials must remain
separate.

## Database and security boundary

Browser roles have no access to `hermes_design_callback_jobs`. The service role may read
tenant-scoped rows and may mutate them only through bounded functions:

- `authorize_and_enqueue_hermes_design_callback`
- `enqueue_hermes_design_callback_job`
- `claim_hermes_design_callback_jobs`
- `compare_and_swap_hermes_design_callback_job`

Every function uses an empty `search_path`; all public, anonymous, authenticated, and service-role
function privileges are revoked before the required service-role grants are added. Payloads are
capped at 1 MiB, and every table key and query includes organization and project scope.

## Operations

The protected Prometheus endpoint exposes:

- queued and running callback jobs;
- dead-letter callback jobs;
- callbacks due now;
- expired leases;
- age of the oldest due callback.

Alert on any dead-letter callback, sustained expired leases, or oldest-due age above the expected
Hermes design latency. A dead-letter callback means Hermes supplied a valid signed result that
Loopgraph could not compile or apply and requires explicit operator review.

## Remaining boundary

The callback inbox closes accepted-but-unrecoverable inbound delivery. Discovery/evidence
sessions, design-run artifacts, graph transactions, controller state, measurements, and outcomes
still need distributed tenant-scoped stores before the whole hosted control plane is safe for
multiple writers.
