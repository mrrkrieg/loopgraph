-- Revoke one exact prepared Connector Broker action without disabling its
-- entire provider connection. The caller must already be an authenticated,
-- step-up-authorized platform administrator; only service_role may invoke
-- this transaction. No canonical provider input or human review text leaves
-- the Connector Broker boundary.

create or replace function public.revoke_connector_prepared_action(
  p_organization_id uuid,
  p_project_key text,
  p_installation_id text,
  p_action_id text,
  p_fingerprint text,
  p_revoked_by text,
  p_reason_digest text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.connector_prepared_actions%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(trim(p_revoked_by)) not between 1 and 512
    or length(p_action_id) not between 8 and 160
    or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_reason_digest !~ '^sha256:[a-f0-9]{64}$'
  then raise exception 'invalid prepared-action revocation request'; end if;

  select * into v_action
    from public.connector_prepared_actions
    where organization_id = p_organization_id
      and project_key = p_project_key
      and installation_id = p_installation_id
      and action_id = p_action_id
    for update;
  if not found then raise exception 'prepared action was not found'; end if;
  if v_action.fingerprint <> p_fingerprint then raise exception 'prepared action fingerprint changed'; end if;
  if v_action.status = 'committed' then raise exception 'committed actions cannot be revoked'; end if;
  if v_action.status = 'committing' then raise exception 'action commit is in progress and requires reconciliation'; end if;
  if v_action.status = 'expired' or v_action.expires_at <= p_now then
    update public.connector_prepared_actions
      set status = 'expired'
      where organization_id = p_organization_id and project_key = p_project_key and action_id = p_action_id;
    raise exception 'prepared action has expired';
  end if;

  if v_action.status <> 'revoked' then
    update public.connector_prepared_actions
      set status = 'revoked'
      where organization_id = p_organization_id and project_key = p_project_key and action_id = p_action_id;
    update public.connector_action_approvals
      set status = 'revoked'
      where organization_id = p_organization_id
        and project_key = p_project_key
        and action_id = p_action_id
        and fingerprint = p_fingerprint
        and status = 'approved';
    perform public.append_connector_security_audit_event(
      p_organization_id,
      p_project_key,
      'connector.action.revoked',
      'accepted',
      'user',
      p_revoked_by,
      'connector-action-revoke:' || p_action_id,
      'connector_prepared_action',
      p_action_id,
      jsonb_build_object(
        'installationId', p_installation_id,
        'providerId', v_action.provider_id,
        'capability', v_action.capability,
        'operation', v_action.operation,
        'reasonDigest', p_reason_digest
      )
    );
  end if;

  return jsonb_build_object(
    'actionId', p_action_id,
    'fingerprint', p_fingerprint,
    'status', 'revoked'
  );
end;
$$;

revoke all on function public.revoke_connector_prepared_action(uuid, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.revoke_connector_prepared_action(uuid, text, text, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.validate_loopgraph_app_action_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action jsonb;
begin
  if new.event_type <> 'revoked' then return new; end if;
  if new.event_payload#>>'{actor,type}' <> 'user'
    or coalesce(new.event_payload#>>'{actor,subject}', '') = ''
    or coalesce(new.event_payload#>>'{revocation,reasonDigest}', '') !~ '^sha256:[a-f0-9]{64}$'
  then raise exception 'invalid App action revocation evidence'; end if;

  select action_payload into strict v_action
    from public.loopgraph_app_operation_actions
    where organization_id = new.organization_id
      and project_key = new.project_key
      and workspace_id = new.workspace_id
      and action_id = new.action_id;
  if not exists (
    select 1 from public.connector_prepared_actions prepared
      where prepared.organization_id = new.organization_id
        and prepared.project_key = new.project_key
        and prepared.installation_id = v_action#>>'{providerBinding,connectionId}'
        and prepared.action_id = v_action->>'brokerPreparedActionId'
        and prepared.fingerprint = v_action->>'brokerPreparedActionFingerprint'
        and prepared.status = 'revoked'
  ) then raise exception 'App action revocation is not backed by a revoked Connector Broker action'; end if;
  return new;
end;
$$;

revoke all on function public.validate_loopgraph_app_action_revocation() from public, anon, authenticated;

drop trigger if exists loopgraph_app_action_revocation_guard on public.loopgraph_app_operation_action_events;
create trigger loopgraph_app_action_revocation_guard
before insert on public.loopgraph_app_operation_action_events
for each row execute function public.validate_loopgraph_app_action_revocation();
