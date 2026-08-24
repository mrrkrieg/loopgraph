-- Durable provider-schema metadata and human-confirmed logical field mappings
-- used by hosted App planning. Raw provider samples are deliberately excluded.

create table if not exists public.loopgraph_provider_schema_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  workspace_id text not null,
  connection_id text not null,
  provider_id text not null,
  payload jsonb not null,
  inspected_at timestamptz not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id, connection_id),
  constraint loopgraph_provider_schema_project_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_provider_schema_workspace_check check (workspace_id ~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$' and length(workspace_id) between 3 and 160),
  constraint loopgraph_provider_schema_connection_check check (length(connection_id) between 3 and 160),
  constraint loopgraph_provider_schema_provider_check check (length(provider_id) between 3 and 160),
  constraint loopgraph_provider_schema_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576)
);

create table if not exists public.loopgraph_connector_field_mappings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  workspace_id text not null,
  mapping_id text not null,
  connection_id text not null,
  object_type text not null,
  logical_field text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, workspace_id, mapping_id),
  constraint loopgraph_field_mapping_project_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_field_mapping_workspace_check check (workspace_id ~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$' and length(workspace_id) between 3 and 160),
  constraint loopgraph_field_mapping_id_check check (length(mapping_id) between 3 and 160),
  constraint loopgraph_field_mapping_connection_check check (length(connection_id) between 3 and 160),
  constraint loopgraph_field_mapping_object_check check (length(object_type) between 1 and 240),
  constraint loopgraph_field_mapping_logical_check check (length(logical_field) between 1 and 500),
  constraint loopgraph_field_mapping_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 131072)
);

create index if not exists loopgraph_provider_schema_expiry_idx
  on public.loopgraph_provider_schema_snapshots (organization_id, project_key, workspace_id, expires_at);
create index if not exists loopgraph_field_mapping_connection_idx
  on public.loopgraph_connector_field_mappings (organization_id, project_key, workspace_id, connection_id, object_type);

alter table public.loopgraph_provider_schema_snapshots enable row level security;
alter table public.loopgraph_connector_field_mappings enable row level security;
revoke all on public.loopgraph_provider_schema_snapshots from public, anon, authenticated, service_role;
revoke all on public.loopgraph_connector_field_mappings from public, anon, authenticated, service_role;
grant select on public.loopgraph_provider_schema_snapshots to service_role;
grant select on public.loopgraph_connector_field_mappings to service_role;

create or replace function public.upsert_loopgraph_provider_schema_snapshot(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_workspace_id !~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    or length(p_workspace_id) not between 3 and 160
    or jsonb_typeof(p_snapshot) <> 'object'
    or pg_column_size(p_snapshot) > 1048576
    or p_snapshot->>'schemaVersion' <> 'loopgraph-provider-schema/v1alpha1'
    or p_snapshot->>'workspaceId' <> p_workspace_id
    or p_snapshot->>'samplePolicy' <> 'redacted_only'
    or length(coalesce(p_snapshot->>'connectionId', '')) not between 3 and 160
    or length(coalesce(p_snapshot->>'providerId', '')) not between 3 and 160
    or jsonb_path_exists(p_snapshot, '$.objects[*].fields[*].sampleValues[*]')
    or p_snapshot ?| array['secret', 'token', 'credential', 'authorization']
  then raise exception 'invalid or sample-bearing Loopgraph provider schema snapshot'; end if;

  insert into public.loopgraph_provider_schema_snapshots (
    organization_id, project_key, workspace_id, connection_id, provider_id,
    payload, inspected_at, expires_at, updated_at
  ) values (
    p_organization_id, p_project_key, p_workspace_id,
    p_snapshot->>'connectionId', p_snapshot->>'providerId', p_snapshot,
    (p_snapshot->>'inspectedAt')::timestamptz,
    nullif(p_snapshot->>'expiresAt', '')::timestamptz,
    now()
  ) on conflict (organization_id, project_key, workspace_id, connection_id)
  do update set
    provider_id = excluded.provider_id,
    payload = excluded.payload,
    inspected_at = excluded.inspected_at,
    expires_at = excluded.expires_at,
    updated_at = now();
  perform private.append_security_audit_event(
    p_organization_id, p_project_key, 'app.provider_schema.recorded', 'accepted', 'user',
    p_snapshot->>'inspectedBy', 'app.connector_metadata.manage', null, gen_random_uuid()::text,
    'app_connector_metadata', 'provider_schema', p_snapshot->>'connectionId',
    jsonb_build_object('workspaceId', p_workspace_id, 'providerId', p_snapshot->>'providerId', 'sampleValuesPersisted', false)
  );
  return p_snapshot;
end;
$$;

create or replace function public.upsert_loopgraph_connector_field_mapping(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_mapping jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_workspace_id !~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    or length(p_workspace_id) not between 3 and 160
    or jsonb_typeof(p_mapping) <> 'object'
    or pg_column_size(p_mapping) > 131072
    or p_mapping->>'schemaVersion' <> 'loopgraph-connector-recipe/v1alpha1'
    or p_mapping->>'workspaceId' <> p_workspace_id
    or p_mapping->>'verified' <> 'true'
    or length(coalesce(p_mapping->>'id', '')) not between 3 and 160
    or length(coalesce(p_mapping->>'connectionId', '')) not between 3 and 160
    or length(coalesce(p_mapping->>'confirmedBy', '')) < 1
    or jsonb_typeof(p_mapping->'dependentInstallationIds') <> 'array'
    or jsonb_array_length(p_mapping->'dependentInstallationIds') > 1000
    or p_mapping ?| array['secret', 'token', 'credential', 'authorization']
  then raise exception 'invalid Loopgraph connector field mapping'; end if;

  select payload into v_existing
    from public.loopgraph_connector_field_mappings
    where organization_id = p_organization_id and project_key = p_project_key
      and workspace_id = p_workspace_id and mapping_id = p_mapping->>'id'
    for update;
  if v_existing is not null then
    if v_existing->>'connectionId' <> p_mapping->>'connectionId'
      or v_existing->>'objectType' <> p_mapping->>'objectType'
      or v_existing->>'logicalField' <> p_mapping->>'logicalField'
    then raise exception 'immutable Loopgraph field mapping identity conflict'; end if;
    if not (p_mapping->'dependentInstallationIds' @> v_existing->'dependentInstallationIds') then
      raise exception 'stale Loopgraph field mapping would drop installation ownership';
    end if;
  end if;

  insert into public.loopgraph_connector_field_mappings (
    organization_id, project_key, workspace_id, mapping_id, connection_id,
    object_type, logical_field, payload, created_at, updated_at
  ) values (
    p_organization_id, p_project_key, p_workspace_id, p_mapping->>'id',
    p_mapping->>'connectionId', p_mapping->>'objectType', p_mapping->>'logicalField',
    p_mapping, (p_mapping->>'createdAt')::timestamptz, (p_mapping->>'updatedAt')::timestamptz
  ) on conflict (organization_id, project_key, workspace_id, mapping_id)
  do update set payload = excluded.payload, updated_at = excluded.updated_at;
  perform private.append_security_audit_event(
    p_organization_id, p_project_key, 'app.field_mapping.confirmed', 'accepted', 'user',
    p_mapping->>'confirmedBy', 'app.connector_metadata.manage', null, gen_random_uuid()::text,
    'app_connector_metadata', 'field_mapping', p_mapping->>'id',
    jsonb_build_object('workspaceId', p_workspace_id, 'connectionId', p_mapping->>'connectionId', 'logicalField', p_mapping->>'logicalField')
  );
  return p_mapping;
end;
$$;

create or replace function public.attach_loopgraph_connector_field_mappings(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_mapping_ids text[],
  p_installation_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping_id text;
  v_payload jsonb;
  v_attached_at timestamptz := now();
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_workspace_id !~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    or length(p_workspace_id) not between 3 and 160
    or cardinality(p_mapping_ids) not between 1 and 500
    or length(p_installation_id) not between 3 and 160
  then raise exception 'invalid Loopgraph field mapping attachment'; end if;
  foreach v_mapping_id in array p_mapping_ids loop
    if length(v_mapping_id) not between 3 and 160 then
      raise exception 'invalid Loopgraph field mapping attachment';
    end if;
    select payload into strict v_payload
      from public.loopgraph_connector_field_mappings
      where organization_id = p_organization_id and project_key = p_project_key
        and workspace_id = p_workspace_id and mapping_id = v_mapping_id
      for update;
    if not (v_payload->'dependentInstallationIds' ? p_installation_id) then
      v_payload := jsonb_set(
        jsonb_set(
          v_payload,
          '{dependentInstallationIds}',
          (v_payload->'dependentInstallationIds') || to_jsonb(p_installation_id),
          true
        ),
        '{updatedAt}',
        to_jsonb(to_char(v_attached_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        true
      );
      update public.loopgraph_connector_field_mappings
        set payload = v_payload, updated_at = v_attached_at
        where organization_id = p_organization_id and project_key = p_project_key
          and workspace_id = p_workspace_id and mapping_id = v_mapping_id;
    end if;
  end loop;
  perform private.append_security_audit_event(
    p_organization_id, p_project_key, 'app.field_mapping.attached', 'accepted', 'service',
    p_installation_id, 'app.installation.manage', null, gen_random_uuid()::text,
    'app_connector_metadata', 'installation', p_installation_id,
    jsonb_build_object('workspaceId', p_workspace_id, 'mappingCount', cardinality(p_mapping_ids))
  );
  return cardinality(p_mapping_ids);
end;
$$;

create or replace function public.detach_loopgraph_connector_field_mappings(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_installation_id text,
  p_detached_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_dependencies jsonb;
  v_count integer := 0;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_workspace_id !~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    or length(p_workspace_id) not between 3 and 160
    or length(p_installation_id) not between 3 and 160
    or p_detached_at is null
  then
    raise exception 'invalid Loopgraph field mapping detachment';
  end if;
  for v_row in
    select mapping_id, payload
      from public.loopgraph_connector_field_mappings
      where organization_id = p_organization_id and project_key = p_project_key
        and workspace_id = p_workspace_id and payload->'dependentInstallationIds' ? p_installation_id
      for update
  loop
    select coalesce(jsonb_agg(value order by value), '[]'::jsonb) into v_dependencies
      from jsonb_array_elements_text(v_row.payload->'dependentInstallationIds') as item(value)
      where value <> p_installation_id;
    update public.loopgraph_connector_field_mappings
      set payload = jsonb_set(
        jsonb_set(v_row.payload, '{dependentInstallationIds}', v_dependencies, true),
        '{updatedAt}', to_jsonb(to_char(p_detached_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true
      ), updated_at = p_detached_at
      where organization_id = p_organization_id and project_key = p_project_key
        and workspace_id = p_workspace_id and mapping_id = v_row.mapping_id;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    perform private.append_security_audit_event(
      p_organization_id, p_project_key, 'app.field_mapping.detached', 'accepted', 'service',
      p_installation_id, 'app.installation.manage', null, gen_random_uuid()::text,
      'app_connector_metadata', 'installation', p_installation_id,
      jsonb_build_object('workspaceId', p_workspace_id, 'mappingCount', v_count)
    );
  end if;
  return v_count;
end;
$$;

revoke all on function public.upsert_loopgraph_provider_schema_snapshot(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_loopgraph_connector_field_mapping(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.attach_loopgraph_connector_field_mappings(uuid, text, text, text[], text) from public, anon, authenticated;
revoke all on function public.detach_loopgraph_connector_field_mappings(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_loopgraph_provider_schema_snapshot(uuid, text, text, jsonb) to service_role;
grant execute on function public.upsert_loopgraph_connector_field_mapping(uuid, text, text, jsonb) to service_role;
grant execute on function public.attach_loopgraph_connector_field_mappings(uuid, text, text, text[], text) to service_role;
grant execute on function public.detach_loopgraph_connector_field_mappings(uuid, text, text, text, timestamptz) to service_role;
