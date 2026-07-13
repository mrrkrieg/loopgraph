# What still needs to be built — priorities

Last updated: 2026-06-30 (post launch-plan implementation on `loopgraph/canvas-first`).

**Full sequencing, effort estimates, Raisi/package tracks:** [BUILD-PLAN.md](./BUILD-PLAN.md) · **M4 package extraction:** [M4-PACKAGE-PLAN.md](./M4-PACKAGE-PLAN.md)

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

1. ~~**Intercom / support-ticket example**~~ — shipped as `examples/support-ticket-triage/`
2. **Supabase multi-user prod validation**
3. ~~**Management rollup persistence**~~ — `.loopgraph/management/latest.json` + cron persistence
4. ~~**Improvements page** reads trace `improvement_signal` outputs~~ — `loadImprovementsFromStorage`
5. **Manual QA sign-off** on clean clone ([manual-qa-v1.1.md](./manual-qa-v1.1.md)) — CLI paths covered by automated governance tests

## Explicitly deferred (V2)

- Durable external job queue
- Marketplace / adapter registry
- Auto-improving loop specs
- ROI claims from production data

See [RELEASE-v1.1.0-alpha.md](./RELEASE-v1.1.0-alpha.md).
