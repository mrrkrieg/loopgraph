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
access-review procedures. At minimum:

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

`npm run reconcile:app-snapshots` reads App installation registries for one exact protected
organization/project scope and verifies every currently detached App through the same immutable
snapshot loader used by execution. It distinguishes missing, content-invalid, descriptor-untracked,
and temporarily unavailable archives and exits non-zero unless every detached installation verifies.

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

The evidence artifact contains a scope digest, timestamps, fixed control names, and
aggregate counts only. It contains no organization ID, project key, workspace ID, App ID,
installation ID, actor, snapshot path, object key, content digest, archive, or credential.

The production release workflow runs the same reconciliation after the bucket isolation gate and
binds its fresh receipt to the validated Storage origin plus the exact marketplace tenant/project.
Promotion fails if the independently pinned scope digest differs, any detached installation is not
verified, any failure count is non-zero, the control set is incomplete, or the receipt is stale.
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
