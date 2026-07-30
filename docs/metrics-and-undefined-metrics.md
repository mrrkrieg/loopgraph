# Metrics And Undefined Metrics

## Purpose

Metric planning defines success metrics and keeps unmeasurable metrics explicit. Gross time savings are not treated as value until review, rework, escalation, governance, and botsitting are subtracted.

## Schema

`MetricDefinitionSchema` and `UndefinedMetricSchema` live in `packages/loopgraph/src/core/metric-definition.ts`. `MetricSample`, `ObservedOutcome`, and `ValueLedgerEntry` are documented in [Outcomes and value](./OUTCOMES-AND-VALUE.md).

## Example

`cost_per_qualified_customer` remains undefined if CRM qualified lead status is missing. `net_saved_minutes` remains incomplete until value evidence exists; a forecast is shown only when explicitly stored as modeled evidence.

## CLI Usage

```bash
npm run loopgraph -- metrics undefined
```

## UI Behavior

Metric plans are shown at `/discovery/metrics`. Undefined metrics are shown at `/daily/undefined-metrics`.

## Testing Notes

`lib/loopgraph-runtime/metric-planner.test.ts` verifies missing integration and missing baseline detection.
