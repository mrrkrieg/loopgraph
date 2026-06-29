# LoopSpec (loopgraph/v1alpha1)

The canonical LoopSpec is defined in `lib/loopgraph-core/loop-spec.ts`.

## Required fields

- `apiVersion: loopgraph/v1alpha1`
- `kind: Loop`
- `metadata.id`, `metadata.name`, `metadata.version`
- `trigger`, `input.schema`, `output.schema`
- `context.sources`, `routine.steps`, `policy`, `approval`, `trace`

## Semantic validation

- Write-capable tools require `policy.allowedActions`
- Escalation rules require owner, SLA, and decisions
- Evidence-required loops must declare evidence in output schema

## Examples

- `examples/github-issue-triage/loopgraph.yaml`
- `examples/strategic-account-escalation/loopgraph.yaml`

Validate locally:

```bash
npm run loopgraph -- validate examples/github-issue-triage
```
