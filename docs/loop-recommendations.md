# Loop Recommendations

## Purpose

Loop recommendations identify useful automation candidates without activating them. A recommendation explains why it exists, department owner, goal, source process, trigger, observed signals, allowed and forbidden actions, approval requirements, verifier, metrics, access needs, value estimate, risk, and readiness.

## Schema

The schema is `LoopRecommendationSchema` in `lib/loopgraph-core/loop-recommendation.ts`.

## Example

Acme's Marketing process produces a Campaign Learning Loop recommendation with ads, analytics, CRM, budget approval, verifier evidence, CPQC metrics, access blockers, and undefined metric warnings.

## CLI Usage

```bash
npm run loopgraph -- discovery recommend acme-saas-discovery
npm run loopgraph -- discovery materialize acme-saas-discovery --accept-all
```

## UI Behavior

Recommendations render at `/discovery/recommendations`. Accept, reject, and edit controls are visible. Only accepted recommendations can materialize.

## Testing Notes

`lib/loopgraph-runtime/discovery-engine.test.ts`, `access-planner.test.ts`, and `topology-discovery.test.ts` verify recommendation generation and accepted-only topology visibility.

