# What still needs to be built — priorities

Last updated: 2026-06-29 (post launch-plan implementation on `loopgraph/canvas-first`).

## Shipped in v1.1.0-alpha

- Browser governance E2E (runs filter, partial approval UX, case resolve in UI)
- Unified storage resolver on case/management pages
- Simulated/fixture mode badges on trace surfaces
- Empty Supabase workspace (no silent demo fallback)
- Acme seed script + extended `supabase/seed.sql`
- Hidden labor from trace reviews feeds health graph
- Context compiler live GitHub adapter when execute env configured
- Execute fixture provider path documented
- Issue templates + release notes

## Remaining P1

1. **Intercom / support-ticket example** — `examples/support-ticket-triage/`
2. **Supabase multi-user prod validation**
3. **Management rollup persistence** to DB
4. **Improvements page** reads trace `improvement_signal` outputs
5. **Manual QA sign-off** on clean clone ([manual-qa-v1.1.md](./manual-qa-v1.1.md))

## Explicitly deferred (V2)

- Durable external job queue
- Marketplace / adapter registry
- Auto-improving loop specs
- ROI claims from production data

See [RELEASE-v1.1.0-alpha.md](./RELEASE-v1.1.0-alpha.md).
