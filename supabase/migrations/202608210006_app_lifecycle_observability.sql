-- Tenant-scoped, metadata-only health for interrupted App lifecycle work.
-- The snapshot deliberately returns aggregate counts and age only: App IDs,
-- installation IDs, actors, and owned-resource names never enter telemetry.

create or replace function public.get_app_lifecycle_recovery_snapshot(
  p_organization_id uuid,
  p_project_key text,
  p_stale_after_seconds integer default 900
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_stale_after_seconds not between 60 and 86400
  then raise exception 'invalid App lifecycle recovery snapshot request'; end if;

  with registries as (
    select workspace_id, registry_payload
    from public.loopgraph_app_installation_registries
    where organization_id = p_organization_id
      and project_key = p_project_key
  ), operations as (
    select
      registry.workspace_id,
      operation.value->>'status' as status,
      (operation.value->>'updatedAt')::timestamptz as updated_at
    from registries registry
    cross join lateral jsonb_array_elements(
      coalesce(registry.registry_payload->'lifecycleOperations', '[]'::jsonb)
    ) as operation(value)
    where operation.value->>'status' in ('prepared', 'requires_reconciliation')
  )
  select jsonb_build_object(
    'app_installations_total', coalesce((
      select sum(jsonb_array_length(coalesce(registry_payload->'installations', '[]'::jsonb)))
      from registries
    ), 0),
    'app_lifecycle_recovery_pending', count(*),
    'app_lifecycle_recovery_prepared', count(*) filter (where status = 'prepared'),
    'app_lifecycle_recovery_requires_reconciliation', count(*) filter (where status = 'requires_reconciliation'),
    'app_lifecycle_recovery_stale', count(*) filter (
      where updated_at <= now() - make_interval(secs => p_stale_after_seconds)
    ),
    'app_lifecycle_recovery_workspaces_affected', count(distinct workspace_id),
    'app_lifecycle_recovery_oldest_age_seconds', coalesce(
      greatest(0, floor(extract(epoch from (now() - min(updated_at)))))::bigint,
      0
    ),
    'app_lifecycle_recovery_stale_after_seconds', p_stale_after_seconds
  ) into v_snapshot
  from operations;

  return v_snapshot;
end;
$$;

revoke all on function public.get_app_lifecycle_recovery_snapshot(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.get_app_lifecycle_recovery_snapshot(uuid, text, integer) to service_role;
