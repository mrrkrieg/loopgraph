# Hosted App snapshots

Detaching a private App permanently stops upstream updates. That decision is safe only when every
hosted replica can recover the same immutable LoopPack after the original worker exits.

## Authority model

The detached installation is the durable recovery authority. It carries the logical snapshot path,
artifact digest, and complete signed-file digest so recovery does not depend on a bounded lifecycle
journal entry remaining among the 100 most recent operations. The completed App lifecycle operation
still provides the accountable mutation receipt and binds:

- organization, project, workspace, and installation identity;
- the logical private snapshot path;
- the exact App artifact digest;
- the digest of the complete signed file inventory; and
- the resulting detached installation and owned LoopSpec topology.

The receipt never contains a public URL, bucket credential, or caller-selected object key.

Local mode uses `FileAppSnapshotStore` and atomically renames a verified directory beneath
`.loopgraph/apps/private-snapshots/`. Hosted mode uses `SupabaseAppSnapshotStore`: the immutable
archive in Supabase Storage is authoritative and the runtime filesystem is only a verified,
disposable read-through cache.

## Private bucket contract

Migration `20260823003136_hosted_app_snapshots.sql` creates the private
`loopgraph-app-snapshots` bucket with a 100 MiB archive limit and `application/json` allowlist.
It also installs an all-command restrictive policy for `public` that evaluates false for this
bucket and true for every other bucket. PostgreSQL AND-combines that guard with any applicable
permissive policy, so an existing project-wide `USING (true)` rule cannot grant browser or worker
access to App snapshots. The server-only Supabase service role bypasses RLS and is the sole
supported data-plane principal.

Object identities are derived by the server from:

```text
organization UUID / project key / workspace ID / logical-path digest /
artifact digest / full-file digest.loopgraph-pack.json
```

Hermes, browsers, connector workers, and lifecycle tool callers cannot provide or receive that
identity. Operators should still audit broad `storage.objects` policies as part of deployment
review, but the snapshot bucket's restrictive policy is the enforcement boundary: permissive
policies cannot override it for a non-bypass role.

## Exact detach and replay sequence

1. The service verifies the installed LoopPack, source installation, owned objects, and expected
   concurrency token.
2. It prepares a retry-safe lifecycle operation containing the immutable snapshot identity.
3. The snapshot store creates a signed LoopPack archive and uploads with `upsert: false`.
4. A first-writer collision is accepted only after downloading and verifying the existing archive
   against both recorded digests.
5. The installation registry commits the detached state and completed lifecycle receipt.
6. Every replay downloads and verifies the authoritative object. A missing or changed object fails
   closed instead of silently using an old local directory.
7. A replica may promote the verified extraction into its tenant runtime cache. A damaged cache is
   replaced from the authoritative archive; symbolic-link ancestors are rejected.

New detached installations carry the complete immutable descriptor directly. Registries written
before that field existed retain a bounded compatibility fallback to their completed detach
operation. If that legacy operation has already aged out, execution and reconciliation fail closed
as untracked rather than guessing from a path or accepting an arbitrary object.

If upload succeeds but the registry transaction is interrupted, the prepared lifecycle operation
can retry against the same exact object. If the registry commits but a later read cannot verify the
object, App execution stops and requires operator recovery.

## Operations and recovery

Production activation must add the bucket to the organization's backup, restore, retention, and
access-review procedures. Loopgraph never deletes an archive automatically: removal is an explicit,
audited operator action after installation, legal-hold, recovery, and audit-retention requirements
have all expired. At minimum:

- inventory objects by tenant and compare them with completed detach receipts;
- alert on missing objects, digest failures, unexpected media types, and access-policy drift;
- retain immutable archives for at least as long as their installation and audit receipts;
- rehearse restore onto a clean replica and prove an exact detached App can be loaded;
- log service-role access through the deployment's protected audit sink without logging object
  contents, object keys, or credentials; and
- revoke the service role and disconnect the bucket during a credential incident, then rotate and
  re-verify before resuming App work.

Standard uploads are deliberately bounded to 100 MiB. Large App distributions should use an
external artifact registry or a future resumable-upload adapter rather than raising the limit
without memory, timeout, and recovery analysis.

## Continuous reconciliation

`npm run reconcile:app-snapshots` reads App installation registries and recursively inventories the
private Storage prefix for one exact protected organization/project scope. It verifies every
currently detached App through the same immutable snapshot loader used by execution, then performs
the reverse check from every valid Storage object back to current registry authority. It
distinguishes missing, content-invalid, descriptor-untracked, temporarily unavailable,
unreferenced, and malformed archives and exits non-zero unless every detached installation verifies,
every Storage object has the exact server-derived shape, and the unreferenced set matches an
independently reviewed retention digest. Because registry rows and Storage objects cannot be read in
one database transaction, the gate repeats the complete registry-plus-Storage pass until two
consecutive content digests are identical. Registry and private-bucket triggers advance one durable,
tenant/project-scoped mutation generation in the same transaction as every committed registry
payload or Storage-object insert, update, or delete. Each pass must observe the same generation
before its registry read and after its final Storage read, and both matching passes must bind the
same generation. The gate allows at most four passes
and fails closed under continuous mutation; a single offset-paginated traversal is never release
evidence.

The scheduled `Hosted App snapshot reconciliation` workflow runs on the protected self-hosted
runner. Its service-role credential is supplied only as an absolute, non-symlink, mode-`0600`
projected file. It is schedule-only, runs only from the protected `loopgraph/canvas-first` ref,
checks out the exact scheduled commit without persisting Git credentials, and SHA-pins every
third-party action. The job refuses a
tenant/project/Storage origin that does not match an independently pinned scope digest. An empty
detached-App inventory is healthy only when the protected deployment explicitly sets the empty
inventory policy to `yes`.

Operators generate the non-secret pinned value after setting the three scope environment variables:

```bash
npm run --silent print:app-snapshot-reconciliation-scope
```

After pinning the scope digest and projecting the same service-role file used by reconciliation,
inventory the current unreferenced set without exposing object keys. The command verifies the pinned
Storage origin before it reads the service-role file or creates a privileged client:

```bash
npm run --silent print:app-snapshot-unreferenced-inventory
```

The command emits only the number of stability passes, durable mutation generation and its scoped
digest, unreferenced count, malformed-object count, and an opaque canonical retention digest. A
non-zero malformed count is always blocking and cannot be accepted by changing a digest.
When the unreferenced digest changes, an operator must investigate the lifecycle/audit authority for
the changed archives. If retention is still required, pin the reviewed digest independently in the
`app-snapshot-reconciliation` environment and as
`LOOPGRAPH_RELEASE_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST` in both the
`release-evidence` and `production` environments. If retention is no longer required, remove only
the exact reviewed objects through an accountable admin procedure, rerun the inventory, and pin the
new digest. Never paste object keys, tenant identifiers, archive contents, or service credentials
into CI variables, logs, or tickets.

The evidence artifact contains scope and retention-inventory digests, timestamps, fixed control
names, and aggregate counts only. It contains no organization ID, project key, workspace ID, App ID,
installation ID, actor, snapshot path, object key, content digest, archive, or credential.

The production release workflow runs the same reconciliation after the bucket isolation gate and
binds its fresh receipt to the validated Storage origin plus the exact marketplace tenant/project.
Promotion fails if the independently pinned scope or retained-inventory digest differs, any detached
installation is not verified, any malformed object or other failure count is non-zero, the control
set is incomplete, or the receipt is stale. The production evidence compiler checks the same
retention digest against separately protected release configuration, so the reconciliation job
cannot approve its own changed archive set.
The release is triggered with a `staging-release` repository dispatch so GitHub loads the workflow
and source SHA from the protected default branch rather than a caller-selected ref.

## Staging release proof

`npm run validate:app-snapshots-staging` exercises the real protected bucket before production
promotion. It uses a unique workspace namespace and two empty runtime roots to prove:

- the bucket is private, JSON-only, and capped at 100 MiB;
- an authenticated non-service session cannot download, insert, replace, or delete the archive;
- repeating the same upload preserves one first-writer object;
- a second replica recovers the exact artifact and full signed file-inventory digests; and
- the service-only probe is removed after validation.

The protected runner receives the Supabase service-role key only through
`LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE`, an absolute non-symlink regular file with mode
`0600`. It reuses the short-lived allowed-user session bundle from the hosted user-boundary gate.
The receipt contains the Storage origin, tenant/project, content digests, bounded check summaries,
and timestamps only. It contains no object key, service credential, session, archive bytes, or App
configuration. Production evidence compilation requires this exact fresh receipt and refuses a
different Storage origin or incomplete control set.

## Cross-origin restore rehearsal

`npm run rehearse:app-snapshot-restore` closes the external-byte recovery gap that a PostgreSQL
dump cannot prove. The protected job uses separate source and isolated-target service identities,
requires an explicit target-origin binding, and refuses to run when both URLs resolve to the same
HTTPS origin. It creates one random content-bound probe in the source bucket, exports the exact
verified archive, restores it with `upsert: false`, and loads it through an empty target runtime.

The target probe is removed first. The job then re-verifies that the source archive is unchanged,
removes the source probe, and confirms both exact objects are gone. It never lists tenant objects,
accepts an object key from input, or copies an existing customer archive. The secret-free
`hosted-app-snapshot-restore-rehearsal/v1` receipt binds source and restore origins, tenant/project,
archive size, artifact/file identities, fixed checks, and timestamps. Production evidence requires
that its source equal the validated snapshot origin and that its restored payload equal the App
payload exercised by the staging isolation gate.
