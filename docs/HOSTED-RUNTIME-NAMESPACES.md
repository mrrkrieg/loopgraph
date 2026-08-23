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

Detached private App artifacts are the exception to this filesystem authority. In hosted mode,
their immutable archives live in the private `loopgraph-app-snapshots` Supabase Storage bucket.
The runtime root holds only a verified, disposable read-through cache. A new replica can recover
the exact detached artifact from the shared lifecycle receipt and object store without sharing a
volume with the worker that performed the detach.

Do not point this variable at `/tmp`, a Vercel function filesystem, or another ephemeral serverless
directory. The public Vercel preview is illustrative and does not run private durable company work.

File storage adapters are cached by resolved namespace rather than in one process-global slot. A
request for organization A can therefore never reuse organization B's file adapter.

## Current scaling boundary

This namespace closes accidental cross-tenant filesystem sharing. Routing events, problems,
Hermes decisions, route commits, corrections, evaluations, and route jobs now use the
tenant/project-scoped Supabase routing store in authenticated hosted mode. Route-job claims are
atomic across replicas and use leases plus revision fencing.

Hermes design tasks, callback receipts, outbound design dispatch, the leased inbound callback
inbox, discovery sessions, evidence-gap sets, and immutable design contexts/runs/proposals now use
a shared Supabase boundary in hosted mode. Accepted LoopSpec versions, fixtures, and the active
workspace registry use that same tenant/project boundary, and materialization completes the
discovery transition in the registry transaction. Opportunities, proposed graph changes,
controller policies/checkpoints/runs, and controller triggers also use tenant/project-scoped
Supabase stores; queue claims use row locks and UUID lease fencing, and the controller holds a
renewable database lease. Graph snapshots, approvals, transactions, promotions, rehearsals,
rollback state, immutable versions, and the active graph now share one tenant-scoped atomic
PostgreSQL commit. Hosted automatic shadow mutation is allowed only when all required controller,
design, registry, opportunity, and graph stores are distributed.

Measurement bindings and jobs, reconciliation reports, metric samples, observed outcomes, and
value-ledger records use the tenant/project-scoped Supabase evidence store in authenticated hosted
mode. Job claims are database-atomic across replicas, carry bounded leases and hashed fencing
tokens, and fail finalization when the active lease no longer matches. Metric samples, outcomes,
and value entries are immutable by tenant-scoped identity; a conflicting replay fails at the
database boundary. Canonical company entities and provider aliases use a separate distributed
entity-resolution store whose uniqueness boundary prevents one provider object from mapping to
multiple company objects.

Hosted resolution for the learning/value and entity planes is fail-closed. If Supabase authority or
the deployment organization binding is unavailable, the runtime rejects the request instead of
using the local file adapters. File stores remain an explicit local-project implementation only and
are cached by resolved project namespace so two local projects do not share evidence or identity.

The executable [hosted learning and entity staging gate](./HOSTED-LEARNING-ENTITY-STAGING-GATE.md)
actively exercises cross-client claims, stale-lease rejection, finalization visibility, all three
immutable evidence types, provider-alias uniqueness, and nonce-authorized exact cleanup against a
deployed staging database. Workflow activation is intentionally paired with making its receipt a
mandatory signed promotion input. Applying the migrations and producing that environment-specific receipt remains an
operator action. Database restore behavior stays part of the separate isolated recovery rehearsal;
neither missing receipt is a reason to fall back to replica-local files.

See [Distributed Hermes routing store](./DISTRIBUTED-ROUTING-STORE.md),
[Distributed Hermes design store](./DISTRIBUTED-HERMES-DESIGN-STORE.md),
[Versioned LoopSpec registry](./VERSIONED-LOOPSPEC-REGISTRY.md),
[Distributed opportunity and controller runtime](./DISTRIBUTED-OPPORTUNITY-CONTROLLER.md),
[Hermes design dispatch queue](./HERMES-DESIGN-DISPATCH-QUEUE.md), and
[Hermes design callback inbox](./HERMES-DESIGN-CALLBACK-INBOX.md), and
[Distributed discovery and design artifacts](./DISTRIBUTED-DISCOVERY-DESIGN-STORE.md) for the
implemented protocols and exact remaining boundary.
See [Hosted App snapshots](./HOSTED-APP-SNAPSHOTS.md) for the detach authority, bucket, recovery,
and backup contract.
