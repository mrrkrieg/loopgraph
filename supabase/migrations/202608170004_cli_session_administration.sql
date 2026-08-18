-- Tenant-scoped emergency administration for human CLI sessions.
--
-- The browser never receives access/refresh digests. Revocation and its
-- immutable security-audit event commit in the same database transaction.

create or replace function public.admin_revoke_cli_access_sessions(
  p_organization_id uuid,
  p_project_key text,
  p_actor_user_id uuid,
  p_scope text,
  p_reason text,
  p_session_id uuid default null,
  p_target_user_id uuid default null,
  p_now timestamptz default now()
)
returns table (revoked_count integer, correlation_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked_count integer;
  v_correlation_id text := 'cli_session_revoke_' || gen_random_uuid()::text;
  v_resource_id text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI session administrator required';
  end if;
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_scope not in ('session', 'user', 'organization')
    or length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'invalid CLI session revocation request';
  end if;
  if not exists (
    select 1
      from public.organization_memberships membership
     where membership.organization_id = p_organization_id
       and membership.user_id = p_actor_user_id
       and membership.status = 'active'
       and membership.role in ('admin', 'owner')
  ) then
    raise exception using errcode = '42501', message = 'CLI session administrator membership required';
  end if;
  if (p_scope = 'session' and (p_session_id is null or p_target_user_id is not null))
    or (p_scope = 'user' and (p_target_user_id is null or p_session_id is not null))
    or (p_scope = 'organization' and (p_session_id is not null or p_target_user_id is not null)) then
    raise exception using errcode = '22023', message = 'invalid CLI session revocation target';
  end if;

  update public.cli_access_sessions session
     set revoked_at = coalesce(session.revoked_at, p_now),
         updated_at = p_now
   where session.organization_id = p_organization_id
     and session.project_key = p_project_key
     and session.revoked_at is null
     and (p_scope <> 'session' or session.id = p_session_id)
     and (p_scope <> 'user' or session.user_id = p_target_user_id);
  get diagnostics v_revoked_count = row_count;

  v_resource_id := case p_scope
    when 'session' then p_session_id::text
    when 'user' then p_target_user_id::text
    else p_organization_id::text
  end;
  perform private.append_security_audit_event(
    p_organization_id,
    p_project_key,
    'cli.session.revoked',
    'accepted',
    'user',
    p_actor_user_id::text,
    'marketplace.consume',
    null,
    v_correlation_id,
    'cli-session-admin',
    'cli_access_session_' || p_scope,
    v_resource_id,
    jsonb_build_object(
      'scope', p_scope,
      'revoked_count', v_revoked_count,
      'reason_recorded', true,
      'reason_sha256', encode(sha256(convert_to(btrim(p_reason), 'UTF8')), 'hex')
    )
  );

  return query select v_revoked_count, v_correlation_id;
end;
$$;

revoke all on function public.admin_revoke_cli_access_sessions(uuid, text, uuid, text, text, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_revoke_cli_access_sessions(uuid, text, uuid, text, text, uuid, uuid, timestamptz)
  to service_role;
