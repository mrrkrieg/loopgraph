-- Detect replay of a rotated human CLI refresh token without retaining raw
-- credentials. One cli_access_sessions row is one token family. Every replaced
-- refresh digest is retained only until the family expiry so reuse can revoke
-- the current generation atomically and enter the tenant audit chain.

alter table public.cli_access_sessions
  add column if not exists refresh_token_generation integer not null default 0,
  add column if not exists refresh_reuse_detected_at timestamptz;

alter table public.cli_access_sessions
  drop constraint if exists cli_access_sessions_refresh_generation_check;
alter table public.cli_access_sessions
  add constraint cli_access_sessions_refresh_generation_check
  check (refresh_token_generation between 0 and 10000);

create table if not exists public.cli_refresh_token_history (
  refresh_token_hash text primary key,
  session_id uuid not null references public.cli_access_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  generation integer not null,
  replaced_at timestamptz not null,
  expires_at timestamptz not null,
  constraint cli_refresh_token_history_hash_check
    check (refresh_token_hash ~ '^[a-f0-9]{64}$'),
  constraint cli_refresh_token_history_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint cli_refresh_token_history_generation_check
    check (generation between 0 and 9999),
  constraint cli_refresh_token_history_expiry_check
    check (expires_at > replaced_at)
);

create index if not exists cli_refresh_token_history_session_generation_idx
  on public.cli_refresh_token_history(session_id, generation desc);
create index if not exists cli_refresh_token_history_expiry_idx
  on public.cli_refresh_token_history(expires_at);

alter table public.cli_refresh_token_history enable row level security;
revoke all on table public.cli_refresh_token_history
  from public, anon, authenticated, service_role;

create or replace function public.rotate_cli_access_session(
  p_refresh_token_hash text,
  p_new_access_token_hash text,
  p_new_refresh_token_hash text,
  p_now timestamptz default now()
)
returns table (
  rotated boolean,
  reason text,
  organization_id uuid,
  project_key text,
  capabilities text[],
  access_expires_at timestamptz,
  refresh_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cli_access_sessions%rowtype;
  v_access_expires_at timestamptz := p_now + interval '15 minutes';
  v_correlation_id text;
  v_presented_generation integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI authorization service required';
  end if;
  if p_refresh_token_hash !~ '^[a-f0-9]{64}$' then
    return query select false, 'invalid_grant'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;
  if p_new_access_token_hash !~ '^[a-f0-9]{64}$'
    or p_new_refresh_token_hash !~ '^[a-f0-9]{64}$'
    or p_new_refresh_token_hash = p_refresh_token_hash then
    return query select false, 'invalid_request'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;
  if exists (
    select 1 from public.cli_access_sessions session
     where session.refresh_token_hash = p_new_refresh_token_hash
  ) or exists (
    select 1 from public.cli_refresh_token_history history
     where history.refresh_token_hash = p_new_refresh_token_hash
  ) then
    return query select false, 'invalid_request'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;

  delete from public.cli_refresh_token_history history
   where history.expires_at < p_now - interval '1 day';

  select * into v_session
    from public.cli_access_sessions session
   where session.refresh_token_hash = p_refresh_token_hash
   for update;

  if not found then
    select session, history.generation into v_session, v_presented_generation
      from public.cli_refresh_token_history history
      join public.cli_access_sessions session on session.id = history.session_id
     where history.refresh_token_hash = p_refresh_token_hash
     for update of session;
    if found then
      update public.cli_access_sessions session
         set revoked_at = coalesce(session.revoked_at, p_now),
             refresh_reuse_detected_at = coalesce(session.refresh_reuse_detected_at, p_now),
             updated_at = p_now
       where session.id = v_session.id;
      if v_session.refresh_reuse_detected_at is null then
        v_correlation_id := 'cli_refresh_reuse_' || gen_random_uuid()::text;
        perform private.append_security_audit_event(
          v_session.organization_id,
          v_session.project_key,
          'cli.session.refresh_reuse_detected',
          'denied',
          'machine',
          'cli_' || replace(v_session.id::text, '-', ''),
          'marketplace.consume',
          null,
          v_correlation_id,
          'cli-device-authorization',
          'cli_access_session',
          v_session.id::text,
          jsonb_build_object(
            'session_revoked', true,
            'presented_generation', v_presented_generation,
            'current_generation', v_session.refresh_token_generation
          )
        );
      end if;
      return query select false, 'refresh_token_reused'::text, null::uuid, null::text,
        null::text[], null::timestamptz, null::timestamptz;
      return;
    end if;
    return query select false, 'invalid_grant'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_session.revoked_at is not null or v_session.refresh_expires_at <= p_now then
    return query select false, 'invalid_grant'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
     where membership.organization_id = v_session.organization_id
       and membership.user_id = v_session.user_id
       and membership.status = 'active'
  ) then
    update public.cli_access_sessions session
       set revoked_at = p_now, updated_at = p_now
     where session.id = v_session.id;
    return query select false, 'membership_required'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;

  insert into public.cli_refresh_token_history (
    refresh_token_hash,
    session_id,
    organization_id,
    project_key,
    generation,
    replaced_at,
    expires_at
  ) values (
    v_session.refresh_token_hash,
    v_session.id,
    v_session.organization_id,
    v_session.project_key,
    v_session.refresh_token_generation,
    p_now,
    v_session.refresh_expires_at
  );

  update public.cli_access_sessions session
     set access_token_hash = p_new_access_token_hash,
         refresh_token_hash = p_new_refresh_token_hash,
         refresh_token_generation = session.refresh_token_generation + 1,
         access_expires_at = v_access_expires_at,
         updated_at = p_now
   where session.id = v_session.id;

  return query select true, 'rotated'::text, v_session.organization_id,
    v_session.project_key, v_session.capabilities, v_access_expires_at,
    v_session.refresh_expires_at;
end;
$$;

revoke all on function public.rotate_cli_access_session(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rotate_cli_access_session(text, text, text, timestamptz)
  to service_role;
