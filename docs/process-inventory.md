# Process Inventory

## Purpose

Process inventory records recurring department work: cadence, triggers, inputs, outputs, systems touched, owners, reviewers, pain points, risk, customer sensitivity, automation mode, and baseline effort.

## Schema

The schema is `ProcessInventoryItemSchema` in `lib/loopgraph-core/process-inventory.ts`.

## Example

Acme's Marketing process is a weekly campaign performance review touching ads, analytics, CRM, and manual uploads.

## CLI Usage

```bash
npm run loopgraph -- discovery start --fixture examples/business-discovery/acme-saas-answers.json --recommend
```

## UI Behavior

Processes render at `/discovery/processes` with recurrence, risk, automation mode, volume, and pain points.

## Testing Notes

`lib/loopgraph-runtime/process-classifier.test.ts` verifies process inventory generation from fixture and minimal company answers.

