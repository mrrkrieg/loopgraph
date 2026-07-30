# Promotion rehearsal

Loopgraph does not promote a loop because an operator supplied an evidence label. It creates a durable rehearsal report bound to the exact project, LoopSpec hash, company graph hash, fixture manifest, current activation mode, and requested next mode.

## Gate

`loopgraph_promotion_rehearsal_run` runs every required check:

1. Simulate the generated happy-path, missing-context, and risk-escalation fixtures.
2. Confirm Hermes routes positive and risk events to the intended loop.
3. Confirm missing-context and unrelated events abstain instead of triggering work.
4. Replay the positive delivery and verify durable duplicate suppression.
5. Inject an intentional routing overlap and verify Hermes requests a human choice.
6. Check the real catalog for unexpected overlaps.
7. Replay the happy path of every other registered loop to catch graph regressions.
8. Reject autonomous promotion when write actions are not strictly low-risk, non-customer-facing, and approval-free.
9. Evaluate precision, recall, false-trigger, miss, abstention, and duplicate-suppression thresholds.

The report is stored under `.loopgraph/graph/rehearsals/`. It expires, is integrity checked, and becomes stale whenever the graph or target LoopSpec changes.

## CLI

```bash
npm run loopgraph -- graph promotion rehearse LOOP_ID \
  --to recommend \
  --by operator@example.com

npm run loopgraph -- graph promotion approve LOOP_ID \
  --to recommend \
  --rehearsal PROMOTION_REHEARSAL_ID \
  --actor operator@example.com \
  --role department_owner \
  --policy promotion-policy/v1 \
  --reason "All required scenarios passed"

npm run loopgraph -- graph promotion apply LOOP_ID \
  --to recommend \
  --rehearsal PROMOTION_REHEARSAL_ID \
  --approval APPROVAL_RECEIPT_ID \
  --by operator@example.com
```

Approval and application must reference the same passing rehearsal. Caller-supplied evidence references may add context, but they cannot replace the canonical rehearsal receipt.

## Hermes and HTTP

Trusted Hermes admin turns receive:

- `loopgraph_promotion_rehearsal_run`
- `loopgraph_promotion_rehearsals_get`
- `loopgraph_loop_promotion_approve`
- `loopgraph_loop_promote`

Webhook-router and lifecycle-router turns do not receive these tools.

The authenticated graph transaction endpoint also accepts `promotion_rehearse` and `promotion_rehearsals_get`. The server always binds operations to `LOOPGRAPH_PROJECT_ROOT`; a caller cannot choose another filesystem root.
