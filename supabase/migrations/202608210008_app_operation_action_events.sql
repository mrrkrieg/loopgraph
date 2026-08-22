-- Append-only lifecycle evidence for App-owned prepared actions. The parent
-- action remains immutable; approvals and commits are separate receipt-bound
-- facts. Neither table stores canonical provider input or credentials.

create table if not exists public.loopgraph_app_operation_action_events (
  organization_id uuid not null,
  project_key text not null,
  workspace_id text not null,
  event_id text not null,
  action_id text not null,
  installation_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  event_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id, event_id),
  foreign key (organization_id, project_key, workspace_id, action_id)
    references public.loopgraph_app_operation_actions (organization_id, project_key, workspace_id, action_id)
    on delete cascade,
  constraint loopgraph_app_operation_action_event_project_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_app_operation_action_event_workspace_check check (length(workspace_id) between 1 and 160),
  constraint loopgraph_app_operation_action_event_id_check check (event_id ~ '^[a-z0-9][a-z0-9._-]{1,159}$'),
  constraint loopgraph_app_operation_action_event_type_check check (
    event_type in ('approval_granted', 'commit_requested', 'commit_succeeded', 'commit_failed', 'revoked')
  ),
  constraint loopgraph_app_operation_action_event_payload_check check (
    jsonb_typeof(event_payload) = 'object'
    and event_payload->>'schemaVersion' = 'loopgraph-app-operation-action-event/v1alpha1'
    and event_payload->>'workspaceId' = workspace_id
    and event_payload->>'id' = event_id
    and event_payload->>'actionId' = action_id
    and event_payload->>'installationId' = installation_id
    and event_payload->>'eventType' = event_type
    and (event_payload->>'occurredAt')::timestamptz = occurred_at
    and event_payload->>'actionRecordDigest' ~ '^sha256:[a-f0-9]{64}$'
    and event_payload->>'eventDigest' ~ '^sha256:[a-f0-9]{64}$'
    and not (event_payload ?| array['input', 'canonicalInput', 'result', 'payload', 'credential', 'accessToken', 'refreshToken', 'apiKey', 'clientSecret'])
    and pg_column_size(event_payload) <= 32768
  )
);

create index if not exists loopgraph_app_operation_action_events_action_idx
  on public.loopgraph_app_operation_action_events (organization_id, project_key, workspace_id, action_id, occurred_at desc);
create index if not exists loopgraph_app_operation_action_events_installation_idx
  on public.loopgraph_app_operation_action_events (organization_id, project_key, workspace_id, installation_id, occurred_at desc);
alter table public.loopgraph_app_operation_action_events enable row level security;
revoke all on public.loopgraph_app_operation_action_events from public, anon, authenticated, service_role;
grant select on public.loopgraph_app_operation_action_events to service_role;

create or replace function public.record_loopgraph_app_operation_action_event(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action jsonb;
  v_existing jsonb;
  v_inserted boolean := false;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or jsonb_typeof(p_event) <> 'object'
    or pg_column_size(p_event) > 32768
    or p_event->>'schemaVersion' <> 'loopgraph-app-operation-action-event/v1alpha1'
    or p_event->>'workspaceId' <> p_workspace_id
    or coalesce(p_event->>'id', '') !~ '^[a-z0-9][a-z0-9._-]{1,159}$'
    or coalesce(p_event->>'eventType', '') not in ('approval_granted', 'commit_requested', 'commit_succeeded', 'commit_failed', 'revoked')
    or coalesce(p_event->>'actionRecordDigest', '') !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(p_event->>'eventDigest', '') !~ '^sha256:[a-f0-9]{64}$'
    or p_event ?| array['input', 'canonicalInput', 'result', 'payload', 'credential', 'accessToken', 'refreshToken', 'apiKey', 'clientSecret']
    or (p_event::text ~* '(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|private[_-]?key|refresh[_-]?token|webhook[_-]?secret)')
  then raise exception 'invalid or secret-bearing App operation action event'; end if;

  select action_payload into strict v_action
    from public.loopgraph_app_operation_actions
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and action_id = p_event->>'actionId'
    for share;
  if v_action->>'installationId' <> p_event->>'installationId'
    or v_action->>'recordDigest' <> p_event->>'actionRecordDigest'
  then raise exception 'App operation action event does not match its immutable parent'; end if;
  if p_event->>'eventType' = 'approval_granted' and not exists (
    select 1
      from public.connector_action_approvals approval
      join public.connector_prepared_actions prepared
        on prepared.organization_id = approval.organization_id
       and prepared.project_key = approval.project_key
       and prepared.action_id = approval.action_id
      where approval.organization_id = p_organization_id
        and approval.project_key = p_project_key
        and approval.approval_id = p_event#>>'{approval,connectorApprovalReceiptId}'
        and approval.action_id = v_action->>'brokerPreparedActionId'
        and approval.fingerprint = v_action->>'brokerPreparedActionFingerprint'
        and approval.approved_by = p_event#>>'{actor,subject}'
        and approval.expires_at = (p_event#>>'{approval,expiresAt}')::timestamptz
        and approval.status in ('approved', 'consumed')
        and prepared.installation_id = v_action#>>'{providerBinding,connectionId}'
        and prepared.provider_id = v_action#>>'{providerBinding,providerId}'
        and prepared.capability = v_action#>>'{providerBinding,brokerCapability}'
        and prepared.operation = v_action#>>'{providerBinding,operation}'
  ) then raise exception 'App action approval event does not match a Connector Broker approval receipt'; end if;

  insert into public.loopgraph_app_operation_action_events (
    organization_id,
    project_key,
    workspace_id,
    event_id,
    action_id,
    installation_id,
    event_type,
    occurred_at,
    event_payload
  ) values (
    p_organization_id,
    p_project_key,
    p_workspace_id,
    p_event->>'id',
    p_event->>'actionId',
    p_event->>'installationId',
    p_event->>'eventType',
    (p_event->>'occurredAt')::timestamptz,
    p_event
  ) on conflict do nothing;
  v_inserted := found;

  select event_payload into strict v_existing
    from public.loopgraph_app_operation_action_events
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and event_id = p_event->>'id';
  if v_existing <> p_event then raise exception 'App operation action event identity conflict'; end if;

  if v_inserted then
    perform private.append_security_audit_event(
      p_organization_id,
      p_project_key,
      'app.operation_action.' || p_event->>'eventType',
      'accepted',
      p_event#>>'{actor,type}',
      p_event#>>'{actor,subject}',
      case when p_event->>'eventType' = 'approval_granted' then 'integrations.manage' else 'hermes.app_operations' end,
      null,
      p_event->>'id',
      'app_operation_action',
      'action_event',
      p_event->>'actionId',
      jsonb_build_object(
        'workspaceId', p_workspace_id,
        'installationId', p_event->>'installationId',
        'eventType', p_event->>'eventType',
        'actionRecordDigest', p_event->>'actionRecordDigest',
        'eventDigest', p_event->>'eventDigest'
      )
    );
  end if;
  return v_existing;
end;
$$;

revoke all on function public.record_loopgraph_app_operation_action_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_loopgraph_app_operation_action_event(uuid, text, text, jsonb) to service_role;
