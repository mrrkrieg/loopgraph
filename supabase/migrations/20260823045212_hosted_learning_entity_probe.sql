-- Staging-only cleanup authority for the hosted learning and entity-resolution
-- active probe. The probe runs under a random 96-bit reserved project key, and
-- this function refuses every non-probe scope before deleting exact tenant rows.

create or replace function public.loopgraph_learning_entity_probe_cleanup(
  p_organization_id uuid,
  p_project_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evidence_deleted bigint;
  v_entities_deleted bigint;
begin
  if p_project_key !~ '^learning_probe_[a-f0-9]{24}$' then
    raise exception 'Invalid hosted learning/entity probe scope';
  end if;

  -- Alias rows are removed by the canonical-entity foreign key cascade. Keeping
  -- the entity delete as the only alias mutation makes the cleanup atomic.
  delete from public.canonical_company_entities
  where organization_id = p_organization_id
    and project_key = p_project_key;
  get diagnostics v_entities_deleted = row_count;

  delete from public.loopgraph_evidence_records
  where organization_id = p_organization_id
    and project_key = p_project_key;
  get diagnostics v_evidence_deleted = row_count;

  if exists (
    select 1
    from public.loopgraph_evidence_records
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) or exists (
    select 1
    from public.canonical_company_entities
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) or exists (
    select 1
    from public.canonical_company_entity_aliases
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) then
    raise exception 'Hosted learning/entity probe cleanup left residual rows';
  end if;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 'hosted-learning-entity-probe-cleanup/v1',
    'evidenceClean', true,
    'entitiesClean', true,
    'aliasesClean', true,
    'evidenceDeleted', v_evidence_deleted,
    'entitiesDeleted', v_entities_deleted
  );
end;
$$;

alter function public.loopgraph_learning_entity_probe_cleanup(uuid, text)
  owner to postgres;

revoke all on function public.loopgraph_learning_entity_probe_cleanup(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.loopgraph_learning_entity_probe_cleanup(uuid, text)
  to service_role;
