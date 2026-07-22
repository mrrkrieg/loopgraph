# GitHub production setup

> **EXPERIMENTAL** — Execute mode performs live GitHub reads and writes after human approval. Simulate/fixture mode remains the default demo path.

Loopgraph V1.1 can run GitHub Issue Triage against a live repository when execute mode is enabled.

## Prerequisites

- A GitHub repository you control
- A fine-grained or classic PAT with `issues: read and write`
- Optional: GitHub App + webhook secret for the Hermes GitHub webhook route

## Environment variables

```bash
LOOPGRAPH_EXECUTE_ENABLED=true
LOOPGRAPH_ASSESSMENT_PROVIDER=fixture   # recommended for local execute testing without OpenAI
# LOOPGRAPH_ASSESSMENT_PROVIDER=openai
OPENAI_API_KEY=sk-...

GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
GITHUB_WEBHOOK_SECRET=                  # used by Hermes, or by Loopgraph's temporary compatibility forwarder
HERMES_WEBHOOK_URL=                     # optional only if /api/webhooks/github must forward during migration

NEXT_PUBLIC_SUPABASE_URL=               # optional shared persistence
SUPABASE_SERVICE_ROLE_KEY=
```

## Webhook flow

1. Configure the GitHub webhook to point at Hermes, not directly at Loopgraph.
2. Hermes verifies, filters, and normalizes the GitHub payload into a Loopgraph `EventEnvelope`.
3. Hermes calls `loopgraph_events_ingest` to persist the receipt and retrieve eligible routing cards.
4. Hermes submits a `RoutingDecision`; Loopgraph validates the selected loop before any run is queued.
5. Trace, review, and escalation artifacts persist to `.loopgraph/` or Supabase.
6. Reviewer approves fingerprints in UI or CLI.
7. Approved `propose_labels` / `draft_response` actions commit via GitHub REST API.

`/api/webhooks/github` no longer executes LoopSpecs directly. It returns `410` by default and can only forward to Hermes when `HERMES_WEBHOOK_URL` is set for temporary migration compatibility.

## CLI execute (local replay)

```bash
npm run loopgraph -- execute examples/github-issue-triage \
  --event fixtures/github-issue-triage/security-issue.json
```

## Review + commit

```bash
npm run loopgraph -- review approve <runId> --actions <fingerprint1,fingerprint2>
```

## E2E verification (test repo)

1. Create a test repository and issue
2. Set env vars above with `LOOPGRAPH_ASSESSMENT_PROVIDER=fixture`
3. Run execute locally:

```bash
LOOPGRAPH_EXECUTE_ENABLED=true LOOPGRAPH_ASSESSMENT_PROVIDER=fixture \
  npm run loopgraph -- execute examples/github-issue-triage \
  --event fixtures/github-issue-triage/security-issue.json
```

4. Approve fingerprints via CLI or `/loops/github-issue-triage/reviews`
5. Verify labels on the GitHub issue (when using live GitHub token + issue number in payload)

The UI shows **Mode: execute · live writes enabled** on execute traces.

## Safety

- Execute mode is off by default (`LOOPGRAPH_EXECUTE_ENABLED`)
- Provider webhooks should terminate at Hermes before Loopgraph sees a normalized event
- Loopgraph's temporary compatibility forwarder still verifies webhook signatures when `GITHUB_WEBHOOK_SECRET` is set
- Durable event receipt and routing dedupe live in Loopgraph's Hermes routing store
- Forbidden actions in LoopSpec still block writes

## Simulated vs real

| Mode | Assessment | Writes | Storage |
|------|------------|--------|---------|
| `simulate` | Fixture/heuristics | Mock | `.loopgraph/` |
| `execute` | OpenAI (default) or fixture | GitHub API | `.loopgraph/` or Supabase |
