# Loopgraph current build state

Last updated: 2026-06-29 · Branch: `loopgraph/canvas-first`

## One-line summary

Loopgraph is a **code-first, fixture-driven** loop runtime with **browser governance**: define `loopgraph.yaml`, simulate locally, inspect traces, approve fingerprints in CLI or UI, resolve escalation cases — **without API keys** in the default simulate path.

---

## What works today (code-first core ≈ 100%)

### LoopSpec contract (`lib/loopgraph-core`)

- Versioned `loopgraph/v1alpha1` schema with YAML/JSON loader
- JSON Schema export (`docs/schemas/loop-v1alpha1.json`)
- Semantic validation (write-capable tools need policy; escalation rules need owner + SLA)
- Types: trace, review, escalation, evidence, context, policy

### Runtime (`lib/loopgraph-runtime`)

- **`simulate`** — deterministic fixture path via `loop-runner.ts`
- **`execute`** — experimental; OpenAI assessment + `LOOPGRAPH_EXECUTE_ENABLED` (not the default demo)
- Context compiler → immutable `ContextSnapshot` with content hashes
- Fixture assessment provider (heuristics + template rules)
- Policy evaluation, verifiers (schema, policy, evidence, approval_required, numeric_threshold)
- **`review-service`** — shared CLI + UI approval binding
- **`review-packet`** — human-readable decision packet for reviewers
- **`case-service`** — list/show/resolve cases; resolve writes outcome + improvement signal to source trace
- **`management-consumer`** — deterministic plan from `EscalationCase` (not raw tickets)
- File storage: `.loopgraph/traces/`, `.loopgraph/cases/`, `.loopgraph/reviews/`

### CLI (`scripts/loopgraph.ts`)

| Command | Purpose |
|---------|---------|
| `init` | Copy hero template + fixtures |
| `validate` | LoopSpec + semantic checks |
| `simulate --fixture` | Deterministic run (primary demo) |
| `trace [--review]` | JSON trace or decision packet |
| `review packet` | Full review decision packet |
| `review approve/reject/...` | Fingerprint-bound decisions |
| `case list/show/resolve` | EscalationCase lifecycle |
| `export-graph` | Topology JSON from spec |
| `adapter test` | Mock adapter conformance |
| `execute --event` | Experimental live assessment |

CLI loads `.env` via `scripts/load-env.ts` (optional keys for execute only).

### Hero templates + fixtures

- **GitHub Issue Triage** — 4 fixtures + expected trace summaries
- **Strategic Account Escalation** — 5 fixtures + expected trace summaries
- **Support Ticket Triage** — 5 fixtures + expected trace summaries
- **Management Review** — weekly open-cases fixture
- Snapshot tests lock deterministic behavior

### Tests & CI

- **70 vitest tests** (governance path, support-ticket triage, full fixture snapshots)
- CI runs all 14 hero fixture simulates + validate for 4 examples
- `npm run typecheck`, `npm run build` pass

### Web UI (governance path on file storage)

- Run history (filtered by loop), trace detail with mode badges, reviews with partial approval UX
- Case page with resolve form + management consumer
- Workspace mode banner (demo / local / persisted / empty)
- Design Studio topology still mixes catalog loops; Supabase parity partial

### Execute (experimental)

- Context compiler uses live GitHub adapter when `LOOPGRAPH_EXECUTE_ENABLED` + GitHub env
- `LOOPGRAPH_ASSESSMENT_PROVIDER=fixture` for execute without OpenAI
- See [github-production-setup.md](./github-production-setup.md)

### V1.1 scaffolding (in repo, not production-complete)

- OpenAI `AssessmentProvider`, GitHub adapter, webhook route, Supabase storage adapter + migration
- In-memory job queue, orchestration helpers, measurement module, improvement signals

---

## Architecture (default path)

```text
loopgraph.yaml
  → validate
  → simulate --fixture
  → loop-runner (fixture provider, mock adapters)
  → trace + optional EscalationCase → .loopgraph/
  → review packet → approve fingerprints → case resolve → trace outcome
```

**Simulate never calls external APIs.** Tool commits in simulate mode record `mock_committed` results after approval.

---

## Known gaps

See [BUILD-PLAN.md](./BUILD-PLAN.md) (comprehensive) and [NEXT-PRIORITIES.md](./NEXT-PRIORITIES.md) (weekly punch list).

- UI / Design Studio parity incomplete
- Live execute (GitHub context + writes) not end-to-end
- No Intercom example yet
- Supabase storage untested multi-user

---

## Key docs

- [DAN-WALKTHROUGH.md](./DAN-WALKTHROUGH.md) — 15-minute CLI tour
- [NEXT-PRIORITIES.md](./NEXT-PRIORITIES.md) — tomorrow's build order
- [approval-model.md](./approval-model.md)
- [escalation-case.md](./escalation-case.md)
- [roadmap.md](./roadmap.md)
