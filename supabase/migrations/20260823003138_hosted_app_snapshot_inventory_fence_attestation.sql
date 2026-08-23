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
  v_function_definition_digests jsonb;
  v_function_owners_pinned boolean;
  v_function_acls_pinned boolean;
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
      and trigger_row.tgtype = 29
      and trigger_row.tgqual is null
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
      and trigger_row.tgtype = 29
      and trigger_row.tgqual is null
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
      and coalesce('search_path=""' = any(function_row.proconfig), false)
    ), false)
  into v_mutation_functions_hardened
  from pg_catalog.pg_proc function_row
  where function_row.oid = any(array[
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_advance(uuid,text)'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump_scope(text)'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump()'),
    pg_catalog.to_regprocedure('public.loopgraph_app_snapshot_inventory_generation_bump_registry()')
  ]);

  select
    pg_catalog.jsonb_object_agg(
      definition_row.definition_key,
      case
        when function_row.oid is null then null
        else 'sha256:' || pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(function_row.prosrc, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      end
      order by definition_row.ordinal
    ),
    count(function_row.oid) = 6
      and coalesce(pg_catalog.bool_and(
        pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
      ), false),
    count(function_row.oid) = 6
      and coalesce(pg_catalog.bool_and(
        not pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
        and (
          pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE')
          = definition_row.allow_service_role
        )
        and not exists (
          select 1
          from pg_catalog.aclexplode(
            coalesce(
              function_row.proacl,
              pg_catalog.acldefault('f', function_row.proowner)
            )
          ) privilege_row
          where privilege_row.privilege_type = 'EXECUTE'
            and privilege_row.grantee <> function_row.proowner
            and not (
              definition_row.allow_service_role
              and privilege_row.grantee = pg_catalog.to_regrole('service_role')
            )
        )
      ), false)
  into
    v_function_definition_digests,
    v_function_owners_pinned,
    v_function_acls_pinned
  from (values
    (1, 'generationAdvance', 'public.loopgraph_app_snapshot_inventory_generation_advance(uuid,text)', false),
    (2, 'scopeBump', 'public.loopgraph_app_snapshot_inventory_generation_bump_scope(text)', false),
    (3, 'storageTrigger', 'public.loopgraph_app_snapshot_inventory_generation_bump()', false),
    (4, 'registryTrigger', 'public.loopgraph_app_snapshot_inventory_generation_bump_registry()', false),
    (5, 'generationReader', 'public.loopgraph_app_snapshot_inventory_generation_get(uuid,text)', true),
    (6, 'fenceAttestation', 'public.loopgraph_app_snapshot_inventory_fence_status_get()', true)
  ) as definition_row(ordinal, definition_key, function_signature, allow_service_role)
  left join pg_catalog.pg_proc function_row
    on function_row.oid = pg_catalog.to_regprocedure(definition_row.function_signature);

  return jsonb_build_object(
    'schemaVersion', 'hosted-app-snapshot-inventory-fence/v1',
    'storageTriggerEnabled', v_storage_trigger_enabled,
    'registryTriggerEnabled', v_registry_trigger_enabled,
    'generationReaderServiceOnly', v_generation_reader_service_only,
    'mutationFunctionsTriggerOnly', v_mutation_functions_trigger_only,
    'mutationFunctionsHardened', v_mutation_functions_hardened,
    'functionDefinitionDigests', v_function_definition_digests,
    'functionOwnersPinned', v_function_owners_pinned,
    'functionAclsPinned', v_function_acls_pinned
  );
end;
$$;

alter function public.loopgraph_app_snapshot_inventory_generation_advance(uuid, text)
  owner to postgres;
alter function public.loopgraph_app_snapshot_inventory_generation_bump_scope(text)
  owner to postgres;
alter function public.loopgraph_app_snapshot_inventory_generation_bump()
  owner to postgres;
alter function public.loopgraph_app_snapshot_inventory_generation_bump_registry()
  owner to postgres;
alter function public.loopgraph_app_snapshot_inventory_generation_get(uuid, text)
  owner to postgres;
alter function public.loopgraph_app_snapshot_inventory_fence_status_get()
  owner to postgres;

revoke all on function public.loopgraph_app_snapshot_inventory_fence_status_get()
  from public, anon, authenticated;
grant execute on function public.loopgraph_app_snapshot_inventory_fence_status_get()
  to service_role;
