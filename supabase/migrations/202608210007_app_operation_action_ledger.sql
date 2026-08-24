-- Secret-free, tenant-scoped ownership records for provider actions prepared
-- through an installed App. Canonical provider input remains in Connector
-- Broker storage and is intentionally absent from this ledger.

create table if not exists public.loopgraph_app_operation_actions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  workspace_id text not null,
  action_id text not null,
  installation_id text not null,
  loop_id text not null,
  route_job_id text not null,
  status text not null,
  prepared_at timestamptz not null,
  expires_at timestamptz not null,
  action_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id, action_id),
  constraint loopgraph_app_operation_action_project_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_app_operation_action_workspace_check check (length(workspace_id) between 1 and 160),
  constraint loopgraph_app_operation_action_id_check check (action_id ~ '^[a-z0-9][a-z0-9._-]{1,159}$'),
  constraint loopgraph_app_operation_action_status_check check (status = 'prepared'),
  constraint loopgraph_app_operation_action_time_check check (expires_at > prepared_at),
  constraint loopgraph_app_operation_action_payload_check check (
    jsonb_typeof(action_payload) = 'object'
    and action_payload->>'schemaVersion' = 'loopgraph-app-operation-action/v1alpha1'
    and action_payload->>'workspaceId' = workspace_id
    and action_payload->>'id' = action_id
    and action_payload->>'installationId' = installation_id
    and action_payload->>'loopId' = loop_id
    and action_payload->>'routeJobId' = route_job_id
    and action_payload->>'status' = status
    and (action_payload->>'preparedAt')::timestamptz = prepared_at
    and (action_payload->>'expiresAt')::timestamptz = expires_at
    and action_payload->>'recordDigest' ~ '^sha256:[a-f0-9]{64}$'
    and not (action_payload ?| array['input', 'canonicalInput', 'result', 'payload', 'credential', 'accessToken', 'refreshToken', 'apiKey', 'clientSecret'])
    and pg_column_size(action_payload) <= 65536
  )
);

create index if not exists loopgraph_app_operation_actions_installation_idx
  on public.loopgraph_app_operation_actions (organization_id, project_key, workspace_id, installation_id, prepared_at desc);
create index if not exists loopgraph_app_operation_actions_route_idx
  on public.loopgraph_app_operation_actions (organization_id, project_key, workspace_id, route_job_id, prepared_at desc);
create index if not exists loopgraph_app_operation_actions_status_idx
  on public.loopgraph_app_operation_actions (organization_id, project_key, workspace_id, status, expires_at);

alter table public.loopgraph_app_operation_actions enable row level security;
revoke all on public.loopgraph_app_operation_actions from public, anon, authenticated, service_role;
grant select on public.loopgraph_app_operation_actions to service_role;

create or replace function public.record_loopgraph_app_operation_action(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_action jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
  v_inserted boolean := false;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or jsonb_typeof(p_action) <> 'object'
    or pg_column_size(p_action) > 65536
    or p_action->>'schemaVersion' <> 'loopgraph-app-operation-action/v1alpha1'
    or p_action->>'workspaceId' <> p_workspace_id
    or p_action->>'status' <> 'prepared'
    or coalesce(p_action->>'id', '') !~ '^[a-z0-9][a-z0-9._-]{1,159}$'
    or coalesce(p_action->>'recordDigest', '') !~ '^sha256:[a-f0-9]{64}$'
    or p_action ?| array['input', 'canonicalInput', 'result', 'payload', 'credential', 'accessToken', 'refreshToken', 'apiKey', 'clientSecret']
    or (p_action::text ~* '(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|private[_-]?key|refresh[_-]?token|webhook[_-]?secret)')
  then raise exception 'invalid or secret-bearing App operation action record'; end if;

  insert into public.loopgraph_app_operation_actions (
    organization_id,
    project_key,
    workspace_id,
    action_id,
    installation_id,
    loop_id,
    route_job_id,
    status,
    prepared_at,
    expires_at,
    action_payload
  ) values (
    p_organization_id,
    p_project_key,
    p_workspace_id,
    p_action->>'id',
    p_action->>'installationId',
    p_action->>'loopId',
    p_action->>'routeJobId',
    p_action->>'status',
    (p_action->>'preparedAt')::timestamptz,
    (p_action->>'expiresAt')::timestamptz,
    p_action
  ) on conflict do nothing;
  v_inserted := found;

  select action_payload into strict v_existing
    from public.loopgraph_app_operation_actions
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and action_id = p_action->>'id';
  if v_existing <> p_action then
    raise exception 'prepared App action identity conflict';
  end if;

  if v_inserted then
    perform private.append_security_audit_event(
      p_organization_id,
      p_project_key,
      'app.operation_action.prepared',
      'accepted',
      'workload',
      p_action->>'agentInstanceId',
      'hermes.app_operations',
      null,
      p_action->>'requestId',
      'app_operation_action',
      'action',
      p_action->>'id',
      jsonb_build_object(
        'workspaceId', p_workspace_id,
        'installationId', p_action->>'installationId',
        'appId', p_action->>'appId',
        'loopId', p_action->>'loopId',
        'routeJobId', p_action->>'routeJobId',
        'capability', p_action->>'capability',
        'providerId', p_action#>>'{providerBinding,providerId}',
        'riskClass', p_action->>'riskClass',
        'approvalRequired', (p_action->>'approvalRequired')::boolean,
        'recordDigest', p_action->>'recordDigest'
      )
    );
  end if;
  return v_existing;
end;
$$;

revoke all on function public.record_loopgraph_app_operation_action(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_loopgraph_app_operation_action(uuid, text, text, jsonb) to service_role;
