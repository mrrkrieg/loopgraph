# Hosted App snapshots

Detaching a private App permanently stops upstream updates. That decision is safe only when every
hosted replica can recover the same immutable LoopPack after the original worker exits.

## Authority model

The completed App lifecycle operation is the durable receipt. It binds:

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
The bucket intentionally has no `anon` or `authenticated` Storage policy. The server-only
Supabase service role is the sole data-plane principal.

Object identities are derived by the server from:

```text
organization UUID / project key / workspace ID / logical-path digest /
artifact digest / full-file digest.loopgraph-pack.json
```

Hermes, browsers, connector workers, and lifecycle tool callers cannot provide or receive that
identity. Because Supabase Storage policies are permissive when multiple policies match, operators
must not add a broad `storage.objects` policy that includes this bucket. The migration fails when
it finds a policy that explicitly names the bucket; deployment review must also reject broad
project-wide policies.

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
