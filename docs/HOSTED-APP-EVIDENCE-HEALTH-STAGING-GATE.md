# Hosted App evidence-health staging gate

This gate proves that the deployed hosted App evidence-health monitor preserves the same
tenant-scoped renewal contract consumed by Hermes, the CLI, the browser, and the local supervisor.
It is deliberately read-only: it cannot replay an App, record evidence, create or consume an
approval, change activation, invoke a connector, or write to a provider.

Run:

```bash
npm run --silent validate:app-evidence-health-staging \
  > app-evidence-health-staging-receipt.json
```

## Required protected-runner inputs

| Variable | Purpose |
| --- | --- |
| `LOOPGRAPH_STAGING_URL` | Bare HTTPS origin of the exact staging deployment. `LOOPGRAPH_STAGING_APP_EVIDENCE_URL` may override it for an isolated gate. |
| `LOOPGRAPH_STAGING_APP_EVIDENCE_ORGANIZATION_ID` | Exact hosted organization UUID. |
| `LOOPGRAPH_STAGING_APP_EVIDENCE_PROJECT_KEY` | Exact hosted project/workspace key. |
| `LOOPGRAPH_STAGING_APP_EVIDENCE_SCHEDULE_TOKEN_FILE` | Absolute path to a projected `0600` workload JWT with only `schedule.app_evidence_health`. |
| `LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE` | Absolute path to a separate projected `0600` workload JWT with only `observability.read`. |

Tokens are read with `O_NOFOLLOW`, must be bounded regular files, and are never copied into the
receipt. Use separate workload identities so the schedule cannot scrape metrics and the metrics
reader cannot trigger the schedule. Do not replace projected identity with a repository secret or
long-lived bearer value.

## Exact controls

The validator performs eight ordered checks:

1. `unauthenticated_denial` — the schedule rejects a request without workload identity.
2. `cross_tenant_denial` — neither the valid schedule identity nor the observability identity can
   substitute another organization.
3. `authorized_health_projection` — the authorized schedule returns a fresh, exact-workspace,
   versioned projection.
4. `replay_denial` — reusing the accepted request ID and timestamp is rejected before another run.
5. `aggregate_only_contract` — the response contains only schema/workspace/time, aggregate fleet
   totals, status counts, health, and truncation. Any extra field fails the gate.
6. `metrics_projection_parity` — each protected unlabeled Prometheus gauge exactly matches the
   schedule projection.
7. `classification_fixture_rehearsal` — the shared production classifier is exercised with isolated
   one-hot invalid, expired, renew-soon, incomplete, current, and not-applicable counts. Invalid must
   block, expired/renew-soon must degrade, and the remaining states must stay healthy.
8. `independent_audit_evidence` — a separately authorized audit export pins one verified hash-chain
   checkpoint containing the accepted `schedule.app_evidence_health` request ID.

The validator also requires:

- `invalid + expired + renewSoon + incomplete + current + notApplicable` to equal the installed
  fleet total exactly;
- returned items to be bounded by matched items, and matched items by installed Apps;
- `truncated` to agree with the returned/matched totals;
- `blocked`, `degraded`, or `healthy` to be derived from the aggregate counts rather than trusted;
- `generatedAt` to remain within five minutes of the validation clock; and
- accepted schedule and metrics responses to disable caching; and
- exactly one unlabeled value for every App evidence-health metric.

## Receipt boundary

`hosted-app-evidence-health-staging-validation/v3` contains the deployment origin, tenant/project,
check time, aggregate projection, matching aggregate metrics, eight booleans, six fixed
classification outcomes, and the bounded audit
checkpoint sequence/hash plus accepted request ID. It contains no App
ID, installation ID, artifact digest, credential ID, provider field, returned action, source
payload, or token.

The receipt proves the behavior of one deployed environment at one time. It does not prove that a
customer completed a renewal action or that an App created business value. Preserve it as protected
release evidence and rerun it after deployment, identity-policy, renewal-contract, or metrics
changes.

The classification rehearsal calls the same exported core function used by the hosted projection.
It performs no database mutation and creates no synthetic installation, verifier key, receipt, or
customer object, so it needs no cleanup authority and cannot contaminate the tenant fleet.
