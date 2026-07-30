-- Hosted authentication and tenant isolation.
-- Apply after 202606220001_loop_engineering_builder.sql and
-- 202606270001_loopgraph_runtime.sql.

create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  constraint organization_memberships_role_check
    check (role in ('viewer', 'operator', 'admin', 'owner')),
  constraint organization_memberships_status_check
    check (status in ('invited', 'active', 'suspended'))
);

drop trigger if exists organization_memberships_set_updated_at
  on public.organization_memberships;
create trigger organization_memberships_set_updated_at
before update on public.organization_memberships
for each row execute function public.set_updated_at();

create index if not exists organization_memberships_user_status_idx
  on public.organization_memberships(user_id, status);
create index if not exists organization_memberships_organization_status_idx
  on public.organization_memberships(organization_id, status);

alter table public.loop_run_traces
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.loop_reviews
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.loop_escalation_cases
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.ingested_events
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

create index if not exists loop_run_traces_organization_id_idx
  on public.loop_run_traces(organization_id);
create index if not exists loop_reviews_organization_id_idx
  on public.loop_reviews(organization_id);
create index if not exists loop_escalation_cases_organization_id_idx
  on public.loop_escalation_cases(organization_id);
create index if not exists ingested_events_organization_id_idx
  on public.ingested_events(organization_id);

create or replace function private.is_org_member(
  requested_organization_id uuid,
  allowed_roles text[] default array['viewer', 'operator', 'admin', 'owner']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = requested_organization_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role = any(allowed_roles)
    );
$$;

create or replace function private.can_access_loop(
  requested_loop_id uuid,
  allowed_roles text[] default array['viewer', 'operator', 'admin', 'owner']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.loops loop_record
      join public.organization_memberships membership
        on membership.organization_id = loop_record.organization_id
      where loop_record.id = requested_loop_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role = any(allowed_roles)
    );
$$;

create or replace function private.can_access_run(
  requested_run_id uuid,
  allowed_roles text[] default array['viewer', 'operator', 'admin', 'owner']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.loop_runs run_record
      join public.loops loop_record on loop_record.id = run_record.loop_id
      join public.organization_memberships membership
        on membership.organization_id = loop_record.organization_id
      where run_record.id = requested_run_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role = any(allowed_roles)
    );
$$;

create or replace function private.can_access_thread(
  requested_thread_id uuid,
  allowed_roles text[] default array['viewer', 'operator', 'admin', 'owner']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.agent_threads thread_record
      join public.organization_memberships membership
        on membership.organization_id = thread_record.organization_id
      where thread_record.id = requested_thread_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role = any(allowed_roles)
    );
$$;

revoke all on function private.is_org_member(uuid, text[]) from public;
revoke all on function private.can_access_loop(uuid, text[]) from public;
revoke all on function private.can_access_run(uuid, text[]) from public;
revoke all on function private.can_access_thread(uuid, text[]) from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_org_member(uuid, text[]) to authenticated, service_role;
grant execute on function private.can_access_loop(uuid, text[]) to authenticated, service_role;
grant execute on function private.can_access_run(uuid, text[]) to authenticated, service_role;
grant execute on function private.can_access_thread(uuid, text[]) to authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations',
    'profiles',
    'loop_templates',
    'loops',
    'loop_questions',
    'loop_answers',
    'data_sources',
    'loop_data_sources',
    'loop_requirements',
    'generated_artifacts',
    'loop_runs',
    'loop_run_steps',
    'human_reviews',
    'loop_metrics',
    'improvement_items',
    'loop_relationships',
    'loop_graph_views',
    'management_reviews',
    'agent_threads',
    'agent_messages',
    'organization_memberships',
    'loop_run_traces',
    'loop_reviews',
    'loop_escalation_cases',
    'ingested_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end
$$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations
for select to authenticated
using (private.is_org_member(id));
drop policy if exists organizations_admin_update on public.organizations;
create policy organizations_admin_update on public.organizations
for update to authenticated
using (private.is_org_member(id, array['admin', 'owner']))
with check (private.is_org_member(id, array['admin', 'owner']));
drop policy if exists organizations_owner_delete on public.organizations;
create policy organizations_owner_delete on public.organizations
for delete to authenticated
using (private.is_org_member(id, array['owner']));

drop policy if exists memberships_member_select on public.organization_memberships;
create policy memberships_member_select on public.organization_memberships
for select to authenticated
using (
  user_id = auth.uid()
  or private.is_org_member(organization_id)
);
drop policy if exists memberships_manager_insert on public.organization_memberships;
create policy memberships_manager_insert on public.organization_memberships
for insert to authenticated
with check (
  private.is_org_member(organization_id, array['admin', 'owner'])
  and (role <> 'owner' or private.is_org_member(organization_id, array['owner']))
);
drop policy if exists memberships_manager_update on public.organization_memberships;
create policy memberships_manager_update on public.organization_memberships
for update to authenticated
using (
  private.is_org_member(organization_id, array['owner'])
  or (
    role <> 'owner'
    and private.is_org_member(organization_id, array['admin'])
  )
)
with check (
  private.is_org_member(organization_id, array['owner'])
  or (
    role <> 'owner'
    and private.is_org_member(organization_id, array['admin'])
  )
);
drop policy if exists memberships_owner_delete on public.organization_memberships;
create policy memberships_owner_delete on public.organization_memberships
for delete to authenticated
using (private.is_org_member(organization_id, array['owner']));

drop policy if exists profiles_org_select on public.profiles;
create policy profiles_org_select on public.profiles
for select to authenticated
using (id = auth.uid() or private.is_org_member(organization_id));
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update to authenticated
using (id = auth.uid() and private.is_org_member(organization_id))
with check (id = auth.uid() and private.is_org_member(organization_id));

drop policy if exists loop_templates_authenticated_select on public.loop_templates;
create policy loop_templates_authenticated_select on public.loop_templates
for select to authenticated using (true);

drop policy if exists loops_member_select on public.loops;
create policy loops_member_select on public.loops
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists loops_operator_insert on public.loops;
create policy loops_operator_insert on public.loops
for insert to authenticated
with check (private.is_org_member(organization_id, array['operator', 'admin', 'owner']));
drop policy if exists loops_operator_update on public.loops;
create policy loops_operator_update on public.loops
for update to authenticated
using (private.is_org_member(organization_id, array['operator', 'admin', 'owner']))
with check (private.is_org_member(organization_id, array['operator', 'admin', 'owner']));
drop policy if exists loops_admin_delete on public.loops;
create policy loops_admin_delete on public.loops
for delete to authenticated
using (private.is_org_member(organization_id, array['admin', 'owner']));

drop policy if exists data_sources_member_select on public.data_sources;
create policy data_sources_member_select on public.data_sources
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists data_sources_admin_write on public.data_sources;
create policy data_sources_admin_write on public.data_sources
for all to authenticated
using (private.is_org_member(organization_id, array['admin', 'owner']))
with check (private.is_org_member(organization_id, array['admin', 'owner']));

drop policy if exists loop_relationships_member_select on public.loop_relationships;
create policy loop_relationships_member_select on public.loop_relationships
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists loop_relationships_operator_write on public.loop_relationships;
create policy loop_relationships_operator_write on public.loop_relationships
for all to authenticated
using (private.is_org_member(organization_id, array['operator', 'admin', 'owner']))
with check (private.is_org_member(organization_id, array['operator', 'admin', 'owner']));

drop policy if exists loop_graph_views_member_select on public.loop_graph_views;
create policy loop_graph_views_member_select on public.loop_graph_views
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists loop_graph_views_operator_write on public.loop_graph_views;
create policy loop_graph_views_operator_write on public.loop_graph_views
for all to authenticated
using (private.is_org_member(organization_id, array['operator', 'admin', 'owner']))
with check (private.is_org_member(organization_id, array['operator', 'admin', 'owner']));

drop policy if exists management_reviews_member_select on public.management_reviews;
create policy management_reviews_member_select on public.management_reviews
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists management_reviews_operator_write on public.management_reviews;
create policy management_reviews_operator_write on public.management_reviews
for all to authenticated
using (private.is_org_member(organization_id, array['operator', 'admin', 'owner']))
with check (private.is_org_member(organization_id, array['operator', 'admin', 'owner']));

drop policy if exists agent_threads_member_select on public.agent_threads;
create policy agent_threads_member_select on public.agent_threads
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists agent_threads_operator_write on public.agent_threads;
create policy agent_threads_operator_write on public.agent_threads
for all to authenticated
using (private.is_org_member(organization_id, array['operator', 'admin', 'owner']))
with check (private.is_org_member(organization_id, array['operator', 'admin', 'owner']));

-- Loop-owned tables.
drop policy if exists loop_questions_member_select on public.loop_questions;
create policy loop_questions_member_select on public.loop_questions
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists loop_questions_operator_write on public.loop_questions;
create policy loop_questions_operator_write on public.loop_questions
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists loop_answers_member_select on public.loop_answers;
create policy loop_answers_member_select on public.loop_answers
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists loop_answers_operator_write on public.loop_answers;
create policy loop_answers_operator_write on public.loop_answers
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists loop_data_sources_member_select on public.loop_data_sources;
create policy loop_data_sources_member_select on public.loop_data_sources
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists loop_data_sources_operator_write on public.loop_data_sources;
create policy loop_data_sources_operator_write on public.loop_data_sources
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists loop_requirements_member_select on public.loop_requirements;
create policy loop_requirements_member_select on public.loop_requirements
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists loop_requirements_operator_write on public.loop_requirements;
create policy loop_requirements_operator_write on public.loop_requirements
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists generated_artifacts_member_select on public.generated_artifacts;
create policy generated_artifacts_member_select on public.generated_artifacts
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists generated_artifacts_operator_write on public.generated_artifacts;
create policy generated_artifacts_operator_write on public.generated_artifacts
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists loop_runs_member_select on public.loop_runs;
create policy loop_runs_member_select on public.loop_runs
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists loop_runs_operator_write on public.loop_runs;
create policy loop_runs_operator_write on public.loop_runs
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists human_reviews_member_select on public.human_reviews;
create policy human_reviews_member_select on public.human_reviews
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists human_reviews_operator_write on public.human_reviews;
create policy human_reviews_operator_write on public.human_reviews
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists loop_metrics_member_select on public.loop_metrics;
create policy loop_metrics_member_select on public.loop_metrics
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists loop_metrics_operator_write on public.loop_metrics;
create policy loop_metrics_operator_write on public.loop_metrics
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

drop policy if exists improvement_items_member_select on public.improvement_items;
create policy improvement_items_member_select on public.improvement_items
for select to authenticated using (private.can_access_loop(loop_id));
drop policy if exists improvement_items_operator_write on public.improvement_items;
create policy improvement_items_operator_write on public.improvement_items
for all to authenticated
using (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']))
with check (private.can_access_loop(loop_id, array['operator', 'admin', 'owner']));

-- Run/thread-owned tables.
drop policy if exists loop_run_steps_member_select on public.loop_run_steps;
create policy loop_run_steps_member_select on public.loop_run_steps
for select to authenticated using (private.can_access_run(loop_run_id));
drop policy if exists loop_run_steps_operator_write on public.loop_run_steps;
create policy loop_run_steps_operator_write on public.loop_run_steps
for all to authenticated
using (private.can_access_run(loop_run_id, array['operator', 'admin', 'owner']))
with check (private.can_access_run(loop_run_id, array['operator', 'admin', 'owner']));

drop policy if exists agent_messages_member_select on public.agent_messages;
create policy agent_messages_member_select on public.agent_messages
for select to authenticated using (private.can_access_thread(thread_id));
drop policy if exists agent_messages_operator_write on public.agent_messages;
create policy agent_messages_operator_write on public.agent_messages
for all to authenticated
using (private.can_access_thread(thread_id, array['operator', 'admin', 'owner']))
with check (private.can_access_thread(thread_id, array['operator', 'admin', 'owner']));

-- Runtime tables are scoped directly because their historical IDs are text.
drop policy if exists loop_run_traces_member_select on public.loop_run_traces;
create policy loop_run_traces_member_select on public.loop_run_traces
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists loop_reviews_member_select on public.loop_reviews;
create policy loop_reviews_member_select on public.loop_reviews
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists loop_escalation_cases_member_select on public.loop_escalation_cases;
create policy loop_escalation_cases_member_select on public.loop_escalation_cases
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists ingested_events_member_select on public.ingested_events;
create policy ingested_events_member_select on public.ingested_events
for select to authenticated using (private.is_org_member(organization_id));
