# Distributed Hermes design store

Loopgraph keeps local CLI and MCP projects portable by storing Hermes design tasks under
`.loopgraph/hermes/`. Hosted deployments need a shared transaction boundary because task
creation, Hermes delivery, evidence answers, controller scans, and signed callbacks may run on
different web or worker replicas.

Migration `supabase/migrations/202607300005_distributed_hermes_design_store.sql` adds that hosted
boundary.

## State and invariants

`hermes_design_tasks` stores the validated `HermesDesignTask` payload with tenant/project scope,
queryable session and status columns, and a monotonic revision. A partial unique index permits
only one active task for the same idempotency key. Failed or cancelled tasks do not block an
explicit retry.

`hermes_design_callbacks` is an append-only callback audit keyed by tenant, project, and callback
ID. Its foreign key binds every callback to the task it changed.

The database functions enforce three transitions:

1. `create_hermes_design_task` creates or returns the active idempotent task.
2. `compare_and_swap_hermes_design_task` rejects stale revisions and immutable identity changes.
3. `apply_hermes_design_callback` locks the task, records the callback, and updates the task in
   one transaction. Duplicate callback IDs return the current task without applying the update.

The Next.js storage resolver selects `SupabaseHermesDesignStore` when Supabase, a server-only
service credential, and `LOOPGRAPH_HOSTED_ORGANIZATION_ID` are configured. Otherwise it selects
`FileHermesDesignStore`.

Hosted design-task APIs, evidence-gap resume, opportunity scans, and controller runs all receive
the same store. This means a callback received by replica B can complete a task dispatched by
replica A, and a later controller run can observe the completed design.

Hosted outbound delivery is now backed by the
[Hermes design dispatch queue](./HERMES-DESIGN-DISPATCH-QUEUE.md). Task creation plus initial
dispatch enqueue is atomic, and leased workers handle retries and dead-letter transitions.

## Access boundary

- Both tables have RLS enabled.
- `anon` and `authenticated` have no table or function access.
- `service_role` can select scoped records but cannot insert or update tables directly.
- Only the three bounded `SECURITY DEFINER` functions may mutate design state.
- Each JSON payload is an object capped at 1 MiB.
- Every application query includes organization and project filters.
- Function execution is revoked from `PUBLIC` before being granted to `service_role`.

The service credential must never be exposed through a `NEXT_PUBLIC_` variable or browser bundle.

## Callback behavior

The signed callback route still verifies HMAC, timestamp freshness, credential identity, replay
identity, and rate limits before it calls the design store. Database callback application then
protects task state from cross-replica lost updates.

The intentionally explicit remaining reliability boundary is callback proposal compilation,
which currently runs inline before the final callback transaction. The hosted replay guard prevents the
same callback ID from being accepted twice, but a process failure after guard acceptance and
before callback completion needs a durable callback inbox plus retry worker. Until that exists,
operate the callback endpoint with platform retries and alert on accepted machine requests that
do not produce a matching `hermes_design_callbacks` record.

## Validation

The migration is tested for:

- active-task idempotency;
- retry after terminal failure/cancellation;
- revision conflicts;
- atomic callback/task updates and duplicate callbacks;
- browser-role denial and service-role RPC-only mutation;
- concurrent creation producing exactly one active task.

The full migration chain is also compiled against PostgreSQL 17 in a disposable database during
release verification.
