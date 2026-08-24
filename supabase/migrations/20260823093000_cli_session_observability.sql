-- Aggregate-only security posture for hosted human CLI sessions.
--
-- The projection is service-role-only and tenant/project scoped. It never
-- returns token digests, user IDs, device IDs, request fingerprints, or raw
-- audit metadata.

create or replace function public.get_cli_session_security_snapshot(
  p_organization_id uuid,
  p_project_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted observability service required';
  end if;
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid CLI session observability scope';
  end if;

  return jsonb_build_object(
    'cli_sessions_total', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
    ),
    'cli_sessions_active', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
         and session.revoked_at is null
         and session.access_expires_at > p_now
         and session.refresh_expires_at > p_now
    ),
    'cli_sessions_refresh_required', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
         and session.revoked_at is null
         and session.access_expires_at <= p_now
         and session.refresh_expires_at > p_now
    ),
    'cli_sessions_expired', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
         and session.revoked_at is null
         and session.refresh_expires_at <= p_now
    ),
    'cli_sessions_revoked', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
         and session.revoked_at is not null
    ),
    'cli_refresh_reuse_detected_total', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
         and session.refresh_reuse_detected_at is not null
    ),
    'cli_refresh_reuse_detected_24h', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
         and session.refresh_reuse_detected_at >= p_now - interval '24 hours'
         and session.refresh_reuse_detected_at <= p_now
    ),
    'cli_refresh_reuse_unrevoked', (
      select count(*)
        from public.cli_access_sessions session
       where session.organization_id = p_organization_id
         and session.project_key = p_project_key
         and session.refresh_reuse_detected_at is not null
         and session.revoked_at is null
    ),
    'cli_device_authorizations_pending', (
      select count(*)
        from public.cli_device_authorizations authorization
       where authorization.organization_id = p_organization_id
         and authorization.project_key = p_project_key
         and authorization.status = 'pending'
         and authorization.expires_at > p_now
    ),
    'cli_device_authorizations_oldest_pending_seconds', coalesce((
      select greatest(
        0,
        floor(extract(epoch from (p_now - min(authorization.created_at))))::bigint
      )
        from public.cli_device_authorizations authorization
       where authorization.organization_id = p_organization_id
         and authorization.project_key = p_project_key
         and authorization.status = 'pending'
         and authorization.expires_at > p_now
    ), 0)
  );
end;
$$;

revoke all on function public.get_cli_session_security_snapshot(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_cli_session_security_snapshot(uuid, text, timestamptz)
  to service_role;
