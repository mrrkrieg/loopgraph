# Roadmap

Explicit boundaries for Loopgraph V1 and what comes next.

## V1 (this release)

- Code-first LoopSpec (`loopgraph/v1alpha1`) as source of truth
- `validate` + deterministic `simulate` CLI
- Reproducible ContextSnapshot, PreparedAction fingerprints, EscalationCase handoff, LoopRunTrace
- Hero templates: GitHub Issue Triage, Strategic Account Escalation
- Mock adapters and fixture provider only — no live integrations
- Design Studio as optional blueprint layer
- File storage under `.loopgraph/`

**Out of scope for V1:** distributed execution, live OAuth integrations, LLM-as-judge gates for P0/P1, auto-executing topology edges.

## V1.1 (near term)

- Supabase-backed persistence when configured
- Run history UI from persisted traces
- YAML export from Design Studio spec page
- Expanded adapter conformance and `adapter test` coverage
- Seed script for demo org without manual setup

## V2 (later)

- Live integration adapters (GitHub, CRM, support)
- Scheduled and webhook triggers with idempotent ingestion
- Multi-loop orchestration and parent/child run depth enforcement at scale
- Management review automation and improvement item writeback
- Topology as derived view across specs, runs, and cases

See [competitive-boundary.md](./competitive-boundary.md) for positioning vs workflow and agent frameworks.
