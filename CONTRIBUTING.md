# Contributing

1. Branch from `v1` for V1 work.
2. Run `npm run check:app-catalog`, `npm run typecheck`, `npm run test`, and `npm run loopgraph -- validate examples/github-issue-triage`.
3. Keep `lib/loopgraph-core` and `lib/loopgraph-runtime` free of Next.js imports.
4. Do not edit generated topology as source of truth — update LoopSpec files.
5. Do not edit `packages/loopgraph/src/generated/official-app-catalog.ts`. Update the official LoopPack and run `npm run generate:app-catalog`.
