# Production operations

Loopgraph production promotion is evidence-gated. A successful build is necessary but not sufficient: the exact prebuilt artifact must pass staging readiness, operational metrics, and audit-integrity checks before a protected production environment may promote it.

## Required controls

- `ops/slo.yaml` is the versioned SLO and alert contract. Route its metrics to an alerting system with paging ownership; the file is not an alert delivery system by itself.
- `.github/workflows/staging-release.yml` builds once, deploys the prebuilt artifact to staging, validates it, and only promotes that verified deployment after protected-environment approval.
- `npm run rehearse:restore` performs a real `pg_dump` / isolated `pg_restore` exercise. It refuses to run unless source and disposable target URLs differ and `LOOPGRAPH_CONFIRM_ISOLATED_RESTORE=yes` is explicit.
- `npm run audit:drain` exports verified audit-chain records to an independent retention endpoint. The destination must verify the timestamped HMAC and enforce its own immutable retention policy.

## Release evidence

Keep the workflow run, staging validation JSON, exact deployment URL, migration commit, database backup checkpoint, alert configuration revision, and most recent restore rehearsal receipt together. Missing evidence blocks production promotion; it must not be replaced with a checkbox.

## Restore rehearsal cadence

Run at least quarterly and after material persistence changes. Restore into an isolated disposable database, validate public schema count and application readiness, record RTO/RPO, investigate unexpected size or timing changes, and destroy the rehearsal target after evidence is retained.

## Provider boundary

Provider credentials and raw webhooks terminate in Hermes. Loopgraph stores tenant-scoped installation receipts, normalized EventEnvelopes, canonical entity aliases, measurements, outcomes, and value entries. Never put OAuth tokens, signing secrets, raw HR records, raw message bodies, or full provider payloads in audit export or evidence tables.
