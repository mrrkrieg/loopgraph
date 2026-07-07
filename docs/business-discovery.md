# Business Discovery

## Purpose

Business discovery captures company context before any loop becomes active. The product asks about the company, customers, quarterly goal, north-star metric, departments, tools, recurring work, bottlenecks, customer-facing outputs, and actions AI must never take without approval.

## Schema

Core types live in `lib/loopgraph-core/discovery.ts`:

- `CompanyDiscoveryProfile`
- `DepartmentProfile`
- `BusinessDiscoverySession`
- `DiscoveryAnswer`
- `DepartmentGoal`
- `ProcessGoalMapping`

## Example

The demo fixture is `examples/business-discovery/acme-saas-answers.json`. It describes a B2B SaaS company with Marketing, Sales, Product, Customer Success, and Management processes.

## CLI Usage

```bash
npm run loopgraph -- discovery start --fixture examples/business-discovery/acme-saas-answers.json --recommend
npm run loopgraph -- discovery recommend acme-saas-discovery
```

## UI Behavior

The wizard starts at `/discovery` and links to company, department, process, goal, access, recommendation, human-input, metric, and create-loop steps.

## Testing Notes

Coverage lives in `lib/loopgraph-runtime/discovery-engine.test.ts` and `lib/loopgraph-runtime/process-classifier.test.ts`.

