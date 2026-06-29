create table if not exists loop_run_traces (
  id text primary key,
  loop_id text not null,
  status text not null,
  idempotency_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loop_run_traces_loop_id_idx on loop_run_traces(loop_id);
create index if not exists loop_run_traces_status_idx on loop_run_traces(status);
create unique index if not exists loop_run_traces_idempotency_key_idx on loop_run_traces(idempotency_key);

create table if not exists loop_reviews (
  id text primary key,
  run_id text not null references loop_run_traces(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists loop_escalation_cases (
  id text primary key,
  source_loop_id text not null,
  severity text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loop_escalation_cases_status_idx on loop_escalation_cases(status);

create table if not exists ingested_events (
  delivery_id text primary key,
  source text not null,
  event_id text not null,
  run_id text,
  status text not null default 'processed',
  created_at timestamptz not null default now()
);

create unique index if not exists ingested_events_source_event_idx on ingested_events(source, event_id);
