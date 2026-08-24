# Provider detector scheduler

The provider detector scheduler turns bounded warehouse observations into verified company events for Hermes. It is the intake path for sources such as BigQuery and Snowflake that do not naturally push one useful business event per problem.

```text
approved warehouse view
  -> fixed broker-owned query template
  -> durable detector window + lease
  -> material rows only
  -> signed EventEnvelope
  -> Hermes Brain
  -> Loopgraph route validation and department loop
```

It does not route to a loop. Hermes receives the event and decides whether it represents a new problem, more evidence for an existing problem, one eligible route, permitted fan-out, or an ambiguous case that requires a human.

## Built-in detector catalog

Each active BigQuery or Snowflake installation with `provider.events.emit` receives three schedules:

| Detector | Normalized event | Company object | Default cadence |
|---|---|---|---|
| `company-metrics.detect` | `management.company_metric_anomaly` | `company_metric_anomaly` | 60 minutes |
| `finance-forecast.detect` | `finance.forecast_variance_detected` | `forecast_window` | 60 minutes |
| `capacity-plan.detect` | `capacity.plan_changed` | `capacity_plan` | 60 minutes |

The detector operations reuse the corresponding credential-owned `.query` template. A caller cannot supply SQL, a URL, a project, a database, a schema, a warehouse, a role, or a table name.

## Required query result contract

An approved query returns no more than 100 rows with these columns:

| Column | Required | Contract |
|---|---:|---|
| `event_id` | yes | Stable provider-side identity for the business observation, at most 256 characters |
| `subject_id` | yes | Stable ID of the affected company object, at most 256 characters |
| `occurred_at` | yes | ISO-8601 timestamp inside the leased evidence window |
| `material` | yes | Explicit boolean; false rows are ignored and missing/invalid values fail closed |
| `payload_json` | yes | JSON object, at most 128 KiB; it cannot override the detector's event or subject type |
| `correlation_id` | no | Existing business-problem identity when the view can provide one |
| `untrusted_fields_json` | no | JSON list of `normalizedPayload.*` paths that Hermes must treat as untrusted text |

Duplicate `event_id` values are accepted only when their complete normalized row is identical. Conflicting duplicates pause the schedule instead of guessing. Results outside the claimed window, oversized payloads, missing materiality, unexpected row shapes, or more than 100 rows also pause the schedule.

Example BigQuery shape:

```sql
select
  anomaly_id as event_id,
  metric_id as subject_id,
  observed_at as occurred_at,
  abs(percent_delta) >= 20 as material,
  to_json_string(struct(metric_id, current_value, baseline_value, percent_delta)) as payload_json,
  cast(null as string) as correlation_id,
  to_json_string(['normalizedPayload.note']) as untrusted_fields_json
from approved.company_metric_anomalies
where observed_at >= @window_start
  and observed_at < @window_end
limit @limit
```

The Snowflake template emits the same ordered columns and binds `windowStart`, `windowEnd`, and `limit` through its declared `binding_order`.

## Delivery and checkpoint semantics

`provider_detector_schedules` stores the cadence, checkpoint, pending window, retry state, and a SHA-256 hash of the current lease token. `provider_detector_runs` stores one durable status record per evidence window. Both tables are RLS-enabled, revoked from browser roles, and available only to `service_role`.

The worker:

1. synchronizes schedules from active warehouse installations;
2. claims at most five due schedules with `FOR UPDATE SKIP LOCKED` and a five-minute fencing lease;
3. executes the fixed read-only template through the Connector Broker as `system:provider-detector`;
4. validates the result contract and computes a result hash;
5. signs a detector receipt over tenant, installation, detector, window, broker receipt, result hash, and event identity;
6. processes the five claims concurrently and forwards each claim's events in batches of ten using workload identity;
7. advances the checkpoint only after every material event is accepted.

Transient provider or Hermes failures retain the exact pending window and retry with exponential backoff from five minutes to one hour. After ten attempts, or after a non-retryable contract violation, the schedule enters `dead_letter` and is paused. Events already accepted before a retry keep the same deterministic envelope identity, so Hermes can suppress duplicate work.

The raw query result is process-local. The detector path deliberately bypasses the generic broker response cache. Durable state contains hashes, receipt IDs, window metadata, event IDs, status, and a bounded error code—not provider rows or credentials.

## Deployment

1. Apply `supabase/migrations/20260813200615_provider_detector_scheduler.sql` after the connector and warehouse-provider migrations.
2. Configure the Connector Broker vault, tenant-owned warehouse identity, and approved `.query` templates.
3. Grant the installation only `provider.events.emit` and the provider's read-only scope.
4. Configure `CRON_SECRET`, `HERMES_WEBHOOK_URL`, `LOOPGRAPH_HERMES_WEBHOOK_AUDIENCE`, `LOOPGRAPH_WEBHOOK_RECEIPT_SIGNING_KEY_REF`, and `LOOPGRAPH_WEBHOOK_RECEIPT_KEY_ID`.
5. Grant the cron workload `schedule.connector_detectors` and the Hermes destination audience through workload identity.
6. Run the worker in staging and confirm positive, no-change, duplicate, malformed-row, Hermes-outage, expired-lease, retry, and dead-letter cases before production.

Vercel invokes `/api/connector-broker/v1/workers/provider-detectors` every five minutes. The schedule uses UTC. The endpoint accepts GET or POST only after the existing cron/workload-identity guard succeeds.

## Security boundaries

- The public Connector Broker execute endpoint rejects `provider.events.emit`; only the in-process authenticated scheduler can invoke detector operations.
- The broker additionally requires a system actor and forbids loop context because detection happens before routing.
- Warehouse credentials remain in the configured tenant vault and are resolved only for the fixed provider request.
- Detector query results are never written to the broker response cache, logs, traces, schedule rows, or run rows.
- The schedule lease token is returned once to the worker and stored only as a hash.
- A tenant/provider/connection/capability kill switch prevents claims before credential resolution.
- Checkpoints do not advance on partial delivery, ambiguous materiality, invalid evidence, Hermes rejection, or lease loss.

This implementation supplies the durable intake mechanism. Operators must still create and review the tenant's approved warehouse views, validate their business definition of materiality, configure cloud IAM, and prove that the resulting loops create net value.
