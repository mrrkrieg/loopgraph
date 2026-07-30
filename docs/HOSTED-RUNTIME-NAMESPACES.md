# Hosted runtime namespaces

Loopgraph's package runtime stores routing decisions, jobs, controller checkpoints, graph
transactions, design tasks, measurements, outcomes, and local execution evidence under a project
`.loopgraph/` directory. That is appropriate for a local project, but an authenticated hosted
deployment must never fall back to the repository checkout or share one implicit process root.

## Required binding

Authenticated hosted mode resolves runtime state as:

```text
LOOPGRAPH_HOSTED_RUNTIME_ROOT/
└── <LOOPGRAPH_HOSTED_ORGANIZATION_ID>/
    └── <LOOPGRAPH_HOSTED_PROJECT_KEY or default>/
        └── .loopgraph/
```

Required configuration:

```dotenv
LOOPGRAPH_HOSTED_MODE=1
LOOPGRAPH_HOSTED_ORGANIZATION_ID=123e4567-e89b-12d3-a456-426614174000
LOOPGRAPH_HOSTED_RUNTIME_ROOT=/var/lib/loopgraph
LOOPGRAPH_HOSTED_PROJECT_KEY=main
```

The organization must be a UUID and the project key is a constrained lowercase slug. Hosted mode
ignores `LOOPGRAPH_PROJECT_ROOT` and fails closed when the hosted root or organization binding is
missing. This prevents a production request from silently reading or writing the application
checkout.

The authenticated database organization and runtime namespace use the same deployment binding.
An account that belongs to a different organization receives no access to the deployment. When an
organization binding already exists, onboarding cannot create a disconnected organization; an
owner must invite the account.

## Storage requirements

`LOOPGRAPH_HOSTED_RUNTIME_ROOT` must be:

- outside the source checkout;
- writable only by the runtime service account;
- backed by an encrypted persistent volume;
- included in backup and restore procedures;
- mounted consistently for every process that is allowed to operate the project.

Do not point this variable at `/tmp`, a Vercel function filesystem, or another ephemeral serverless
directory. The public Vercel preview is illustrative and does not run private durable company work.

File storage adapters are cached by resolved namespace rather than in one process-global slot. A
request for organization A can therefore never reuse organization B's file adapter.

## Current scaling boundary

This namespace closes accidental cross-tenant filesystem sharing. Routing events, problems,
Hermes decisions, route commits, corrections, evaluations, and route jobs now use the
tenant/project-scoped Supabase routing store in authenticated hosted mode. Route-job claims are
atomic across replicas and use leases plus revision fencing.

Design tasks, graph transactions, controller triggers, measurement jobs, outcomes, and generated
LoopSpec artifacts still have file-backed paths. Until those move, only the routing queue/worker
boundary may be scaled horizontally; do not treat the full control plane as multi-writer. The
remaining stores need:

- atomic claim/update operations;
- leases and fencing tokens;
- organization and project keys on every row;
- idempotency constraints scoped to the tenant;
- retry/dead-letter state;
- append-only mutation receipts;
- transactionally consistent graph snapshots.

See [Distributed Hermes routing store](./DISTRIBUTED-ROUTING-STORE.md) for the implemented queue
protocol and exact remaining boundary.
