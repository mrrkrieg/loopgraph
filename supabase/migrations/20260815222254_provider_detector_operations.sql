-- Expose a bounded, non-secret detector operations read model to permission-checked
-- server routes. The underlying scheduler tables remain service-role only.
create or replace function public.list_provider_detector_operations(
  p_organization_id uuid,
  p_project_key text,
  p_limit integer default 200
)
returns table (
  schedule_id text,
  installation_id text,
  installation_display_name text,
  installation_status text,
  environment text,
  provider_id text,
  detector_key text,
  operation text,
  event_type text,
  subject_type text,
  cadence_minutes integer,
  window_minutes integer,
  overlap_minutes integer,
  schedule_status text,
  run_state text,
  checkpoint_at timestamptz,
  next_run_at timestamptz,
  available_at timestamptz,
  lease_until timestamptz,
  attempt_count integer,
  last_error_code text,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  blocked_by_kill_switch boolean,
  recent_runs jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'invalid provider detector operations limit';
  end if;

  return query
  select
    detector.id,
    detector.installation_id,
    installation.display_name,
    installation.status,
    installation.environment,
    detector.provider_id,
    detector.detector_key,
    detector.operation,
    detector.event_type,
    detector.subject_type,
    detector.cadence_minutes,
    detector.window_minutes,
    detector.overlap_minutes,
    detector.status,
    detector.run_state,
    detector.checkpoint_at,
    detector.next_run_at,
    detector.available_at,
    detector.lease_until,
    detector.attempt_count,
    detector.last_error_code,
    detector.last_started_at,
    detector.last_completed_at,
    exists (
      select 1
      from public.connector_kill_switches kill
      where kill.organization_id = detector.organization_id
        and kill.project_key = detector.project_key
        and kill.status = 'active'
        and (kill.expires_at is null or kill.expires_at >= now())
        and (kill.environment is null or kill.environment = installation.environment)
        and (
          (kill.scope_type = 'organization' and kill.scope_value = detector.organization_id::text)
          or (kill.scope_type = 'environment' and kill.scope_value = installation.environment)
          or (kill.scope_type = 'provider' and kill.scope_value = detector.provider_id)
          or (kill.scope_type = 'connection' and kill.scope_value = detector.installation_id)
          or (kill.scope_type = 'capability' and kill.scope_value = 'provider.events.emit')
        )
    ),
    coalesce(history.items, '[]'::jsonb)
  from public.provider_detector_schedules detector
  join public.connector_installations installation
    on installation.organization_id = detector.organization_id
   and installation.project_key = detector.project_key
   and installation.id = detector.installation_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', run.id,
        'status', run.status,
        'attemptCount', run.attempt_count,
        'emittedEventCount', run.emitted_event_count,
        'errorCode', run.error_code,
        'windowStart', run.window_start,
        'windowEnd', run.window_end,
        'startedAt', run.started_at,
        'completedAt', run.completed_at
      ) order by run.completed_at desc
    ) as items
    from (
      select candidate.*
      from public.provider_detector_runs candidate
      where candidate.organization_id = detector.organization_id
        and candidate.project_key = detector.project_key
        and candidate.schedule_id = detector.id
      order by candidate.completed_at desc
      limit 5
    ) run
  ) history on true
  where detector.organization_id = p_organization_id
    and detector.project_key = p_project_key
  order by installation.display_name, detector.detector_key
  limit p_limit;
end;
$$;

-- Apply detector control transitions and their audit receipt in one transaction.
-- Pausing never breaks an in-flight lease: the current run may finish, but no new
-- lease can be claimed until an administrator resumes the schedule.
create or replace function public.control_provider_detector_schedule(
  p_organization_id uuid,
  p_project_key text,
  p_schedule_id text,
  p_action text,
  p_actor_id text,
  p_reason text,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  detector public.provider_detector_schedules%rowtype;
  installation public.connector_installations%rowtype;
  v_blocked boolean;
  v_result text;
begin
  if p_action not in ('pause', 'resume', 'run_now', 'retry_now')
     or length(trim(p_actor_id)) < 1
     or length(p_actor_id) > 256
     or length(trim(p_reason)) < 3
     or length(p_reason) > 1000 then
    raise exception 'invalid provider detector control request';
  end if;

  select * into detector
  from public.provider_detector_schedules schedule
  where schedule.organization_id = p_organization_id
    and schedule.project_key = p_project_key
    and schedule.id = p_schedule_id
  for update;
  if not found then
    perform * from public.append_connector_security_audit_event(
      p_organization_id,
      p_project_key,
      'provider_detector.' || p_action,
      'denied',
      'user',
      p_actor_id,
      'provider_detector_control_' || gen_random_uuid()::text,
      'provider_detector_schedule',
      p_schedule_id,
      jsonb_build_object(
        'action', p_action,
        'result', 'missing',
        'reasonHash', encode(extensions.digest(trim(p_reason), 'sha256'), 'hex')
      )
    );
    return 'missing';
  end if;

  select * into installation
  from public.connector_installations candidate
  where candidate.organization_id = detector.organization_id
    and candidate.project_key = detector.project_key
    and candidate.id = detector.installation_id;

  <<apply_control>>
  begin
    if not found then
      v_result := 'connector_inactive';
      exit apply_control;
    end if;

    select exists (
      select 1
      from public.connector_kill_switches kill
      where kill.organization_id = detector.organization_id
        and kill.project_key = detector.project_key
        and kill.status = 'active'
        and (kill.expires_at is null or kill.expires_at >= p_now)
        and (kill.environment is null or kill.environment = installation.environment)
        and (
          (kill.scope_type = 'organization' and kill.scope_value = detector.organization_id::text)
          or (kill.scope_type = 'environment' and kill.scope_value = installation.environment)
          or (kill.scope_type = 'provider' and kill.scope_value = detector.provider_id)
          or (kill.scope_type = 'connection' and kill.scope_value = detector.installation_id)
          or (kill.scope_type = 'capability' and kill.scope_value = 'provider.events.emit')
        )
    ) into v_blocked;

    if p_action <> 'pause' and (
      installation.status <> 'active'
      or not (installation.allowed_capabilities @> array['provider.events.emit']::text[])
    ) then
      v_result := 'connector_inactive';
      exit apply_control;
    end if;
    if p_action <> 'pause' and v_blocked then
      v_result := 'blocked_by_kill_switch';
      exit apply_control;
    end if;

    if p_action = 'pause' then
      if detector.status = 'disabled' then
        v_result := 'connector_inactive';
        exit apply_control;
      end if;
      update public.provider_detector_schedules
         set status = 'paused', updated_at = p_now
       where id = detector.id;
      v_result := 'paused';
    elsif p_action = 'resume' then
      if detector.status = 'disabled' then
        v_result := 'connector_inactive';
        exit apply_control;
      end if;
      if detector.run_state = 'dead_letter' then
        v_result := 'requires_retry';
        exit apply_control;
      end if;
      update public.provider_detector_schedules
         set status = 'active', updated_at = p_now
       where id = detector.id;
      v_result := 'active';
    elsif p_action = 'run_now' then
      if detector.status <> 'active' then
        v_result := 'schedule_paused';
        exit apply_control;
      end if;
      if detector.run_state = 'leased' then
        v_result := 'already_running';
        exit apply_control;
      end if;
      if detector.run_state = 'retry' then
        v_result := 'retry_pending';
        exit apply_control;
      end if;
      if detector.run_state = 'dead_letter' then
        v_result := 'requires_retry';
        exit apply_control;
      end if;
      update public.provider_detector_schedules
         set next_run_at = p_now, available_at = p_now, updated_at = p_now
       where id = detector.id;
      v_result := 'run_scheduled';
    else
      if detector.run_state <> 'dead_letter' then
        v_result := 'not_dead_lettered';
        exit apply_control;
      end if;
      if detector.pending_window_start is null or detector.pending_window_end is null then
        v_result := 'retry_window_missing';
        exit apply_control;
      end if;
      update public.provider_detector_schedules
         set status = 'active',
             run_state = 'retry',
             current_run_id = null,
             attempt_count = 0,
             available_at = p_now,
             lease_token_hash = null,
             lease_until = null,
             last_error_code = null,
             updated_at = p_now
       where id = detector.id;
      v_result := 'retry_scheduled';
    end if;
  end apply_control;

  perform * from public.append_connector_security_audit_event(
    detector.organization_id,
    detector.project_key,
    'provider_detector.' || p_action,
    case when v_result in ('paused', 'active', 'run_scheduled', 'retry_scheduled') then 'accepted' else 'denied' end,
    'user',
    p_actor_id,
    'provider_detector_control_' || gen_random_uuid()::text,
    'provider_detector_schedule',
    detector.id,
    jsonb_build_object(
      'providerId', detector.provider_id,
      'installationId', detector.installation_id,
      'detectorKey', detector.detector_key,
      'action', p_action,
      'result', v_result,
      'reasonHash', encode(extensions.digest(trim(p_reason), 'sha256'), 'hex')
    )
  );

  return v_result;
end;
$$;

revoke all on function public.list_provider_detector_operations(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.control_provider_detector_schedule(uuid, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_provider_detector_operations(uuid, text, integer)
  to service_role;
grant execute on function public.control_provider_detector_schedule(uuid, text, text, text, text, text, timestamptz)
  to service_role;
