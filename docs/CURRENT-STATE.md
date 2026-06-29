# Loopgraph current build state

Last updated: 2026-06-28 · Branch: `v1`

## One-line summary

Loopgraph is a **code-first, fixture-driven** loop runtime: define `loopgraph.yaml`, simulate events locally, inspect traces, approve exact action fingerprints, and resolve escalation cases — **without API keys or live integrations** in the default path.

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
- Snapshot tests lock deterministic behavior

### Tests & CI

- **46 vitest tests** (loop-spec, simulators, review-service, case-service, review-packet, verifiers, snapshots)
- `npm run typecheck`, `npm run build` pass

### Web UI (partial — not required for code-first demo)

- Run history, trace detail, reviews with fingerprint checkboxes
- Reads same `.loopgraph/` storage as CLI when Supabase is not configured
- Design Studio / topology / management pages still mix demo workspace data

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

## Known gaps (see NEXT-PRIORITIES.md)

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
