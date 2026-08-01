# Semantic graph transactions

Hermes can identify missing or weak business loops, but model reasoning is not permission to rewrite the company graph. Loopgraph turns each proposed `add`, `update`, `split`, `merge`, or `retire` operation into a content-bound, accountable, atomic, and reversible transaction.

## Transaction boundary

```text
durable evidence
  -> LoopOpportunity
  -> GraphChangeSet against exact base graph hash
  -> bounded Hermes design
  -> validated proposal set
  -> accountable approval receipt
  -> atomic graph transaction
  -> result snapshot + operation receipts
  -> rehearsal / promotion evidence
```

The registered LoopSpecs remain the authoritative graph. A transaction computes graph identity from the actual validated spec content—not only registry paths—so editing a registered LoopSpec invalidates an older approval.

## Invariants

- Every semantic mutation is bound to the exact reviewed base graph hash.
- An approval receipt records actor, role, policy, reason, evidence, decision, change-set hash, and approved operation IDs.
- A stale proposal fails closed; it cannot overwrite a newer graph.
- `update`, `split`, and `merge` must name existing target loops and accepted validated proposals.
- Retired loops are removed from routing eligibility and their generated assets are archived in the transaction snapshot.
- A failed apply restores the exact base snapshot and records the failed transaction.
- Promotion follows the ordered sequence `simulate → shadow → recommend → execute_with_approval → autonomous_low_risk`.
- Paused and retired loops are unavailable to Hermes routing.
- Rollback is allowed only while the current graph still equals the selected transaction result.
- Webhook-router and lifecycle-router Hermes turns cannot access approval, mutation, promotion, lifecycle, or rollback tools.

## Hermes administration tools

The project-bound `loopgraph_admin` MCP profile exposes:

| Tool | Purpose |
|---|---|
| `loopgraph_graph_change_decide` | Approve or reject the exact proposed graph operations |
| `loopgraph_graph_change_apply` | Atomically apply an approved add/update/split/merge/retire change set |
| `loopgraph_graph_history_get` | Inspect snapshots, approvals, transactions, promotions, and rollbacks |
| `loopgraph_promotion_rehearsal_run` | Run and persist the complete content-bound promotion gate |
| `loopgraph_promotion_rehearsals_get` | Inspect rehearsal reports by report or loop |
| `loopgraph_loop_promotion_approve` | Approve one ordered activation-mode transition |
| `loopgraph_loop_promote` | Apply the promotion only with the same passing rehearsal used for approval |
| `loopgraph_loop_lifecycle_approve` | Approve pausing or resuming one loop |
| `loopgraph_loop_lifecycle_set` | Apply the approved lifecycle transaction |
| `loopgraph_graph_rollback_approve` | Approve rollback of a specific committed transaction |
| `loopgraph_graph_rollback` | Restore the exact pre-transaction snapshot |

The generated Hermes skill tells Hermes to explain the opportunity and operations first, preserve returned receipt IDs, and never interpret chat text as an approval receipt.

## Local CLI

Review and approve a proposed change set:

```bash
npm run loopgraph -- graph change decide CHANGE_SET_ID \
  --decision approved \
  --approved-changes CHANGE_1,CHANGE_2 \
  --actor operator@example.com \
  --role owner \
  --policy graph-policy/v1 \
  --reason "Approved after reviewing the proposed Product loops" \
  --evidence review:product-2026-07 \
  --project .
```

Apply the approved design:

```bash
npm run loopgraph -- graph change apply CHANGE_SET_ID \
  --approval APPROVAL_RECEIPT_ID \
  --design-run DESIGN_RUN_ID \
  --proposals PROPOSAL_1,PROPOSAL_2 \
  --by operator@example.com \
  --project .
```

Inspect the durable history:

```bash
npm run loopgraph -- graph history --project .
npm run loopgraph -- graph history --transaction TRANSACTION_ID --project .
```

Promotion, lifecycle, and rollback each use two commands so the approval and mutation cannot be collapsed into one unreviewed action:

```bash
npm run loopgraph -- graph promotion rehearse LOOP_ID \
  --to recommend \
  --by operator@example.com \
  --project .

npm run loopgraph -- graph promotion approve LOOP_ID \
  --to recommend \
  --rehearsal PROMOTION_REHEARSAL_ID \
  --actor operator@example.com \
  --role owner \
  --policy promotion-policy/v1 \
  --reason "Routing evaluation passed" \
  --evidence routing-evaluation:EVALUATION_ID \
  --project .

npm run loopgraph -- graph promotion apply LOOP_ID \
  --to recommend \
  --rehearsal PROMOTION_REHEARSAL_ID \
  --approval APPROVAL_RECEIPT_ID \
  --by operator@example.com \
  --project .
```

Equivalent command groups are available under `graph lifecycle` and `graph rollback`.

## Authenticated HTTP API

```text
GET  /api/graph/transactions
POST /api/graph/transactions
```

Both methods require:

```text
Authorization: Bearer $LOOPGRAPH_WORKER_API_TOKEN
```

GET accepts `transactionId`, `snapshotId`, `approvalReceiptId`, `promotionReceiptId`, `rehearsalReportId`, `changeSetId`, or `loopId` filters.

POST accepts one of:

```text
decide
apply
history
promotion_approve
promotion_rehearse
promotion_rehearsals_get
promote
lifecycle_approve
lifecycle_set
rollback_approve
rollback
```

The API always binds the operation to `LOOPGRAPH_PROJECT_ROOT`; a caller-supplied `projectRoot` is ignored.

## Durable storage

Local installations keep portable graph history beside the project:

```text
.loopgraph/graph/
  approvals/
  promotions/
  rehearsals/
  snapshots/
  transactions/
  assets/
  transaction.lock
```

Writes are atomic, transaction application is lock-protected, and generated asset restoration is confined to project-local Loopgraph paths.

Authenticated hosted deployments use tenant/project-scoped PostgreSQL tables for snapshots, approval receipts, transactions, promotions, rehearsals, and idempotent graph commit receipts. One `commit_semantic_graph_transaction` database transaction:

1. locks the active LoopSpec workspace revision;
2. fences the mutation against the exact active `{loopId, versionHash}` set;
3. verifies the approved receipt is present and bound to the transaction kind and base graph;
4. inserts immutable LoopSpec versions and replaces the active registry;
5. advances the workspace revision;
6. stores base/result snapshots, the transaction, optional promotion, rollback updates, and the applied change set;
7. returns the original receipt on an identical retry.

Browser roles receive no direct table writes or function execution. The service runtime receives read access and execute access only to the tenant-scoped RPCs. Hosted mutation fails closed if the semantic store or active LoopSpec registry is not distributed.

Graph snapshots include the validated spec and fixture payloads, so rollback can restore a retired version without depending on whatever files or active rows happen to exist later.

## Promotion boundary

Promotion requires a passing, unexpired rehearsal report bound to the exact graph hash, LoopSpec hash, loop ID, and requested next activation mode. Loopgraph verifies the report both when approval is issued and when the transaction is applied. Arbitrary evidence labels cannot satisfy the gate. See [Promotion rehearsal](./PROMOTION-REHEARSAL.md).

## Remaining boundary

The semantic graph and active LoopSpec registry are now multi-replica authorities. Measurement jobs, outcome samples/evaluations, and value-ledger records remain the next distributed data boundary. Provider OAuth, API execution, and subscription application remain Hermes-owned integration work.
