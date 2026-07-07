# Access Plan

## Purpose

Access planning declares which systems, variables, and actions are required before a loop can run safely. No live integrations or external writes are required for V1.2.

## Schema

`AccessRequirementSchema` lives in `lib/loopgraph-core/access-requirements.ts`.

## Example

Campaign Learning requires ads spend, analytics conversion rate, CRM qualified lead status, experiment brief drafting, and human approval before budget changes.

## CLI Usage

```bash
npm run loopgraph -- discovery recommend acme-saas-discovery
```

The generated session includes `accessRequirements`.

## UI Behavior

The grouped access plan is `/access-plan`. Discovery access context is also visible at `/discovery/access`.

## Testing Notes

`lib/loopgraph-runtime/access-planner.test.ts` verifies Marketing, Sales, and Customer Success access requirements.

