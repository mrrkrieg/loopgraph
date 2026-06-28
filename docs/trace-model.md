# Trace model

Every V1 run produces a complete **LoopRunTrace** persisted under `.loopgraph/traces/{runId}.json`.

## Status semantics

| Status | Meaning |
|--------|---------|
| `COMPLETED` | Verifiers passed; mock commits recorded where allowed |
| `WAITING_FOR_REVIEW` | Prepared actions require human approval |
| `FAILED_VERIFICATION` | Schema, evidence, or verifier gate failed |
| `BLOCKED_BY_POLICY` | Forbidden action or policy block |
| `ESCALATED` | Typed EscalationCase created; may also await review |
| `APPROVED` / `COMMITTED` / `REJECTED` | Review lifecycle transitions |

The deterministic simulator reaches `COMPLETED` or `WAITING_FOR_REVIEW` for hero fixtures; other states are represented in the schema for forward compatibility.

## Deterministic IDs

| ID | Derivation |
|----|------------|
| `idempotencyKey` | hash(loopSpecVersion + trigger source + eventId) |
| `runId` | `run_` + hash(loopSpecHash + idempotencyKey) |
| Context snapshot ID | `ctx_` + hash(snapshot body) |
| Prepared action fingerprint | hash(normalized payload) |

No `Date.now()` in hashes — use fixture `simulatedAt`.

## Trace sections

- LoopSpec version and hash
- Trigger reference and inputs
- Immutable ContextSnapshot
- Agent structured output
- Proposed and prepared actions (with fingerprints)
- Tool call log (mock commit in V1)
- Policy decisions
- Verification results
- Escalation case references
- Human review records
- Errors, latency, estimated cost placeholders

## Replay rules

Traces are append-only audit artifacts. Re-running the same fixture produces the same summary fields (see `fixtures/expected-traces/*.summary.json`).

CLI: `npm run loopgraph -- trace <runId>`

See also: [approval-model.md](./approval-model.md), [escalation-case.md](./escalation-case.md).
