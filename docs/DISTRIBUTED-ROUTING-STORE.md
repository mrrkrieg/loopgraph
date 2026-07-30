# Distributed Hermes routing store

Local Loopgraph projects remain file-backed and portable: events, decisions, jobs, and traces live
under the project's `.loopgraph/` directory. An authenticated hosted deployment has a different
requirement. Hermes may submit a decision to one web replica while another replica claims and
executes its route job.

Migration `supabase/migrations/202607300004_distributed_routing_store.sql` provides that shared
routing boundary.

## What is shared

`routing_state_records` stores tenant/project-scoped:

- event receipts;
- business problems;
- Hermes routing attempts;
- immutable route commits and their lifecycle status;
- human corrections;
- router evaluations.

`route_jobs` stores normalized query fields beside the validated `RouteJob` JSON payload. This
lets workers filter by status, event, problem, commit, or loop without trusting JSON-path scans.
The full supporting state is shared so a worker that did not ingest the event can still verify the
event → problem → attempt → commit → job binding.

Both tables:

- use organization and project in the primary key;
- enable RLS and revoke browser-role access;
- accept service-role access only;
- cap each JSON record at 1 MiB;
- keep a monotonic revision number.

The server automatically selects this store when Supabase, the service-role key, and
`LOOPGRAPH_HOSTED_ORGANIZATION_ID` are configured. Local CLI and MCP use continue selecting
`FileRoutingStore`; installing Loopgraph does not create hosted sample data.

## Queue protocol

1. An accepted Hermes route creates a deterministic job and calls `enqueue_route_job`.
2. The tenant-scoped idempotency key makes repeated submissions return the existing job.
3. A worker calls `claim_due_route_jobs`.
4. PostgreSQL selects due rows with `FOR UPDATE SKIP LOCKED`, increments the attempt, creates a
   unique lease token, and returns the claimed payload in one transaction.
5. Heartbeats and terminal transitions call `compare_and_swap_route_job` with the row revision and
   expected lease token.
6. A stale revision retries from fresh state. A stale lease cannot write completion after another
   worker reclaimed the job.
7. Review reconciliation uses a separate atomic claim over `waiting_review` jobs.

Before that sequence, `create_routing_event_receipt` wins a unique tenant/project/event identity.
Concurrent provider retries can therefore produce only one set of routing candidates; later
deliveries are recorded as duplicates without asking Hermes to reason or enqueue work again.

The operator retry and cancellation API uses the same shared store, so changes are visible to
every worker replica.

## Hosted configuration

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
LOOPGRAPH_HOSTED_MODE=1
LOOPGRAPH_HOSTED_ORGANIZATION_ID=YOUR_ORGANIZATION_UUID
LOOPGRAPH_HOSTED_PROJECT_KEY=main
LOOPGRAPH_WORKER_API_TOKEN=SEPARATE_LONG_RANDOM_TOKEN
LOOPGRAPH_WORKER_CREDENTIAL_ID=worker_primary
```

Apply migrations before starting the worker. The protected operational metrics endpoint exposes:

- queued/retrying jobs;
- claimed/running jobs;
- jobs waiting for review;
- dead-letter jobs;
- currently claimable jobs;
- expired leases;
- age of the oldest due job.

Alert on dead letters, expired leases, and sustained oldest-due age. These are database-derived
deployment metrics, not one replica's memory.

## Remaining distributed boundary

Routing decisions and route jobs are now safe to share across web/worker replicas. Other runtime
subsystems still have file-backed stores, including design tasks, controller triggers,
measurements, graph transactions, and some generated LoopSpec artifacts. Do not call the whole
runtime horizontally scalable until those stores and versioned artifacts receive equivalent
tenant-scoped atomic persistence.
