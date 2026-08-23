# Independent audit retention protocol

Loopgraph audit events are append-only and hash-linked inside PostgreSQL, but a database
administrator still controls that database. Production evidence therefore needs a second system,
operated under a separate trust boundary, that acknowledges durable immutable retention.

`npm run audit:drain` implements the sender side of that boundary without reusable bearer strings or
shared HMAC signing keys in environment variables.

## Trust and identity model

The protected runner receives two independently issued, short-lived workload JWTs as projected
files:

- `LOOPGRAPH_AUDIT_SOURCE_TOKEN_FILE` has only `observability.read` for one Loopgraph organization
  and project;
- `LOOPGRAPH_AUDIT_RETENTION_TOKEN_FILE` has only the external receiver capability to append audit
  batches to that tenant retention namespace.

Both paths must be absolute regular non-symlink files with mode `0600`. Loopgraph reads them again
for every request so the identity platform can rotate a projection during a long drain. Tokens are
never copied into the receipt.

The receiver owns an Ed25519 signing key in its KMS/HSM boundary. Loopgraph receives only the
matching public key and expected key ID. The public-key file must be an absolute bounded regular file
that is not writable by group or other users.

## Stable source checkpoint

Migration `202608170002_bounded_audit_retention_export.sql` adds two service-role-only RPCs. The first
fully verifies the tenant/project audit chain and returns an immutable event sequence and head hash.
The second pages events only after the prior cursor and at or below that selected head.

The first `GET /api/operations/audit-export` call selects the current verified head. Every later page
sends `through=<headSequence>`. Events appended by authorization or other company activity remain
for the next drain; they cannot move the current drain's target or make pagination endless.

The sender independently rejects:

- a broken `previous_hash` to `event_hash` link;
- a tenant/project mismatch;
- a repeated, reversed, or out-of-bound sequence;
- a cursor that does not equal the last returned event;
- an empty page that claims more work; and
- a final event hash different from the verified checkpoint.

For a production release, the sender also reads the exact `staging-validation/v5`,
`hosted-marketplace-staging-validation/v2`, and
`hosted-app-evidence-health-staging-validation/v2` receipts. It rejects a different source origin,
tenant, or project, then proves all three named sequence/hash checkpoints while traversing the pinned chain. A
checkpoint older than the protected predecessor state fails closed because it can no longer be
independently replayed by the current drain.

## Receiver endpoint

`LOOPGRAPH_AUDIT_RETENTION_URL` is an HTTPS origin without credentials, query, fragment, or path.
The receiver implements:

```text
POST /v1/loopgraph/audit-retention
```

The request includes workload authorization, fresh tenant/project/request/timestamp headers, an
`x-loopgraph-audit-batch-id`, and an `x-loopgraph-payload-digest`. The canonical JSON body uses
`loopgraph-audit-retention-batch/v1` and binds:

- source origin, organization, and project;
- verified source checkpoint sequence and hash;
- exact first/last sequence, event count, and event hashes;
- the exact SHA-256 payload digest; and
- the prior external receipt digest.

The batch ID is deterministic for the exact checkpoint, range, receipt predecessor, and event
hashes. The receiver must make it idempotent, reject a batch whose `previousReceiptDigest` is not its
current tenant chain head, write the bytes to immutable storage, and only then acknowledge it.

## Signed acknowledgement

The receiver returns `loopgraph-audit-retention-ack/v1`. Its Ed25519 signature covers the schema,
statement, algorithm, and key ID. The statement includes:

- receiver and receipt identity plus a monotonically increasing receipt sequence;
- organization, project, batch ID, payload digest, and previous receipt digest;
- first/last event sequence, event count, and final event hash; and
- `retainedAt` and `immutableUntil`.

Loopgraph verifies the signature, exact request binding, receiver continuity, and the configured
minimum retention duration. The acknowledgement digest becomes the predecessor of the next batch.
A replayed older local receipt therefore fails at the independently stateful receiver instead of
silently rewinding retention.

The final `audit-drain/v4` receipt contains the selected chain head, the three exact verified release
checkpoints, and the last signed external acknowledgement. Store it outside the application database.
The production manifest recomputes the acknowledgement digest instead of trusting the supplied digest.
A protected runner should set
`LOOPGRAPH_AUDIT_RECEIPT_STATE_FILE` to a private persistent volume. Loopgraph accepts a missing file
on the first run, verifies it as the predecessor on later runs, and atomically replaces it with mode
`0600` only after every destination acknowledgement has passed. The receiver remains authoritative:
editing or rewinding this local state cannot rewind the independently enforced receipt chain.

`LOOPGRAPH_AUDIT_PREVIOUS_RECEIPT_FILE` remains a read-only compatibility input for externally
projected predecessor receipts. Do not set both variables.

## Protected runner configuration

```dotenv
LOOPGRAPH_AUDIT_SOURCE_URL=https://staging.loopgraph.example
LOOPGRAPH_AUDIT_RETENTION_URL=https://audit-retention.example
LOOPGRAPH_AUDIT_ORGANIZATION_ID=00000000-0000-4000-8000-000000000000
LOOPGRAPH_AUDIT_PROJECT_KEY=main
LOOPGRAPH_AUDIT_PAGE_SIZE=100
LOOPGRAPH_AUDIT_MIN_RETENTION_DAYS=2555
LOOPGRAPH_AUDIT_RETENTION_KEY_ID=retention_ed25519_2026_01
LOOPGRAPH_AUDIT_SOURCE_TOKEN_FILE=/var/run/secrets/loopgraph/audit-source.jwt
LOOPGRAPH_AUDIT_RETENTION_TOKEN_FILE=/var/run/secrets/retention/audit-writer.jwt
LOOPGRAPH_AUDIT_RETENTION_PUBLIC_KEY_FILE=/var/run/trust/retention/ed25519-public.pem
LOOPGRAPH_AUDIT_STAGING_RECEIPT_FILE=/var/run/release/staging-validation-receipt.json
LOOPGRAPH_AUDIT_MARKETPLACE_RECEIPT_FILE=/var/run/release/marketplace-validation-receipt.json
LOOPGRAPH_AUDIT_APP_EVIDENCE_HEALTH_RECEIPT_FILE=/var/run/release/app-evidence-health-staging-receipt.json
# Optional for one rotation window while the previous receipt still uses the old key:
LOOPGRAPH_AUDIT_RETENTION_PREVIOUS_KEY_ID=retention_ed25519_2025_04
LOOPGRAPH_AUDIT_RETENTION_PREVIOUS_PUBLIC_KEY_FILE=/var/run/trust/retention/ed25519-previous.pem
LOOPGRAPH_AUDIT_RECEIPT_STATE_FILE=/var/lib/loopgraph-release/audit-drain.json
```

Run the process on an isolated ephemeral runner after its protected environment is approved. The
receiver should use object-lock/compliance retention, deny mutation/deletion before
`immutableUntil`, maintain its own tenant receipt chain, rotate keys with an overlap period, export
receiver access logs to a third monitoring plane, and alert on predecessor conflicts or repeated
signature failures. During signing-key rotation, configure the active key for new acknowledgements
and the optional previous key only long enough to verify the predecessor receipt. Remove the old key
after one successful receipt signed by the active key.

The state file's parent directory must already exist on a protected persistent volume and must be
writable only by the release workload. The 90-day GitHub Actions artifact is convenient release
evidence, not the WORM boundary and not the predecessor store.

Repository tests prove protocol parsing, pagination, tenant/hash continuity, Ed25519 verification,
receipt chaining, and rejection paths. Production promotion still requires a real receiver receipt;
tests cannot prove that an enterprise storage account actually enabled WORM enforcement.
