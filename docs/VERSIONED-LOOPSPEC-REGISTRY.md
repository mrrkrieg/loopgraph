# Versioned LoopSpec registry

Loopgraph has one canonical contract between design and execution: the active
LoopSpec registry. A proposal is not routable merely because Hermes generated
it. It becomes routable only after Loopgraph validates it and atomically commits
an immutable version plus an active workspace entry.

## Why this boundary exists

Local projects can safely keep LoopSpecs and fixtures in `.loopgraph/`. A hosted
deployment may materialize on one replica, route an event on another, and run
the job on a third. Those replicas cannot rely on a shared checkout or one
process's filesystem.

The registry makes this sequence durable:

```text
Hermes proposal accepted
  -> validate LoopSpec and routing contract
  -> generate bounded synthetic fixtures
  -> lock tenant/project workspace revision
  -> insert immutable 256-bit LoopSpec version
  -> activate that version in the registry
  -> update the workspace
  -> complete the discovery-session transition
  -> write one idempotent commit receipt
```

All database changes above occur in one PostgreSQL transaction. A conflict
leaves neither a partially active loop nor a falsely completed discovery
session.

## Storage model

Migration `supabase/migrations/202607300009_versioned_loop_spec_registry.sql`
adds four tenant/project-scoped records:

| Record | Mutability | Purpose |
|---|---|---|
| `loop_spec_workspaces` | Revisioned | Active project registry and compare-and-swap revision |
| `loop_spec_versions` | Immutable | Validated spec, registry entry, fixtures, source, and full SHA-256 version digest |
| `loop_spec_registry` | Replaceable pointer | One active version per loop ID for design, routing, execution, and UI readers |
| `loop_spec_commits` | Immutable receipt | Idempotency binding and the exact workspace/artifact/discovery result |

Every key includes `organization_id` and `project_key`. Payload sizes and batch
size are bounded. Browser roles have no direct table or function access.
Service-role reads are allowed, while writes must use the
`commit_loop_spec_registry` function with an empty PostgreSQL `search_path`.

## Hashes and execution binding

The immutable registry version uses a full 64-character SHA-256 digest. The
existing compact runtime `loopSpecHash` remains the route/job binding used by
the current execution protocol. Routing workers always recompute that runtime
binding from the active validated spec before running a job. These identities
serve different purposes:

- the full digest protects immutable version history and collision resistance;
- the compact runtime hash preserves compatibility with existing route, run,
  and trace contracts.

The two must not be substituted for one another.

## Runtime behavior

| Runtime | Behavior |
|---|---|
| Local CLI, MCP server, or browser | Reads and writes project-local LoopSpec files through `FileLoopSpecRegistryStore` |
| Authenticated hosted deployment | Reads and commits through `SupabaseLoopSpecRegistryStore` |
| Hosted deployment without service database or tenant binding | Fails closed |

Hosted proposal materialization, design context duplicate detection, routing
catalog reads, route-job execution, routing operations, and the Design Studio
workspace now use this store. The hosted graph therefore shows the LoopSpecs
Hermes actually created even when the legacy `loops` table is empty.

## Concurrency and retry rules

- Workspace activation uses an expected revision.
- Discovery completion uses its own expected revision in the same transaction.
- A commit ID and idempotency key must identify the same receipt on replay.
- An immutable `(loop ID, version digest)` cannot be reused with different
  content.
- Route jobs remain bound to the runtime hash captured when Hermes committed
  the route; a later active version cannot silently change an already queued
  job.

## Operations

Protected metrics expose:

- `loopgraph_active_loop_specs`;
- `loopgraph_immutable_loop_spec_versions`;
- `loopgraph_loop_spec_commits`;
- `loopgraph_loop_spec_workspace_revision`.

Alert when materialization failures rise, registry revisions stop advancing
while proposal acceptance continues, or active specs unexpectedly fall below
the expected tenant baseline.

## Current boundary

This registry completes the distributed design-to-routing handoff. The
[distributed opportunity and controller runtime](./DISTRIBUTED-OPPORTUNITY-CONTROLLER.md)
now covers opportunity/change-set records plus controller triggers, runs,
policies, checkpoints, and leases. Semantic graph snapshots, approvals,
transactions, promotions, provider measurement jobs, outcome windows, and the
value ledger still need tenant/project stores. Real provider OAuth, webhook
subscription application, and write-capable API clients remain Hermes-owned
integration work.

## Verification

Automated coverage includes:

- file-store revision fencing, idempotent receipts, fixture confinement, and
  path-escape rejection;
- Supabase adapter tenant validation, full-digest integrity, hosted source
  references, and atomic RPC inputs;
- distributed materialization with a single discovery transition;
- routing catalog reads from active distributed artifacts;
- migration security and observability contracts;
- the complete migration chain and transactional behavior against PostgreSQL
  17.
