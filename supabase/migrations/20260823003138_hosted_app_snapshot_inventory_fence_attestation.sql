-- Service-role-only live attestation for the cross-authority mutation fence.
-- Static migration tests prove the intended SQL. This RPC proves that the exact
-- registry and Storage triggers are present and enabled in the deployed project.

create or replace function public.loopgraph_app_snapshot_inventory_fence_status_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_storage_trigger_enabled boolean;
  v_registry_trigger_enabled boolean;
  v_generation_reader_oid oid;
  v_generation_reader_service_only boolean;
  v_mutation_functions_trigger_only boolean;
  v_mutation_functions_hardened boolean;
begin
  select exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'storage'
      and relation_row.relname = 'objects'
      and trigger_row.tgname = 'loopgraph_app_snapshot_inventory_generation'
      and trigger_row.tgfoid = pg_catalog.to_regprocedure(
        'public.loopgraph_app_snapshot_inventory_generation_bump()'
      )
      and trigger_row.tgenabled in ('O', 'A')
      and not trigger_row.tgisinternal
  ) into v_storage_trigger_enabled;

  select exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'loopgraph_app_installation_registries'
      and trigger_row.tgname = 'loopgraph_app_snapshot_inventory_registry_generation'
      and trigger_row.tgfoid = pg_catalog.to_regprocedure(
        'public.loopgraph_app_snapshot_inventory_generation_bump_registry()'
      )
      and trigger_row.tgenabled in ('O', 'A')
      and not trigger_row.tgisinternal
  ) into v_registry_trigger_enabled;

  v_generation_reader_oid := pg_catalog.to_regprocedure(
    'public.loopgraph_app_snapshot_inventory_generation_get(uuid,text)'
  );
  select exists (
    select 1
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_generation_reader_oid
      and function_row.prosecdef
      and 'search_path=""' = any(function_row.proconfig)
      and not pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE')
  ) into v_generation_reader_service_only;

  select
    count(function_oid) = 4
    and coalesce(bool_and(
      not pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
    ), false)
  into v_mutation_functions_trigger_only
  from unnest(array[
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_advance(uuid,text)'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump_scope(text)'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump()'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump_registry()')
  ]) as mutation_functions(function_oid);

  select
    count(*) = 4
    and coalesce(bool_and(
      function_row.prosecdef
      and 'search_path=""' = any(function_row.proconfig)
    ), false)
  into v_mutation_functions_hardened
  from pg_catalog.pg_proc function_row
  where function_row.oid = any(array[
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_advance(uuid,text)'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump_scope(text)'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump()'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump_registry()')
  ]);

  return jsonb_build_object(
    'schemaVersion', 'hosted-app-snapshot-inventory-fence/v1',
    'storageTriggerEnabled', v_storage_trigger_enabled,
    'registryTriggerEnabled', v_registry_trigger_enabled,
    'generationReaderServiceOnly', v_generation_reader_service_only,
    'mutationFunctionsTriggerOnly', v_mutation_functions_trigger_only,
    'mutationFunctionsHardened', v_mutation_functions_hardened
  );
end;
$$;

revoke all on function public.loopgraph_app_snapshot_inventory_fence_status_get()
  from public, anon, authenticated;
grant execute on function public.loopgraph_app_snapshot_inventory_fence_status_get()
  to service_role;
