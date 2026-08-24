# Explain Forecast Variance and Govern Financial Operations

This official Loopgraph App gives Hermes six governed Operations & Finance loops while keeping every financial commitment human-owned.

Hermes receives normalized finance and operations events, resolves the affected forecast, approval, accounting period, invoice, vendor, or resource plan, and chooses exactly one primary loop. A forecast variance may invoke Approval Bottleneck or Resource Allocation only when the signed topology condition is proven. Otherwise Hermes routes one loop or abstains.

## Included loops

- Forecast Variance
- Approval Bottleneck
- Vendor Review
- Close Readiness
- Cash Collection
- Resource Allocation

## Supported stack recipes

- QuickBooks + Stripe + Snowflake + Slack
- NetSuite + Salesforce + Warehouse + Teams

Both recipes are declarative capability mappings. Credentials remain in the Connector Broker and never enter this pack. Installation starts in shadow mode and never enables provider writes.

## Safety model

- Forecast, ledger, receivable, vendor, contract, approval, CRM, analytics, and capacity access is read-only.
- Finance-record changes, remediation tasks, internal messages, and customer collection drafts require exact prepared-action approval.
- Payments, budget movement, forecast mutation, vendor commitments, customer sends, and accounting entries are forbidden by default.
- Missing identity, reconciliation evidence, materiality policy, or accountable ownership causes Hermes to abstain.
- Outcomes return as evidence for forecast accuracy, approval latency, close readiness, cash realization, vendor value, and resource decisions.

Run `loopgraph app validate packs/official/operations-finance/manage-forecast-controls` and `loopgraph app test packs/official/operations-finance/manage-forecast-controls` before publishing or installing a modified version.
