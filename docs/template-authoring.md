# Template authoring

V1 hero templates live as code-first **LoopSpec** YAML under `examples/`.

## Authoring workflow

1. Copy an example: `npm run loopgraph -- init github-issue-triage ./my-loop`
2. Edit `loopgraph.yaml` (apiVersion `loopgraph/v1alpha1`, kind `Loop`)
3. Add fixtures under `fixtures/<template-id>/` with `eventId`, `simulatedAt`, and `expectedAssessment`
4. Validate: `npm run loopgraph -- validate ./my-loop/github-issue-triage`
5. Simulate: `npm run loopgraph -- simulate ./my-loop/github-issue-triage --fixture fixtures/.../case.json`

## Required sections

- `metadata`, `trigger`, `input`, `output` (structured assessment schema)
- `context.sources` with adapter IDs and precedence
- `tools` — every write-capable tool needs matching `policy.allowedActions`
- `policy.escalationRules` for severity routing
- `verification`, `approval`, `persistence`, `trace`

## Design Studio bridge

The wizard exports via `flatSpecToV1alpha1()` in `lib/loopgraph-core/studio-adapter.ts`. Unsupported UI-only fields are preserved in extension blocks; required semantics must round-trip.

## Fixture conventions

```json
{
  "eventId": "unique_event_id",
  "simulatedAt": "2026-06-27T12:00:00.000Z",
  "expectedAssessment": { "...": "structured output matching output.schema" }
}
```

Regenerate trace snapshots after template changes:

```bash
npx tsx scripts/generate-expected-traces.ts
```

See also: [loop-spec.md](./loop-spec.md), [ADR-001-v1-architecture.md](./ADR-001-v1-architecture.md).
