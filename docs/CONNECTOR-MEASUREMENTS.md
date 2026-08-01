# Hermes connector measurements

Loopgraph can turn a designed metric into a repeatable evidence contract without taking possession of provider credentials.

```text
provider credentials + API client
              owned by Hermes
                     |
                     | claim exact query / return evidence
                     v
Loopgraph metric binding -> measurement job -> MetricSample
                                             -> ObservedOutcome
                                             -> controller trigger
```

All provider webhooks still terminate at Hermes. Scheduled metric reads use a trusted Hermes administration/collector turn, never the isolated webhook-router turn.

## Contracts

### Connection instance

`loopgraph_connections_register` records only:

- a known connector manifest;
- enabled read/event/write capability names;
- granted scope names;
- environment and read/write policy;
- status;
- an opaque `hermes://`, `keychain://`, `vault://`, or `env-ref://` credential reference.

It rejects raw credential strings. The referenced token or OAuth grant remains in Hermes or its credential store.

After a provider read probe, Hermes calls `loopgraph_connections_health_report` with status, check time, collector identity, latency, a stable error code, and evidence references. Loopgraph never needs the probe's authorization header or response body.

### Metric binding

`loopgraph_metric_bindings_set` binds one registered metric definition to:

- one registered loop;
- one connector instance and read capability;
- one provider resource and field path;
- one timestamp field and aggregation;
- bounded filters and optional grouping;
- one unit, cadence, measurement window, and collection lag;
- a role: `primary`, `leading`, or `guardrail`;
- an explicit guardrail comparator and threshold when the role is `guardrail`.

Loopgraph validates the registered loop, metric key, connector capability, and minimum granted scopes before saving the binding. Revisions are optimistic and content-bound; changing a binding makes already-created jobs stale instead of silently running a different query.

### Measurement job

`loopgraph_measurements_schedule` creates deterministic jobs for aligned windows. Repeated scheduling returns the existing jobs.

A trusted Hermes collector:

1. calls `loopgraph_measurement_jobs_claim`;
2. receives the exact structured query and a short-lived opaque lease;
3. executes that query through the referenced Hermes connector;
4. calls `loopgraph_measurement_jobs_complete` with the value, observation time, quality, and at least one durable provider evidence reference;
5. calls `loopgraph_measurement_jobs_fail` when collection fails.

Lease tokens are hashed at rest. Expired claims can be reclaimed. Repeated failures end in durable dead-letter state.

When two complete primary windows exist, Loopgraph treats the earlier window as the baseline and the current window as observed evidence. It waits until every enabled guardrail has both windows, evaluates the outcome, records the guardrail receipt, and enqueues the continuous controller. Missing evidence remains missing.

## Local CLI

```bash
# Register non-secret connector metadata and health
npm run loopgraph -- connections register --project . --file connection.json
npm run loopgraph -- connections health --project . --file connection-health.json

# Bind, schedule, collect, and reconcile
npm run loopgraph -- measurements bindings set --project . --file activation-binding.json
npm run loopgraph -- measurements bindings list --project . --loop product_activation
npm run loopgraph -- measurements schedule --project . --backfill 2
npm run loopgraph -- measurements jobs claim --project . --by hermes-analytics-collector
npm run loopgraph -- measurements jobs complete --project . --file measurement-result.json
npm run loopgraph -- connections reconcile --project .
npm run loopgraph -- connections reports --project .
```

Reconciliation checks missing/degraded connections, stale health, missing capabilities/scopes, missing or stale Hermes webhook manifests, and overdue measurement jobs. Every report also produces a `connector_health` controller trigger.

## Authenticated scheduling

The runtime exposes:

- `GET|POST /api/measurements`, protected by `LOOPGRAPH_WORKER_API_TOKEN`;
- `GET|POST /api/cron/measurements`, protected by `CRON_SECRET`.

The cron endpoint creates due jobs and reconciliation reports. It does not call a provider. A trusted Hermes collector still claims and completes the jobs.

The server binds every request to `LOOPGRAPH_PROJECT_ROOT`; a caller-supplied project path is ignored. Measurement, connection, and reconciliation tools exist only on the trusted `loopgraph_admin` MCP profile. Webhook-router and lifecycle-router profiles cannot see or call them.

## Local storage

```text
.loopgraph/
  connections/
    instances.json
  measurements/
    bindings.json
    jobs/
    reconciliation/
  outcomes/
    metric-samples/
    observed/
```

Files are written atomically with private permissions. Connection and job operations use project-local locks with stale-lock recovery.

## What remains Hermes-owned

Loopgraph does not run OAuth, store provider tokens, implement every provider API client, install provider webhook subscriptions, accept raw provider webhooks, let an untrusted webhook turn claim measurement work, or infer an incomplete provider field.

Hermes owns provider onboarding, webhook termination, normalization, credential use, and execution of the exact read query. Loopgraph owns the contract, schedule, lease, evidence identity, outcome evaluation, reconciliation, and safety boundary.
