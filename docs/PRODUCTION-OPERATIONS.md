# Production operations

Loopgraph production promotion is evidence-gated. A successful build is necessary but not sufficient: the exact prebuilt artifact must pass staging readiness, operational metrics, and audit-integrity checks before a protected production environment may promote it.

## Required controls

- `ops/slo.yaml` is the versioned SLO and alert contract. Route its metrics to an alerting system with paging ownership; the file is not an alert delivery system by itself.
- `.github/workflows/staging-release.yml` builds once, deploys the prebuilt artifact to staging, validates it, and only promotes that verified deployment after protected-environment approval.
- `npm run rehearse:restore` performs a real, snapshot-consistent `pg_dump` / isolated `pg_restore` exercise. It refuses to run unless source and disposable target URLs differ, the target has zero public tables, its database name explicitly identifies it as disposable, and `LOOPGRAPH_CONFIRM_ISOLATED_RESTORE=yes` is explicit.
- `npm run audit:drain` exports one bounded verified audit checkpoint with separate short-lived source and destination workload identities. It reads the current staging and marketplace receipts and proves both exact sequence/hash checkpoints inside that chain. The independent receiver must enforce receipt-chain continuity and return an Ed25519-signed immutability acknowledgement.
- `npm run validate:marketplace-staging` is the production marketplace gate. It requires four separately projected, short-lived workload identities: allowed tenant, foreign tenant, revoked grant, and observability. It proves exact signed artifact staging, tenant isolation, durable revocation, replay rejection, and accepted-request audit evidence without printing a token.
- `npm run validate:staging` now uses the projected observability workload identity too. Its receipt contains status and control summaries only; it no longer accepts a reusable observability token or copies audit/metrics response bodies into release evidence.
- `npm run release:evidence:build` binds the current run's four receipts to one deployment, tenant/project, database identity, and exact marketplace artifact. `npm run release:evidence:verify` reconstructs that manifest before promotion and fails on any substituted, stale, or mixed receipt.

## Release evidence

The protected workflow stores the staging, marketplace, recovery, and audit-retention receipts as
separate artifacts, compiles `loopgraph-production-promotion-evidence/v1`, and creates a GitHub OIDC
provenance attestation for the exact manifest file. The production job downloads the same run's
artifacts, reconstructs the manifest, verifies its evidence-set digest and GitHub attestation, and
verifies the receiver acknowledgement against the production environment's independently configured
Ed25519 public key before promoting the exact prebuilt deployment. Missing evidence blocks promotion; it
must not be replaced with a checkbox or an environment variable claiming a check passed. See
[Production promotion evidence](./PRODUCTION-PROMOTION-EVIDENCE.md) for the schemas and protected
environment setup.

The `audit-drain/v3` receipt with its signed external acknowledgement is mandatory for every production promotion. Preserve it outside
the application database through the protected runner's `LOOPGRAPH_AUDIT_RECEIPT_STATE_FILE`; the
sender atomically advances this predecessor only after verification. Production promotion depends
on the protected `audit-retention-staging` job; an unavailable
receiver, stale predecessor, invalid signature, or insufficient immutability period fails the job.
See [Independent audit retention protocol](./AUDIT-RETENTION-PROTOCOL.md).

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

Run at least quarterly and after material persistence changes. Supply short-lived database URLs from
the deployment secret plane; do not paste them into workflow output:

```bash
LOOPGRAPH_CONFIRM_ISOLATED_RESTORE=yes \
LOOPGRAPH_REHEARSAL_TARGET_MARKER="$ONE_TIME_RESTORE_MARKER" \
LOOPGRAPH_BACKUP_SOURCE_DB_URL_FILE="$SOURCE_DATABASE_URL_FILE" \
LOOPGRAPH_REHEARSAL_RESTORE_DB_URL_FILE="$DISPOSABLE_RESTORE_DATABASE_URL_FILE" \
LOOPGRAPH_EXPECTED_SOURCE_DB_IDENTITY_DIGEST="$REVIEWED_SOURCE_DATABASE_IDENTITY_DIGEST" \
npm run rehearse:restore > restore-rehearsal.json
```

Before the run, create an empty database with a name containing `rehearsal`, `restore`, `disposable`,
or `test`, generate a unique 32-128 character marker, and set that database's comment to
`loopgraph-disposable-restore:<marker>`. Pass the same marker through
`LOOPGRAPH_REHEARSAL_TARGET_MARKER`. This second, per-run proof prevents a similarly named database
from becoming an accidental destructive target. Rotate the marker for every rehearsal.

Remote URLs must explicitly select `sslmode=verify-full`. The script writes
credentials into private `0600` pgpass files inside a unique temporary directory and passes only
host, port, user, and database through process arguments. It strips Loopgraph database URLs and
unrelated secrets from child-process environments. The recommended `*_FILE` variables must point to
absolute, non-symlink, bounded regular files with no group or world permissions. Direct URL variables
remain available for local use, but the script rejects setting a direct and projected value together.

The source fingerprint and archive share one exported, repeatable-read PostgreSQL snapshot, so the
rehearsal does not need to pause production writes. Source and restore servers must use the same
PostgreSQL major version. The `backup-restore-rehearsal/v2` receipt is emitted only after:

1. every application-owned public table—including connector consent and webhook state, Hermes design
   and execution records, loops/runs/reviews, marketplace releases, workload identity, audit, routing,
   graph transactions, LoopSpecs, canonical entities, evidence, and the value ledger—has the same row
   count and order-independent SHA-256 multiset fingerprint;
2. every restored tenant/project audit chain passes `verify_security_audit_chain`; and
3. every evidence-ledger record family is enumerated in the receipt.

The protected source identity digest is `sha256:` plus the SHA-256 of
`lowercase-hostname:port/database`. The receipt preserves that digest, a distinct target identity
digest, and each table's exact row-count/SHA-256 fingerprint; the promotion manifest binds all of
them without exposing either credential-bearing database URL.

The database dump contains marketplace metadata, signatures, and artifact identities, but external
artifact bytes deliberately live outside PostgreSQL. Therefore the receipt marks those bytes as
unverified. Deploy the restored database in an isolated rehearsal environment and run
`npm run validate:marketplace-staging` against that environment before treating the recovery exercise
as production-complete. Preserve both receipts together, measure RTO/RPO, investigate unexpected
size or timing changes, then destroy the disposable database and deployment after evidence is retained.

## Provider boundary

Provider credentials and raw webhooks terminate in Hermes. Loopgraph stores tenant-scoped installation receipts, normalized EventEnvelopes, canonical entity aliases, measurements, outcomes, and value entries. Never put OAuth tokens, signing secrets, raw HR records, raw message bodies, or full provider payloads in audit export or evidence tables.
