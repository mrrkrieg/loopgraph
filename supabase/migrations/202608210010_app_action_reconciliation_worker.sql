-- Select the oldest App action commit requests whose provider outcome is not
-- yet represented by a terminal App event. This is service-role-only recovery
-- metadata; provider input, output, credentials, and vault references remain
-- outside the result.

create index if not exists loopgraph_app_action_commit_reconciliation_idx
  on public.loopgraph_app_operation_action_events
    (organization_id, project_key, workspace_id, occurred_at asc, action_id)
  where event_type = 'commit_requested';

create or replace function public.list_loopgraph_app_action_reconciliation_candidates(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_requested_before timestamptz,
  p_limit integer default 25
)
returns table(action_payload jsonb, request_event_payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or p_requested_before is null
    or p_limit not between 1 and 100
  then raise exception 'invalid App action reconciliation query'; end if;

  return query
  select action.action_payload, requested.event_payload
    from public.loopgraph_app_operation_action_events requested
    join public.loopgraph_app_operation_actions action
      on action.organization_id = requested.organization_id
     and action.project_key = requested.project_key
     and action.workspace_id = requested.workspace_id
     and action.action_id = requested.action_id
   where requested.organization_id = p_organization_id
     and requested.project_key = p_project_key
     and requested.workspace_id = p_workspace_id
     and requested.event_type = 'commit_requested'
     and requested.occurred_at <= p_requested_before
     and not exists (
       select 1
         from public.loopgraph_app_operation_action_events terminal
        where terminal.organization_id = requested.organization_id
          and terminal.project_key = requested.project_key
          and terminal.workspace_id = requested.workspace_id
          and terminal.action_id = requested.action_id
          and (
            terminal.event_type = 'revoked'
            or (
              terminal.event_type in ('commit_succeeded', 'commit_failed')
              and terminal.event_payload#>>'{commit,requestId}' = requested.event_payload#>>'{commit,requestId}'
            )
          )
     )
   order by requested.occurred_at asc, requested.action_id asc
   limit p_limit;
end;
$$;

revoke all on function public.list_loopgraph_app_action_reconciliation_candidates(uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_loopgraph_app_action_reconciliation_candidates(uuid, text, text, timestamptz, integer) to service_role;
