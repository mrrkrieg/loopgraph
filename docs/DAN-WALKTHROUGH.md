# Dan walkthrough — code-first Loopgraph core

This is a **15-minute CLI tour** of what shipped on the `v1` branch. No Supabase, no OpenAI, and no live integrations required.

## Setup (once)

```bash
git checkout v1
git pull
npm install
```

Traces and cases are written to `.loopgraph/` in the repo root.

---

## Path A — GitHub Issue Triage (developer template)

### 1. Validate the loop spec

```bash
npm run loopgraph -- validate examples/github-issue-triage
```

### 2. Simulate a normal bug (completes without human review)

```bash
npm run loopgraph -- simulate examples/github-issue-triage \
  --fixture fixtures/github-issue-triage/normal-bug.json
```

Note the `runId=` in the output (deterministic for this fixture).

### 3. Simulate a security issue (requires review + escalation case)

```bash
npm run loopgraph -- simulate examples/github-issue-triage \
  --fixture fixtures/github-issue-triage/security-issue.json
```

### 4. Read the review decision packet

```bash
npm run loopgraph -- review packet run_1ff426aee511a198
```

(Use the `runId` from step 3 if yours differs.)

### 5. Approve actions by fingerprint

List fingerprints in the packet, then:

```bash
npm run loopgraph -- review approve run_1ff426aee511a198 --actions <fingerprint1>,<fingerprint2>
```

Replace with real fingerprints from the packet — **do not** use angle brackets in the shell.

### 6. Inspect the trace JSON

```bash
npm run loopgraph -- trace run_1ff426aee511a198
```

Or open `.loopgraph/traces/run_1ff426aee511a198.json`.

---

## Path B — Strategic Account Escalation (company OS template)

This is the full governance story: evidence → review → partial approval → case resolution.

### 1. Simulate enterprise outage near renewal

```bash
npm run loopgraph -- simulate examples/strategic-account-escalation \
  --fixture fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json
```

Expected: `status=WAITING_FOR_REVIEW`, `caseId=case_60f5d6d9121e` (ids are stable for this fixture).

### 2. Read the decision packet

```bash
npm run loopgraph -- review packet run_a75f60f5d6d9121e
```

You should see **Internal** and **Customer-facing** sections with different fingerprints.

### 3. Partial approval (internal only)

```bash
npm run loopgraph -- review approve run_a75f60f5d6d9121e --actions 05437111bacf29d0
```

Expected: `trace status=WAITING_FOR_REVIEW` — customer message still pending.

### 4. Finish customer-facing approval

```bash
npm run loopgraph -- review approve run_a75f60f5d6d9121e --actions 3a223868a24b7c4b
```

Expected: `trace status=COMPLETED`.

### 5. Resolve the escalation case

```bash
npm run loopgraph -- case resolve case_60f5d6d9121e --summary "Incident mitigated."
```

### 6. Confirm outcome wrote back to the run trace

```bash
npm run loopgraph -- trace run_a75f60f5d6d9121e
```

Look for `case_outcome` and `improvement_signal` entries in `outputs`.

### 7. Management consumer (case-level, not raw ticket)

```bash
npm run loopgraph -- case show case_60f5d6d9121e
```

---

## Optional — web UI

```bash
npm run dev
```

- Run history: `/loops/github-issue-triage/runs` or `/loops/strategic-account-escalation/runs`
- Trace detail: `/loops/<loopId>/runs/<runId>`
- Reviews: `/loops/<loopId>/reviews?runId=<runId>`

The CLI and UI share the same `.loopgraph/` file storage by default.

---

## What this demo proves

- **LoopSpec** in YAML is the source of truth
- **Simulate** is deterministic (fixtures, no API keys)
- **Context snapshots** have hashes and provenance
- **Prepared actions** bind to exact fingerprints
- **Partial approval** separates internal vs customer-facing actions
- **EscalationCase** resolves with outcome writeback to the source trace

## What this demo does *not* do yet

- No live GitHub / Intercom / CRM writes in simulate mode
- Execute + OpenAI is experimental (`LOOPGRAPH_EXECUTE_ENABLED=true`)
- Design Studio / Supabase parity is incomplete

See [NEXT-PRIORITIES.md](./NEXT-PRIORITIES.md).
