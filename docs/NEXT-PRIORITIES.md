# What still needs to be built — priorities

Last updated: 2026-06-28 (after code-first core completion on `v1`).

## Tomorrow (recommended order)

### P0 — Shippable examples without core coupling

1. **Intercom / support-ticket example (adapter pattern)**
   - Add `examples/support-ticket-triage/` using existing `mock-support` adapter + fixtures
   - Optional: `lib/loopgraph-sdk/adapters/intercom.ts` behind env flag
   - Normalize webhook payload → generic ticket input schema (no Intercom types in core)

2. **UI: finish inspect → approve flow in browser**
   - Run history + trace viewer already exist; wire labels (“simulated / fixture”)
   - Reviews page uses shared `review-service` — verify end-to-end with `.loopgraph/` only
   - Fix P0 Design Studio issues: demo vs Supabase confusion, hidden labor → health

3. **Execute path hardening (V1.1, optional if time)**
   - `context-compiler` selects live adapter when env configured
   - `execute --event` works with `LOOPGRAPH_ASSESSMENT_PROVIDER=fixture`
   - End-to-end: webhook → review → GitHub label write on test repo

### P1 — Polish for external readers

4. **Acme seed script + topology YAML** (launch doc Epic 6)
5. **Manual QA checklist** — run `docs/manual-qa-v1.1.md` on clean clone
6. **Commit hygiene** — ensure `.env.example` never contains real keys

### P2 — V2 foundations (later in the week)

7. Durable job queue (replace in-memory stub)
8. Trace-linked improvements UI (not workspace stub)
9. Management rollup persistence
10. Semantic topology execution (informational vs executable edges)

---

## Explicitly not started / incomplete

| Area | Status |
|------|--------|
| Design Studio P0 fixes (P0-1–P0-8) | Partial |
| Supabase multi-user storage | Code exists; untested in prod |
| Live GitHub context + writes E2E | Adapter + webhook exist; not wired through context compiler |
| `dry-run` runtime mode | Types only |
| Intercom integration | Not started |
| Public alpha tag / release notes | Not done |
| ROI / live automation claims in UI | Must remain off until execute is proven |

---

## Definition of done for “V1 public alpha” (launch doc)

- [x] Code-first validate + simulate + trace CLI
- [x] Both hero templates + 9 fixture snapshots
- [x] Fingerprint approval + partial approval + invalidation tests
- [x] Review decision packet (CLI)
- [x] EscalationCase resolve → trace outcome writeback
- [x] 46 automated tests + CI build
- [ ] Design Studio / demo mode parity
- [ ] README/quickstart verified on clean clone by a second person (Dan)
- [ ] Optional: one live integration example (GitHub or Intercom) clearly labeled experimental
