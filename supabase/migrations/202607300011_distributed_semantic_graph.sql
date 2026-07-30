-- Tenant-scoped semantic graph history and one atomic active-graph authority.
-- Hosted graph mutations replace the active LoopSpec registry, persist exact
-- snapshots and receipts, and update the related proposal in one transaction.

create table if not exists public.semantic_graph_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  snapshot_id text not null,
  sequence bigint not null,
  graph_hash text not null,
  transaction_id text,
  payload jsonb not null,
  created_at timestamptz not null,
  primary key (organization_id, project_key, snapshot_id),
  unique (organization_id, project_key, sequence),
  constraint semantic_graph_snapshots_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint semantic_graph_snapshots_identity_check
    check (
      length(snapshot_id) between 1 and 512
      and graph_hash ~ '^[a-f0-9]{16}$'
      and sequence >= 0
    ),
  constraint semantic_graph_snapshots_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 33554432)
);

create index if not exists semantic_graph_snapshots_hash_idx
  on public.semantic_graph_snapshots(
    organization_id, project_key, graph_hash, sequence desc
  );

create table if not exists public.semantic_graph_approvals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  approval_id text not null,
  subject_type text not null,
  change_set_id text,
  loop_id text,
  transaction_id text,
  base_graph_hash text not null,
  decision text not null,
  payload jsonb not null,
  decided_at timestamptz not null,
  primary key (organization_id, project_key, approval_id),
  constraint semantic_graph_approvals_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint semantic_graph_approvals_identity_check
    check (
      length(approval_id) between 1 and 512
      and base_graph_hash ~ '^[a-f0-9]{16}$'
    ),
  constraint semantic_graph_approvals_subject_check
    check (subject_type in ('graph_change', 'promotion', 'lifecycle', 'rollback')),
  constraint semantic_graph_approvals_decision_check
    check (decision in ('approved', 'rejected')),
  constraint semantic_graph_approvals_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2097152)
);

create index if not exists semantic_graph_approvals_change_idx
  on public.semantic_graph_approvals(
    organization_id, project_key, change_set_id, decided_at
  );

create table if not exists public.semantic_graph_transactions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  transaction_id text not null,
  kind text not null,
  status text not null,
  change_set_id text,
  base_graph_hash text not null,
  result_graph_hash text,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, transaction_id),
  constraint semantic_graph_transactions_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint semantic_graph_transactions_identity_check
    check (
      length(transaction_id) between 1 and 512
      and base_graph_hash ~ '^[a-f0-9]{16}$'
      and (result_graph_hash is null or result_graph_hash ~ '^[a-f0-9]{16}$')
    ),
  constraint semantic_graph_transactions_kind_check
    check (kind in ('change_set', 'promotion', 'lifecycle', 'rollback')),
  constraint semantic_graph_transactions_status_check
    check (status in ('prepared', 'committed', 'failed', 'rolled_back')),
  constraint semantic_graph_transactions_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4194304)
);

create index if not exists semantic_graph_transactions_created_idx
  on public.semantic_graph_transactions(
    organization_id, project_key, created_at desc, transaction_id
  );

create table if not exists public.semantic_graph_promotions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  promotion_id text not null,
  loop_id text not null,
  transaction_id text not null,
  status text not null,
  payload jsonb not null,
  promoted_at timestamptz not null,
  primary key (organization_id, project_key, promotion_id),
  constraint semantic_graph_promotions_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint semantic_graph_promotions_identity_check
    check (
      length(promotion_id) between 1 and 512
      and length(loop_id) between 1 and 512
      and length(transaction_id) between 1 and 512
    ),
  constraint semantic_graph_promotions_status_check
    check (status in ('applied', 'rolled_back')),
  constraint semantic_graph_promotions_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2097152)
);

create index if not exists semantic_graph_promotions_loop_idx
  on public.semantic_graph_promotions(
    organization_id, project_key, loop_id, promoted_at desc
  );

create table if not exists public.semantic_graph_rehearsals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  rehearsal_id text not null,
  report_hash text not null,
  loop_id text not null,
  graph_hash text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  valid_until timestamptz not null,
  primary key (organization_id, project_key, rehearsal_id),
  constraint semantic_graph_rehearsals_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint semantic_graph_rehearsals_identity_check
    check (
      length(rehearsal_id) between 1 and 512
      and report_hash ~ '^[a-f0-9]{16}$'
      and graph_hash ~ '^[a-f0-9]{16}$'
      and length(loop_id) between 1 and 512
    ),
  constraint semantic_graph_rehearsals_status_check
    check (status in ('passed', 'failed')),
  constraint semantic_graph_rehearsals_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8388608)
);

create index if not exists semantic_graph_rehearsals_loop_idx
  on public.semantic_graph_rehearsals(
    organization_id, project_key, loop_id, created_at desc
  );

create table if not exists public.semantic_graph_commits (
  organization_id uuid not null,
  project_key text not null,
  commit_id text not null,
  idempotency_key text not null,
  transaction_id text not null,
  expected_workspace_revision bigint not null,
  expected_artifact_bindings jsonb not null,
  result_workspace_revision bigint not null,
  result_artifact_bindings jsonb not null,
  result_transaction jsonb not null,
  result_promotion jsonb,
  committed_at timestamptz not null,
  primary key (organization_id, project_key, commit_id),
  unique (organization_id, project_key, idempotency_key),
  foreign key (organization_id, project_key)
    references public.loop_spec_workspaces(organization_id, project_key)
    on delete cascade,
  constraint semantic_graph_commits_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint semantic_graph_commits_identity_check
    check (
      length(commit_id) between 1 and 512
      and length(idempotency_key) between 1 and 512
      and length(transaction_id) between 1 and 512
    ),
  constraint semantic_graph_commits_revision_check
    check (
      expected_workspace_revision >= 0
      and result_workspace_revision = expected_workspace_revision + 1
    ),
  constraint semantic_graph_commits_payload_check
    check (
      jsonb_typeof(expected_artifact_bindings) = 'array'
      and jsonb_typeof(result_artifact_bindings) = 'array'
      and jsonb_typeof(result_transaction) = 'object'
      and (result_promotion is null or jsonb_typeof(result_promotion) = 'object')
    )
);

alter table public.semantic_graph_snapshots enable row level security;
alter table public.semantic_graph_approvals enable row level security;
alter table public.semantic_graph_transactions enable row level security;
alter table public.semantic_graph_promotions enable row level security;
alter table public.semantic_graph_rehearsals enable row level security;
alter table public.semantic_graph_commits enable row level security;

revoke all on public.semantic_graph_snapshots
  from public, anon, authenticated, service_role;
revoke all on public.semantic_graph_approvals
  from public, anon, authenticated, service_role;
revoke all on public.semantic_graph_transactions
  from public, anon, authenticated, service_role;
revoke all on public.semantic_graph_promotions
  from public, anon, authenticated, service_role;
revoke all on public.semantic_graph_rehearsals
  from public, anon, authenticated, service_role;
revoke all on public.semantic_graph_commits
  from public, anon, authenticated, service_role;

grant select on public.semantic_graph_snapshots to service_role;
grant select on public.semantic_graph_approvals to service_role;
grant select on public.semantic_graph_transactions to service_role;
grant select on public.semantic_graph_promotions to service_role;
grant select on public.semantic_graph_rehearsals to service_role;
grant select on public.semantic_graph_commits to service_role;

create or replace function public.save_semantic_graph_record(
  p_organization_id uuid,
  p_project_key text,
  p_record_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_payload jsonb;
  v_id text := p_payload->>'id';
  v_status text := p_payload->>'status';
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_record_type not in (
      'snapshot', 'approval', 'transaction', 'promotion', 'rehearsal'
    )
    or nullif(v_id, '') is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 33554432 then
    raise exception 'invalid semantic graph record';
  end if;

  if p_record_type = 'snapshot' then
    insert into public.semantic_graph_snapshots (
      organization_id, project_key, snapshot_id, sequence, graph_hash,
      transaction_id, payload, created_at
    ) values (
      p_organization_id, p_project_key, v_id,
      (p_payload->>'sequence')::bigint, p_payload->>'graphHash',
      p_payload->>'transactionId', p_payload,
      (p_payload->>'createdAt')::timestamptz
    )
    on conflict do nothing
    returning payload into existing_payload;
    if not found then
      select payload into existing_payload
        from public.semantic_graph_snapshots
       where organization_id = p_organization_id
         and project_key = p_project_key
         and snapshot_id = v_id;
    end if;
  elsif p_record_type = 'approval' then
    insert into public.semantic_graph_approvals (
      organization_id, project_key, approval_id, subject_type,
      change_set_id, loop_id, transaction_id, base_graph_hash,
      decision, payload, decided_at
    ) values (
      p_organization_id, p_project_key, v_id, p_payload->>'subjectType',
      p_payload->>'changeSetId', p_payload->>'loopId',
      p_payload->>'transactionId', p_payload->>'baseGraphHash',
      p_payload->>'decision', p_payload,
      (p_payload->>'decidedAt')::timestamptz
    )
    on conflict do nothing
    returning payload into existing_payload;
    if not found then
      select payload into existing_payload
        from public.semantic_graph_approvals
       where organization_id = p_organization_id
         and project_key = p_project_key
         and approval_id = v_id;
    end if;
  elsif p_record_type = 'transaction' then
    select payload into existing_payload
      from public.semantic_graph_transactions
     where organization_id = p_organization_id
       and project_key = p_project_key
       and transaction_id = v_id
     for update;
    if found and (
      existing_payload->>'kind' <> p_payload->>'kind'
      or existing_payload->>'baseGraphHash' <> p_payload->>'baseGraphHash'
      or existing_payload->>'approvalReceiptId'
        <> p_payload->>'approvalReceiptId'
    ) then
      raise exception 'semantic graph transaction identity conflict';
    end if;
    if found
      and existing_payload->>'status' in ('failed', 'rolled_back')
      and existing_payload <> p_payload then
      raise exception 'terminal semantic graph transaction cannot change';
    end if;
    if found
      and existing_payload->>'status' = 'committed'
      and v_status not in ('committed', 'rolled_back') then
      raise exception 'committed semantic graph transaction cannot regress';
    end if;
    insert into public.semantic_graph_transactions (
      organization_id, project_key, transaction_id, kind, status,
      change_set_id, base_graph_hash, result_graph_hash, payload,
      created_at, updated_at
    ) values (
      p_organization_id, p_project_key, v_id, p_payload->>'kind',
      v_status, p_payload->>'changeSetId', p_payload->>'baseGraphHash',
      p_payload->>'resultGraphHash', p_payload,
      (p_payload->>'createdAt')::timestamptz, now()
    )
    on conflict (organization_id, project_key, transaction_id)
    do update set
      status = excluded.status,
      result_graph_hash = excluded.result_graph_hash,
      payload = excluded.payload,
      updated_at = now()
    returning payload into existing_payload;
  elsif p_record_type = 'promotion' then
    select payload into existing_payload
      from public.semantic_graph_promotions
     where organization_id = p_organization_id
       and project_key = p_project_key
       and promotion_id = v_id
     for update;
    if found and (
      existing_payload->>'loopId' <> p_payload->>'loopId'
      or existing_payload->>'transactionId' <> p_payload->>'transactionId'
      or (
        existing_payload->>'status' = 'rolled_back'
        and existing_payload <> p_payload
      )
    ) then
      raise exception 'semantic graph promotion identity conflict';
    end if;
    insert into public.semantic_graph_promotions (
      organization_id, project_key, promotion_id, loop_id,
      transaction_id, status, payload, promoted_at
    ) values (
      p_organization_id, p_project_key, v_id, p_payload->>'loopId',
      p_payload->>'transactionId', v_status, p_payload,
      (p_payload->>'promotedAt')::timestamptz
    )
    on conflict (organization_id, project_key, promotion_id)
    do update set status = excluded.status, payload = excluded.payload
    returning payload into existing_payload;
  else
    insert into public.semantic_graph_rehearsals (
      organization_id, project_key, rehearsal_id, report_hash,
      loop_id, graph_hash, status, payload, created_at, valid_until
    ) values (
      p_organization_id, p_project_key, v_id, p_payload->>'reportHash',
      p_payload->>'loopId', p_payload->>'graphHash', v_status,
      p_payload, (p_payload->>'createdAt')::timestamptz,
      (p_payload->>'validUntil')::timestamptz
    )
    on conflict do nothing
    returning payload into existing_payload;
    if not found then
      select payload into existing_payload
        from public.semantic_graph_rehearsals
       where organization_id = p_organization_id
         and project_key = p_project_key
         and rehearsal_id = v_id;
    end if;
  end if;

  if existing_payload is null or existing_payload <> p_payload then
    raise exception 'semantic graph immutable record conflict';
  end if;
  return existing_payload;
end;
$$;

create or replace function public.commit_semantic_graph_transaction(
  p_organization_id uuid,
  p_project_key text,
  p_project_root text,
  p_commit_id text,
  p_idempotency_key text,
  p_expected_workspace_revision bigint,
  p_expected_artifact_bindings jsonb,
  p_committed_at timestamptz,
  p_workspace jsonb,
  p_artifacts jsonb,
  p_base_snapshot jsonb,
  p_result_snapshot jsonb,
  p_transaction jsonb,
  p_change_set jsonb default null,
  p_promotion jsonb default null,
  p_transaction_updates jsonb default '[]'::jsonb,
  p_promotion_updates jsonb default '[]'::jsonb
)
returns table (
  workspace_revision bigint,
  transaction jsonb,
  promotion jsonb,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_workspace public.loop_spec_workspaces%rowtype;
  existing_commit public.semantic_graph_commits%rowtype;
  artifact jsonb;
  stored_version public.loop_spec_versions%rowtype;
  current_bindings jsonb;
  result_bindings jsonb := '[]'::jsonb;
  next_entries jsonb := '[]'::jsonb;
  next_workspace jsonb;
  update_record jsonb;
  v_loop_id text;
  v_version_hash text;
  v_source text;
  v_source_ref text;
  v_entry jsonb;
  v_spec jsonb;
  v_fixtures jsonb;
  approval_payload jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_project_root), '') is null
    or nullif(btrim(p_commit_id), '') is null
    or nullif(btrim(p_idempotency_key), '') is null
    or p_expected_workspace_revision < 0
    or jsonb_typeof(p_expected_artifact_bindings) <> 'array'
    or jsonb_typeof(p_workspace) <> 'object'
    or jsonb_typeof(p_artifacts) <> 'array'
    or jsonb_array_length(p_artifacts) > 256
    or jsonb_typeof(p_base_snapshot) <> 'object'
    or jsonb_typeof(p_result_snapshot) <> 'object'
    or jsonb_typeof(p_transaction) <> 'object'
    or p_transaction->>'id' <> p_commit_id
    or p_transaction->>'status' <> 'committed'
    or p_transaction->>'baseSnapshotId' <> p_base_snapshot->>'id'
    or p_transaction->>'resultSnapshotId' <> p_result_snapshot->>'id'
    or p_transaction->>'baseGraphHash' <> p_base_snapshot->>'graphHash'
    or p_transaction->>'resultGraphHash' <> p_result_snapshot->>'graphHash'
    or p_transaction->>'projectRootId' <> p_workspace->>'projectRootId'
    or p_base_snapshot->>'projectRootId' <> p_workspace->>'projectRootId'
    or p_result_snapshot->>'projectRootId' <> p_workspace->>'projectRootId'
    or p_base_snapshot->>'transactionId' <> p_commit_id
    or p_result_snapshot->>'transactionId' <> p_commit_id
    or jsonb_typeof(p_transaction_updates) <> 'array'
    or jsonb_typeof(p_promotion_updates) <> 'array'
    or pg_column_size(p_artifacts) > 67108864 then
    raise exception 'invalid semantic graph transaction commit';
  end if;

  insert into public.loop_spec_workspaces (
    organization_id, project_key, payload, revision, created_at, updated_at
  ) values (
    p_organization_id, p_project_key, p_workspace, 0,
    p_committed_at, p_committed_at
  )
  on conflict do nothing;

  select workspaces.* into current_workspace
    from public.loop_spec_workspaces workspaces
   where organization_id = p_organization_id
     and project_key = p_project_key
   for update;

  select commits.* into existing_commit
    from public.semantic_graph_commits commits
   where commits.organization_id = p_organization_id
     and commits.project_key = p_project_key
     and (
       commits.commit_id = p_commit_id
       or commits.idempotency_key = p_idempotency_key
     )
   order by (commits.commit_id = p_commit_id) desc
   limit 1;
  if found then
    if existing_commit.commit_id <> p_commit_id
      or existing_commit.idempotency_key <> p_idempotency_key
      or existing_commit.expected_artifact_bindings
        <> p_expected_artifact_bindings
      or existing_commit.result_transaction <> p_transaction then
      raise exception 'semantic graph commit identity conflict';
    end if;
    workspace_revision := existing_commit.result_workspace_revision;
    transaction := existing_commit.result_transaction;
    promotion := existing_commit.result_promotion;
    created := false;
    return next;
    return;
  end if;

  if current_workspace.revision <> p_expected_workspace_revision then
    raise exception 'semantic graph workspace revision conflict: expected %, found %',
      p_expected_workspace_revision, current_workspace.revision;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'loopId', registry.loop_id,
        'versionHash', registry.active_version_hash
      )
      order by registry.loop_id
    ),
    '[]'::jsonb
  ) into current_bindings
    from public.loop_spec_registry registry
   where registry.organization_id = p_organization_id
     and registry.project_key = p_project_key;
  if current_bindings <> p_expected_artifact_bindings then
    raise exception 'semantic graph active artifact conflict';
  end if;

  select approvals.payload into approval_payload
    from public.semantic_graph_approvals approvals
   where approvals.organization_id = p_organization_id
     and approvals.project_key = p_project_key
     and approvals.approval_id = p_transaction->>'approvalReceiptId';
  if not found
    or approval_payload->>'decision' <> 'approved'
    or approval_payload->>'projectRootId' <> p_workspace->>'projectRootId'
    or approval_payload->>'baseGraphHash' <> p_transaction->>'baseGraphHash'
    or (
      p_transaction->>'kind' = 'change_set'
      and (
        approval_payload->>'subjectType' <> 'graph_change'
        or approval_payload->>'changeSetId' <> p_transaction->>'changeSetId'
      )
    )
    or (
      p_transaction->>'kind' = 'promotion'
      and approval_payload->>'subjectType' <> 'promotion'
    )
    or (
      p_transaction->>'kind' = 'lifecycle'
      and approval_payload->>'subjectType' <> 'lifecycle'
    )
    or (
      p_transaction->>'kind' = 'rollback'
      and (
        approval_payload->>'subjectType' <> 'rollback'
        or approval_payload->>'transactionId'
          <> p_transaction->>'rollbackOfTransactionId'
      )
    ) then
    raise exception 'semantic graph transaction approval is missing or stale';
  end if;

  if (
    select count(*) <> count(distinct value->>'loopId')
      from jsonb_array_elements(p_artifacts) artifacts(value)
  ) then
    raise exception 'semantic graph artifacts contain duplicate loop identities';
  end if;

  for artifact in select value from jsonb_array_elements(p_artifacts)
  loop
    v_loop_id := nullif(btrim(artifact->>'loopId'), '');
    v_version_hash := nullif(btrim(artifact->>'versionHash'), '');
    v_source := nullif(btrim(artifact->>'source'), '');
    v_source_ref := nullif(btrim(artifact->>'sourceRef'), '');
    v_entry := artifact->'entry';
    v_spec := artifact->'spec';
    v_fixtures := coalesce(artifact->'fixtures', '{}'::jsonb);
    if v_loop_id is null
      or v_version_hash !~ '^[a-f0-9]{64}$'
      or v_source not in (
        'hermes_design', 'semantic_graph', 'design_studio', 'import'
      )
      or v_source_ref is null
      or jsonb_typeof(v_entry) <> 'object'
      or jsonb_typeof(v_spec) <> 'object'
      or jsonb_typeof(v_fixtures) <> 'object'
      or v_entry->>'id' <> v_loop_id
      or v_entry->>'path' <> v_source_ref
      or v_spec->'metadata'->>'id' <> v_loop_id
      or pg_column_size(v_entry) > 65536
      or pg_column_size(v_spec) > 4194304
      or pg_column_size(v_fixtures) > 4194304 then
      raise exception 'semantic graph LoopSpec artifact is invalid';
    end if;

    insert into public.loop_spec_versions (
      organization_id, project_key, loop_id, version_hash, spec, entry,
      fixtures, source, source_ref, created_at
    ) values (
      p_organization_id, p_project_key, v_loop_id, v_version_hash,
      v_spec, v_entry, v_fixtures, v_source, v_source_ref, p_committed_at
    )
    on conflict do nothing
    returning * into stored_version;
    if not found then
      select versions.* into stored_version
        from public.loop_spec_versions versions
       where versions.organization_id = p_organization_id
         and versions.project_key = p_project_key
         and versions.loop_id = v_loop_id
         and versions.version_hash = v_version_hash;
      if not found
        or stored_version.spec <> v_spec
        or stored_version.entry <> v_entry
        or stored_version.fixtures <> v_fixtures then
        raise exception 'semantic graph immutable LoopSpec version conflict';
      end if;
    end if;

    result_bindings := result_bindings || jsonb_build_array(
      jsonb_build_object(
        'loopId', v_loop_id,
        'versionHash', v_version_hash
      )
    );
    next_entries := next_entries || jsonb_build_array(v_entry);
  end loop;

  delete from public.loop_spec_registry registry
   where registry.organization_id = p_organization_id
     and registry.project_key = p_project_key;

  for artifact in select value from jsonb_array_elements(p_artifacts)
  loop
    insert into public.loop_spec_registry (
      organization_id, project_key, loop_id, active_version_hash, spec,
      entry, fixtures, source, source_ref, activated_at, updated_at
    ) values (
      p_organization_id, p_project_key, artifact->>'loopId',
      artifact->>'versionHash', artifact->'spec', artifact->'entry',
      coalesce(artifact->'fixtures', '{}'::jsonb), artifact->>'source',
      artifact->>'sourceRef', p_committed_at, p_committed_at
    );
  end loop;

  select coalesce(jsonb_agg(value order by value->>'loopId'), '[]'::jsonb)
    into result_bindings
    from jsonb_array_elements(result_bindings) bindings(value);
  select coalesce(jsonb_agg(value order by value->>'name'), '[]'::jsonb)
    into next_entries
    from jsonb_array_elements(next_entries) entries(value);
  next_workspace := jsonb_set(
    p_workspace, '{registeredSpecs}', next_entries, true
  );
  next_workspace := jsonb_set(
    next_workspace, '{projectRoot}', to_jsonb(p_project_root), true
  );
  next_workspace := jsonb_set(
    next_workspace, '{updatedAt}', to_jsonb(p_committed_at::text), true
  );

  update public.loop_spec_workspaces workspaces
     set payload = next_workspace,
         revision = current_workspace.revision + 1,
         updated_at = p_committed_at
   where workspaces.organization_id = p_organization_id
     and workspaces.project_key = p_project_key
  returning * into current_workspace;

  perform public.save_semantic_graph_record(
    p_organization_id, p_project_key, 'snapshot', p_base_snapshot
  );
  perform public.save_semantic_graph_record(
    p_organization_id, p_project_key, 'snapshot', p_result_snapshot
  );
  perform public.save_semantic_graph_record(
    p_organization_id, p_project_key, 'transaction', p_transaction
  );
  if p_promotion is not null then
    perform public.save_semantic_graph_record(
      p_organization_id, p_project_key, 'promotion', p_promotion
    );
  end if;
  for update_record in
    select value from jsonb_array_elements(p_transaction_updates)
  loop
    perform public.save_semantic_graph_record(
      p_organization_id, p_project_key, 'transaction', update_record
    );
  end loop;
  for update_record in
    select value from jsonb_array_elements(p_promotion_updates)
  loop
    perform public.save_semantic_graph_record(
      p_organization_id, p_project_key, 'promotion', update_record
    );
  end loop;
  if p_change_set is not null then
    perform public.upsert_loop_graph_change_set(
      p_organization_id, p_project_key, p_change_set
    );
  end if;

  insert into public.semantic_graph_commits (
    organization_id, project_key, commit_id, idempotency_key,
    transaction_id, expected_workspace_revision,
    expected_artifact_bindings, result_workspace_revision,
    result_artifact_bindings, result_transaction, result_promotion,
    committed_at
  ) values (
    p_organization_id, p_project_key, p_commit_id, p_idempotency_key,
    p_transaction->>'id', p_expected_workspace_revision,
    p_expected_artifact_bindings, current_workspace.revision,
    result_bindings, p_transaction, p_promotion, p_committed_at
  );

  workspace_revision := current_workspace.revision;
  transaction := p_transaction;
  promotion := p_promotion;
  created := true;
  return next;
end;
$$;

create or replace function public.get_semantic_graph_snapshot(
  p_organization_id uuid,
  p_project_key text
)
returns table (
  graph_snapshots_total bigint,
  graph_approvals_total bigint,
  graph_transactions_total bigint,
  graph_transactions_failed bigint,
  graph_promotions_total bigint,
  graph_rehearsals_total bigint,
  graph_commits_total bigint,
  latest_graph_sequence bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*) from public.semantic_graph_snapshots records
      where records.organization_id = p_organization_id
        and records.project_key = p_project_key
    ),
    (
      select count(*) from public.semantic_graph_approvals records
      where records.organization_id = p_organization_id
        and records.project_key = p_project_key
    ),
    (
      select count(*) from public.semantic_graph_transactions records
      where records.organization_id = p_organization_id
        and records.project_key = p_project_key
    ),
    (
      select count(*) from public.semantic_graph_transactions records
      where records.organization_id = p_organization_id
        and records.project_key = p_project_key
        and records.status = 'failed'
    ),
    (
      select count(*) from public.semantic_graph_promotions records
      where records.organization_id = p_organization_id
        and records.project_key = p_project_key
    ),
    (
      select count(*) from public.semantic_graph_rehearsals records
      where records.organization_id = p_organization_id
        and records.project_key = p_project_key
    ),
    (
      select count(*) from public.semantic_graph_commits records
      where records.organization_id = p_organization_id
        and records.project_key = p_project_key
    ),
    coalesce(
      (
        select max(records.sequence)
        from public.semantic_graph_snapshots records
        where records.organization_id = p_organization_id
          and records.project_key = p_project_key
      ),
      0
    );
$$;

revoke all on function public.save_semantic_graph_record(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.commit_semantic_graph_transaction(
  uuid, text, text, text, text, bigint, jsonb, timestamptz,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.get_semantic_graph_snapshot(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.save_semantic_graph_record(
  uuid, text, text, jsonb
) to service_role;
grant execute on function public.commit_semantic_graph_transaction(
  uuid, text, text, text, text, bigint, jsonb, timestamptz,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.get_semantic_graph_snapshot(uuid, text)
  to service_role;

grant execute on function public.save_semantic_graph_record(
  uuid, text, text, jsonb
) to service_role;
grant execute on function public.commit_semantic_graph_transaction(
  uuid, text, text, text, text, bigint, jsonb, timestamptz,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.get_semantic_graph_snapshot(uuid, text)
  to service_role;
