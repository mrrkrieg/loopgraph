# Daily Summary

## Purpose

The daily summary gives operators a project-bound view of loop state, department health, blocked access, undefined metrics, open reviews, escalations, evidence-backed hidden labor, net saved time, and recommended next actions.

## Schema

`DailySummarySchema` lives in `packages/loopgraph/src/core/daily-summary.ts`.

## Example

The hosted preview shows a modeled sample company. A local workspace shows only its registered loops and evidence. With no local loops or ledger entries, the page reports an incomplete empty state rather than sample-company data or guessed value.

## CLI Usage

```bash
npm run loopgraph -- daily-summary generate
```

## UI Behavior

The summary is at `/daily`; undefined metrics are at `/daily/undefined-metrics`. Value fields distinguish `observed`, `modeled`, and `incomplete` evidence.

## Testing Notes

`lib/loopgraph-runtime/daily-summary-generator.test.ts` verifies empty local truth, missing access, and ledger-based hidden-labor subtraction.
