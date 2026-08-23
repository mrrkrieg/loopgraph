# Production operations

Loopgraph production promotion is evidence-gated. A successful build is necessary but not sufficient: the exact prebuilt artifact must pass staging readiness, operational metrics, audit integrity, browser-session tenant isolation, suspended-membership denial, and real user-quota saturation before a protected production environment may promote it.

## Required controls

- `ops/slo.yaml` is the versioned SLO and alert contract. Route its metrics to an alerting system with paging ownership; the file is not an alert delivery system by itself.
- `.github/workflows/staging-release.yml` builds once, deploys the prebuilt artifact to staging, validates it, and only promotes that verified deployment after protected-environment approval.
  The credential-bearing workflow chain runs only from the protected default branch
  `loopgraph/canvas-first`; environment deployment rules must enforce the same branch. Trigger it
  with the `staging-release` repository-dispatch event, never with a feature-ref workflow run.

  ```bash
  gh api --method POST repos/mrrkrieg/loopgraph/dispatches \
    -f event_type=staging-release \
    -F 'client_payload[promote_production]=true'
  ```

  Send `false` to exercise the full evidence chain without entering the protected production job.
  Every third-party action in this credential-bearing workflow is pinned to one reviewed 40-character
  commit SHA. Every checkout also binds the dispatch SHA explicitly and disables persisted Git
  credentials. Update those pins only through a reviewed dependency change that resolves the
  vendor's release tag to its exact commit.
- `npm run rehearse:restore` performs a real, snapshot-consistent `pg_dump` / isolated `pg_restore` exercise. It refuses to run unless source and disposable target URLs differ, the target has zero public tables, its database name explicitly identifies it as disposable, and `LOOPGRAPH_CONFIRM_ISOLATED_RESTORE=yes` is explicit.
- `npm run audit:drain` exports one bounded verified audit checkpoint with separate short-lived source and destination workload identities. It reads the current staging and marketplace receipts and proves both exact sequence/hash checkpoints inside that chain. The independent receiver must enforce receipt-chain continuity and return an Ed25519-signed immutability acknowledgement.
- `npm run validate:marketplace-staging` is the production marketplace gate. It requires four separately projected, short-lived workload identities: allowed tenant, foreign tenant, revoked grant, and observability. It proves exact signed artifact staging, tenant isolation, durable revocation, replay rejection, and accepted-request audit evidence without printing a token.
- `npm run validate:app-snapshots-staging` is the detached-App archive gate. It proves the private
  bucket contract, authenticated client denial for read/insert/update/delete, first-writer
  immutability, exact recovery through a second replica root, and verified cleanup. The service-role
  key is read only from a private projected file; its receipt contains content identities, not the
  credential or object key.
- `npm run probe:app-snapshot-fence` is an explicit staging-only mutation rehearsal. It uses a
  random reserved project scope to prove registry insert/update/delete and protected Storage
  upload/replace/delete each advance the live generation fence. It removes the probe registry and
  object, deletes the synthetic generation row, and emits only the pinned scope digest plus eight
  true control results. The command refuses to run without an exact `yes` mutation confirmation.
- `npm run rehearse:app-snapshot-restore` proves that one exact signed App archive can cross from
  the validated source project into a separately protected disposable Storage project, load through
  an empty runtime, preserve the source during target cleanup, and clean only its random probe.
- `npm run reconcile:app-snapshots` verifies every current detached installation through the signed
  archive loader for the exact Storage origin and tenant/project proven by the preceding gates. It
  first attests from live PostgreSQL catalogs that both exact mutation triggers are installed and
  enabled with the full unconditional row-level event mask, and that independently pinned function
  bodies, owners, search paths, and execute capabilities remain exact. It also inventories Storage
  back to current registry authority. The protected environment pins that
  scope and the reviewed unreferenced-archive digest independently and requires an explicit
  empty-inventory policy. Two identical full passes are required, and persistent mutation exhausts a
  bounded retry window. Each pass is fenced by the same durable generation before the registry
  read and after Storage traversal; registry and private-bucket triggers advance it transactionally
  whenever an authoritative registry payload or archive object changes.
  Missing, corrupt, untracked, unavailable, malformed, retention-drifted,
  unstable, incomplete, cross-scope, or stale evidence blocks promotion.
- `npm run validate:staging` uses a projected observability workload identity plus three short-lived Supabase user sessions. It proves unauthenticated, foreign-tenant, and suspended-member denial, then consumes one complete staging-only `admin` quota window and requires the next request to return `429`. Its receipt contains status and bounded control summaries only; it does not copy cookies, tokens, response bodies, or user records into release evidence.
- `npm run release:evidence:build` binds the current run's eleven receipts to one source commit,
  deployment, source and restore Storage origins, tenant/project, database identity, exact
  marketplace artifact, independently reviewed active mutation and learning/entity probe scopes,
  and retained-snapshot inventory.
  `npm run release:evidence:verify` reconstructs that manifest before promotion and fails on any
  substituted, stale, or mixed receipt.
- App install/uninstall reconciliation is an operational gate. The tenant-scoped service-role
  snapshot exports aggregate pending, interrupted, stale, affected-workspace, and oldest-age
  metrics without exposing App or installation identifiers. The default stale threshold is 900
  seconds; set `LOOPGRAPH_APP_LIFECYCLE_RECOVERY_STALE_SECONDS` only to a reviewed integer from 60
  through 86400. An invalid value fails hosted configuration readiness.
- App action receipt reconciliation is a separate operational gate. The protected snapshot exports
  aggregate commit-request, terminal-receipt, pending, stale, affected-workspace, and oldest-age
  metrics without exposing action, installation, provider, or request identifiers. The default
  stale threshold is 300 seconds; set `LOOPGRAPH_APP_ACTION_RECONCILIATION_STALE_SECONDS` only to a
  reviewed integer from 60 through 86400. An invalid value fails hosted configuration readiness.
- App evidence freshness is derived from the same tenant-scoped, versioned renewal plan used by
  Hermes, CLI, browser, and local supervisor. The protected metrics export aggregate invalid,
  expired, renew-soon, incomplete, current, and not-applicable counts. Invalid, expired, or
  renew-soon evidence degrades operations without removing healthy traffic workers; an unavailable,
  malformed, cross-workspace, stale, or future-dated projection fails readiness closed. The hourly
  scheduler has only `schedule.app_evidence_health` and cannot run replay, create approval, promote
  an App, or invoke providers.

## App lifecycle recovery runbook

An unfinished `prepared` operation can be normal while the worker is still applying the exact
content-bound plan. A `requires_reconciliation` operation means cross-store work was interrupted;
it is degraded immediately. Any unfinished operation older than the configured threshold is stale.

1. Confirm the alert is tenant/project scoped and compare
   `loopgraph_app_lifecycle_recovery_oldest_age_seconds` with the exported threshold.
2. Open Installed Apps or ask Hermes for App onboarding status. Both surfaces resolve the same
   metadata-only operation and exact retry instruction.
3. Submit the original install request with the same approved plan, or the original uninstall
   request for that installation. Never invent a replacement plan, manually delete one owned
   resource, or start a competing configuration/update operation.
4. Confirm the operation becomes `completed`, the installation registry revision advances, and
   pending/interrupted/stale metrics return to zero. Preserve the corresponding audit-chain events.
5. If exact retry cannot complete, pause promotion and investigate the owning store or lease. Do
   not copy registry payloads into tickets or logs; record bounded operation status and timestamps.

## App action reconciliation runbook

A fresh nonterminal commit request can be normal while a provider call finishes. The scheduled
worker checks old requests against the Connector Broker's durable idempotency receipt and never
invokes the provider handler. A request older than the configured threshold is stale.

1. Confirm the protected `loopgraph_app_action_reconciliation_stale` alert is scoped to the expected
   tenant/project and compare oldest age with the exported threshold.
2. Confirm the five-minute reconciliation schedule is running and authorized with only
   `schedule.app_action_reconciliation`.
3. Inspect bounded App and Broker receipt status using the original action/request identity in the
   authorized operator surface. Do not copy provider payloads, credentials, or result bodies into
   logs or tickets.
4. If the Broker has a terminal receipt, run the receipt-only reconciliation operation and confirm
   the App ledger records the same terminal result. Never call commit again.
5. If no Broker receipt exists, leave the action unresolved, revoke it if policy requires, and
   investigate provider-specific evidence through an approved human process. Do not infer success
   and do not automatically repeat the mutation.
6. Confirm pending and stale metrics return to zero and preserve the relevant audit-chain evidence
   before resuming promotion.

## App evidence freshness runbook

Before treating the monitor as production evidence, run the protected
`npm run --silent validate:app-evidence-health-staging` gate against the exact deployment. It proves
workload authorization, cross-tenant denial, replay rejection, the aggregate-only response
contract, and parity between the schedule projection and protected Prometheus gauges. See
[Hosted App evidence-health staging gate](./HOSTED-APP-EVIDENCE-HEALTH-STAGING-GATE.md).

1. Confirm the protected alert is scoped to the expected tenant/project and compare invalid,
   expired, renew-soon, and truncation metrics.
2. Ask Hermes for the versioned fleet renewal plan or open Installed Apps. Do not copy provider
   payloads, credentials, or arbitrary object values into logs or tickets.
3. For invalid proof, repair the exact missing, unbound, malformed, or future-dated reference. For
   expired proof, run a new bounded write-blocked replay and record current completed work, observed
   outcomes, and observed net value. For renew-soon proof, schedule the returned safe action before
   the evidence deadline.
4. Keep replay, evidence recording, approval, and activation as separate accountable operations.
   The health scheduler and metrics scraper must never perform them.
5. Confirm the affected aggregate count returns to zero, the App maturity gate reflects the new
   evidence clock, and relevant audit evidence is retained before considering promotion.

## Release evidence

The protected workflow stores the staging, App action, marketplace, hosted App evidence-health,
active App snapshot
mutation-fence, distributed learning/entity, App snapshot isolation, App snapshot recovery,
App snapshot reconciliation, database recovery, and audit-retention receipts as separate artifacts,
compiles `loopgraph-production-promotion-evidence/v10`, and creates a GitHub OIDC
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

## App snapshot staging boundary

The `app-snapshot-staging` environment runs separately from marketplace validation. Project the
service-role key to the isolated runner as an absolute mode-`0600` non-symlink file referenced by
`LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE`; do not store the key text in a GitHub variable,
command, artifact, or log. The environment also receives the public Supabase origin/publishable key
and the allowed short-lived user-session file. Rotate the service credential or destroy the
ephemeral runner projection after the gate. The emitted Storage origin is non-secret and is carried
forward as a protected job output so production reconstruction cannot substitute another project.

Set `LOOPGRAPH_EXPECTED_APP_SNAPSHOT_FENCE_PROBE_SCOPE_DIGEST` from
`npm run --silent print:app-snapshot-fence-probe-scope` for the reviewed staging origin and
organization. The workflow fixes `LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_ALLOW_MUTATION=yes`; do not
copy that confirmation into production jobs. A failed cleanup is a hard failure and deliberately
leaves reconciliation unable to promote until an operator inspects the isolated probe scope.

## App snapshot recovery boundary

The `app-snapshot-recovery` environment must use a different Supabase project from the source.
Project separate source and target service-role credentials as absolute mode-`0600` non-symlink
files. Set `LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RESTORE_ORIGIN` to the reviewed target HTTPS origin and
restrict the environment to the protected default branch. The workflow supplies the validated
source origin and tenant/project from earlier jobs rather than duplicating them as editable values.

The gate sets `LOOPGRAPH_CONFIRM_ISOLATED_APP_SNAPSHOT_RESTORE=yes`, creates one random probe, and
never enumerates or restores a customer object. It removes the target probe first, proves the source
still verifies, then removes the source probe. Rotate both projected identities after the exercise.
The receipt contains origins and digests but no credential, object key, archive bytes, or App config.

## Hosted user-boundary staging matrix

The same protected runner also receives three independently issued, short-lived Supabase session
bundles. Each file is strict JSON containing only `access_token` and `refresh_token`, is mounted at an
absolute regular non-symlink path, and has mode `0600`:

1. `LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE` belongs to an active member of the exact staging organization.
2. `LOOPGRAPH_STAGING_FOREIGN_USER_SESSION_FILE` belongs to an active user in a different organization.
3. `LOOPGRAPH_STAGING_SUSPENDED_USER_SESSION_FILE` belongs to a valid user whose target membership is suspended.

Configure `LOOPGRAPH_STAGING_SUPABASE_URL` and the public
`LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY` so the validator can exchange each bundle for the same
cookie format used by the browser. Never put a session JSON value in a GitHub variable, command
argument, artifact, or workflow log. The protected runner's identity/bootstrap system must project
and rotate these files before the job starts.

Use a staging-only service-role migration/administration step to set the `admin` bucket to a small,
bounded window such as three requests per second. Set
`LOOPGRAPH_STAGING_USER_API_ADMIN_QUOTA_LIMIT=3` and
`LOOPGRAPH_STAGING_USER_API_QUOTA_MAX_WAIT_SECONDS=5` to the same reviewed policy. The gate waits at
most once for a partially consumed window and fails if the reset is absent, unexpectedly long, or
does not start a fresh window. Do not lower production tenant limits merely to satisfy this check.

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
artifact bytes deliberately live outside PostgreSQL. Therefore the database receipt marks those
bytes as unverified. Run `npm run validate:marketplace-staging` for marketplace artifacts and
`npm run rehearse:app-snapshot-restore` for detached-App archives before treating recovery as
production-complete. Preserve all receipts together, measure RTO/RPO, investigate unexpected size
or timing changes, then destroy the disposable database, Storage target, and deployment after
evidence is retained.

## Provider boundary

Provider credentials and raw webhooks terminate in Hermes. Loopgraph stores tenant-scoped installation receipts, normalized EventEnvelopes, canonical entity aliases, measurements, outcomes, and value entries. Never put OAuth tokens, signing secrets, raw HR records, raw message bodies, or full provider payloads in audit export or evidence tables.
