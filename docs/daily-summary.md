# Daily Summary

## Purpose

The daily summary gives operators a company-level view of loop state, department health, blocked access, undefined metrics, open reviews, escalations, hidden labor, net saved time, and recommended next actions.

## Schema

`DailySummarySchema` lives in `lib/loopgraph-core/daily-summary.ts`.

## Example

The Acme daily summary shows health, net saved minutes, botsitting minutes, blocked loops, undefined metrics, and access/metric next actions.

## CLI Usage

```bash
npm run loopgraph -- daily-summary generate
```

## UI Behavior

The summary is at `/daily`; undefined metrics are at `/daily/undefined-metrics`.

## Testing Notes

`lib/loopgraph-runtime/daily-summary-generator.test.ts` verifies missing access status and hidden-labor subtraction.

