# Run the Company Operating System

This official Loopgraph App gives Hermes six governed Management loops that connect department outcomes to company decisions and system improvement without transferring leadership authority to the agent.

Hermes receives normalized company events, resolves the affected review, metric, loop, decision, resource plan, or repeated failure pattern, and selects one primary route. Metric and loop-health work may invoke supporting decision, resource, or improvement loops only when the signed topology condition is proven.

## Included loops

- Company Operating Review
- Company Anomaly Review
- Loop Health Review
- Management Decision Memo
- Management Resource Allocation
- Company System Improvement

## Supported stack recipes

- Loopgraph + Snowflake + Slack
- Loopgraph + BigQuery + Teams

The app uses Loopgraph's own topology, routing, outcome, value, correction, and reliability records as the management system of record, joined to bounded warehouse, forecast, capacity, and task evidence. Credentials remain in the Connector Broker.

## Safety and value model

- Hermes assembles evidence, options, tradeoffs, and follow-through; leadership decides strategy, budget, hiring, priorities, legal matters, and high-risk customer actions.
- Company metrics retain definitions, baselines, windows, dimensions, sources, materiality, confidence, and conflicts.
- Loop value includes connector, execution, review, supervision, reliability, failure, and organizational-change cost.
- Semantic graph changes are exact proposals with approvals, tests, rollback, and outcome windows; Hermes cannot apply or promote them.
- Every loop begins in shadow mode, missing evidence causes abstention, and simulation performs zero provider writes.

Run `loopgraph app validate packs/official/management/run-company-operating-system` before publishing or installing a modified version.
