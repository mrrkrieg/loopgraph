-- Private, tenant-scoped delivery and verification for hosted LoopPacks.
--
-- Browser sessions may search only releases already visible through registry
-- RLS. Artifact object keys, detached signatures, and verification jobs remain
-- service-role-only. Storage URLs are minted by the application after the
-- caller has been authorized and expire quickly.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'loopgraph-marketplace-artifacts',
  'loopgraph-marketplace-artifacts',
  false,
  104857600,
  array['application/json']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.marketplace_verification_jobs (
  job_id uuid primary key default gen_random_uuid(),
  app_id text not null,
  version text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (app_id, version),
  foreign key (app_id, version)
    references public.marketplace_app_versions(app_id, version) on delete cascade,
  constraint marketplace_verification_jobs_status_check
    check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint marketplace_verification_jobs_attempts_check
    check (attempts between 0 and 25),
  constraint marketplace_verification_jobs_lease_check
    check (
      (status = 'processing' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
      or (status <> 'processing' and lease_owner is null and lease_token is null and lease_expires_at is null)
    ),
  constraint marketplace_verification_jobs_owner_check
    check (lease_owner is null or lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  constraint marketplace_verification_jobs_error_check
    check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{2,79}$')
);

create index if not exists marketplace_verification_jobs_claim_idx
  on public.marketplace_verification_jobs(status, lease_expires_at, created_at);

alter table public.marketplace_verification_jobs enable row level security;
revoke all on public.marketplace_verification_jobs from anon, authenticated;
grant all on public.marketplace_verification_jobs to service_role;

create or replace function private.enqueue_marketplace_verification_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.marketplace_verification_jobs (app_id, version)
  values (new.app_id, new.version)
  on conflict (app_id, version) do nothing;
  return new;
end;
$$;

revoke all on function private.enqueue_marketplace_verification_job() from public;

drop trigger if exists enqueue_marketplace_verification_job on public.marketplace_app_versions;
create trigger enqueue_marketplace_verification_job
after insert on public.marketplace_app_versions
for each row execute function private.enqueue_marketplace_verification_job();

-- Backfill pending releases created between the registry and delivery migrations.
insert into public.marketplace_verification_jobs (app_id, version)
select app_id, version
  from public.marketplace_app_versions
 where release_status = 'pending_verification'
on conflict (app_id, version) do nothing;

create or replace function public.search_visible_marketplace_apps(
  p_query text default null,
  p_department text default null,
  p_capability text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  app_id text,
  version text,
  artifact_digest text,
  snapshot_digest text,
  release_status text,
  app_metadata jsonb,
  version_payload jsonb,
  published_at timestamptz,
  verified_at timestamptz,
  status_message text,
  status_updated_at timestamptz,
  relevance_score integer,
  matched_terms text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with visible as (
    select distinct on (v.app_id)
      v.app_id,
      v.version,
      v.artifact_digest,
      v.snapshot_digest,
      v.release_status,
      v.app_metadata,
      v.version_payload,
      v.published_at,
      v.verified_at,
      v.status_message,
      v.status_updated_at
    from public.marketplace_app_versions v
    where v.release_status in ('active', 'deprecated')
      and (
        nullif(trim(p_department), '') is null
        or lower(v.app_metadata->>'department') = lower(trim(p_department))
      )
      and (
        nullif(trim(p_capability), '') is null
        or exists (
          select 1
            from public.marketplace_app_connector_requirements c
           where c.app_id = v.app_id
             and c.version = v.version
             and c.capability = trim(p_capability)
        )
      )
    order by v.app_id, v.published_at desc, v.version desc
  ), scored as (
    select visible.*,
      case
        when nullif(trim(p_query), '') is null then 1
        when lower(visible.app_id) = lower(trim(p_query)) then 100
        when lower(visible.app_id) like lower(trim(p_query)) || '%' then 80
        when lower(visible.app_metadata->>'name') like '%' || lower(trim(p_query)) || '%' then 60
        when lower(visible.app_metadata->>'summary') like '%' || lower(trim(p_query)) || '%' then 40
        when lower(coalesce(visible.app_metadata->>'description', '')) like '%' || lower(trim(p_query)) || '%' then 20
        else 0
      end as relevance_score,
      case when nullif(trim(p_query), '') is null then array[]::text[] else
        array_remove(array[
          case when lower(visible.app_id) like '%' || lower(trim(p_query)) || '%' then 'id' end,
          case when lower(visible.app_metadata->>'name') like '%' || lower(trim(p_query)) || '%' then 'name' end,
          case when lower(visible.app_metadata->>'summary') like '%' || lower(trim(p_query)) || '%' then 'summary' end,
          case when lower(coalesce(visible.app_metadata->>'description', '')) like '%' || lower(trim(p_query)) || '%' then 'description' end
        ], null)
      end as matched_terms
    from visible
  )
  select * from scored
   where relevance_score > 0
   order by relevance_score desc, app_id asc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, least(coalesce(p_offset, 0), 10000));
$$;

revoke all on function public.search_visible_marketplace_apps(text, text, text, integer, integer) from public;
grant execute on function public.search_visible_marketplace_apps(text, text, text, integer, integer) to authenticated;

create or replace function public.claim_hosted_marketplace_verification_jobs(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace verifier required';
  end if;
  if p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
    or p_limit not between 1 and 25
    or p_lease_seconds not between 30 and 1800 then
    raise exception 'invalid marketplace verification claim';
  end if;

  update public.marketplace_verification_jobs
     set status = 'failed',
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         last_error_code = 'lease_attempts_exhausted',
         updated_at = now(),
         completed_at = now()
   where status = 'processing'
     and lease_expires_at < now()
     and attempts >= 25;

  with candidates as (
    select j.job_id
      from public.marketplace_verification_jobs j
      join public.marketplace_app_versions v
        on v.app_id = j.app_id and v.version = j.version
     where (
         (j.status = 'pending' and v.release_status = 'pending_verification')
         or (
           j.status = 'processing'
           and j.lease_expires_at < now()
           and v.release_status in ('pending_verification', 'active', 'rejected')
         )
       )
     order by j.created_at, j.job_id
     for update of j skip locked
     limit p_limit
  ), claimed as (
    update public.marketplace_verification_jobs j
       set status = 'processing',
           attempts = j.attempts + 1,
           lease_owner = p_worker_id,
           lease_token = gen_random_uuid(),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           updated_at = now()
      from candidates c
     where j.job_id = c.job_id
    returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId', c.job_id,
    'appId', c.app_id,
    'version', c.version,
    'attempts', c.attempts,
    'leaseToken', c.lease_token,
    'leaseExpiresAt', c.lease_expires_at,
    'releaseStatus', v.release_status,
    'artifactDigest', v.artifact_digest,
    'manifestDigest', v.manifest_digest,
    'fileIndexDigest', v.file_index_digest,
    'snapshotDigest', v.snapshot_digest,
    'artifactObjectKey', v.artifact_object_key,
    'manifestPayload', v.manifest_payload,
    'fileIndexPayload', v.file_index_payload,
    'signature', jsonb_build_object(
      'publisherId', s.publisher_id,
      'algorithm', s.algorithm,
      'keyId', s.key_id,
      'publicKey', s.public_key,
      'value', s.signature_value
    )
  ) order by c.created_at, c.job_id), '[]'::jsonb)
    into v_result
    from claimed c
    join public.marketplace_app_versions v
      on v.app_id = c.app_id and v.version = c.version
    join public.marketplace_release_signatures s
      on s.app_id = c.app_id and s.version = c.version;
  return v_result;
end;
$$;

create or replace function public.finish_hosted_marketplace_verification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.marketplace_verification_jobs%rowtype;
  v_status text;
  v_release_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace verifier required';
  end if;
  if p_outcome not in ('completed', 'retry', 'failed')
    or (p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{2,79}$') then
    raise exception 'invalid marketplace verification completion';
  end if;
  select * into v_job
    from public.marketplace_verification_jobs
   where job_id = p_job_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace verification job not found';
  end if;
  if v_job.status is distinct from 'processing'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at <= now() then
    raise exception using errcode = '42501', message = 'marketplace verification lease lost';
  end if;
  select release_status into v_release_status
    from public.marketplace_app_versions
   where app_id = v_job.app_id and version = v_job.version;
  if p_outcome = 'completed'
    and v_release_status not in ('active', 'rejected') then
    raise exception 'marketplace verification completion requires a final release';
  end if;
  v_status := case
    when p_outcome = 'retry' and v_job.attempts < 5 then 'pending'
    when p_outcome = 'retry' then 'failed'
    else p_outcome
  end;
  update public.marketplace_verification_jobs
     set status = v_status,
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         last_error_code = p_error_code,
         updated_at = now(),
         completed_at = case when v_status in ('completed', 'failed') then now() else null end
   where job_id = p_job_id;
  return jsonb_build_object(
    'jobId', p_job_id,
    'status', v_status,
    'attempts', v_job.attempts,
    'errorCode', p_error_code
  );
end;
$$;

create or replace function public.reject_hosted_marketplace_release(
  p_app_id text,
  p_version text,
  p_verification_receipt_digest text,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.marketplace_app_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace verifier required';
  end if;
  if p_verification_receipt_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_reason_code !~ '^[a-z][a-z0-9_]{2,79}$' then
    raise exception 'invalid marketplace rejection';
  end if;
  select * into v_release
    from public.marketplace_app_versions
   where app_id = p_app_id and version = p_version
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace release not found';
  end if;
  if v_release.release_status = 'rejected'
    and v_release.verification_receipt_digest = p_verification_receipt_digest then
    return jsonb_build_object(
      'appId', p_app_id,
      'version', p_version,
      'artifactDigest', v_release.artifact_digest,
      'releaseStatus', 'rejected',
      'created', false
    );
  end if;
  if v_release.release_status is distinct from 'pending_verification' then
    raise exception 'marketplace release is no longer awaiting verification';
  end if;
  update public.marketplace_app_versions
     set release_status = 'rejected',
         verification_receipt_digest = p_verification_receipt_digest,
         status_message = p_reason_code,
         status_updated_at = now()
   where app_id = p_app_id and version = p_version;
  return jsonb_build_object(
    'appId', p_app_id,
    'version', p_version,
    'artifactDigest', v_release.artifact_digest,
    'releaseStatus', 'rejected',
    'created', true
  );
end;
$$;

revoke all on function public.claim_hosted_marketplace_verification_jobs(text, integer, integer) from public;
revoke all on function public.finish_hosted_marketplace_verification_job(uuid, uuid, text, text) from public;
revoke all on function public.reject_hosted_marketplace_release(text, text, text, text) from public;
grant execute on function public.claim_hosted_marketplace_verification_jobs(text, integer, integer) to service_role;
grant execute on function public.finish_hosted_marketplace_verification_job(uuid, uuid, text, text) to service_role;
grant execute on function public.reject_hosted_marketplace_release(text, text, text, text) to service_role;
