-- Tenant-scoped, metadata-only health for App action commits whose provider
-- result has not reached the App ledger. The snapshot never returns action,
-- installation, provider, request, payload, or credential identifiers.

create or replace function public.get_loopgraph_app_action_reconciliation_snapshot(
  p_organization_id uuid,
  p_project_key text,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_stale_after_seconds not between 60 and 86400
  then raise exception 'invalid App action reconciliation snapshot request'; end if;

  with scoped_events as (
    select workspace_id, action_id, event_type, occurred_at,
      event_payload#>>'{commit,requestId}' as commit_request_id
    from public.loopgraph_app_operation_action_events
    where organization_id = p_organization_id
      and project_key = p_project_key
  ), commit_requests as (
    select workspace_id, action_id, occurred_at, commit_request_id
    from scoped_events
    where event_type = 'commit_requested'
      and commit_request_id is not null
  ), unresolved as (
    select requested.workspace_id, requested.action_id, requested.occurred_at,
      requested.commit_request_id
    from commit_requests requested
    where not exists (
      select 1
      from scoped_events terminal
      where terminal.workspace_id = requested.workspace_id
        and terminal.action_id = requested.action_id
        and (
          terminal.event_type = 'revoked'
          or (
            terminal.event_type in ('commit_succeeded', 'commit_failed')
            and terminal.commit_request_id = requested.commit_request_id
          )
        )
    )
  )
  select jsonb_build_object(
    'app_action_commits_requested_total', (select count(*) from commit_requests),
    'app_action_commits_succeeded_total', (
      select count(*) from scoped_events where event_type = 'commit_succeeded'
    ),
    'app_action_commits_failed_total', (
      select count(*) from scoped_events where event_type = 'commit_failed'
    ),
    'app_action_reconciliation_pending', count(*),
    'app_action_reconciliation_stale', count(*) filter (
      where occurred_at <= now() - make_interval(secs => p_stale_after_seconds)
    ),
    'app_action_reconciliation_workspaces_affected', count(distinct workspace_id),
    'app_action_reconciliation_oldest_age_seconds', coalesce(
      greatest(0, floor(extract(epoch from (now() - min(occurred_at)))))::bigint,
      0
    ),
    'app_action_reconciliation_stale_after_seconds', p_stale_after_seconds
  ) into v_snapshot
  from unresolved;

  return v_snapshot;
end;
$$;

revoke all on function public.get_loopgraph_app_action_reconciliation_snapshot(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.get_loopgraph_app_action_reconciliation_snapshot(uuid, text, integer) to service_role;
