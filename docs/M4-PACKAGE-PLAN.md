# M4 — Package extraction plan

Last updated: 2026-07-06

**Goal:** Publish a consumable `loopgraph` package so [raisi-growth-os](https://github.com/mrrkrieg/raisi-growth-os) can install the loop engine without the Next.js Design Studio app.

**Depends on:** M1–M3 (shipped on `loopgraph/m1-m3`)

**Effort:** ~3–5 days focused work

---

## Outcome

Raisi can:

```bash
npm install github:mrrkrieg/loopgraph#loopgraph/m1-m3
# or, after M4:
npm install github:mrrkrieg/loopgraph#packages/v0.2.0
```

```typescript
import { validateLoopSpec, loadLoopSpecFromPath } from "loopgraph/core";
import { runLoop, applyReviewDecision } from "loopgraph/runtime";
import type { IntegrationAdapter, StorageAdapter } from "loopgraph/sdk";
```

Loop specs (`loopgraph.yaml`) and Raisi adapters stay **in Raisi**. Loopgraph ships contracts + runtime only.

---

## What ships in the package

| Include | Exclude |
|---------|---------|
| `loopgraph-core` | `app/`, `components/` |
| `loopgraph-runtime` | `loop-engineering-builder/` (Design Studio) |
| `loopgraph-sdk` (interfaces + mocks) | Supabase UI adapter (`lib/db/supabase`) |
| CLI `loopgraph` binary | Topology canvas, workspace wizard |
| JSON Schema export | Next.js, React, Tailwind |

**Optional later:** `@loopgraph/studio` for Design Studio types; `@loopgraph/storage-supabase` for hosted persistence.

---

## Phase 1 — Boundary cleanup (day 1)

Fix leaks so `packages/loopgraph` has no imports from `loop-engineering-builder` or `app/`.

| Task | File(s) | Action |
|------|---------|--------|
| F1.1 | `loopgraph-core/studio-adapter.ts` | Move `FlatLoopSpec` types into `loopgraph-core/studio-types.ts` OR mark `studio-adapter` as `@loopgraph/studio` only |
| F1.2 | `loopgraph-sdk/providers.ts` | Move `FixtureProvider` impl to runtime; sdk exports `AssessmentProvider` interface only |
| F1.3 | `loopgraph-sdk/supabase-storage.ts` | Move to `lib/db/adapters/` in app; not in published package |
| F1.4 | `improvement-loader.ts` | Replace `ImprovementItem` import with minimal `TraceImprovement` type in core or runtime |
| F1.5 | `topology-runtime.ts`, `trace-labor.ts` | Stay in app repo only (already excluded from package) |
| F1.6 | Dependency rule test | Vitest: `packages/loopgraph` must not import `loop-engineering-builder`, `next`, `@supabase/*` |

**Exit:** `grep -r loop-engineering-builder packages/loopgraph` returns nothing.

---

## Phase 2 — Package scaffold (day 1–2)

```text
packages/
└── loopgraph/
    ├── package.json       # name: "loopgraph", version: 0.2.0
    ├── tsconfig.json      # composite, emit to dist/
    ├── tsup.config.ts     # or tsc --build
    ├── src/
    │   ├── core/          # copied/symlinked from lib/loopgraph-core
    │   ├── runtime/       # from lib/loopgraph-runtime
    │   ├── sdk/           # from lib/loopgraph-sdk
    │   └── cli/           # from scripts/loopgraph.ts (trim Design Studio init deps)
    └── dist/
```

| Task | Deliverable |
|------|-------------|
| F2.1 | `packages/loopgraph/package.json` with `exports`: `./core`, `./runtime`, `./sdk`, `./package.json` |
| F2.2 | `bin.loopgraph` → `dist/cli.js` |
| F2.3 | `files`: `["dist", "README.md"]` — no source leak |
| F2.4 | Peer deps: `zod`, `yaml`; optional peer `openai` |
| F2.5 | Root `package.json` workspaces: `"workspaces": ["packages/*"]` |
| F2.6 | Root app imports `@loopgraph/core` etc. via workspace (dogfood) |

**Build commands:**

```json
"scripts": {
  "build:package": "npm run build -w loopgraph",
  "prepublishOnly": "npm run test && npm run build:package"
}
```

**Exit:** `npm run build:package` produces `dist/` with `.d.ts`; root app still builds.

---

## Phase 3 — CLI trim (day 2)

CLI in consumer repo should not require Next.js or full template catalog.

| Keep | Trim / optional |
|------|-----------------|
| `validate`, `simulate`, `trace`, `review *`, `case *` | `init` with full Design Studio catalog → ship hero templates only |
| `adapter test` | `register` (workspace.json) → document as app-only |
| `export-graph` (from core graph) | Supabase-specific paths |

**Exit:** `npx loopgraph validate` works in empty dir with only `zod` + `yaml` installed.

---

## Phase 4 — Consumer docs + Raisi spike (day 3)

| Task | Deliverable |
|------|-------------|
| F4.1 | `packages/loopgraph/README.md` — install, minimal example, adapter stub |
| F4.2 | `docs/consumer-integration.md` — StorageAdapter, trigger wiring, CI recipe |
| F4.3 | Raisi spike PR | `npm install` loopgraph; one loop from `support-ticket-triage`; fixture simulate in CI |

**Raisi folder shape:**

```text
raisi-growth-os/
├── loops/investor-reply-triage/loopgraph.yaml
├── lib/loopgraph/
│   ├── storage.ts          # Postgres StorageAdapter
│   └── adapters/inbox.ts     # IntegrationAdapter
└── scripts/run-loop.ts       # cron → runLoop()
```

---

## Phase 5 — CI + release (day 4)

| Task | Deliverable |
|------|-------------|
| F5.1 | CI job: `npm run build:package` + import smoke test from `/tmp/consumer-fixture` |
| F5.2 | Tag `packages/v0.2.0` on loopgraph repo |
| F5.3 | Document git install: `"loopgraph": "github:mrrkrieg/loopgraph#packages/v0.2.0"` |
| F5.4 | (Optional) `npm publish --access public` under `0.x` — defer until Raisi validates |

**Exit:** Raisi `package.json` pins loopgraph; `npm ci` + `loopgraph validate loops/...` passes in Raisi CI.

---

## Acceptance criteria (M4 done)

- [ ] `packages/loopgraph` builds standalone; no Next/React in dependencies
- [ ] Root loopgraph app uses workspace package (no duplicate `lib/loopgraph-*` long-term — migrate imports in same PR or follow-up)
- [ ] Boundary test passes (no engineering-builder imports in package)
- [ ] CLI core commands work from published artifact
- [ ] Consumer README + Raisi spike documents git install path
- [ ] 70+ existing tests still green; package has its own smoke tests

---

## Recommended PR sequence

1. **PR A — Boundaries only** (F1): refactor leaks, no package yet; zero behavior change
2. **PR B — Package scaffold** (F2–F3): `packages/loopgraph`, workspace, build
3. **PR C — Dogfood + docs** (F4–F5): root imports from package, consumer docs, tag

Do not merge PR B until PR A is green — otherwise you copy leaks into `packages/`.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Duplicate source (`lib/` + `packages/`) | Single source: move `lib/loopgraph-*` → `packages/loopgraph/src`; app re-exports |
| `studio-adapter` round-trip | Keep in optional `@loopgraph/studio`; not required for Raisi |
| Breaking Raisi on every main push | Pin git tag; semver `0.x` |
| CLI `init` depends on template catalog | Ship 3 hero templates in package `templates/` dir |

---

## After M4 → M5 (Raisi loops)

1. Investor reply triage — clone `support-ticket-triage` in Raisi
2. Campaign health escalation — clone `strategic-account-escalation`
3. Campaign learning — new spec in Raisi (pattern TBD)

See [BUILD-PLAN.md](./BUILD-PLAN.md) Stream G.

---

## Related

- [BUILD-PLAN.md](./BUILD-PLAN.md) — full platform plan
- [template-authoring.md](./template-authoring.md) — authoring loops in consumer repos
- [competitive-boundary.md](./competitive-boundary.md) — what Loopgraph is vs workflow runtimes
