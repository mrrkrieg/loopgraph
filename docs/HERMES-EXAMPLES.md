# Hermes Examples

These examples all keep Hermes Agent as the company brain. External events terminate at Hermes, Hermes submits a bounded routing decision, and Loopgraph validates/materializes/runs only through the registered local workspace.

## Marketing: Ads + Content Creation

Reference fixture:

```text
packages/loopgraph/src/runtime/fixtures/golden-marketing-reference-flow.json
```

This is the main happy-path example:

```text
Hermes Brain -> Marketing -> Ads
Hermes Brain -> Marketing -> Content Creation
```

It proves that Marketing can split one department into two different loops with separate routing contracts:

- Google Ads-style campaign events route to `marketing_ads`.
- Notion/content events route to `marketing_content_creation`.
- Both start from synthetic fixtures and manual fallbacks before live connectors.

Regression:

```bash
npm test -- packages/loopgraph/src/runtime/golden-marketing-flow.test.ts
```

## Sensitive department: Legal / Compliance Evidence Review

Reference fixture:

```text
packages/loopgraph/src/runtime/fixtures/sensitive-legal-reference-flow.json
```

This example demonstrates strict blocking for sensitive work. The answers intentionally request `execute_with_approval`, but the deterministic fallback caps the generated loop at `shadow` because legal/compliance work must not become autonomous from a setup interview.

Expected graph:

```text
Hermes Brain -> Legal / Compliance -> Legal / Compliance Evidence Review
```

Safety properties:

- `legal_compliance_evidence_review` accepts Hermes-normalized `vanta*` / `questionnaire.*` events.
- Required event fields include approved source refs, an expert reviewer, and redaction confirmation.
- Draft evidence packets and external questionnaire answers both require approval.
- External questionnaire drafts are marked critical and customer/partner-facing.
- Forbidden actions include legal advice, risk acceptance, contract changes, access approval, and external sends.
- Live execution remains blocked by shadow activation and missing live connector instances.
- Fixture routing creates a shadow route commit and no route job.

Regression:

```bash
npm test -- packages/loopgraph/src/runtime/hermes-published-examples.test.ts
```

## Custom department: Field Ops custom-app route

Reference fixture:

```text
packages/loopgraph/src/runtime/fixtures/custom-ops-reference-flow.json
```

This example shows how a workflow that does not fit a built-in department can still use the same Hermes brain pattern.

Expected graph:

```text
Hermes Brain -> Custom -> Custom Operating Loop
```

Behavior:

- `custom_operating_loop` accepts Hermes-normalized `custom_app*` / `custom_work_item.*` events.
- The loop starts in `recommend` mode, which still records a shadow route commit and does not execute live work.
- The generated fixture can be used for both Hermes route rehearsal and local LoopSpec simulation.
- Forbidden actions prevent vendor dispatch, spend approval, cancellation, or schedule changes without approval.

Regression:

```bash
npm test -- packages/loopgraph/src/runtime/hermes-published-examples.test.ts
```
