# Manual QA — V1.1

Automated coverage: `lib/loopgraph-runtime/governance-path.test.ts` (review binding, improvements from reject), `support-ticket-triage.test.ts`, full fixture snapshot matrix in CI.

## Governance path (file storage)

- [ ] `npm run loopgraph -- simulate examples/github-issue-triage --fixture fixtures/github-issue-triage/security-issue.json`
- [ ] Run appears on `/loops/<id>/runs`
- [ ] Trace detail page shows context precedence and prepared actions
- [ ] Approve selected fingerprints on reviews page updates trace to `COMPLETED`
- [ ] CLI `review approve` produces same trace status as UI

## Execute path (optional)

- [ ] Set `LOOPGRAPH_EXECUTE_ENABLED=true` and GitHub env vars
- [ ] `npm run loopgraph -- execute examples/github-issue-triage --event fixtures/github-issue-triage/normal-bug.json`
- [ ] GitHub provider webhook is configured in Hermes; Loopgraph `/api/webhooks/github` returns 410 unless `HERMES_WEBHOOK_URL` is set as a temporary compatibility forwarder

## Cases + management

- [ ] `npm run loopgraph -- case list` shows persisted cases
- [ ] `/cases/[caseId]` renders management plan
- [ ] `GET /api/cron/management-review` returns plans from open cases only

## Measurement

- [ ] Review with high rework minutes yields negative net savings in health summary

Release candidate tag: `v1.1.0-alpha`
