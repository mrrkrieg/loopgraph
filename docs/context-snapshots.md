# Context snapshots

Loopgraph V1 treats the **ContextSnapshot** as an immutable, reproducible view of everything the loop could see before acting. It is compiled deterministically from fixture or adapter reads at simulation start.

## Precedence order

Context entries are sorted by explicit `precedence` rank from the LoopSpec:

1. Global policy
2. Organization / account context
3. Parent loop outputs
4. Current loop configuration
5. Integration / source data (fixture-backed in V1)
6. Trace summaries
7. Scoped memory
8. Current event payload
9. Tool and action policy
10. Verifier configuration
11. Escalation and approval rules

Higher-precedence sources win when values conflict. Informational topology edges (`reports_to`, `learns_from`) never inject executable instructions.

## Entry fields

Each entry includes:

| Field | Purpose |
|-------|---------|
| `sourceId` | Stable identifier from the LoopSpec |
| `sourceType` | e.g. policy, integration, event |
| `title` | Human-readable label |
| `value` | Resolved payload (may be null when missing) |
| `retrievedAt` | From fixture `simulatedAt` in V1 |
| `freshness` | `fixture` in deterministic mode |
| `sensitivity` | Drives redaction policy |
| `trusted` | Whether text may influence tool selection |
| `redactionApplied` | Whether restricted data was masked |
| `contentHash` | SHA-256 slice of normalized value |
| `precedence` | Numeric rank |

## Trust boundaries

- Issue bodies, ticket bodies, and imported documents are **untrusted** (`trusted: false`).
- Instructions embedded in untrusted text cannot override system or loop policy.
- Tool policy and forbidden-action rules are evaluated after context compilation.

## Reproducibility

- Snapshot ID and content hash are assigned once at compile time and never mutate.
- Same LoopSpec version + fixture → identical `contentHash`.
- Hashes use stable JSON key ordering; `undefined` values hash as the string `"undefined"`.

## Token budget

V1 records a rough `tokenEstimate` (serialized value length). Full truncation policies are deferred; specs may declare precedence to drop lower-priority sources first.

See also: [trace-model.md](./trace-model.md), [loop-spec.md](./loop-spec.md).
