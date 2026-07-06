# Loopgraph v1.1.0-alpha

Public alpha of the code-first Loopgraph core with browser governance and experimental execute path.

## What works

- **CLI:** `validate`, `simulate`, `trace`, `review packet`, `review approve`, `case resolve`
- **Hero templates:** GitHub Issue Triage, Strategic Account Escalation (deterministic fixtures)
- **Governance:** fingerprint-bound partial approval (internal then customer-facing)
- **EscalationCase:** create, resolve, outcome writeback to source trace
- **Web UI:** run history, trace viewer, reviews, case resolve (file storage / `.loopgraph/`)
- **Design Studio:** explicit empty Supabase workspace, local registry, Acme seed script

## Experimental

- **Execute mode:** `LOOPGRAPH_EXECUTE_ENABLED=true` + GitHub env vars
- **Live context:** GitHub adapter used in context compiler when configured
- **Assessment:** `LOOPGRAPH_ASSESSMENT_PROVIDER=fixture` for execute without OpenAI

See [github-production-setup.md](./github-production-setup.md).

## Quickstart

```bash
git checkout loopgraph/canvas-first
npm install
npm run loopgraph -- simulate examples/strategic-account-escalation \
  --fixture fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json
```

Follow [DAN-WALKTHROUGH.md](./DAN-WALKTHROUGH.md) for the full governance story.

## Not included

- Live Intercom/CRM writes in simulate mode
- Multi-tenant Supabase production hardening
- Durable job queue / marketplace

## Test plan

- [ ] Path B CLI walkthrough passes
- [ ] Path B browser: partial approve + case resolve
- [ ] `npm run test` (54+ tests)
- [ ] Optional: execute on test GitHub repo with fixture provider
