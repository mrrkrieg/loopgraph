# Production operations

Loopgraph production promotion is evidence-gated. A successful build is necessary but not sufficient: the exact prebuilt artifact must pass staging readiness, operational metrics, and audit-integrity checks before a protected production environment may promote it.

## Required controls

- `ops/slo.yaml` is the versioned SLO and alert contract. Route its metrics to an alerting system with paging ownership; the file is not an alert delivery system by itself.
- `.github/workflows/staging-release.yml` builds once, deploys the prebuilt artifact to staging, validates it, and only promotes that verified deployment after protected-environment approval.
- `npm run rehearse:restore` performs a real `pg_dump` / isolated `pg_restore` exercise. It refuses to run unless source and disposable target URLs differ and `LOOPGRAPH_CONFIRM_ISOLATED_RESTORE=yes` is explicit.
- `npm run audit:drain` exports verified audit-chain records to an independent retention endpoint. The destination must verify the timestamped HMAC and enforce its own immutable retention policy.
- `npm run validate:marketplace-staging` is the production marketplace gate. It requires four separately projected, short-lived workload identities: allowed tenant, foreign tenant, revoked grant, and observability. It proves exact signed artifact staging, tenant isolation, durable revocation, replay rejection, and accepted-request audit evidence without printing a token.
- `npm run validate:staging` now uses the projected observability workload identity too. Its receipt contains status and control summaries only; it no longer accepts a reusable observability token or copies audit/metrics response bodies into release evidence.

## Release evidence

Keep the workflow run, staging validation JSON, exact deployment URL, migration commit, database backup checkpoint, alert configuration revision, and most recent restore rehearsal receipt together. Missing evidence blocks production promotion; it must not be replaced with a checkbox.

The marketplace receipt is also mandatory when marketplace delivery changed. Preserve its exact app
ID, version, artifact digest, seven check results, and audit checkpoint. Do not preserve token files.
The protected `marketplace-staging` runner must receive projected tokens from the enterprise
identity plane; do not replace them with repository secrets or reusable bearer credentials.

## Marketplace staging identity matrix

The staging identity administrator prepares four principals before approving the protected job:

1. The allowed principal is active and has only `marketplace.consume` for the staging tenant and project.
2. The foreign principal belongs to a different organization and must not read the target private app.
3. The revoked principal still presents a cryptographically valid, unexpired JWT, but its principal or `marketplace.consume` grant is revoked. The expected result is `403`, proving durable revocation rather than token expiry.
4. The observability principal has only `observability.read` and can export the verified tenant audit chain.

The token file variables are absolute paths on an isolated, ephemeral self-hosted runner. Files must
be regular, non-symlink paths with mode `0600`; the gate rejects group/world-readable tokens. Rotate
all four identities after the exercise and preserve the provider-side issuance/revocation audit record.

## Restore rehearsal cadence

Run at least quarterly and after material persistence changes. Restore into an isolated disposable database, validate public schema count and application readiness, record RTO/RPO, investigate unexpected size or timing changes, and destroy the rehearsal target after evidence is retained.

## Provider boundary

Provider credentials and raw webhooks terminate in Hermes. Loopgraph stores tenant-scoped installation receipts, normalized EventEnvelopes, canonical entity aliases, measurements, outcomes, and value entries. Never put OAuth tokens, signing secrets, raw HR records, raw message bodies, or full provider payloads in audit export or evidence tables.
