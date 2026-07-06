# Dan walkthrough — code-first Loopgraph core

**Time:** ~15 minutes  
**Branch:** `v1`  
**Requires:** Node, npm, terminal — no Supabase, no OpenAI, no API keys

This walkthrough runs Loopgraph entirely from the CLI using fixture data. Nothing hits live GitHub, CRM, or customer channels.

---

## Start here

1. Run **Setup** once.
2. Do **Path B** — that is the full governance story (review, partial approval, case resolution).
3. Optionally do **Path A** — a shorter developer-triage example.

When Path B is done, you will have:

- A run that paused for human review, then completed after two separate approvals
- An escalation case marked resolved
- A trace file with audit history and case outcome writeback

All data lives in `.loopgraph/` at the repo root.

---

## Setup (run once)

From the repo root:

```bash
git checkout v1
git pull
npm install
```

**Tip:** Run one command at a time. Wait for each to finish before running the next.

**If something looks wrong mid-walkthrough:** Re-run Path B step 1 (`simulate`). That resets the run to a fresh `WAITING_FOR_REVIEW` state.

---

## Path B — Strategic Account Escalation (main demo)

**Story:** An enterprise customer reports an outage days before renewal. Loopgraph gathers evidence, prepares internal and customer-facing actions, waits for human approval in two steps, then lets you resolve the escalation case.

### Reference card (stable for this fixture)

Copy these IDs — every command below uses them:

| What | Value |
|------|-------|
| Run ID | `run_a75f60f5d6d9121e` |
| Case ID | `case_60f5d6d9121e` |
| Internal action fingerprint | `05437111bacf29d0` |
| Customer-facing action fingerprint | `3a223868a24b7c4b` |

---

### Step 1 — Simulate the incident

**Run:**

```bash
npm run loopgraph -- simulate examples/strategic-account-escalation \
  --fixture fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json
```

**You should see:**

```text
runId=run_a75f60f5d6d9121e status=WAITING_FOR_REVIEW mode=simulate reviewRequired=yes escalationCase=case_60f5d6d9121e
caseId=case_60f5d6d9121e severity=P1
```

**What it means:** The loop ran against fixture data, proposed actions, and stopped because a human must approve before anything proceeds. An escalation case was created automatically.

**If you see a different `runId`:** You may be on a different fixture or branch. The IDs above are deterministic for this exact fixture on `v1`.

---

### Step 2 — Read the review packet

**Run:**

```bash
npm run loopgraph -- review packet run_a75f60f5d6d9121e
```

**You should see:**

- A **Decision summary** about enterprise outage near renewal
- **Evidence** from the support ticket and CRM (renewal in 48 days)
- **Prepared actions** split into two sections:
  - **Internal** — Create P1 incident task (`05437111bacf29d0`)
  - **Customer-facing (separate approval gate)** — Draft customer update (`3a223868a24b7c4b`)
- **EscalationCase** block for `case_60f5d6d9121e`

**What it means:** This is the human decision packet — evidence, proposed actions, and exact fingerprints you must approve. Fingerprints bind to specific payloads; approving the wrong fingerprint would not commit a tampered action.

---

### Step 3 — Approve internal actions only

**Run:**

```bash
npm run loopgraph -- review approve run_a75f60f5d6d9121e --actions 05437111bacf29d0
```

**You should see:**

```text
Review approved recorded for run_a75f60f5d6d9121e (trace status=WAITING_FOR_REVIEW)
```

**What it means:** Internal escalation is approved, but the run is **not** finished. The customer-facing draft still needs a separate approval — that is intentional (two approval gates).

**If you see an error:** Re-run step 1 to reset the run, then try again.

---

### Step 4 — Approve customer-facing action

**Run:**

```bash
npm run loopgraph -- review approve run_a75f60f5d6d9121e --actions 3a223868a24b7c4b
```

**You should see:**

```text
Review approved recorded for run_a75f60f5d6d9121e (trace status=COMPLETED)
```

**What it means:** You only pass the customer fingerprint on this call. The runtime remembers the internal approval from step 3. Both gates are now satisfied and the run is complete.

**If you see `Missing approved fingerprints for required internal actions`:** Your branch may be missing the cumulative-approval fix. Run step 3 first, or approve both in one call: `--actions 05437111bacf29d0,3a223868a24b7c4b`.

---

### Step 5 — Resolve the escalation case

**Run:**

```bash
npm run loopgraph -- case resolve case_60f5d6d9121e --summary "Incident mitigated."
```

**You should see:** JSON ending with:

```json
"status": "resolved",
"outcome": {
  "resolutionSummary": "Incident mitigated.",
  "resolvedAt": "..."
}
```

**What it means:** The case is closed from a management perspective. This also writes outcome data back to the source run trace (step 6).

---

### Step 6 — Inspect the run trace

**Run:**

```bash
npm run loopgraph -- trace run_a75f60f5d6d9121e
```

**You should see in the CLI output:**

- `"status": "COMPLETED"`
- `"humanReviews"`: **two** entries
  - First: `"approvedFingerprints": ["05437111bacf29d0"]`
  - Second: `"approvedFingerprints": ["3a223868a24b7c4b"]`

**What it means:** Full audit trail — two separate human decisions, each recording exactly what was approved that step.

**Case writeback is not shown by `trace`.** To confirm outcome writeback, run:

```bash
grep -E '"type": "(case_outcome|improvement_signal)"' .loopgraph/traces/run_a75f60f5d6d9121e.json
```

You should see two matches: `case_outcome` and `improvement_signal` (with `"failureMode": "case_resolved"`).

Or open the full file: `.loopgraph/traces/run_a75f60f5d6d9121e.json` and scroll to `"outputs"`.

**Ignore this (expected quirk):** `verificationResults` may still say `"message": "Review required"`. That is a snapshot from when the run first paused — it is not updated after approvals.

---

### Step 7 — View the management consumer

**Run:**

```bash
npm run loopgraph -- case show case_60f5d6d9121e
```

**You should see:**

1. The resolved case JSON (evidence, routing, response plan, outcome)
2. A **Management plan** block below it — a case-level summary for leadership, not the raw support ticket

**What it means:** Downstream consumers (dashboards, reports) can read structured case data without parsing agent traces.

---

### Path B — done checklist

You are finished when all of these are true:

- [ ] Step 1: `status=WAITING_FOR_REVIEW`
- [ ] Step 3: still `WAITING_FOR_REVIEW` after internal approval only
- [ ] Step 4: `trace status=COMPLETED`
- [ ] Step 5: case `"status": "resolved"`
- [ ] Step 6: two `humanReviews` entries; `grep` finds `case_outcome` and `improvement_signal`
- [ ] Step 7: management plan prints below the case JSON

---

### Path B — copy all commands (fast track)

Paste these one at a time. Do **not** paste lines starting with `#` — zsh will error.

```bash
npm run loopgraph -- simulate examples/strategic-account-escalation --fixture fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json

npm run loopgraph -- review packet run_a75f60f5d6d9121e

npm run loopgraph -- review approve run_a75f60f5d6d9121e --actions 05437111bacf29d0

npm run loopgraph -- review approve run_a75f60f5d6d9121e --actions 3a223868a24b7c4b

npm run loopgraph -- case resolve case_60f5d6d9121e --summary "Incident mitigated."

npm run loopgraph -- trace run_a75f60f5d6d9121e

grep -E '"type": "(case_outcome|improvement_signal)"' .loopgraph/traces/run_a75f60f5d6d9121e.json

npm run loopgraph -- case show case_60f5d6d9121e
```

---

## Path A — GitHub Issue Triage (optional, ~5 min)

Shorter example: a normal bug completes automatically; a security issue requires review.

### Reference card

| What | Value |
|------|-------|
| Normal bug run ID | `run_1ed8e96c37d9e9b5` |
| Security run ID | `run_1ff426aee511a198` |
| Security case ID | `case_26aee511a198` |
| Label fingerprint | `1d427e388a3cdfa4` |
| Escalation-case fingerprint | `9a137a8ce2dee1ec` |

### Steps

**1. Validate**

```bash
npm run loopgraph -- validate examples/github-issue-triage
```

Expected: `Valid: GitHub Issue Triage (github-issue-triage@1.0.0)`

**2. Normal bug — no review needed**

```bash
npm run loopgraph -- simulate examples/github-issue-triage \
  --fixture fixtures/github-issue-triage/normal-bug.json
```

Expected: `runId=run_1ed8e96c37d9e9b5 status=COMPLETED ... reviewRequired=no`

**3. Security issue — review required**

```bash
npm run loopgraph -- simulate examples/github-issue-triage \
  --fixture fixtures/github-issue-triage/security-issue.json
```

Expected:

```text
runId=run_1ff426aee511a198 status=WAITING_FOR_REVIEW ... escalationCase=case_26aee511a198
caseId=case_26aee511a198 severity=P1
```

**4. Read the packet**

```bash
npm run loopgraph -- review packet run_1ff426aee511a198
```

**5. Approve both actions in one step** (both are internal — no separate customer gate for this loop)

```bash
npm run loopgraph -- review approve run_1ff426aee511a198 \
  --actions 1d427e388a3cdfa4,9a137a8ce2dee1ec
```

Expected: `trace status=COMPLETED`

**6. Inspect trace**

```bash
npm run loopgraph -- trace run_1ff426aee511a198
```

Expected: `"status": "COMPLETED"`, one `humanReviews` entry with both fingerprints.

---

## Optional — web UI

After Path B via CLI:

```bash
npm run dev
```

Then open:

| Page | URL |
|------|-----|
| Strategic account runs | `/loops/strategic-account-escalation/runs` |
| This run's detail | `/loops/strategic-account-escalation/runs/run_a75f60f5d6d9121e` |
| Review UI | `/loops/strategic-account-escalation/reviews?runId=run_a75f60f5d6d9121e` |
| Topology map | `/topology?node=loop:catalog_strategic-account-escalation` |

The UI reads the same `.loopgraph/` files the CLI writes. On Topology, use the Inspector **Review pending** and **Open case** actions after selecting the Strategic Account Escalation loop. See [topology-guide.md](./topology-guide.md).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `zsh: command not found: #` | You pasted a comment line. Run only the `npm run loopgraph ...` lines. |
| `Trace not found` | Run step 1 (`simulate`) first. |
| `Missing approved fingerprints...` on step 4 | Run step 3 first, or `git pull` for the cumulative-approval fix. |
| `Case not found` | Run Path B step 1 — simulate creates the case. |
| Step 6: no `case_outcome` in `trace` output | Expected. Use `grep` or open `.loopgraph/traces/run_a75f60f5d6d9121e.json`. |
| Weird state from a previous session | Re-run Path B step 1 to reset. |

---

## What this demo proves

- **LoopSpec** (YAML) is the source of truth
- **Simulate** is deterministic — same fixture, same IDs every time
- **Prepared actions** bind to exact fingerprints
- **Partial approval** — internal and customer-facing actions use separate approval steps
- **EscalationCase** resolves with outcome writeback to the source trace

## What this demo does not do yet

- No live GitHub / Intercom / CRM writes in simulate mode
- Execute + OpenAI is experimental (`LOOPGRAPH_EXECUTE_ENABLED=true`)
- Design Studio / Supabase parity is incomplete

See [NEXT-PRIORITIES.md](./NEXT-PRIORITIES.md).
