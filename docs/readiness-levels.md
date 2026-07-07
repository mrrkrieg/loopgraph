# Readiness Levels

## Purpose

Readiness prevents premature autonomy. A loop recommendation can be useful while still blocked by missing access, undefined metrics, missing verifiers, or missing human gates.

## Schema

`LoopReadinessSchema` lives in `lib/loopgraph-core/readiness.ts`.

## Levels

- `L0 Draft`: idea exists but is missing goal, owner, metric, or access.
- `L1 Monitor / Report Only`: can observe and report, no external writes.
- `L2 Recommend + Human Approval`: can recommend with approval, verifier, and traceability.
- `L3 Execute Low-Risk Actions`: low-risk allowlisted actions with explicit access, metric, verifier, and safe path.
- `L4 Autonomous Within Guardrails`: low-risk reversible work only, with strong verifier, metrics, audit, and human escalation.

## Example

Acme recommendations start around L2 but remain blocked by missing access and undefined metrics.

## CLI Usage

```bash
npm run loopgraph -- discovery recommend acme-saas-discovery
```

## UI Behavior

Readiness level, score, blockers, and warnings are shown on recommendation cards and materialized LoopSpec metadata.

## Testing Notes

`lib/loopgraph-runtime/loop-readiness.test.ts` verifies caps for missing metrics/verifiers and gates L3/L4.

