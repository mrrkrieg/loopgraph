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
| `GET /api/cron/app-evidence-health` | Workload identity with `schedule.app_evidence_health` | Re-evaluates tenant App proof freshness hourly and emits one aggregate, secret-free operational observation |
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
- any `loopgraph_app_action_reconciliation_stale > 0`, or
  `loopgraph_app_action_reconciliation_oldest_age_seconds` exceeding
  `loopgraph_app_action_reconciliation_stale_after_seconds`: page the connector platform owner,
  preserve the original request identity, and inspect Broker receipt storage; never retry the
  provider mutation;
- any `loopgraph_app_evidence_invalid > 0`: block App promotion, inspect the exact App through
  Hermes or the authorized Installed Apps surface, and repair the bound evidence references;
- any `loopgraph_app_evidence_expired > 0`: keep the affected App at its currently allowed mode
  and renew proof through a bounded write-blocked replay plus current observed operating evidence;
- any `loopgraph_app_evidence_renew_soon > 0`: schedule the service-authored Hermes renewal action
  before the evidence window closes; monitoring must not invoke that action itself;
- any `loopgraph_app_evidence_plan_truncated > 0`: inspect the full tenant renewal plan in bounded
  pages before claiming fleet proof health;
- increasing `loopgraph_discovery_oldest_active_seconds` while a design is expected to progress:
  inspect unresolved evidence, outbound Hermes delivery, and proposals waiting for review;
- increasing `loopgraph_discovery_sessions_active` with no increase in
  `loopgraph_loop_design_artifacts_total`: inspect the discovery-to-design handoff;
- an audit-chain verification response of `409`: stop promotion and preserve database evidence.

The snapshot now covers the hosted authorization plane, database-backed route queue, outbound
Hermes dispatch queue, inbound Hermes callback inbox, discovery sessions, evidence gaps, immutable
design artifacts, App lifecycle recovery, App action receipt reconciliation, and the same versioned
App evidence-renewal contract consumed by Hermes. App recovery and evidence-health metrics contain
aggregate counts only; App IDs, installation IDs, action IDs, request IDs, actors, connector fields,
provider payloads, and company-context keys are excluded. Invalid, expired, or renew-soon proof
sets `loopgraph_operational_degraded` without failing public traffic readiness. An unavailable,
cross-workspace, malformed, stale, or future-dated evidence projection fails readiness closed.
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
9. Run `npm run prove:app-action-exactly-once` with the exact source commit. The no-network fixture
   discards the first successful Broker response at the App terminal-ledger boundary, reconciles the
   durable receipt, replays the original commit, and fails unless its provider handler ran exactly
   once. For distributed-environment proof, repeat the process-loss scenario with an approved
   non-production provider account that independently records invocation count. The aggregate
   `staging-validation/v5` gate proves the final zero-backlog state but cannot by itself prove the
   external provider's idempotency behavior.
10. Run `npm run --silent validate:app-evidence-health-staging` from a protected runner. Preserve
    the secret-free receipt and separately prove invalid/expired/renew-soon fixtures set the
    expected protected metrics without creating replay, approval, activation, or provider-write
    records.
