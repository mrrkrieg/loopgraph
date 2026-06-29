# EscalationCase

Typed handoff objects created when policy or assessment severity requires human ownership beyond inline review.

## When cases are created

- GitHub triage: security findings → P1 case + review (see `security-issue.json` fixture)
- Account escalation: enterprise outage near renewal, executive escalation, incomplete context → cases with routing metadata
- Low-risk product questions may complete without a case

## Case shape (summary)

| Section | Purpose |
|---------|---------|
| `summary` | One-line management headline |
| `severity` | P0–P3 |
| `routing` | Primary owner role, reviewers, SLA deadline |
| `evidence` | Citations backing the escalation |
| `recommendedPlan` | Internal actions and success criteria |
| `status` | Lifecycle: open → under_review → resolved / closed |

## Management consumption

`consumeEscalationCase()` transforms a case into a management plan (cross-functional dependencies, decisions needed). The Management UI lists cases from `.loopgraph/cases/` after CLI simulate runs.

## Persistence

- `.loopgraph/cases/{caseId}.json`
- Indexed in `.loopgraph/index.json`
- UI: `/cases/[caseId]`, Management → Escalation cases

V1 does not perform live CRM or paging integrations — cases are fixture-backed and deterministic.

See also: [trace-model.md](./trace-model.md), [competitive-boundary.md](./competitive-boundary.md).
