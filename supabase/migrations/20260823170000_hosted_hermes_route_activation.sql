-- Durable tenant/project/workspace proof that the Hermes Route Controller
-- applied one exact secret-free shadow route contract. Records are append-only
-- by request digest; a later plan produces a new row rather than overwriting
-- the evidence used by an earlier App promotion decision.

create table if not exists public.loopgraph_hermes_route_activation_records (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  workspace_id text not null,
  request_digest text not null,
  plan_digest text not null,
  catalog_version text not null,
  controller_instance_id text not null,
  ready boolean not null,
  activated_at timestamptz not null,
  record_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id, request_digest),
  constraint loopgraph_hermes_route_activation_project_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_hermes_route_activation_workspace_check
    check (length(workspace_id) between 1 and 160),
  constraint loopgraph_hermes_route_activation_request_digest_check
    check (request_digest ~ '^[a-f0-9]{16}$'),
  constraint loopgraph_hermes_route_activation_plan_digest_check
    check (plan_digest ~ '^[a-f0-9]{16}$'),
  constraint loopgraph_hermes_route_activation_catalog_check
    check (length(catalog_version) between 1 and 500),
  constraint loopgraph_hermes_route_activation_controller_check
    check (length(controller_instance_id) between 1 and 240),
  constraint loopgraph_hermes_route_activation_payload_check
    check (jsonb_typeof(record_payload) = 'object' and pg_column_size(record_payload) <= 1048576)
);

create index if not exists loopgraph_hermes_route_activation_latest_idx
  on public.loopgraph_hermes_route_activation_records (
    organization_id,
    project_key,
    workspace_id,
    activated_at desc,
    created_at desc
  );

alter table public.loopgraph_hermes_route_activation_records enable row level security;
revoke all on public.loopgraph_hermes_route_activation_records from public, anon, authenticated, service_role;
grant select on public.loopgraph_hermes_route_activation_records to service_role;

create or replace function public.reject_loopgraph_hermes_route_activation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Hermes route activation records are append-only';
end;
$$;

drop trigger if exists loopgraph_hermes_route_activation_records_immutable
  on public.loopgraph_hermes_route_activation_records;
create trigger loopgraph_hermes_route_activation_records_immutable
before update or delete on public.loopgraph_hermes_route_activation_records
for each row execute function public.reject_loopgraph_hermes_route_activation_mutation();

create or replace function public.record_loopgraph_hermes_route_activation(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
  v_request_digest text;
  v_plan_digest text;
  v_catalog_version text;
  v_controller_instance_id text;
  v_activated_at timestamptz;
  v_ready boolean;
  v_route_count integer;
begin
  v_request_digest := p_record->>'requestDigest';
  v_plan_digest := p_record#>>'{plan,planDigest}';
  v_catalog_version := p_record#>>'{plan,catalogVersion}';
  v_controller_instance_id := p_record#>>'{receipt,controllerInstanceId}';
  v_activated_at := nullif(p_record->>'activatedAt', '')::timestamptz;
  v_ready := coalesce((p_record->>'ready')::boolean, false);
  v_route_count := jsonb_array_length(coalesce(p_record#>'{receipt,routes}', '[]'::jsonb));

  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or jsonb_typeof(p_record) <> 'object'
    or pg_column_size(p_record) > 1048576
    or p_record->>'schemaVersion' <> 'hermes-route-activation-record/v1alpha1'
    or v_request_digest !~ '^[a-f0-9]{16}$'
    or v_plan_digest !~ '^[a-f0-9]{16}$'
    or length(coalesce(v_catalog_version, '')) not between 1 and 500
    or length(coalesce(v_controller_instance_id, '')) not between 1 and 240
    or p_record#>>'{receipt,planDigest}' is distinct from v_plan_digest
    or p_record#>>'{receipt,catalogVersion}' is distinct from v_catalog_version
    or p_record#>>'{receipt,destructiveChangesApplied}' <> 'false'
    or v_route_count < 1
    or p_record::text ~* '"(access_token|refresh_token|client_secret|webhook_secret|authorization|password|api_key|private_key)"[[:space:]]*:'
  then
    raise exception 'invalid Hermes route activation record';
  end if;

  select record_payload into v_existing
    from public.loopgraph_hermes_route_activation_records
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and request_digest = v_request_digest;
  if v_existing is not null then
    if v_existing <> p_record then
      raise exception 'immutable Hermes route activation conflict';
    end if;
    return v_existing;
  end if;

  insert into public.loopgraph_hermes_route_activation_records (
    organization_id,
    project_key,
    workspace_id,
    request_digest,
    plan_digest,
    catalog_version,
    controller_instance_id,
    ready,
    activated_at,
    record_payload
  ) values (
    p_organization_id,
    p_project_key,
    p_workspace_id,
    v_request_digest,
    v_plan_digest,
    v_catalog_version,
    v_controller_instance_id,
    v_ready,
    v_activated_at,
    p_record
  );

  perform private.append_security_audit_event(
    p_organization_id,
    p_project_key,
    'hermes.route_activation.recorded',
    'accepted',
    'machine',
    v_controller_instance_id,
    'hermes.route_activation',
    null,
    gen_random_uuid()::text,
    'hermes_route_activation',
    'route_plan',
    v_plan_digest,
    jsonb_build_object(
      'workspaceId', p_workspace_id,
      'requestDigest', v_request_digest,
      'ready', v_ready,
      'routeCount', v_route_count
    )
  );
  return p_record;
end;
$$;

revoke all on function public.record_loopgraph_hermes_route_activation(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_loopgraph_hermes_route_activation(uuid, text, text, jsonb)
  to service_role;

revoke all on function public.reject_loopgraph_hermes_route_activation_mutation()
  from public, anon, authenticated, service_role;
