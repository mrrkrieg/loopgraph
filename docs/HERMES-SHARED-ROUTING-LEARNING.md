# Hermes shared routing learning

Hermes should not route a company event from static trigger rules alone. It should be able to see whether similar routing decisions were correct, whether humans corrected them, whether the selected loops changed an observed business outcome, and whether the work created net value after supervision and connector cost.

Loopgraph compiles that evidence into `routing-learning-context/v1alpha1` and returns it from `loopgraph_events_ingest` beside the eligible routing cards. The context is a bounded, provider-payload-free projection; it is not a second router and it grants no authority. Ingest also returns `learningContextDigest`, a full SHA-256 semantic digest that intentionally excludes only the packet generation timestamp.

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

## Evidence-to-decision binding

The event-router skill must echo `learningContextDigest` through `loopgraph_routing_decision_submit`. At submission time Loopgraph reloads the event, current routing catalog, evaluations, corrections, outcomes, and value ledger; recompiles the bounded packet; and compares its semantic digest with the one Hermes acknowledged.

- A match stores `routing-learning-context-binding/v1alpha1` with the complete bounded packet, digest, acknowledgement, and binding time inside the durable routing attempt.
- A supplied mismatch creates a durable rejected attempt and no route commit. Hermes must re-ingest before it reasons again.
- The isolated `webhook_router` MCP profile advertises the digest as required and rejects an omitted or malformed value before decision submission. An omitted digest remains valid only on trusted admin/legacy surfaces, where the attempt is marked unacknowledged so the UI never implies stronger proof than exists.
- If evidence cannot be loaded or safely bounded, Loopgraph records a small typed `unavailable` packet with a fixed redacted warning. It never stores the underlying infrastructure error.

The Management routing receipt shows the acknowledgement state, digest, evidence counts, and per-loop summary. The correlation timeline adds the binding as a separate event. The event-routing projection draws a non-executable advisory-evidence node into the Hermes decision while preserving the executable event-to-decision edge. This makes the evidence that influenced one historical decision inspectable even after newer outcomes and corrections arrive.

The local shadow-route simulator follows the same evidence-bound path: it ingests the event, retains the returned digest, and submits that digest with the deterministic rehearsal decision. A passing local rehearsal therefore proves the binding contract rather than silently producing a legacy unacknowledged receipt.

## Measuring whether Hermes improves

`routing-learning-effectiveness/v1alpha1` aggregates the durable routing ledger without copying provider payloads or hidden reasoning. It keeps these signals separate:

- committed and rejected decisions;
- acknowledged, unacknowledged, and pre-binding historical attempts;
- stale evidence packets rejected before work was created;
- explicit abstentions and human-review requests;
- accountable human corrections;
- golden-event evaluation pass/fail results;
- per-loop selections, expected selections, evaluation quality, and correction selections.

The `/operate/learning` view presents that routing-quality report beside business outcome evidence. A loop being selected frequently is therefore never presented as proof that it is accurate or valuable. Operators can see whether Hermes used the current packet, whether the route matched evaluated expectations, whether a human corrected it, and separately whether the resulting loop improved a measured outcome.

Local projects compile this report from the project-scoped file routing store. Hosted deployments resolve the same compiler through the tenant/project-scoped distributed routing store used by event ingest and Management. Authenticated hosted mode fails closed when that authority is unavailable; it never substitutes a replica-local file ledger that could show a partial or cross-replica routing history. Outcome and measurement rows on the same page resolve through their distributed evidence stores for the same reason.

## Interfaces

- Event tool: `loopgraph_events_ingest`
- Schema resource: `loopgraph://schemas/routing-learning-context`
- Binding schema resource: `loopgraph://schemas/routing-learning-context-binding`
- Trusted effectiveness tool: `loopgraph_routing_learning_effectiveness_get`
- Native skill: `loopgraph:event-router`
- Source-checkout skill: `loopgraph-event-router`
- Compiler: `packages/loopgraph/src/runtime/routing-learning-context.ts`
- Effectiveness compiler: `packages/loopgraph/src/runtime/routing-learning-effectiveness.ts`
- Operator view: `/operate/learning`
