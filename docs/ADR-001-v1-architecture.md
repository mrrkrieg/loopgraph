# ADR-001: Loopgraph V1 Architecture

**Status:** Accepted  
**Date:** 2026-06-27

## Context

Loopgraph is repositioning from a company-loop design studio to a code-first framework for recurring AI-human loops. This ADR locks the ten decisions that govern V1 implementation.

## Decisions

### 1. Product name

**Loopgraph** is the public product, repository, and CLI name. Use Loopgraph consistently in all user-facing docs, UI copy, and CLI output.

### 2. Source of truth

The canonical artifact is `loopgraph.yaml` or validated JSON/TypeScript that conforms to `loopgraph/v1alpha1`. The React Flow topology is **derived**, never authoritative.

### 3. V1 runtime modes

| Mode | V1 status |
|------|-----------|
| `validate` | Required — static schema and policy validation |
| `simulate` | Required — deterministic fixture-driven execution, no external writes |
| `dry-run` | Defined, experimental — read-only adapters allowed, no writes |
| `execute` | Deferred — production execution with real integrations |

### 4. Storage

- **CLI / local:** `FileStorageAdapter` writes to `.loopgraph/traces/`, `.loopgraph/reviews/`, `.loopgraph/cases/`, `.loopgraph/index.json`
- **Design Studio:** Supabase optional; must persist the same trace/review/case shapes (Epic 6)

### 5. Hero templates

1. **GitHub Issue Triage** — developer onboarding demo  
2. **Strategic Account Escalation** — company operating-system demo  

Marketing Campaign Learning remains a Design Studio hero, not the OSS wedge.

### 6. Company hierarchy

Company, department, and management loop objects are optional `topology` metadata. A developer can validate and simulate a standalone loop without defining an organization.

### 7. Live integrations

No real GitHub, Zendesk, Salesforce, Slack, or Linear credentials required for V1 public alpha. Mock/local fixture adapters only.

### 8. Approval semantics

Human approval binds to a **PreparedAction** with a content fingerprint. The runtime rejects commits when the payload differs from the approved fingerprint. No hidden re-planning after approval.

### 9. LLM usage

A **fixture provider** is required for deterministic simulation. Live OpenAI/Anthropic providers are experimental and feature-flagged. `OPENAI_API_KEY` is reserved, not required.

### 10. License

MIT License (see LICENSE file at repo root).

## Runtime invariants

```text
idempotencyKey = hash(loopSpecVersion + triggerSource + sourceEventId)
runId          = hash(loopSpecHash + idempotencyKey)   // deterministic in simulate mode
```

| Invariant | Value |
|-----------|-------|
| Max parent/child run depth | 3 |
| Max escalation re-entry depth | 2 |
| Event IDs | Deduplicated per run |
| Informational graph edges (`reports_to`, `learns_from`, etc.) | Never auto-execute |
| Management handoff | Explicit event only |

Context snapshots are immutable after a run starts. Untrusted external text is marked `trusted: false` and cannot override system or loop policy.

## Consequences

- Epic 0–2 must complete before topology polish or Design Studio P0 fixes.
- All new loop logic lives in `lib/loopgraph-core/` and `lib/loopgraph-runtime/` without Next.js imports.
- CI must run `loopgraph validate` and fixture simulations on every PR.
