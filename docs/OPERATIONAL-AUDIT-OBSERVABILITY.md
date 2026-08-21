# Operational audit and observability

Hosted automation needs evidence that the control plane is alive, ready, authorized, and
accountable. Application logs alone are not an audit record, and an HTTP `200` alone does not prove
that the database or tenant runtime boundary is usable.

## Audit chain

Migration `supabase/migrations/202607300003_operational_audit_observability.sql` adds
`security_audit_events`.

- Events are scoped by organization and project.
- A tenant/project advisory lock serializes append order.
- Every event stores the preceding hash and a SHA-256 hash of its canonical event body.
- Direct service-role inserts, updates, and deletes are revoked.
- A database trigger rejects updates and deletes even if an application path accidentally tries
  to mutate an event.
- `authorize_machine_request` appends accepted, replayed, and rate-limited decisions in the same
  transaction as the replay receipt and rate window.
- Metadata must be a JSON object no larger than 16 KiB.
- The privileged append helper stays in the non-exposed `private` schema. Read-only export,
  snapshot, and chain-verification RPCs run as the caller and are service-role only.

This is a tamper-evident application audit chain, not an independently retained WORM archive. A
database owner can still disable triggers or rewrite the database. Production operators should
continuously export the chain head and events to a separately controlled retention destination.

## Endpoints

| Endpoint | Authentication | Purpose |
|---|---|---|
| `GET /api/health/live` | Public, no details | Confirms the web process can respond |
| `GET /api/health/ready` | Public, no dependency details | Returns `200` only when hosted configuration, tenant namespace, database, and audit RPC are ready |
| `GET /api/operations/metrics` | Workload identity with `observability.read` | Prometheus-format readiness and security-control counters |
| `GET /api/operations/audit-export` | Workload identity with `observability.read` | Machine export bounded to one verified immutable checkpoint |
| `GET /api/audit/export` | Signed-in organization `admin` or `owner` | Human export bounded to one verified immutable checkpoint |

The public health responses intentionally exclude error messages, table names, connection data,
tenant IDs, and metrics. Detailed readiness and counters stay behind the observability credential.

Production uses issuer-verified workload identity with a durable `observability.read` grant. Static
tokens are a temporary compatibility path only and are disabled by default in production. Configure
the scraper separately from workers:

```dotenv
LOOPGRAPH_OBSERVABILITY_API_TOKEN=<long random secret>
LOOPGRAPH_OBSERVABILITY_CREDENTIAL_ID=metrics_primary
LOOPGRAPH_OBSERVABILITY_RATE_LIMIT_PER_MINUTE=60
```

Hosted scrape requests use the same fresh request identity, timestamp, tenant/project binding,
durable replay receipt, and rate-window headers described in
[Machine request guards](./MACHINE-REQUEST-GUARDS.md).

## Audit export

Only `admin` and `owner` memberships have human `audit.read`. A page can contain at most 500 events:

```text
GET /api/audit/export?after=0&limit=100
```

The first response selects a fully verified chain head. Pass its `throughSequence` on subsequent
pages so concurrent append activity remains for the next export:

```text
GET /api/audit/export?after=100&through=750&limit=100
```

The v2 response includes:

- `nextCursor` for the following page;
- exact `previous_hash` and `event_hash` values;
- selected and current chain heads plus the selected head hash and event count from a database-side
  full-chain verification;
- HTTP `409` if verification identifies a broken link.

Do not place provider payloads, credentials, signatures, authorization headers, or customer
records in audit metadata. Structured application logging drops sensitive-key names, nested
objects, and unbounded values.

## Initial alert contract

Wire the protected metrics into the deployment monitoring system and begin with:

- `loopgraph_ready == 0` for two consecutive checks: page the service owner;
- any sustained increase in `loopgraph_machine_denied_5m`: investigate credential drift or abuse;
- any `loopgraph_machine_rate_limited_5m > 0`: inspect the caller and expected schedule;
- any `loopgraph_route_jobs_dead_letter > 0`: stop promotion for the affected route and inspect
  its last error;
- sustained `loopgraph_route_job_expired_leases > 0` or increasing
  `loopgraph_route_job_oldest_due_seconds`: inspect worker health and capacity;
- any `loopgraph_hermes_callbacks_dead_letter > 0`: preserve the signed callback receipt and
  inspect the compiler or task-application error;
- sustained `loopgraph_hermes_callback_expired_leases > 0` or increasing
  `loopgraph_hermes_callback_oldest_due_seconds`: inspect callback-worker health and capacity;
- any `loopgraph_app_lifecycle_recovery_requires_reconciliation > 0`: warn the App platform owner
  and run the exact install or uninstall request recorded by the recovery workflow; do not create a
  replacement plan or start another mutation;
- any `loopgraph_app_lifecycle_recovery_stale > 0`, or
  `loopgraph_app_lifecycle_recovery_oldest_age_seconds` exceeding
  `loopgraph_app_lifecycle_recovery_stale_after_seconds`: page the App platform owner and block
  production promotion until the exact retry completes;
- increasing `loopgraph_discovery_oldest_active_seconds` while a design is expected to progress:
  inspect unresolved evidence, outbound Hermes delivery, and proposals waiting for review;
- increasing `loopgraph_discovery_sessions_active` with no increase in
  `loopgraph_loop_design_artifacts_total`: inspect the discovery-to-design handoff;
- an audit-chain verification response of `409`: stop promotion and preserve database evidence.

The snapshot now covers the hosted authorization plane, database-backed route queue, outbound
Hermes dispatch queue, inbound Hermes callback inbox, discovery sessions, evidence gaps, immutable
design artifacts, and App lifecycle recovery. App recovery metrics contain aggregate counts and age
only; App IDs, installation IDs, actors, connector fields, and company-context keys are excluded.
`loopgraph_operational_degraded` reports recoverable operator work without returning a public
readiness failure that could remove healthy workers and make reconciliation harder.

## Deployment check

After applying migrations to staging:

1. Call liveness and readiness with no browser session.
2. Confirm readiness returns `503` when the service-role key or runtime namespace is absent.
3. Scrape metrics with the dedicated observability credential and fresh replay headers.
4. Make one accepted and one replayed machine request.
5. Export the audit page as an administrator and confirm both decisions are present.
6. Verify a repeated machine request returns `409` and a broken audit chain would block export.
7. Run `npm run audit:drain` and verify the external Ed25519 acknowledgement, predecessor digest,
   and immutable-until deadline. See [Independent audit retention protocol](./AUDIT-RETENTION-PROTOCOL.md).
8. Interrupt one staging-only App install after its prepared record, verify the protected metrics
   show pending recovery, retry the exact request, and verify every recovery metric returns to zero.
