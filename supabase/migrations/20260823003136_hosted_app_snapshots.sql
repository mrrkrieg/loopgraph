-- Private immutable LoopPack archives for detached Apps. Browser and
-- authenticated clients receive no Storage policy for this bucket; only the
-- server-side service role used by the tenant-scoped App snapshot adapter may
-- create, read, or verify objects.

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

-- Fail the migration if a project-wide policy accidentally names this bucket.
-- Supabase Storage RLS policies are permissive (OR-combined), so the supported
-- deployment contract is intentionally policy-free for this service bucket.
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%loopgraph-app-snapshots%'
        or coalesce(with_check, '') ilike '%loopgraph-app-snapshots%'
      )
  ) then
    raise exception 'loopgraph-app-snapshots must remain service-role-only and policy-free';
  end if;
end;
$$;
