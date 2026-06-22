create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key,
  organization_id uuid references organizations(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

create table loop_templates (
  id uuid primary key default gen_random_uuid(),
  department text not null,
  loop_type text not null,
  name text not null,
  description text,
  template jsonb not null,
  is_builtin boolean not null default true,
  created_at timestamptz not null default now()
);

create table loops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  template_id uuid references loop_templates(id),
  name text not null,
  department text not null,
  loop_type text not null,
  status text not null default 'draft',
  autonomy_level text not null default 'recommend',
  owner_id uuid references profiles(id),
  goal text,
  target_metric text,
  business_outcome text,
  cadence text,
  spec jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loops_status_check check (
    status in (
      'draft',
      'questions_in_progress',
      'spec_generated',
      'implementation_generated',
      'active',
      'paused',
      'archived'
    )
  ),
  constraint loops_autonomy_level_check check (
    autonomy_level in (
      'monitor_only',
      'recommend',
      'draft_for_review',
      'execute_with_approval',
      'execute_with_limits'
    )
  )
);

create trigger loops_set_updated_at
before update on loops
for each row execute function set_updated_at();

create table loop_questions (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  section text not null,
  question_key text not null,
  question text not null,
  help_text text,
  required boolean not null default true,
  answer_type text not null default 'text',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table loop_answers (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  question_id uuid references loop_questions(id) on delete cascade,
  answer jsonb not null,
  answered_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(loop_id, question_id)
);

create trigger loop_answers_set_updated_at
before update on loop_answers
for each row execute function set_updated_at();

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  source_type text not null,
  connection_status text not null default 'manual',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint data_sources_source_type_check check (
    source_type in (
      'manual',
      'postgres',
      'supabase',
      'hubspot',
      'salesforce',
      'posthog',
      'linear',
      'github',
      'slack',
      'gmail',
      'calendar',
      'stripe',
      'analytics',
      'custom_api'
    )
  )
);

create table loop_data_sources (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  data_source_id uuid references data_sources(id) on delete cascade,
  purpose text,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

create table loop_requirements (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  category text not null,
  title text not null,
  description text,
  requirement_type text not null,
  priority text not null default 'medium',
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint loop_requirements_category_check check (
    category in (
      'data',
      'routine',
      'tool',
      'verification',
      'escalation',
      'trace',
      'measurement',
      'ui',
      'cron',
      'security',
      'human_review'
    )
  )
);

create table generated_artifacts (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  artifact_type text not null,
  title text not null,
  content text,
  json_content jsonb,
  version integer not null default 1,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint generated_artifacts_artifact_type_check check (
    artifact_type in (
      'loop_spec',
      'supabase_schema',
      'vercel_plan',
      'agent_prompt',
      'verification_rubric',
      'cron_plan',
      'ui_plan',
      'implementation_plan',
      'management_summary'
    )
  )
);

create table loop_runs (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  status text not null default 'running',
  trigger_type text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_snapshot jsonb not null default '{}'::jsonb,
  verification_result jsonb,
  escalation_required boolean not null default false,
  human_review_required boolean not null default false,
  error text
);

create table loop_run_steps (
  id uuid primary key default gen_random_uuid(),
  loop_run_id uuid references loop_runs(id) on delete cascade,
  step_name text not null,
  step_type text not null,
  status text not null,
  input jsonb,
  output jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create table human_reviews (
  id uuid primary key default gen_random_uuid(),
  loop_run_id uuid references loop_runs(id) on delete cascade,
  loop_id uuid references loops(id) on delete cascade,
  reviewer_id uuid references profiles(id),
  status text not null default 'pending',
  reason text,
  recommendation text,
  reviewer_decision text,
  reviewer_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint human_reviews_status_check check (
    status in ('pending', 'approved', 'rejected', 'edited', 'escalated')
  )
);

create table loop_metrics (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  metric_name text not null,
  metric_type text not null,
  target_value numeric,
  current_value numeric,
  unit text,
  period_start date,
  period_end date,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table improvement_items (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  source_loop_run_id uuid references loop_runs(id),
  title text not null,
  description text,
  failure_mode text,
  recommendation text,
  status text not null default 'open',
  owner_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger improvement_items_set_updated_at
before update on improvement_items
for each row execute function set_updated_at();

create table management_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary text,
  risks jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  bottlenecks jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table agent_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  loop_id uuid references loops(id) on delete set null,
  title text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agent_threads_set_updated_at
before update on agent_threads
for each row execute function set_updated_at();

create table agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references agent_threads(id) on delete cascade,
  role text not null,
  content text not null,
  context jsonb not null default '{}'::jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index loop_templates_department_idx on loop_templates(department);
create index loops_organization_id_idx on loops(organization_id);
create index loops_status_idx on loops(status);
create index loop_questions_loop_id_idx on loop_questions(loop_id);
create index loop_answers_loop_id_idx on loop_answers(loop_id);
create index loop_runs_loop_id_started_at_idx on loop_runs(loop_id, started_at desc);
create index human_reviews_loop_id_status_idx on human_reviews(loop_id, status);
create index improvement_items_loop_id_status_idx on improvement_items(loop_id, status);
create index management_reviews_organization_period_idx on management_reviews(organization_id, period_start, period_end);
