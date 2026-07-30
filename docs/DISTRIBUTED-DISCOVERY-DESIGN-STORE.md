# Distributed discovery and design artifacts

Loopgraph keeps local projects simple: discovery sessions, evidence gaps, and Hermes design
artifacts are JSON records under the project's `.loopgraph/` directory. An authenticated hosted
deployment cannot depend on one replica's filesystem, so the same runtime contract selects a
tenant/project-scoped Supabase implementation.

## Stored records

Migration `supabase/migrations/202607300008_distributed_discovery_design_store.sql` adds:

| Record | Mutability | Purpose |
|---|---|---|
| `discovery_sessions` | Revisioned | Confirmed departments, answers, stage, generated recommendations, and accepted design-run references |
| `discovery_evidence_gap_sets` | Monotonic revision | The current bounded set of facts Hermes still needs before it may design or materialize |
| `loop_design_artifacts` | Immutable | The exact bounded context, design run, and proposal set returned by Hermes |

Every primary key includes `organization_id` and `project_key`. Payload sizes are bounded, browser
roles have no table access, direct service-role writes are revoked, and mutations use
service-role-only database functions with an empty `search_path`.

## Consistency contract

Discovery session changes use compare-and-swap:

```text
read revision N
  -> submit complete session revision N+1
  -> database locks the row
  -> commit only if the stored revision is still N
```

This prevents two Hermes turns or two web replicas from silently overwriting each other's answers.
Evidence-gap writes are monotonic and cannot replace a newer derivation with an older one.

A design submission is one transaction:

```text
validate bounded context + run + proposal identities
  -> lock the discovery session
  -> insert immutable design artifact
  -> append designRunId to the session
  -> advance the session to proposal review
  -> commit both records
```

The design-run ID and Hermes submission key make retries idempotent. The application verifies the
stored input/output hashes before accepting a duplicate as the same submission.

## Runtime selection

| Runtime | Store |
|---|---|
| Local CLI or Design Studio | Atomic project-local file store |
| Authenticated hosted deployment | Supabase distributed store |
| Hosted deployment missing its service database or tenant binding | Fail closed |

The hosted APIs, server actions, Hermes design bridge, evidence-gap engine, callback worker, and
proposal reader all receive this store through the shared runtime storage resolver. A discovery
session may therefore start on one replica, receive answers on another, and compile a Hermes
callback on a third without losing state.

## Operations

The protected metrics endpoint exposes:

- `loopgraph_discovery_sessions_total`;
- `loopgraph_discovery_sessions_active`;
- `loopgraph_discovery_evidence_gap_sets_total`;
- `loopgraph_loop_design_artifacts_total`;
- `loopgraph_discovery_oldest_active_seconds`.

Alert on an increasing oldest-active age when users expect active design work. A growing active
session count without new artifacts can indicate missing evidence, an unhealthy Hermes dispatch
path, or proposals that are waiting for review.

## Current boundary

This store makes discovery evidence and pre-materialization design output replica-safe. It does
not yet make the entire control plane multi-writer.

Materialized/versioned LoopSpecs and the active workspace registry now move through the
tenant-scoped transactional store described in
[Versioned LoopSpec registry](./VERSIONED-LOOPSPEC-REGISTRY.md). Semantic graph snapshots and
change sets, opportunities, controller state, measurement jobs, outcomes, and the value ledger
still have project-local paths. Provider credentials and provider API calls remain Hermes-owned
and are intentionally not stored here.

## Verification

Automated tests cover file-store locking and revision conflicts, Supabase adapter scope and
idempotency, hosted resolver fail-close behavior, API propagation, artifact integrity, and
migration security properties. The complete migration chain is also exercised against PostgreSQL
17 for:

- successful and stale compare-and-swap writes;
- monotonic evidence gaps;
- atomic design artifact plus session update;
- duplicate submission suppression;
- tenant-scoped metrics;
- denied `anon` and `authenticated` table reads.
