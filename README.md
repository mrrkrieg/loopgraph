# Loopgraph

Loopgraph is an open-source starter for mapping, designing, implementing, running, reviewing, and improving AI-human company loops.

The unit of design is a loop:

```text
Observe state
Compare state to a goal
Execute routines through tools, agents, or humans
Verify outputs
Escalate judgment-heavy work
Record traces
Improve from outcomes and human review
```

## What the starter includes

- Next.js App Router application
- TypeScript and Tailwind UI
- Supabase schema and seed data
- React Flow + ELK topology canvas for company loop management
- Vercel cron route for weekly management review
- Zod Loop Spec validation
- Department templates for marketing, sales, product, engineering, customer success, operations and finance, HR, legal and security, management, and custom loops
- A polished Marketing Campaign Learning Loop example
- Question engine for department-specific loop questions
- Spec generator for structured Loop Specs
- Implementation generator for Supabase, Vercel, cron, UI, agent prompt, verification rubric, and management review artifacts
- Manual loop runs with traces, verification result, human review, metrics, hidden-labor accounting, and improvement items
- Developer APIs for graph data and implementation-pack export

## Routes

```text
/topology
/dashboard
/loops
/loops/new
/loops/[loopId]
/loops/[loopId]/questions
/loops/[loopId]/spec
/loops/[loopId]/implementation
/loops/[loopId]/runs
/loops/[loopId]/reviews
/loops/[loopId]/metrics
/loops/[loopId]/improvements
/management
/templates
/settings
/api/cron/management-review
/api/loops/[loopId]/graph
/api/loops/[loopId]/artifacts
```

## Getting started

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

## Supabase

Loopgraph runs as a zero-config demo when Supabase environment variables are missing. When Supabase is configured, new loops, answers, specs, artifacts, runs, reviews, improvements, graph relationships, and saved graph views are persisted.

Apply the migration in:

```text
supabase/migrations/202606220001_loop_engineering_builder.sql
```

Seed built-in templates from:

```text
supabase/seed.sql
```

Environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
CRON_SECRET=
```

## V1 scope

V1 is intentionally focused. It proves that a user can start with a vague company goal, answer the right department-specific questions, and get a serious implementation blueprint for an AI-human operating loop.

External system ingestion is not included in V1. Manual and simulated runs are used to prove the loop model, trace schema, verification, human review, measurement, and management rollup.

The product also avoids presenting automation as free labor. Measurement includes review time, rework time, escalation time, governance time, botsitting time, quality, business value, and relationship-time redeployment.
