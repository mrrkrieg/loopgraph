# Hermes shared routing learning

Hermes should not route a company event from static trigger rules alone. It should be able to see whether similar routing decisions were correct, whether humans corrected them, whether the selected loops changed an observed business outcome, and whether the work created net value after supervision and connector cost.

Loopgraph compiles that evidence into `routing-learning-context/v1alpha1` and returns it from `loopgraph_events_ingest` beside the eligible routing cards. The context is a bounded, provider-payload-free projection; it is not a second router and it grants no authority.

## Evidence joined for one event

The compiler scopes every source to the event workspace and company, then joins:

- routing fixture evaluations associated with events in the same scope;
- accountable human routing corrections;
- historical problems for the same exact subject or the same unambiguous canonical company entity across provider aliases;
- observed outcomes for currently eligible loops or subject-related problems;
- value-ledger entries linked to those outcomes;
- declared supporting loops and loops that previously handled the same subject.

For each relevant loop Hermes receives counts, bounded record IDs, latest evidence time, observed outcome status, and observed net saved minutes. Raw provider payloads, correction prose, metric samples, credentials, monetary details, and hidden model reasoning are not copied into the context.

## Decision boundary

The context is always marked `authority: advisory` and carries this invariant:

> Only currently eligible routing cards may be selected; learning evidence cannot authorize a route, fan-out, execution, or provider action.

Historical evidence can help Hermes distinguish, for example, a campaign that creates cheap but unqualified leads from one that creates pipeline. It cannot make the Sales loop eligible for a Marketing event when the current event contract, readiness, exclusions, or topology do not permit that route.

An unavailable evidence store returns a typed `unavailable` context with no invented history. A duplicate delivery returns `not_applicable`, instructing Hermes to reuse the original durable decision instead of reasoning again. Source collections and the response are capped; a truncation flag tells Hermes when it is seeing only the newest bounded sample.

## Example

```text
campaign.performance_anomaly
        │
        ▼
Hermes Brain
        ├── eligible cards: Marketing / Ads
        ├── prior correction: Ads selected by Growth owner
        ├── Ads outcome: qualified CAC improved
        ├── Ads value: observed positive net minutes
        └── related Sales outcome: qualification rate improved
                │
                └── advisory only; Sales remains ineligible unless its own card matches
```

Hermes can use this packet to explain a route, lower confidence, append evidence to an existing problem, or abstain. Loopgraph still validates the submitted decision against the current immutable LoopSpec catalog before it creates any route commit.

## Interfaces

- Event tool: `loopgraph_events_ingest`
- Schema resource: `loopgraph://schemas/routing-learning-context`
- Native skill: `loopgraph:event-router`
- Source-checkout skill: `loopgraph-event-router`
- Compiler: `packages/loopgraph/src/runtime/routing-learning-context.ts`
