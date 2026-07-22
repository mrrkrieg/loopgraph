# Roadmap

Explicit boundaries for Loopgraph releases.

## V1 (shipped on `v1`)

- Code-first LoopSpec (`loopgraph/v1alpha1`) as source of truth
- `validate` + deterministic `simulate` CLI
- Reproducible ContextSnapshot, PreparedAction fingerprints, EscalationCase handoff, LoopRunTrace
- Hero templates: GitHub Issue Triage, Strategic Account Escalation
- Mock adapters and fixture provider
- Design Studio as optional blueprint layer
- File storage under `.loopgraph/`

## V1.1 (implemented)

- Shared review service (CLI + UI fingerprint binding)
- Run history + trace viewer (`/loops/[loopId]/runs`, `/runs/[runId]`)
- `SupabaseStorageAdapter` + runtime migration when env configured
- `AssessmentProvider` (fixture + OpenAI) with `execute` mode behind `LOOPGRAPH_EXECUTE_ENABLED`
- Live `GitHubAdapter` for approved execute-mode actions; provider webhooks route through Hermes, with `/api/webhooks/github` kept only as a Hermes compatibility forwarder
- `loopgraph execute`, `case list`, `case resolve`
- Docs: [github-production-setup.md](./github-production-setup.md), [manual-qa-v1.1.md](./manual-qa-v1.1.md)

**Still optional for V1.1 polish:** Design Studio YAML export, Acme seed script, full Supabase auth/RBAC.

## V2 (partial foundations shipped)

- Management review loop template + cron consumer of EscalationCase only
- Hidden labor / net savings module (`lib/loopgraph-core/measurement.ts`)
- Improvement signals from review rejections (`improvement-service.ts`)
- Orchestration limits + informational vs semantic edges (`orchestration.ts`)
- In-process job queue stub for resume-after-review (`job-queue.ts`)

**Still deferred:** package extraction, durable external queue, live CRM/support adapters, auto-improving specs, marketplace, enterprise audit modes.

See [competitive-boundary.md](./competitive-boundary.md) for positioning vs workflow and agent frameworks.
