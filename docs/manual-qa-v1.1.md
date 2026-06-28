# Manual QA — V1.1

## Governance path (file storage)

- [ ] `npm run loopgraph -- simulate examples/github-issue-triage --fixture fixtures/github-issue-triage/security-issue.json`
- [ ] Run appears on `/loops/<id>/runs`
- [ ] Trace detail page shows context precedence and prepared actions
- [ ] Approve selected fingerprints on reviews page updates trace to `COMPLETED`
- [ ] CLI `review approve` produces same trace status as UI

## Execute path (optional)

- [ ] Set `LOOPGRAPH_EXECUTE_ENABLED=true` and GitHub env vars
- [ ] `npm run loopgraph -- execute examples/github-issue-triage --event fixtures/github-issue-triage/normal-bug.json`
- [ ] GitHub webhook creates run for test issue (if deployed)

## Cases + management

- [ ] `npm run loopgraph -- case list` shows persisted cases
- [ ] `/cases/[caseId]` renders management plan
- [ ] `GET /api/cron/management-review` returns plans from open cases only

## Measurement

- [ ] Review with high rework minutes yields negative net savings in health summary

Release candidate tag: `v1.1.0-alpha`
