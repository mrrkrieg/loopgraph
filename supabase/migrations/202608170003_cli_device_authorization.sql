-- Interactive human authorization for the Loopgraph CLI.
--
-- Device and session secrets are returned once and stored only as SHA-256
-- digests. Human CLI sessions are deliberately separate from workload
-- identities: they are user-owned, short-lived, capability scoped, and remain
-- subject to active organization membership plus the existing durable machine
-- request replay/rate/audit boundary.

create table if not exists public.cli_device_authorizations (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique,
  user_code_hash text not null unique,
  client_id text not null default 'loopgraph-cli',
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  capabilities text[] not null default array['marketplace.consume']::text[],
  request_fingerprint_hash text not null,
  status text not null default 'pending',
  user_id uuid references auth.users(id) on delete set null,
  interval_seconds integer not null default 5,
  last_polled_at timestamptz,
  approved_at timestamptz,
  denied_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  constraint cli_device_authorizations_device_hash_check
    check (device_code_hash ~ '^[a-f0-9]{64}$'),
  constraint cli_device_authorizations_user_hash_check
    check (user_code_hash ~ '^[a-f0-9]{64}$'),
  constraint cli_device_authorizations_fingerprint_check
    check (request_fingerprint_hash ~ '^[a-f0-9]{64}$'),
  constraint cli_device_authorizations_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint cli_device_authorizations_capabilities_check
    check (
      cardinality(capabilities) between 1 and 8
      and capabilities <@ array['marketplace.consume']::text[]
    ),
  constraint cli_device_authorizations_status_check
    check (status in ('pending', 'approved', 'denied', 'consumed', 'expired')),
  constraint cli_device_authorizations_interval_check
    check (interval_seconds between 5 and 30),
  constraint cli_device_authorizations_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);

create index if not exists cli_device_authorizations_fingerprint_created_idx
  on public.cli_device_authorizations(request_fingerprint_hash, created_at desc);
create index if not exists cli_device_authorizations_expiry_idx
  on public.cli_device_authorizations(expires_at);

create table if not exists public.cli_device_issuance_rate_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_kind text not null,
  bucket_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, bucket_kind, bucket_key, window_started_at),
  constraint cli_device_issuance_rate_windows_kind_check
    check (bucket_kind in ('fingerprint', 'organization')),
  constraint cli_device_issuance_rate_windows_key_check
    check (
      (bucket_kind = 'fingerprint' and bucket_key ~ '^[a-f0-9]{64}$')
      or (bucket_kind = 'organization' and bucket_key = 'global')
    ),
  constraint cli_device_issuance_rate_windows_count_check
    check (request_count between 0 and 500)
);

create index if not exists cli_device_issuance_rate_windows_updated_idx
  on public.cli_device_issuance_rate_windows(updated_at);

create table if not exists public.cli_access_sessions (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  capabilities text[] not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cli_access_sessions_access_hash_check
    check (access_token_hash ~ '^[a-f0-9]{64}$'),
  constraint cli_access_sessions_refresh_hash_check
    check (refresh_token_hash ~ '^[a-f0-9]{64}$'),
  constraint cli_access_sessions_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint cli_access_sessions_capabilities_check
    check (
      cardinality(capabilities) between 1 and 8
      and capabilities <@ array['marketplace.consume']::text[]
    ),
  constraint cli_access_sessions_expiry_check
    check (
      access_expires_at > created_at
      and access_expires_at <= updated_at + interval '20 minutes'
      and refresh_expires_at > access_expires_at
      and refresh_expires_at <= created_at + interval '31 days'
    )
);

create index if not exists cli_access_sessions_scope_user_idx
  on public.cli_access_sessions(organization_id, project_key, user_id, created_at desc);
create index if not exists cli_access_sessions_expiry_idx
  on public.cli_access_sessions(refresh_expires_at);

create table if not exists public.cli_device_decision_rate_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, window_started_at),
  constraint cli_device_decision_rate_windows_count_check
    check (attempt_count between 0 and 10)
);

alter table public.cli_device_authorizations enable row level security;
alter table public.cli_device_issuance_rate_windows enable row level security;
alter table public.cli_access_sessions enable row level security;
alter table public.cli_device_decision_rate_windows enable row level security;
revoke all on public.cli_device_authorizations from public, anon, authenticated;
revoke all on public.cli_device_issuance_rate_windows from public, anon, authenticated;
revoke all on public.cli_access_sessions from public, anon, authenticated;
revoke all on public.cli_device_decision_rate_windows from public, anon, authenticated;
grant all on public.cli_device_authorizations to service_role;
grant all on public.cli_device_issuance_rate_windows to service_role;
grant all on public.cli_access_sessions to service_role;
grant all on public.cli_device_decision_rate_windows to service_role;

create or replace function public.create_cli_device_authorization(
  p_device_code_hash text,
  p_user_code_hash text,
  p_organization_id uuid,
  p_project_key text,
  p_capabilities text[],
  p_request_fingerprint_hash text,
  p_now timestamptz default now()
)
returns table (authorization_id uuid, expires_at timestamptz, interval_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_expires_at timestamptz := p_now + interval '10 minutes';
  v_fingerprint_count integer;
  v_organization_count integer;
  v_window_started_at timestamptz := date_trunc('minute', p_now);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI authorization service required';
  end if;
  if p_device_code_hash !~ '^[a-f0-9]{64}$'
    or p_user_code_hash !~ '^[a-f0-9]{64}$'
    or p_request_fingerprint_hash !~ '^[a-f0-9]{64}$'
    or p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or cardinality(p_capabilities) not between 1 and 8
    or not p_capabilities <@ array['marketplace.consume']::text[] then
    raise exception 'invalid CLI device authorization';
  end if;

  delete from public.cli_device_authorizations
   where expires_at < p_now - interval '1 day';
  delete from public.cli_device_issuance_rate_windows
   where updated_at < p_now - interval '1 day';

  insert into public.cli_device_issuance_rate_windows (
    organization_id,
    bucket_kind,
    bucket_key,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_organization_id,
    'fingerprint',
    p_request_fingerprint_hash,
    v_window_started_at,
    1,
    p_now
  )
  on conflict (organization_id, bucket_kind, bucket_key, window_started_at) do update
    set request_count = public.cli_device_issuance_rate_windows.request_count + 1,
        updated_at = p_now
    where public.cli_device_issuance_rate_windows.request_count < 5
  returning request_count into v_fingerprint_count;
  if v_fingerprint_count is null then
    raise exception using errcode = 'P0001', message = 'device_authorization_rate_limited';
  end if;

  insert into public.cli_device_issuance_rate_windows (
    organization_id,
    bucket_kind,
    bucket_key,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_organization_id,
    'organization',
    'global',
    v_window_started_at,
    1,
    p_now
  )
  on conflict (organization_id, bucket_kind, bucket_key, window_started_at) do update
    set request_count = public.cli_device_issuance_rate_windows.request_count + 1,
        updated_at = p_now
    where public.cli_device_issuance_rate_windows.request_count < 500
  returning request_count into v_organization_count;
  if v_organization_count is null then
    raise exception using errcode = 'P0001', message = 'device_authorization_rate_limited';
  end if;

  insert into public.cli_device_authorizations (
    device_code_hash,
    user_code_hash,
    organization_id,
    project_key,
    capabilities,
    request_fingerprint_hash,
    expires_at,
    created_at
  ) values (
    p_device_code_hash,
    p_user_code_hash,
    p_organization_id,
    p_project_key,
    p_capabilities,
    p_request_fingerprint_hash,
    v_expires_at,
    p_now
  ) returning id into v_id;

  return query select v_id, v_expires_at, 5;
end;
$$;

create or replace function public.decide_cli_device_authorization(
  p_user_code_hash text,
  p_organization_id uuid,
  p_user_id uuid,
  p_approve boolean,
  p_now timestamptz default now()
)
returns table (decided boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.cli_device_authorizations%rowtype;
  v_attempt_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI authorization service required';
  end if;
  delete from public.cli_device_decision_rate_windows
   where updated_at < p_now - interval '1 day';
  insert into public.cli_device_decision_rate_windows (
    organization_id,
    user_id,
    window_started_at,
    attempt_count,
    updated_at
  ) values (
    p_organization_id,
    p_user_id,
    date_trunc('minute', p_now),
    1,
    p_now
  )
  on conflict (organization_id, user_id, window_started_at) do update
    set attempt_count = public.cli_device_decision_rate_windows.attempt_count + 1,
        updated_at = p_now
    where public.cli_device_decision_rate_windows.attempt_count < 10
  returning attempt_count into v_attempt_count;
  if v_attempt_count is null then
    return query select false, 'rate_limited'::text;
    return;
  end if;

  select * into v_authorization
    from public.cli_device_authorizations
   where user_code_hash = p_user_code_hash
   for update;
  if not found or v_authorization.organization_id <> p_organization_id then
    return query select false, 'invalid_user_code'::text;
    return;
  end if;
  if v_authorization.expires_at <= p_now then
    update public.cli_device_authorizations set status = 'expired'
     where id = v_authorization.id;
    return query select false, 'expired_token'::text;
    return;
  end if;
  if v_authorization.status <> 'pending' then
    return query select false, 'authorization_already_decided'::text;
    return;
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
     where membership.organization_id = p_organization_id
       and membership.user_id = p_user_id
       and membership.status = 'active'
  ) then
    return query select false, 'membership_required'::text;
    return;
  end if;

  update public.cli_device_authorizations
     set status = case when p_approve then 'approved' else 'denied' end,
         user_id = p_user_id,
         approved_at = case when p_approve then p_now else null end,
         denied_at = case when p_approve then null else p_now end
   where id = v_authorization.id;
  return query select true, case when p_approve then 'approved' else 'denied' end;
end;
$$;

create or replace function public.exchange_cli_device_authorization(
  p_device_code_hash text,
  p_access_token_hash text,
  p_refresh_token_hash text,
  p_now timestamptz default now()
)
returns table (
  authorized boolean,
  reason text,
  organization_id uuid,
  project_key text,
  capabilities text[],
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  interval_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.cli_device_authorizations%rowtype;
  v_access_expires_at timestamptz := p_now + interval '15 minutes';
  v_refresh_expires_at timestamptz := p_now + interval '30 days';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI authorization service required';
  end if;
  if p_device_code_hash !~ '^[a-f0-9]{64}$'
    or p_access_token_hash !~ '^[a-f0-9]{64}$'
    or p_refresh_token_hash !~ '^[a-f0-9]{64}$' then
    return query select false, 'invalid_grant'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz, 5;
    return;
  end if;

  select * into v_authorization
    from public.cli_device_authorizations
   where device_code_hash = p_device_code_hash
   for update;
  if not found then
    return query select false, 'invalid_grant'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz, 5;
    return;
  end if;
  if v_authorization.expires_at <= p_now then
    update public.cli_device_authorizations set status = 'expired'
     where id = v_authorization.id;
    return query select false, 'expired_token'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz, v_authorization.interval_seconds;
    return;
  end if;
  if v_authorization.status = 'pending' then
    if v_authorization.last_polled_at is not null
      and p_now < v_authorization.last_polled_at + make_interval(secs => v_authorization.interval_seconds) then
      update public.cli_device_authorizations
         set interval_seconds = least(30, interval_seconds + 5),
             last_polled_at = p_now
       where id = v_authorization.id;
      return query select false, 'slow_down'::text, null::uuid, null::text,
        null::text[], null::timestamptz, null::timestamptz,
        least(30, v_authorization.interval_seconds + 5);
      return;
    end if;
    update public.cli_device_authorizations set last_polled_at = p_now
     where id = v_authorization.id;
    return query select false, 'authorization_pending'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz, v_authorization.interval_seconds;
    return;
  end if;
  if v_authorization.status = 'denied' then
    return query select false, 'access_denied'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz, v_authorization.interval_seconds;
    return;
  end if;
  if v_authorization.status <> 'approved' or v_authorization.user_id is null then
    return query select false, 'invalid_grant'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz, v_authorization.interval_seconds;
    return;
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
     where membership.organization_id = v_authorization.organization_id
       and membership.user_id = v_authorization.user_id
       and membership.status = 'active'
  ) then
    return query select false, 'membership_required'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz, v_authorization.interval_seconds;
    return;
  end if;

  insert into public.cli_access_sessions (
    access_token_hash,
    refresh_token_hash,
    organization_id,
    project_key,
    user_id,
    capabilities,
    access_expires_at,
    refresh_expires_at,
    created_at,
    updated_at
  ) values (
    p_access_token_hash,
    p_refresh_token_hash,
    v_authorization.organization_id,
    v_authorization.project_key,
    v_authorization.user_id,
    v_authorization.capabilities,
    v_access_expires_at,
    v_refresh_expires_at,
    p_now,
    p_now
  );
  update public.cli_device_authorizations
     set status = 'consumed', consumed_at = p_now
   where id = v_authorization.id;

  return query select true, 'authorized'::text,
    v_authorization.organization_id,
    v_authorization.project_key,
    v_authorization.capabilities,
    v_access_expires_at,
    v_refresh_expires_at,
    v_authorization.interval_seconds;
end;
$$;

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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI authorization service required';
  end if;
  select * into v_session from public.cli_access_sessions
   where refresh_token_hash = p_refresh_token_hash
   for update;
  if not found or v_session.revoked_at is not null or v_session.refresh_expires_at <= p_now then
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
    update public.cli_access_sessions set revoked_at = p_now, updated_at = p_now
     where id = v_session.id;
    return query select false, 'membership_required'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;
  if p_new_access_token_hash !~ '^[a-f0-9]{64}$'
    or p_new_refresh_token_hash !~ '^[a-f0-9]{64}$' then
    return query select false, 'invalid_request'::text, null::uuid, null::text,
      null::text[], null::timestamptz, null::timestamptz;
    return;
  end if;
  update public.cli_access_sessions
     set access_token_hash = p_new_access_token_hash,
         refresh_token_hash = p_new_refresh_token_hash,
         access_expires_at = v_access_expires_at,
         updated_at = p_now
   where id = v_session.id;
  return query select true, 'rotated'::text, v_session.organization_id,
    v_session.project_key, v_session.capabilities, v_access_expires_at,
    v_session.refresh_expires_at;
end;
$$;

create or replace function public.revoke_cli_access_session(
  p_token_hash text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI authorization service required';
  end if;
  update public.cli_access_sessions set revoked_at = p_now, updated_at = p_now
   where revoked_at is null
     and (access_token_hash = p_token_hash or refresh_token_hash = p_token_hash);
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create or replace function public.authorize_cli_session_request(
  p_access_token_hash text,
  p_organization_id uuid,
  p_project_key text,
  p_capability text,
  p_request_id text,
  p_request_hash text,
  p_requested_at timestamptz,
  p_rate_limit integer,
  p_now timestamptz default now()
)
returns table (
  authorized boolean,
  reason text,
  retry_after_seconds integer,
  credential_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cli_access_sessions%rowtype;
  v_guard record;
  v_credential_id text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted CLI authorization service required';
  end if;
  select * into v_session from public.cli_access_sessions
   where access_token_hash = p_access_token_hash;
  if not found or v_session.revoked_at is not null or v_session.access_expires_at <= p_now then
    return query select false, 'invalid_or_expired_session'::text, null::integer, null::text;
    return;
  end if;
  if v_session.organization_id <> p_organization_id
    or v_session.project_key <> p_project_key then
    return query select false, 'scope_mismatch'::text, null::integer, null::text;
    return;
  end if;
  if not p_capability = any(v_session.capabilities) then
    return query select false, 'capability_not_granted'::text, null::integer, null::text;
    return;
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
     where membership.organization_id = v_session.organization_id
       and membership.user_id = v_session.user_id
       and membership.status = 'active'
  ) then
    update public.cli_access_sessions set revoked_at = p_now, updated_at = p_now
     where id = v_session.id;
    return query select false, 'membership_required'::text, null::integer, null::text;
    return;
  end if;

  v_credential_id := 'cli_' || replace(v_session.id::text, '-', '');
  select * into v_guard from public.authorize_machine_request(
    p_organization_id,
    p_project_key,
    v_credential_id,
    p_capability,
    p_request_id,
    p_request_hash,
    p_requested_at,
    p_rate_limit
  );
  if coalesce(v_guard.authorized, false) then
    update public.cli_access_sessions set last_used_at = p_now, updated_at = p_now
     where id = v_session.id;
  end if;
  return query select coalesce(v_guard.authorized, false),
    coalesce(v_guard.reason, 'guard_rejected'),
    v_guard.retry_after_seconds,
    v_credential_id;
end;
$$;

revoke all on function public.create_cli_device_authorization(text, text, uuid, text, text[], text, timestamptz) from public, anon, authenticated;
revoke all on function public.decide_cli_device_authorization(text, uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.exchange_cli_device_authorization(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.rotate_cli_access_session(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_cli_access_session(text, timestamptz) from public, anon, authenticated;
revoke all on function public.authorize_cli_session_request(text, uuid, text, text, text, text, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.create_cli_device_authorization(text, text, uuid, text, text[], text, timestamptz) to service_role;
grant execute on function public.decide_cli_device_authorization(text, uuid, uuid, boolean, timestamptz) to service_role;
grant execute on function public.exchange_cli_device_authorization(text, text, text, timestamptz) to service_role;
grant execute on function public.rotate_cli_access_session(text, text, text, timestamptz) to service_role;
grant execute on function public.revoke_cli_access_session(text, timestamptz) to service_role;
grant execute on function public.authorize_cli_session_request(text, uuid, text, text, text, text, timestamptz, integer, timestamptz) to service_role;
