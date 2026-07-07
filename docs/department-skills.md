# Department Skills

## Purpose

Department skill packs translate generic loop engineering ideas into company department process loops. They define discovery questions, common goals, loop blueprints, required integrations, default metrics, human review rules, risk rules, and daily summary fields.

## Schema

The schema is `DepartmentSkillPackSchema` in `lib/loopgraph-core/department-skills.ts`.

## Example

`examples/department-skills/marketing.yaml` includes Campaign Learning, Landing Page Experiment, Brand Claim Review, Competitor Monitoring, and SEO Refresh loops.

## CLI Usage

```bash
npm run loopgraph -- skills list
npm run loopgraph -- skills show marketing
```

## UI Behavior

The skill library is available at `/skills`, with detail pages at `/skills/[skillId]`.

## Testing Notes

`lib/loopgraph-core/department-skills.test.ts` loads every YAML pack and validates blueprint references to metrics and integrations.

