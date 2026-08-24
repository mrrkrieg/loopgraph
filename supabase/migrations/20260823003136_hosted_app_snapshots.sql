-- Private immutable LoopPack archives for detached Apps. A restrictive policy
-- denies every non-bypass role access to this bucket even when the project has
-- an unrelated broad permissive Storage policy. Only the server-side Supabase
-- service role used by the tenant-scoped App snapshot adapter may create, read,
-- or verify objects.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'loopgraph-app-snapshots',
  'loopgraph-app-snapshots',
  false,
  104857600,
  array['application/json']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- PostgreSQL OR-combines permissive policies and AND-combines restrictive
-- policies. This project-wide guard is true for every other bucket, so it does
-- not narrow their existing policies. It is false for this bucket, preventing
-- any anon, authenticated, or custom non-BYPASSRLS role from reading, creating,
-- changing, or deleting App snapshots. Supabase's server-only service role
-- bypasses RLS and remains the sole supported data-plane principal.
drop policy if exists "Loopgraph App snapshots deny client access"
  on storage.objects;

create policy "Loopgraph App snapshots deny client access"
on storage.objects
as restrictive
for all
to public
using (bucket_id <> 'loopgraph-app-snapshots')
with check (bucket_id <> 'loopgraph-app-snapshots');
