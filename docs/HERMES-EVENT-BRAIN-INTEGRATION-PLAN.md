# Hermes Agent Event Brain Integration Plan

Status: implemented and audited; Hermes-only integration target with safe local runtime tools exposed through MCP

Scope: local-first department discovery, high-reasoning loop design, Hermes-centered event intake and routing, connector planning, LoopSpec materialization, graph visualization, and safe local execution

Primary reference scenario: Business Webhooks -> Hermes Brain -> Marketing -> Ads or Content Creation

## 1. Product goal

Make Loopgraph usable as a local company-loop design system from Hermes Agent or the Loopgraph browser UI.

A user should be able to:

1. Clone Loopgraph or install its package in a local project.
2. Connect Loopgraph to Hermes Agent with one setup command.
3. Start or resume a discovery session from the Hermes conversation.
4. See the supported departments and select one or more.
5. Answer a short, adaptive set of questions about the current stack, recurring work, biggest problem, desired automation, ideal outcome, boundaries, and owners.
6. Have a high-reasoning planner propose one or more governed loops.
7. See a concise explanation of each loop, the evidence behind it, assumptions, risks, and exactly what the user must connect or decide.
8. Accept, edit, or reject each proposal.
9. Materialize accepted proposals into validated `loopgraph.yaml` LoopSpecs.
10. Register a typed routing contract for every materialized loop.
11. Send all external business webhooks to Hermes Agent as the Company Brain.
12. Let Hermes interpret each normalized event, identify the business problem, and select the best eligible loop.
13. Require Loopgraph to validate the proposed route before starting the loop.
14. Open a local graph that logically shows Events -> Hermes Brain -> Department -> Workflow Loops.
15. Simulate a loop locally without credentials, then enable real reads and approved writes only when connectors and policies are ready.

The key architectural decision is to make **Hermes Agent the operational Company Brain and sole external webhook ingress**, while Loopgraph remains the governed loop registry and execution kernel. Hermes receives business events, determines what problem the event represents, and proposes which registered loop or loops should handle it. Loopgraph checks that the selected loop exists, is active, accepts the event, has the required data and readiness, is not already processing the same event, and is allowed to run at the requested autonomy level. Only then does Loopgraph queue or start the loop.

This plan intentionally centers Hermes as the only external integration path for agent-led discovery and runtime routing. The browser remains available for local setup, editing, visualization, and simulation, but runtime business events and Hermes-led discovery should flow through Hermes so there is one routing authority and one operational event history.

## 2. What already exists and should be reused

The current project has substantial foundations:

- A versioned LoopSpec contract, loader, semantic validation, simulation runtime, trace model, approval binding, escalation cases, and file storage in `packages/loopgraph/src`.
- A package CLI supporting template initialization, validation, simulation, traces, reviews, cases, graph export, and experimental execution.
- A local registry at `.loopgraph/workspace.json` and local LoopSpec registration.
- Department skill packs for Management, Marketing, Sales, Product, Customer Success, Engineering, Ops/Finance, HR/Talent, and Legal/Compliance.
- A deterministic business-discovery pipeline with company profiles, department profiles, process inventory, goals, recommendations, access requirements, metrics, human requirements, readiness, and LoopSpec materialization.
- A semantic topology model that can derive company, management, department, workflow, data, metric, review, improvement, and trace nodes from LoopSpecs.
- A Company Brain view and a more detailed Topology view.
- An integration adapter interface with conformance checks, mocks, and one real GitHub adapter.
- A separate Design Studio question engine and template catalog.

These pieces should be consolidated, not replaced.

## 3. Important current gaps

### 3.1 Two discovery systems overlap

`/loops/new` uses `lib/loop-engineering-builder/question-engine.ts`, flat generated specs, and a large template catalog. `/discovery/*` uses core discovery schemas, department skill packs, process recommendations, access planning, metric planning, and materialization.

Maintaining both as independent product flows will cause divergent questions, answers, department names, connector requirements, and LoopSpecs. The core discovery schemas and department skill packs should become the canonical domain. The older Design Studio should become a focused editor for a materialized proposal or be retired after feature parity.

### 3.2 Discovery pages are not yet a real interactive flow

Most `/discovery/*` pages render a demo fixture. The only working mutations are accepting/rejecting recommendations and materializing accepted loops. There are no forms for creating a real company profile, selecting departments, answering department questions, adding processes, resolving follow-up questions, or editing a proposed loop.

### 3.3 Stored discovery answers do not influence recommendations

`answerDiscoveryQuestion()` stores `DiscoveryAnswer` records, but the classifier and recommender primarily read `companyProfile`, `departmentProfiles`, and `processInventory`. They do not compile stored answers into those projections. A user could answer questions and see no corresponding change in the recommendations.

### 3.4 Recommendations are deterministic catalog matches, not high-reasoning designs

The current recommender scores process inventory against fixed blueprints. That is useful as a safe baseline and candidate generator, but it does not synthesize a novel two-loop design, explain tradeoffs, produce evidence-backed assumptions, or ask targeted follow-ups.

### 3.5 Department identifiers disagree

The older builder and the core discovery model use different identifiers:

| Concept | Builder identifier | Core identifier |
|---|---|---|
| Ops / Finance | `operations_finance` | `ops_finance` |
| HR / Talent | `hr` | `hr_talent` |
| Legal / Compliance | `legal_security` | `legal_compliance` |

A discovery-materialized Ops/Finance, HR, or Legal loop can be downgraded to `custom` when it passes through the builder registry. This must be fixed before Hermes-driven materialization.

### 3.6 Connector planning and measurement operation

The original gap was that an `AccessRequirement` could name CRM, ads, analytics, email, or another integration without identifying a provider instance, credential reference, granted scopes, health, or exact metric fields.

Current implementation status: Loopgraph now registers non-secret connection instances, constrained opaque Hermes/keychain/vault/environment references, granted capabilities and scopes, and health receipts. Exact `MetricBinding` records connect primary, leading, and guardrail definitions to structured provider queries and aligned schedules. Durable `MeasurementJob` records support idempotent creation, atomic claims, hashed leases, retries/dead letter, evidence-qualified completion, automatic baseline/current outcome evaluation, and guardrail receipts. Reconciliation checks connection health, scopes, capabilities, Hermes route-manifest drift, and overdue work, then triggers the continuous controller.

Provider OAuth, credential values, provider-specific API execution, and live subscription application intentionally remain Hermes-owned. Loopgraph provides the contract and receipt boundary, not a second credential store.

### 3.7 Graph hierarchy does not match the simple authoring story

The semantic topology currently creates:

`Company -> Company Management Loop -> Department Loop -> Workflow Loop`

The requested design story is:

`Company Brain -> Marketing -> Ads`

`Company Brain -> Marketing -> Content Creation`

Both are valid views of the same graph. The product needs explicit graph projections instead of forcing one hierarchy to serve authoring and operating-governance use cases.

### 3.8 The force layout can obscure hierarchy

The Company Brain uses a force layout. It is useful for exploration, but it cannot guarantee that Company, Department, and Workflow tiers are visually ordered. A layered hierarchy layout is needed for the initial design result.

### 3.9 Local project roots are implicit

Many paths derive from `process.cwd()`. That works when Loopgraph is launched in its own repository, but the Hermes integration needs an explicit target project root so the MCP server, browser UI, CLI, and Hermes all read the same `.loopgraph` workspace.

### 3.10 The package does not expose discovery or MCP

The publishable package deliberately excludes app-only modules. Its CLI has no `discovery`, `agent`, `mcp`, or `studio` commands. The new domain logic must be moved behind a package-safe boundary before Hermes can consume it reliably.

### 3.11 The current event-routing UI is descriptive, not executable

`components/management/event-routing-table.tsx` contains hard-coded example rows. It is not derived from registered LoopSpecs, does not inspect incoming events, and cannot explain an actual routing decision. It must become a read model over routing contracts and persisted decisions.

### 3.12 LoopSpec triggers are too narrow for semantic routing

The current LoopSpec trigger identifies one type, source, and event. Hermes needs richer routing information: the business problems a loop can solve, accepted event patterns, required fields, exclusions, minimum confidence, cooldown, concurrency, fan-out policy, and what to do when routing is ambiguous. This should be a backward-compatible routing extension, not an attempt to encode all semantic routing into the existing three trigger fields.

### 3.13 The existing GitHub webhook bypasses Hermes

`app/api/webhooks/github/route.ts` authenticates and executes directly through Loopgraph. Under the Hermes-brain architecture, this becomes a temporary compatibility route that forwards to Hermes or is removed after migration. New external webhooks must not call individual loops directly.

Current implementation status: `/api/webhooks/github` is now a compatibility-only route. It returns `410` when Hermes forwarding is not configured and, when `HERMES_WEBHOOK_URL` is explicitly set for migration, forwards verified GitHub deliveries to Hermes without executing a LoopSpec or route decision locally.

### 3.14 Gateway idempotency is not enough for durable business routing

Hermes provides webhook delivery deduplication, filtering, rate limits, signature validation, and payload-size limits. Loopgraph still needs a durable event receipt store because gateway deduplication is time-bounded, events may be replayed intentionally, one event may fan out to multiple loops, and a routing decision must remain auditable after Hermes restarts.

## 4. Target end-to-end flow

### 4.1 Installation and project binding

Target command design:

```text
loopgraph workspace init --project /path/to/company-project
loopgraph hermes install --project /path/to/company-project
loopgraph hermes doctor --project /path/to/company-project
loopgraph studio --project /path/to/company-project
```

The commands above are the canonical Hermes-first local setup path.

Current implementation status: `workspace init`, `hermes install`, `hermes doctor`, `mcp serve`, and `studio --project` now exist in the package CLI. The product path is Hermes-specific. The `studio` command prepares the selected `.loopgraph` workspace and either prints a local Hermes Brain URL/launch plan or starts the local Next.js studio from a Loopgraph clone with `LOOPGRAPH_PROJECT_ROOT` set.

`workspace init` should create only recoverable, local state:

```text
.loopgraph/
  workspace.json
  discovery/
  generated/
  traces/
  reviews/
  cases/
  connections/
```

The selected project root must be stored as an explicit workspace property or passed to every service. The system must not search broad parent directories or write outside the selected root.

### 4.2 Hermes onboarding

The user says, for example, “Help me design automations for a department.”

The Loopgraph Hermes skill then:

1. Checks whether the current project has a Loopgraph workspace.
2. Starts a new discovery session or offers to resume an incomplete one.
3. Asks permission before inspecting project manifests and repository metadata.
4. Uses deterministic project inspection to detect likely stack details without reading secrets.
5. Presents the canonical department list.
6. Saves the selected department.
7. Asks five compact question bundles, adding only the follow-ups needed to remove material ambiguity.
8. Builds a structured design context from answers, detected stack, department skill packs, and deterministic blueprint candidates.
9. Runs the high-reasoning design step.
10. Submits the result to Loopgraph for schema and governance validation.
11. Explains the validated proposals and required user actions.
12. Materializes only proposals the user explicitly accepts.
13. Provides the local Company Brain URL and a safe simulation command.

### 4.3 Browser onboarding

The browser flow should operate on exactly the same session and schemas:

```text
Project -> Departments -> Questions -> Designing -> Proposed Loops
        -> Connections -> Accept/Edit -> Materialize -> Company Brain -> Simulate
```

The browser must not use a separate set of questions or generate a different spec shape. A session started in Hermes must be resumable in the browser, and a browser-started session must be resumable in Hermes.

### 4.4 Operational event flow with Hermes as the brain

All runtime events follow one path:

```text
Business System
  -> Hermes Webhook Gateway
       -> authenticate, rate-limit, filter, transform
       -> normalize to EventEnvelope
       -> persist receipt through Loopgraph MCP
       -> retrieve eligible RoutingCards
       -> Hermes classifies the business problem
       -> Hermes submits RoutingDecision
            -> Loopgraph route validator
                 -> create or update the durable BusinessProblem
                 -> ignore / append evidence / defer / request human / start loop(s)
                 -> queue and execute validated LoopSpec
                 -> emit trace, review, escalation, and outcome events
                      -> signed lifecycle webhook back to Hermes
                           -> notify, trigger a safe follow-on loop, or stop
```

The critical rule is that Hermes chooses the business response, but it does not call arbitrary loop implementation tools directly from an untrusted webhook turn. It calls a small routing-only Loopgraph MCP surface. Loopgraph then performs durable deduplication, schema validation, readiness checks, policy checks, queueing, and execution.

All event sources should enter this pipeline:

- External provider webhooks such as GitHub, HubSpot, Stripe, support systems, form systems, CMS systems, or custom applications.
- Hermes schedule/cron events for periodic loops.
- Manual events created from a Hermes conversation.
- Threshold/anomaly events created by connector pollers.
- Loopgraph lifecycle events such as `loop.route.accepted`, `loop.run.started`, `loop.run.completed`, `loop.review.required`, `loop.run.failed`, `loop.escalation.created`, `loop.outcome.recorded`, and `loop.problem.unhandled`.

Schedules are normalized into the same event contract even though they are not HTTP webhooks. This gives Hermes one routing model for event-driven, scheduled, and manually reported business problems.

### 4.5 Routing must use two stages

#### Stage 1: Deterministic eligibility

Before Hermes reasons about the event, Loopgraph returns only loops that are structurally eligible:

- Materialized and active, not a catalog item or unaccepted draft.
- Routing contract accepts the source/event family.
- Required event fields can be mapped to the loop input schema.
- Department, tenant, and workspace match.
- Required connectors or manual fallbacks are available.
- Loop is not disabled, blocked, inside cooldown, or over its concurrency limit.
- Event is not already committed for that loop.

This is not the final decision. It prevents the model from choosing impossible loops.

#### Stage 2: Hermes semantic decision

Hermes receives the normalized problem summary plus eligible routing cards and decides:

- Which business problem is present.
- Whether no loop should run.
- Whether exactly one loop is the best match.
- Whether the event contains multiple independent problems and bounded fan-out is justified.
- Whether confidence is too low and a human should choose.
- What event fields map to the selected loop input.

Loopgraph validates this decision again before it is committed.

### 4.6 How Hermes selects the right loop

Hermes should compare candidates using a structured rubric rather than free-form intuition:

1. **Problem fit:** Does the event describe a problem the loop explicitly claims to solve?
2. **Source/event fit:** Does the routing contract accept this source, event family, and subject type?
3. **Evidence completeness:** Are the required fields present and fresh enough?
4. **Specificity:** Prefer the narrowest loop that fully handles the problem over a generic department or management loop.
5. **Action fit:** Can the loop's allowed actions plausibly address the problem without crossing a forbidden boundary?
6. **Readiness:** Is the loop active, connected or using an approved fallback, measurable, and under its concurrency limit?
7. **Risk fit:** Does its current autonomy level permit this event's risk level?
8. **Outcome history:** If available, has this loop successfully resolved similar routed problem types without excessive review, rework, or escalation?
9. **Conflict/cooldown:** Is an equivalent problem already open for the same subject?
10. **Negative examples:** Does the event match an explicit “do not route here” case?

Selection rules:

- Zero eligible candidates: `unhandled`; record the business problem and do not improvise.
- A matching open problem with an active committed route: `append_evidence`; do not create duplicate work.
- One clear candidate above threshold: select it.
- Two close candidates: request human choice or route to a declared triage loop.
- Multiple independent, high-confidence problems: bounded fan-out only when every selected loop permits it.
- Any high-risk selection below its higher confidence threshold: require human routing confirmation.
- A generic management loop must not win merely because it can observe many event types; specificity outranks breadth.

Loopgraph should calculate deterministic eligibility/readiness components. Hermes supplies the semantic problem/action fit. Store both component sets so a route is explainable and can be evaluated later.

The system must keep three concepts separate:

- An **event** is immutable evidence that something happened.
- A **business problem** is the stateful issue to resolve and may accumulate many related events.
- A **loop run** is one governed attempt to resolve that problem.

This distinction prevents ten webhook deliveries about the same campaign or customer from becoming ten separate pieces of work. Hermes proposes the problem classification; Loopgraph owns the durable problem identity, merge policy, route binding, and lifecycle.

## 5. Architecture and responsibility boundaries

### 5.1 Loopgraph owns

- Workspace and project-root resolution.
- Canonical departments and department skill packs.
- Discovery sessions, typed questions, answers, and derived profiles.
- Deterministic project inspection and blueprint candidate generation.
- The structured input and output schemas for loop design.
- Design validation and repair diagnostics.
- Connector manifests, connection requirements, status, and health.
- Human ownership, approval policy, metrics, readiness, and required user actions.
- LoopSpec materialization and versioning.
- Topology derivation and graph projections.
- The registered routing catalog and routing-card compiler.
- Durable event receipts, deduplication, routing decisions, queue state, correlation, and replay.
- Eligibility, input compatibility, readiness, policy, cooldown, concurrency, and fan-out validation.
- Simulation, traces, review, escalation, and approved execution.

### 5.2 Hermes Agent owns

- The conversational interface.
- Asking the next Loopgraph-supplied question in natural language.
- Summarizing detected project context for user confirmation.
- In Hermes-hosted reasoning mode, producing a `LoopDesignProposal` using the configured high-reasoning model.
- Explaining validated results conversationally.
- Requesting explicit acceptance before local materialization or any real connector action.
- Running the external webhook gateway.
- Authenticating provider webhook routes using Hermes-supported mechanisms.
- Filtering noisy event families before they spend model tokens.
- Transforming vendor payloads into a bounded normalized event.
- Treating all payload-authored text as untrusted.
- Loading the Loopgraph event-router skill for webhook-triggered turns.
- Classifying the business problem and selecting among eligible registered loops.
- Returning structured route reasoning, confidence, alternatives, and payload mapping.
- Delivering notifications and human-choice requests to configured channels.

### 5.3 A model provider owns

- Structured inference only.
- It receives a redacted, bounded `LoopDesignContext`.
- It returns a schema-constrained `LoopDesignProposalSet`.
- It never writes LoopSpecs, changes connector state, or performs business actions directly.

### 5.4 The web UI owns

- Rendering session progress and question controls.
- Showing reasoning summaries, not hidden chain-of-thought.
- Editing proposals through structured fields.
- Connection setup and health surfaces.
- Company Brain and detailed topology projections.
- Webhook source, event inbox, routing decision, unhandled-problem, and router-health surfaces.
- Safe simulate/run/review controls.

## 6. Canonical domain model changes

### 6.1 Unify department taxonomy

Use one exported `DepartmentTypeSchema` everywhere:

```text
management
marketing
sales
product
customer_success
engineering
ops_finance
hr_talent
legal_compliance
custom
```

Add an alias migration layer:

```text
operations_finance -> ops_finance
hr                 -> hr_talent
legal_security     -> legal_compliance
```

Requirements:

- Builder templates, registries, topology filters, routes, database rows, and tests must use the canonical type.
- Existing local registries and Supabase data must load through aliases and be rewritten only during an explicit migration.
- Department labels remain presentation data and may be customized without changing the canonical identifier.

### 6.2 Add `ProjectProfile`

Fields:

- `projectRootId`: stable hash, never the raw path in model prompts.
- `displayName`.
- `repoType`: application, monorepo, service, non-code workspace, or unknown.
- `languages`, `frameworks`, `packageManagers`, `datastores`, `deploymentTargets`.
- `detectedIntegrationHints`: names only, no secrets.
- `manifestEvidence`: file path plus detector and confidence.
- `confirmedByUser` and `confirmedAt`.
- `inspectionVersion`.

Project inspection must ignore `.env*`, credential directories, `.git`, build outputs, and files outside the selected root.

### 6.3 Extend `BusinessDiscoverySession`

Add:

- `projectProfileId`.
- `selectedDepartmentIds`.
- `activeDepartmentId`.
- `activeStage` and `activeQuestionBundleId`.
- `questionQueue` with answered, skipped, blocked, and conditional states.
- `designRunIds`.
- `revision` for optimistic concurrency.
- `createdByActor`: browser, Hermes, CLI, or API.
- `lastActor` and `lastTransitionAt`.

Do not overload `status` with every UI page. Use a state machine with explicit allowed transitions.

### 6.4 Extend `DiscoveryAnswer`

Add:

- `valueType` and schema validation.
- `source`: user, project detector, imported fixture, Hermes inference, or existing workspace.
- `evidenceRefs`.
- `confidence` for inferred answers.
- `confirmedByUser`.
- `supersedesAnswerId` so edits remain auditable.
- `sensitivity` and `redactionApplied`.

Answers produced by Hermes or a detector must be confirmed before they can satisfy a required business or safety question.

### 6.5 Add `QuestionBundle`

A conversational turn may collect multiple typed fields while still feeling like one question. A bundle should contain:

- `id`, `stage`, `departmentType`.
- `prompt`, `whyAsked`, and optional examples.
- Typed fields and suggested choices.
- `requiredFor`: candidate generation, design, materialization, or execution.
- Conditional visibility rules.
- Follow-up rules.
- A maximum follow-up budget.

### 6.6 Add `LoopDesignContext`

This is the only model input contract. It contains:

- Confirmed company and project summary.
- Selected department profile.
- Confirmed answers and evidence references.
- Process inventory and baselines.
- Relevant department skill pack excerpts.
- Deterministic blueprint candidates and scores.
- Available connector manifests and current connection status.
- Existing loops to prevent duplicates.
- Company-wide AI boundaries.
- Required output schema and validation rules.

### 6.7 Add `LoopDesignProposalSet`

Each proposed loop contains:

- Stable proposal ID and proposed LoopSpec ID.
- User-facing short name, for example `Ads` or `Content Creation`.
- Department and optional parent workflow loop.
- Goal and business outcome.
- Reasoning summary: concise rationale tied to evidence.
- Assumptions, open questions, and alternative considered.
- Source answer and process references.
- Trigger/cadence and work-item definition.
- Observed signals and context sources.
- Routine steps.
- Proposed actions with risk, customer-facing status, and approval needs.
- Verifiers and measurable acceptance conditions.
- Owner, reviewers, escalation conditions, and forbidden actions.
- Primary and guardrail metrics with baseline state.
- Connector requirements and manual fallbacks.
- Readiness target and rollout stage.
- `requiredFromUser`: connections, owners, policy decisions, samples, baseline data, or approvals.
- A preview of the nodes and edges that will be added to topology.

Do not store or display private chain-of-thought. “Reasoning” in the product means an evidence-linked rationale, assumptions, tradeoffs, and decision summary.

### 6.8 Add `DesignRun`

Record:

- Session and department IDs.
- Provider mode: `hermes_host` or `embedded`.
- Hermes/provider name, model identifier when available, and `reasoningProfile`.
- Prompt/template version.
- Input hash and output hash.
- Started/completed timestamps.
- Validation attempts and repair errors.
- Final proposal IDs.
- Token/cost metadata when the provider supplies it.

### 6.9 Replace the closed integration enum with connector capabilities

Keep a small connector category type but stop using one enum value as both provider and capability.

Add `ConnectorManifest`:

- `id`: `google_ads`, `meta_ads`, `hubspot`, `notion`, etc.
- `category`: ads, analytics, CRM, content repository, CMS, messaging, database, and so on.
- `transport`: native adapter, MCP, HTTP API, file import, or manual.
- Auth type and minimum scopes.
- Variables, signals, actions, and risk defaults.
- Configuration schema and credential-field schema.
- Supported health checks and manual fallback.

Add `ConnectionInstance`:

- Workspace-scoped instance ID.
- Connector manifest ID and optional account label.
- Credential reference, never credential contents.
- Granted scopes.
- Status, last health check, and failure reason.
- Read/write policy and environment: simulate, sandbox, or live.

`AccessRequirement` should reference connector categories and capabilities, then be satisfiable by a compatible connection instance.

### 6.10 Add `EventEnvelope`

Every external, scheduled, manual, or Loopgraph lifecycle event is converted to one versioned envelope before routing:

```text
EventEnvelope
  id
  schemaVersion
  workspaceId
  companyId
  source
  sourceRoute
  sourceDeliveryId
  eventType
  occurredAt
  receivedAt
  subject { type, id, display }
  correlationId
  causationId?
  parentEventId?
  hopCount
  normalizedPayload
  rawPayloadRef?
  evidenceRefs[]
  trust { signatureVerified, signer, untrustedFields[] }
  sensitivity
```

Requirements:

- `id` is stable for a provider delivery and workspace.
- `normalizedPayload` contains only fields approved by the route transformer.
- Large or sensitive raw payloads are stored outside the model input and referenced by hash/ID.
- `correlationId` ties an incoming problem to all route decisions, loop runs, reviews, outcomes, and follow-on events.
- `causationId`, `parentEventId`, and `hopCount` prevent hidden recursive chains.
- Signature verification is gateway evidence, not proof that user-authored payload text is trustworthy.

### 6.11 Add a LoopSpec `routing` contract

Keep the existing `trigger` for backward compatibility and direct manual/simulation behavior. Add an optional routing section compiled during design:

```text
routing:
  problemTypes[]
  accepts[]
    sourcePattern
    eventTypePattern
    subjectTypes[]
    requiredFields[]
    optionalConditions[]
  excludes[]
  inputMapping
  priority
  minimumConfidence
  ambiguityPolicy
  noMatchPolicy
  fanoutPolicy
  cooldown
  concurrency
  activationMode
  lifecycleEvents[]
```

Important fields:

- `problemTypes`: semantic descriptions such as `paid_acquisition_efficiency_drop`, not just vendor event names.
- `accepts`: structurally eligible sources/events and required data.
- `excludes`: events that resemble the loop's domain but must never trigger it.
- `inputMapping`: deterministic mapping from envelope fields to the LoopSpec input.
- `minimumConfidence`: threshold for automatic route commitment.
- `ambiguityPolicy`: ignore, defer, request human, or route to a management triage loop.
- `fanoutPolicy`: none, independent-only, or declared ordered fan-out with a maximum count.
- `activationMode`: shadow, recommend, simulate, execute-with-approval, or autonomous-low-risk.
- `cooldown` and `concurrency`: stop event storms from creating overlapping work.

### 6.12 Add `RoutingCard`

Hermes should not receive complete LoopSpecs for every event. Compile a bounded routing card per active loop:

- Loop ID, name, department, goal, and current readiness.
- Problems the loop solves and explicit non-goals.
- Accepted sources, event families, subject types, and required fields.
- Short examples of events that should and should not route.
- Primary action type and risk/autonomy level.
- Required connector availability.
- Ambiguity/no-match policy, fan-out policy, and lifecycle events Hermes should expect.
- Current cooldown/concurrency state.
- Routing contract version and LoopSpec hash.

Routing cards are dynamically fetched from Loopgraph. Adding a new loop updates the routing catalog without adding a new Hermes webhook route unless the loop requires a previously unseen external event source.

### 6.13 Add `RoutingDecision`

Hermes returns a schema-constrained decision:

```text
RoutingDecision
  eventId
  catalogVersion
  action: route | append_evidence | ignore | defer | request_human | unhandled
  existingProblemId?
  problem
    summary
    problemTypes[]
    subject { type, id }
    severity
    dedupeKeyInputs[]
  selectedRoutes[]
    loopId
    role: primary | supporting
    confidence
    reasonSummary
    evidenceRefs[]
    inputMapping
    priority
  alternatives[]
  fanoutReason?
  modelMetadata
  policyVersion
```

The reason summary is concise and evidence-linked; it is not hidden chain-of-thought.

### 6.14 Add `BusinessProblem`

Make the problem—not the webhook delivery—the durable unit of business work:

```text
BusinessProblem
  id
  workspaceId
  companyId
  problemType
  subject { type, id }
  summary
  severity
  status: detected | needs_human | routed | in_progress | waiting | resolved | closed | unhandled
  correlationId
  dedupeKey
  evidenceEventIds[]
  primaryLoopId?
  supportingLoopIds[]
  routeCommitIds[]
  owner?
  slaDueAt?
  outcomeRefs[]
  openedAt
  updatedAt
  resolvedAt?
```

Hermes may propose the type, subject, severity, and ingredients for a dedupe key. Loopgraph must canonicalize and validate them against the routing contract. The final key should normally derive from workspace, canonical problem type, stable subject ID, and the loop's repeat-window policy.

When another event has the same open-problem key, Loopgraph appends evidence and re-evaluates only if the new evidence changes severity, eligibility, or the declared repeat policy. It does not silently start another run. A resolved problem can reopen only when its contract explicitly allows it. An event with multiple genuinely independent problems creates separate problem records sharing the original correlation ID.

Appending evidence does not silently mutate a running loop's inputs. A routing contract must declare whether a running loop accepts incremental evidence; otherwise the event is attached to the problem timeline for the next assessment, review, or retry. A new route for an already open problem is allowed only through an explicit escalation, retry, supporting-loop, or reroute policy.

The submitted routing decision should atomically create or update the problem, bind accepted routes, and enqueue permitted runs. This gives the UI and Hermes one statusful record to follow from detection to verified outcome.

### 6.15 Add durable routing records

Add:

- `EventReceipt`: immutable normalized event plus hashes and ingest status.
- `RoutingAttempt`: every Hermes routing attempt, including validation failures.
- `RouteCommit`: accepted event-to-loop binding and resulting job/run ID.
- `UnhandledBusinessProblem`: a view/state of `BusinessProblem` with recurrence count, owner, and suggested discovery action when no loop can own it.
- `RoutingCorrection`: human feedback that the event should have routed differently.
- `RouterEvaluation`: expected versus actual routes for test fixtures and shadow traffic.

These records should live in file storage locally and behind the existing storage abstraction for database mode.

## 7. Question system

The user asked for a few questions. The product should use five compact conversational bundles, not a 30-field form. Each bundle can collect several structured values and branch only when a missing answer would materially change the loop.

### 7.1 Automatic project context, confirmed by the user

Before the five bundles, Loopgraph may inspect safe manifests and propose:

- Current application stack.
- Databases and analytics libraries.
- Existing integrations suggested by package names or config filenames.
- Deployment/runtime hints.
- Existing LoopSpecs and `.loopgraph` state.

Ask: “I detected Next.js, TypeScript, Supabase, and PostHog. Is that accurate, and which business systems are the source of truth?”

Never infer credentials, account IDs, business policy, or approval authority from code.

### 7.2 The five universal question bundles

#### Bundle 1: Current stack and sources of truth

Ask:

> What tools does this department use today, where is the source of truth, and which inputs can Loopgraph safely read?

Capture:

- Systems and providers.
- Source-of-truth system per key object.
- Data availability/freshness.
- Manual files or exports available as fallback.
- Existing automations that must not be duplicated.

#### Bundle 2: Biggest recurring problem

Ask:

> What recurring work creates the most delay, manual context gathering, rework, missed follow-up, or quality risk?

Capture:

- One to three processes.
- Trigger/cadence.
- Approximate weekly volume.
- Current owner and reviewer.
- Current input, steps, and output.
- Pain type and severity.
- Baseline time/cycle time/error rate if known.

#### Bundle 3: What would be useful to automate

Ask:

> What would be useful for AI to monitor, prepare, recommend, or execute—and what must it never do on its own?

Capture:

- Desired automation mode.
- Candidate outputs/actions.
- Read-only versus draft versus approved write.
- Customer-facing status.
- Financial, brand, employment, legal, privacy, or security boundaries.

#### Bundle 4: Ideal outcome and proof

Ask:

> If this worked ideally, what would improve, how would we know the output is good, and what should not get worse?

Capture:

- Primary outcome metric.
- Leading indicator.
- Guardrail metric.
- Baseline and target if known.
- Verification rules and evidence requirements.
- Minimum sample size or confidence rule when applicable.

#### Bundle 5: Ownership and rollout

Ask:

> Who owns the loop, who approves risky outputs, when should it escalate, and how cautiously should it start?

Capture:

- Loop owner role.
- Reviewer/approver roles.
- Escalation conditions and SLA.
- Initial autonomy level.
- Pilot scope and review budget.
- Preferred daily/weekly management summary.

### 7.3 Follow-up policy

Ask a follow-up only when one of these is unresolved:

- No measurable goal or verification condition.
- No owner for the loop or a risky action.
- A required input has no source or manual fallback.
- A customer-facing, financial, legal, employment, security, or destructive action lacks explicit approval policy.
- Two candidate loop designs differ materially based on the missing answer.
- The user asked for execution but only discovery readiness is available.

Default maximum: three follow-ups per selected department before generating a draft. Remaining uncertainty becomes a visible assumption or blocker.

### 7.4 Routing-contract questions

For Hermes to choose the right loop later, loop discovery must capture more than cadence. Ask these fields inside the existing bundles rather than adding another long interview:

1. **Problem signal:** What event or change tells us this business problem may exist?
2. **Source and subject:** Which system sends it, and what stable entity does it concern: campaign, account, ticket, invoice, candidate, repository, contract, or another object?
3. **Required evidence:** Which event fields must be present before this loop is a valid candidate?
4. **Ignore conditions:** Which similar events are noise, expected behavior, test data, already resolved, or explicitly out of scope?
5. **Urgency and priority:** How quickly must the problem be handled, and which problem wins when several appear together?
6. **Repeat policy:** Should repeated events update the same open run, be ignored during a cooldown, or create a new run?
7. **Ambiguity policy:** Should Hermes ask a human, defer, or route to management when two loops look equally appropriate?
8. **Fan-out policy:** May one event trigger multiple independent loops, and if so what is the maximum and required order?
9. **Completion signal:** Which output or downstream event proves the problem was handled?
10. **Failure signal:** Which failure, timeout, or rejected review should return to Hermes for a different response?

The user does not need to know webhook field names during the first interview. After selecting a connector, Loopgraph maps these business answers onto the provider's concrete event schema and asks only for unresolved mappings.

Current implementation status: the shared Hermes/browser question bundles now include these routing-contract fields inside the existing five-bundle interview. The deterministic design fallback compiles the answers into proposal routing policy, including positive and negative examples, ambiguity policy, fan-out policy, repeat/cooldown behavior, completion/failure lifecycle events, and the assumptions Hermes should see before routing events.

### 7.5 Department-specific branches

The branch questions below supplement the universal bundles.

#### Marketing

1. Which motions should be included: paid ads, content creation, lifecycle/email, SEO, events, partnerships, or another motion?
2. For paid ads, which platforms contain spend and campaign data, and which downstream system defines a qualified lead/customer?
3. For content, where do ideas and evidence come from, which formats/channels are required, and where are drafts reviewed and published?
4. Which proxy metrics should the loop distrust when qualified conversion, activation, retention, or revenue quality disagrees?
5. Which spend changes, claims, brand language, publishing actions, or audience changes require approval, and what are the thresholds?

#### Sales

1. Which CRM stages, lead queues, buyer signals, email/calendar systems, and qualification fields are authoritative?
2. Where does seller time disappear: account research, qualification, follow-up, forecasting, proposal preparation, or CRM hygiene?
3. What makes a lead qualified and what evidence must support an opportunity or forecast change?
4. Which customer messages may be drafted, and which pricing, negotiation, commitment, or send actions must remain human-owned?
5. Which metric best proves value: response latency, qualified lead rate, opportunity conversion, stage velocity, forecast accuracy, or seller relationship time?

#### Product

1. Where do feedback, usage signals, support tickets, research notes, and roadmap decisions live?
2. Which recurring work is most painful: feedback clustering, discovery prep, spec-to-ticket translation, release learning, or roadmap evidence review?
3. What evidence is required before a theme becomes a product problem or a spec becomes a ticket?
4. Who owns prioritization and which roadmap or scope changes must never be automated?
5. Which outcome proves success: decision cycle time, spec clarity/rework, adoption, release outcome, or evidence coverage?

#### Engineering

1. Which repositories, issue trackers, CI systems, incident systems, and environments are in scope?
2. Which work should be improved: issue triage, PR review preparation, QA planning, release readiness, incident learning, or bug clustering?
3. What checks are mandatory before a recommendation, merge, release, or incident closure?
4. Which actions can remain drafts, and which code, merge, deploy, rollback, or production operations require explicit approval?
5. Which metrics matter: lead time, PR cycle time, escaped defects, incident recurrence, test coverage, or review burden?

#### Customer Success

1. Which product-usage, support, CRM, renewal, meeting, and health-score systems are authoritative?
2. Which recurring work needs help: health monitoring, renewal-risk preparation, QBR preparation, ticket escalation, or knowledge-base maintenance?
3. Which signals actually predict risk, and which false-positive signals should be discounted?
4. Which customer communications, commitments, discounts, renewal actions, or escalations require human ownership?
5. Which outcomes matter: renewal risk, support response/resolution, CSAT, QBR quality, or CSM relationship time?

#### Ops / Finance

1. Which finance, billing, spreadsheet, database, procurement, and approval systems contain authoritative records?
2. Which recurring work needs help: approval bottlenecks, invoice variance, cash collection, forecast variance, or allocation review?
3. What numeric tolerance or policy distinguishes a normal variance from an exception?
4. Which payment, collection, budget, vendor, or allocation actions must be blocked or approved?
5. Which outcomes matter: approval latency, invoice cycle time, forecast accuracy, variance resolution, transaction cost, or audit readiness?

#### HR / Talent

1. Which ATS, HRIS, onboarding, performance, learning, and calendar systems are approved data sources?
2. Which recurring work needs help: candidate pipeline, onboarding progress, review preparation, manager coaching, or engagement-risk preparation?
3. What sensitive or protected data must be excluded from model context and traces?
4. Which ranking, rejection, hiring, compensation, performance, discipline, or employment decisions must remain human and policy reviewed?
5. Which outcomes matter: time to hire, candidate experience, onboarding completion, manager coaching time, or human-reviewed retention risk?

#### Legal / Compliance

1. Which contract, policy, control, evidence, access-log, questionnaire, and security systems are authoritative?
2. Which work needs help: policy drift, questionnaire drafting, contract risk triage, compliance evidence, or access review?
3. Which approved sources may support an answer, and what freshness/provenance rules apply?
4. Which legal interpretations, risk acceptance, exceptions, contract changes, or access decisions require expert approval?
5. Which outcomes matter: review cycle time, exception resolution, audit readiness, valid risk detection, expert review burden, or false positives?

#### Management

1. Which operating cadence, OKR, dashboard, finance, project, and decision systems are authoritative?
2. Which daily or weekly decisions and cross-functional bottlenecks should the management loop surface?
3. Which department loops, metrics, access blockers, reviews, cases, and improvements should roll up?
4. Which priority, staffing, budget, legal, customer, or resource decisions require an accountable leader?
5. Which outcomes matter: decision latency, dependency age, experiment throughput, OKR drift, allocation cycle time, recurring issues, or trace-supported decisions?

#### Custom

1. What recurring work item enters the loop, and what event or cadence starts it?
2. What must the loop observe, and which sources are trusted?
3. What may it prepare or do, and which actions are forbidden?
4. How is output verified, who owns judgment, and when does it escalate?
5. Which outcome and hidden-labor metrics determine whether the loop is worth keeping?

## 8. High-reasoning design pipeline

### 8.1 Preserve a deterministic spine

The model should not design from an empty prompt. The pipeline should be:

1. Validate confirmed answers.
2. Compile company, department, process, and goal projections from answers.
3. Generate deterministic blueprint candidates and connector/metric/human requirement drafts.
4. Build a bounded `LoopDesignContext`.
5. Ask a high-reasoning planner to synthesize, combine, split, or reject candidates.
6. Parse the structured result.
7. Run schema validation.
8. Run governance and semantic validation.
9. Run duplicate/conflict checks against existing loops.
10. Perform at most one model repair pass using validation diagnostics.
11. If still invalid, return blockers without writing files.
12. Present the validated design for human acceptance.

The deterministic candidate generator remains useful as a fallback when no model is configured and as evidence for why the model proposed a loop.

### 8.2 Add a separate design-provider contract

Do not reuse `AssessmentProvider`. Runtime assessment and loop architecture have different inputs, outputs, risk, and prompt versions.

Add:

```text
LoopDesignProvider.design(context, options) -> LoopDesignProposalSet
```

Options include:

- `reasoningProfile`: standard or high.
- Maximum proposals.
- Whether novel designs outside the blueprint catalog are allowed.
- Provider mode: `hermes_host` or embedded.
- Redaction policy.
- Timeout and repair-attempt limit.

### 8.3 Support two reasoning modes

#### Hermes-hosted mode

The Hermes skill obtains a model-ready design context and output schema through MCP. Hermes uses its configured high-reasoning model, then submits structured proposals to Loopgraph for validation.

Benefits:

- No second model credential is needed.
- The user stays in one Hermes conversation.
- Hermes can use relevant repository context already in the session.

Constraint:

- Loopgraph cannot independently guarantee the Hermes model or hidden reasoning settings. Record the Hermes session and model metadata when supplied and show “high reasoning requested” rather than making an unverifiable claim.

#### Embedded mode: recommended for the browser

Loopgraph invokes a configured provider directly. The provider adapter maps the abstract `high` reasoning profile to provider-specific settings and records the actual model configuration in `DesignRun`.

The browser must also support deterministic-only mode so the open-source local flow remains usable without an API key.

### 8.4 Design validation rules

Reject or block materialization when:

- A loop has no goal, owner, trigger, work item, verifier, or metric.
- A required context source has neither a connector nor a manual fallback.
- A risky action has no approval rule.
- A customer-facing action is treated as internal-only.
- A forbidden company action appears in allowed actions.
- A primary metric is undefined and presented as observed.
- A proposal duplicates an existing loop without an explicit merge/replacement plan.
- A proposal claims a connector is ready when health has not passed.
- A child workflow references a nonexistent parent loop.
- The topology preview includes edges that overclaim executability.

### 8.5 Runtime routing reasoning is separate from design reasoning

The high-reasoning design provider creates loops and routing contracts. The Hermes runtime router handles individual events. They must use separate prompts, schemas, evaluation datasets, and model profiles.

Runtime routing should be optimized for bounded, reliable decisions:

1. Hermes receives a narrow normalized event, never the unrestricted raw payload by default.
2. Loopgraph returns a small eligible candidate set.
3. Loopgraph returns a bounded advisory learning context compiled from scoped routing evaluations, human corrections, observed outcomes, net value, and subject history. The context cannot expand eligibility or authority.
4. Exact high-confidence events may use a fast routing profile.
5. Ambiguous or high-impact events may use a stronger reasoning profile.
6. Low-confidence decisions request human choice rather than guessing.
7. The router never modifies a loop definition during an event turn.
8. An event with no safe match becomes an unhandled business problem, not an excuse to call an arbitrary tool.

This separation prevents a noisy webhook from entering the expensive loop-design workflow and prevents the design workflow from becoming the execution authority.

## 9. Hermes Agent integration

### 9.1 Build one Loopgraph MCP server

Add a package-safe stdio MCP server first. HTTP transport can follow after local correctness.

Implemented read/admin tools:

- `loopgraph_workspace_inspect`
- `loopgraph_departments_list`
- `loopgraph_discovery_get`
- `loopgraph_discovery_next_questions`
- `loopgraph_design_context_get`
- `loopgraph_connections_plan`
- `loopgraph_loops_list`
- `loopgraph_graph_get`
- `loopgraph_runs_get`
- `loopgraph_routing_catalog_get`
- `loopgraph_events_get`
- `loopgraph_problems_get`
- `loopgraph_routing_decision_get`
- `loopgraph_route_jobs_get`
- `loopgraph_routing_evaluations_get`
- `loopgraph_lifecycle_events_get`

Implemented local-write/operator tools:

- `loopgraph_discovery_start`
- `loopgraph_discovery_select_departments`
- `loopgraph_discovery_submit_answers`
- `loopgraph_design_submit`
- `loopgraph_recommendation_set_status`
- `loopgraph_loops_materialize`
- `loopgraph_connections_set_manual_fallback`
- `loopgraph_events_ingest`
- `loopgraph_routing_decision_submit`
- `loopgraph_routing_human_choice_submit`
- `loopgraph_routing_evaluation_run`
- `loopgraph_events_replay`
- `loopgraph_route_commit_simulate`

Implemented safe runtime tools:

- `loopgraph_loops_validate`
- `loopgraph_loops_simulate`
- `loopgraph_review_submit`
- `loopgraph_case_resolve`

Current implementation status: these safe runtime tools are exposed through the project-bound Loopgraph MCP server for Hermes. They reuse the same LoopSpec loader, simulation runtime, file trace store, review service, case service, and lifecycle callback emitter as the CLI, and they do not expose unrestricted live execution.

Current implementation status: the MCP server now exposes project-bound resources in addition to tools. Hermes can list/read canonical department resources, live discovery-session resources, registered loop resources, the Hermes Company Brain graph projection, and schema resources for `LoopDesignContext`, `LoopDesignProposalSet`, `EventEnvelope`, `RoutingCard`, and `RoutingDecision`. The server advertises `resources` capability during initialize, and `loopgraph hermes doctor` verifies the required static resource URIs before marking the MCP integration healthy.

Current implementation status: the Hermes-facing routing MCP schemas no longer accept caller-supplied `routingCards`, `specPaths`, or catalog-version overrides. Loopgraph derives the active routing catalog from the bound project workspace on ingest and decision submission; synthetic catalogs are available only through trusted internal evaluation options. This prevents a webhook-triggered Hermes turn from smuggling stale or forged routing cards into route validation.

`loopgraph_runs_get` is also exposed as a read-only project-bound tool. It returns safe run summaries, prepared-action fingerprints, redacted payload previews, reviews, and escalation context so Hermes can explain or review a local run without reading raw trace files directly.

`loopgraph_route_commit_simulate` is exposed for trusted local/operator turns, not untrusted webhook turns. It takes a validated route commit, rebuilds a simulation fixture from the stored normalized EventEnvelope, runs the selected LoopSpec in simulation mode, persists the trace, and writes the resulting `runId` back to the route commit.

Current implementation status: accepted Hermes route decisions now prepare signed, notification-only `loop.route.accepted` EventEnvelopes in the local lifecycle outbox. Route-commit simulation also prepares signed `loop.run.started`, optional `loop.escalation.created`, and terminal run lifecycle callbacks. Resolving a Hermes-routed escalation case through the CLI, browser, or `loopgraph_case_resolve` updates the durable business problem and prepares a signed `loop.outcome.recorded` callback. Hermes can inspect these callbacks with `loopgraph_lifecycle_events_get`, and the event-routing graph shows Loopgraph callbacks flowing back to Hermes Brain.

Current implementation status: accepted non-shadow route commits now create deterministic durable `RouteJob` records under `.loopgraph/routing/jobs`. Hermes or an operator can inspect them with `loopgraph_route_jobs_get`. The file-backed route job model records queued, claimed, running, waiting-review, completed, failed, dead-letter, and cancelled states, with leases, retry policy, exponential backoff, max attempts, correlation IDs, and idempotent event/loop/spec run keys.

`loopgraph_routing_decision_submit` performs route validation, creates or updates the durable business problem, and atomically creates the permitted job bindings; Hermes does not need a second unrestricted “run this loop” routing tool. Do not expose unrestricted live execution in the first MCP release. Add it only after per-action approval and connector policy can be represented by the Hermes profile.

MCP resources:

- `loopgraph://departments/{departmentType}`
- `loopgraph://discovery/{sessionId}`
- `loopgraph://schemas/loop-design-context`
- `loopgraph://schemas/loop-design-proposal-set`
- `loopgraph://loops/{loopId}`
- `loopgraph://graph/company`

MCP implementation constraints:

- Bind to one explicit project root.
- Validate every input and output with exported core schemas.
- Use stdout only for protocol messages and stderr for logs.
- Do not return secrets, raw credential values, or unrestricted file contents.
- Make write tools idempotent with request IDs and expected session revisions.
- Return typed error codes that the skill can explain.

Current implementation status: the MCP server supports an admin/design exposure by default plus restricted `webhook_router` and `lifecycle_router` exposures. Webhook-triggered Hermes turns can list and call only the bounded routing tools and routing schema resources, while trusted local/admin turns keep discovery, design, materialization, local simulation, review, and operations tools.

Current implementation status: the MCP dispatcher enforces the installed project binding for every tool call. When the server is started with `--project`, any `projectRoot` supplied inside a Hermes tool-call argument is overwritten with the bound root before dispatch, so webhook-triggered or conversation-triggered calls cannot redirect reads or writes into another local workspace.

### 9.2 Create the Hermes Loopgraph design skill

Package a standards-compatible `SKILL.md` with supporting references:

```text
integrations/hermes/loopgraph/
  SKILL.md
  references/
    discovery-flow.md
    proposal-schema.md
    safety-and-approvals.md
  examples/
    marketing-ads-content.md
```

The skill should teach Hermes to:

- Start/resume discovery through MCP.
- Present canonical departments rather than inventing them.
- Ask only the next supplied question bundle.
- Confirm detected context.
- Request high reasoning for the design step.
- Submit structured proposals for validation.
- Show rationale, assumptions, connections, and required user actions.
- Ask for explicit acceptance before materialization.
- Default to simulation and never silently enable live writes.

Current implementation status: `loopgraph hermes install` now writes project-local standards-compatible skills under `.loopgraph/hermes/skills`: the `loopgraph` discovery/design skill, the separate `loopgraph-event-router` webhook-routing skill, design references for discovery flow, proposal shape, safety/approvals, a Marketing Ads + Content Creation example, and router references/examples for normalized event routing. The generated skills point Hermes at Loopgraph MCP resources for canonical schemas, departments, sessions, loops, and the Company Brain graph. `loopgraph hermes doctor` verifies both skills and their supporting assets before reporting the project-local integration as installed.

### 9.3 Hermes installation

Hermes supports local stdio MCP servers and standards-compatible skills. The installer should:

1. Confirm `hermes` is available.
2. Add the Loopgraph MCP server with an absolute executable path and the selected project root.
3. Install or link the Loopgraph skill.
4. Avoid editing global configuration unless the user chose user scope.
5. Run `hermes mcp test loopgraph` or the equivalent health check.
6. Print the exact first prompt to start discovery.

Target UX:

```text
loopgraph hermes install --project . --scope user
loopgraph hermes doctor --project .
hermes chat -q "/loopgraph design automations for a department"
```

Hermes also discovers project context files, but the Loopgraph workflow should live in a skill so it is loaded only when needed.

### 9.4 Hermes installation state

Store non-secret Hermes installation metadata in `.loopgraph/hermes/install.json`:

- Hermes install scope.
- MCP server version.
- Skill version.
- Project-root hash.
- Last successful health check.
- Capabilities available.

Never assume that a written config means a working integration; the doctor command must start the server, initialize MCP, list core tools, and make a read-only workspace call.

### 9.5 Use Hermes's webhook gateway as the only public event ingress

Hermes already supports route-specific webhook endpoints, event allowlists, HMAC or provider-specific signature verification, declarative filters, transform scripts, skill loading, delivery targets, rate limits, body-size limits, and delivery deduplication. Use that native gateway instead of building a competing public webhook server in Loopgraph.

Recommended route behavior:

- One Hermes webhook route per external provider/account event family, not one route per Loopgraph loop.
- Route-specific secret and event allowlist.
- Narrow filters to remove irrelevant events before a Hermes routing turn.
- A transform script that emits the normalized envelope fields and drops unrelated payload data.
- `skills: ["loopgraph-event-router"]`.
- A restricted webhook toolset containing only Loopgraph routing MCP tools and approved delivery tools.
- `deliver: log` for initial shadow mode, then Slack/Telegram/email or another configured human channel for exceptions.

Example conceptual route:

```text
platforms.webhook.extra.routes.hubspot-company-events
  events: [deal.propertyChange, contact.propertyChange]
  secret: stored by Hermes
  filters: only relevant lifecycle fields
  script: normalize-hubspot-event.py
  skills: [loopgraph-event-router]
  deliver: log
```

Do not use an empty prompt or `{__raw__}` for business routing. Provider payload text is untrusted even when the signature is valid.

### 9.6 Add a `loopgraph-event-router` Hermes skill

This is separate from the loop-design skill. It must instruct Hermes to:

1. Parse only the supplied normalized event envelope.
2. Call `loopgraph_events_ingest` immediately to obtain a durable receipt, eligible routing cards, and any matching open-problem candidates.
3. Return early when Loopgraph reports a duplicate or ignored event.
4. Decide whether the event is new evidence for an existing problem or represents a new problem, using only the bounded evidence and candidates.
5. Classify the business problem using only the event evidence and eligible cards.
6. Produce a `RoutingDecision` with confidence and alternatives.
7. Call `loopgraph_routing_decision_submit`.
8. Never bypass a rejected decision by calling terminal, file, connector, or implementation tools.
9. If Loopgraph requests human choice, deliver the bounded alternatives to the configured owner.
10. If no loop matches, create an unhandled-problem record and stop.

Webhook-triggered Hermes sessions should use a dedicated profile with no general terminal, file-write, browser, or unrestricted MCP tools. This is essential because webhook fields may contain prompt-injection text.

Do not route all business events through one accumulating chat transcript. Use an isolated routing turn per event or correlation ID, with tenant/workspace-scoped context and no unrelated personal memory. The durable EventReceipt and correlation timeline—not conversational memory—carry state between related events. This prevents one event's untrusted content or reasoning from contaminating later routing decisions.

### 9.7 Add an optional Loopgraph Hermes plugin

The MVP can use native Hermes webhook routes, transform scripts, the router skill, and Loopgraph MCP. A small Hermes plugin becomes useful for production packaging and should:

- Bundle the design and event-router skills.
- Register `hermes loopgraph install`, `doctor`, `webhooks plan`, `webhooks sync`, and `webhooks test` commands.
- Expose a restricted Loopgraph routing toolset/profile.
- Use Hermes-owned structured LLM access when a schema-bound one-shot route decision is preferable to a full conversational turn.
- Add route lifecycle logging and propagate Hermes task/session IDs into Loopgraph routing attempts.
- Avoid modifying Hermes core.

Project-local plugins are trusted code and should remain opt-in. For distribution, prefer a versioned pip entry point or user-level plugin installation.

Current implementation status: Loopgraph now ships a dependency-free native Hermes plugin under `integrations/hermes-plugin`. Hermes can install that exact subdirectory from GitHub, so its security scanner examines only the adapter and bundled design/event-router skills rather than the application's intentional prompt-injection and credential-redaction regression fixtures. Registration is offline and side-effect free. The plugin registers the `hermes loopgraph` command tree, `/loopgraph` help, both read-only skills, and an exact-phrase onboarding hook. `hermes loopgraph plan` exposes the immutable source revision, package-lock digest, intended commands, and write boundaries. The confirmed installer fetches only the full 40-character revision recorded by Hermes, rejects lock drift before dependency installation, uses `npm ci --ignore-scripts`, builds the existing Loopgraph runtime, requires a clean production audit, and delegates setup, doctor, supervisor, and route rehearsal to the existing CLI. Business tools continue to arrive through the three scoped MCP profiles; the plugin does not duplicate routing logic, accept credentials, give webhook turns general tools, modify Hermes core, or perform work during registration.

### 9.8 Webhook configuration synchronization

Creating a new loop should usually update the Loopgraph routing catalog only. It should not create another external webhook endpoint. Add a Hermes route only when the accepted loop introduces a new provider/account or event family.

Add commands/services:

```text
loopgraph hermes webhooks plan --project .
loopgraph hermes webhooks sync --project .
loopgraph hermes webhooks doctor --project .
loopgraph events test --source hubspot --fixture event.json
```

The plan command derives required provider event sources from accepted LoopSpecs and connector manifests, and always includes the dedicated `loopgraph-lifecycle-events` route for signed Loopgraph callbacks. The sync command uses Hermes's dynamic subscription/config surfaces after user confirmation. Store only non-secret route metadata in `.loopgraph/hermes-routes.json`; secrets remain in Hermes configuration or its credential store.

Current implementation status: `loopgraph hermes webhooks plan` derives non-secret Hermes provider route families from registered routing contracts and includes the dedicated `loopgraph-lifecycle-events` route with a notification-only toolset. `loopgraph hermes webhooks sync` writes/merges the project-local `.loopgraph/hermes-routes.json` manifest, and `loopgraph hermes webhooks doctor` verifies that the manifest still matches the current routing catalog plus lifecycle route. Sync preserves unrelated external route references in sanitized form, removes stale Loopgraph-managed route entries from the manifest, refuses secret-like serialized values, and is also exposed to Hermes as `loopgraph_hermes_webhooks_sync` for explicit operator/design turns. Doctor is exposed as `loopgraph_hermes_webhooks_doctor`, reports missing, stale, and unexpected Loopgraph-managed route entries, and proves re-sync is idempotent. `loopgraph hermes webhooks test`, `loopgraph hermes events test`, and the compatibility alias `loopgraph events test` now load a synthetic or redacted normalized fixture, verify that it matches a planned Hermes route family, optionally require the synced manifest to be current, and run the durable local shadow routing path. The same fixture test is exposed to Hermes as `loopgraph_hermes_webhooks_test` for explicit operator/design turns. `/api/webhooks/github` no longer executes workflows directly; it is a migration forwarder to Hermes only and rejects direct use when `HERMES_WEBHOOK_URL` is absent. These commands and routes do not create live provider subscriptions, send provider webhooks, execute loops directly from public ingress, or store provider secrets; applying the manifest to real Hermes routes remains a Hermes-owned/configured step.

The doctor command checks:

- Hermes gateway health.
- Required route existence and event allowlists.
- Signature configuration without revealing secret values.
- Transform-script version.
- Router skill and Loopgraph MCP availability.
- Routing catalog compatibility.
- A signed synthetic event from ingress through a shadow routing decision.

## 10. Connection planning and connector delivery

### 10.1 Separate Hermes setup from business-data connections

The Hermes connection enables the design conversation and event routing. It does not connect Google Ads, HubSpot, Notion, or any company system by itself.

Every proposed loop must show:

- Required business signals.
- Which connector category/provider could supply each signal.
- Required read and write capabilities.
- Whether a compatible connection is connected, degraded, missing, or using manual fallback.
- What the loop can do at its current readiness level.

### 10.2 Department connector matrix

| Department | Common read connectors | Common draft/write connectors | Mandatory controls |
|---|---|---|---|
| Marketing | Ads platforms, analytics, CRM, CMS, content repository, product/billing quality data | Draft docs, experiment tracker, CMS draft, social/email draft | Budget threshold, claims/brand review, no unapproved publish or spend change |
| Sales | CRM, enrichment, email, calendar, call notes | CRM draft/update, follow-up draft, task creation | No unapproved send, pricing, negotiation, or commitment |
| Product | Support, research repository, analytics, ticketing, roadmap, GitHub | Draft spec/ticket, research brief | No autonomous prioritization or roadmap change |
| Engineering | GitHub, issue tracker, CI, incidents, observability | Draft issue/PR review/QA plan, approved label/comment | No auto-merge/deploy/production action in initial rollout |
| Customer Success | Usage, support, CRM, renewal, calendar | Risk packet, QBR draft, support/customer draft | Customer commitment and send approval |
| Ops / Finance | Billing, finance, ERP, spreadsheet, database, approvals | Variance packet, reminder draft, approved task | No autonomous payment, collection, budget, or vendor commitment |
| HR / Talent | ATS, HRIS, onboarding, calendar, approved survey data | Draft recruiter/manager task, evidence packet | Sensitive-data minimization; no automated employment decision |
| Legal / Compliance | Contract repository, policy store, evidence DB, access logs, questionnaire system | Draft response/risk/evidence packet | Expert review; no risk acceptance or access decision |
| Management | Loopgraph traces/reviews/cases/metrics, OKR, finance, project systems, Slack | Decision memo, owner reminder, improvement item | Leadership approval for priorities, staffing, budget, and resource changes |

### 10.3 Marketing MVP connector set

For the reference flow, deliver capability in this order:

1. Manual JSON/CSV/file import adapter for every required signal.
2. Loopgraph trace/storage adapter for generated outputs and outcomes.
3. Ads read capability: provider-specific implementations can start with Google Ads and one additional major platform, but the loop depends on the `ads` capability, not a provider name.
4. Analytics read capability.
5. CRM read capability for qualified lead/customer outcome.
6. Content repository read plus draft write, such as Notion, Google Drive/Docs, or a local Markdown directory.
7. CMS draft capability; publishing remains approval-gated.
8. Messaging/review notification capability.

The first usable marketing demo should work completely with fixture/manual adapters. Real OAuth must not block loop design or simulation.

### 10.4 Credential handling

- Store only credential references in `.loopgraph`.
- Prefer OS keychain, Hermes credential store, or provider OAuth token store.
- Allow environment variables for development but never serialize them into sessions, traces, LoopSpecs, graph metadata, or model prompts.
- Scope credentials per connection instance and request minimum read scopes first.
- Require a separate explicit upgrade for write scopes.
- Redact connector errors before returning them to Hermes.

### 10.5 Add webhook capabilities to connector manifests

Each connector that can emit events should declare:

- Provider event types and subscription mechanism.
- Hermes route name template.
- Signature/authentication type.
- Safe event filters.
- Normalization transform version and output schema.
- Stable delivery-ID header or field.
- Subject-ID mapping.
- Maximum payload size and expected burst rate.
- Subscription renewal requirements.
- Example synthetic events.

Separate event intake from data access. A HubSpot webhook may tell Hermes that a deal changed, while the selected Sales loop still needs a read connector to load the authoritative deal context. Receiving an event does not imply permission to read or write the provider.

For sources without useful webhooks, add a poller or scheduled detector that emits the same `EventEnvelope` into Hermes. Do not create a second routing path just because the source is polled.

## 11. Loop materialization

### 11.1 Materialize a proposal set atomically

When the user accepts Ads and Content Creation together:

1. Revalidate the session revision and proposal hashes.
2. Convert both proposals to LoopSpecs in memory.
3. Validate schemas, policies, metrics, owners, access, parent references, and duplicate IDs.
4. Write both to a temporary workspace transaction directory.
5. Register both specs.
6. Update session proposal statuses and created loop IDs.
7. Rebuild topology.
8. Commit the transaction or leave the previous workspace unchanged.

Avoid a state where Ads appears in the graph while Content Creation failed to write.

### 11.2 Preserve design provenance in LoopSpec

Add safe metadata or `studioExtension.discovery` fields:

- Discovery session ID and revision.
- Design run ID and proposal ID.
- Source process and answer IDs.
- Reasoning summary and assumptions.
- Required connection IDs/capabilities.
- Initial rollout level.
- Proposal schema version.
- Routing contract version, problem types, accepted event families, exclusions, and examples.

Do not include the full model prompt or private reasoning.

Materialization must also compile and index a `RoutingCard`. The loop is not eligible for Hermes routing until both the LoopSpec and routing card validate. Updating a LoopSpec invalidates the old routing card by spec hash and requires recompilation before the new version becomes active.

### 11.3 Emit lifecycle events back to Hermes

Loopgraph should emit signed internal events for:

- `loop.route.accepted`
- `loop.run.started`
- `loop.review.required`
- `loop.run.completed`
- `loop.run.failed`
- `loop.escalation.created`
- `loop.outcome.recorded`
- `loop.problem.unhandled`

These events enter a dedicated Hermes route with a Loopgraph-specific secret and narrow schema. They let Hermes notify humans or choose a safe follow-on loop.

Prevent routing cycles:

- Increment `hopCount` on every follow-on event.
- Carry correlation and causation IDs.
- Enforce maximum route depth and maximum escalation re-entry.
- Do not allow a loop's completion event to re-trigger the same loop unless the routing contract explicitly permits re-entry.
- Apply per-correlation loop-visit limits.
- Mark notification-only lifecycle events so they cannot trigger business loops.

Current implementation status: Loopgraph emits signed `loop.route.accepted` callbacks when the Hermes-facing decision tool validates and commits a route, emits signed `loop.run.started` callbacks when a trusted route-commit simulation creates a run trace, emits signed `loop.escalation.created` callbacks when that trusted run creates an escalation case, emits signed `loop.outcome.recorded` callbacks when a Hermes-routed case resolution records the verified outcome, and emits signed `loop.run.completed`, `loop.review.required`, `loop.run.failed`, and `loop.problem.unhandled` callbacks from trusted route-commit simulation into `.loopgraph/routing/lifecycle`. The emitted EventEnvelope carries `notificationOnly: true`, correlation/causation IDs, hop count, route commit ID, problem ID, loop ID, route/run status, run ID when a run exists, escalation case metadata when review is needed, and outcome metadata when a case is resolved. Lifecycle events from Loopgraph or notification-only source events are skipped so Hermes does not recursively trigger the same loop.

### 11.4 Generated file layout

Recommended local layout:

```text
.loopgraph/generated/{companyId}/{departmentType}/{loopId}/loopgraph.yaml
```

Optionally support an export command that copies accepted specs into a version-controlled `loops/` directory. Keep generated session state and runtime traces out of version control by default, while making approved LoopSpecs easy to commit.

## 12. Graph logic and visualization changes

### 12.1 Add explicit graph projections

#### Design projection

Default after materialization:

```text
Hermes Brain (Company Brain)
  -> Marketing
       -> Ads
       -> Content Creation
```

Characteristics:

- Hides the synthetic Company Management Loop.
- Identifies Hermes as the event-routing runtime behind Company Brain.
- Uses short department and loop labels.
- Shows planned/missing connectors as optional satellite nodes or inspector requirements.
- Uses a layered hierarchy layout.
- Focuses on what was just created.

#### Operating projection

Retains the governance hierarchy:

```text
Business Event Sources
  -> Hermes Brain
       -> Company Management Loop
            -> Marketing Department Loop
                 -> Ads
                 -> Content Creation
```

It can also show webhook health, recent routing decisions, metrics, reviews, escalation cases, improvements, traces, and connector health.

#### Event routing projection

For one actual event:

```text
Webhook Source
  -> Event Receipt
       -> Business Problem
            -> Hermes Routing Decision
                 -> selected Ads Loop -> Run -> Outcome
                 -> rejected Content Creation alternative
```

The inspector shows contributing events, the normalized durable problem, eligible candidates, selected route, confidence, evidence, alternatives, Loopgraph validation, resulting run, verified outcome, and human corrections.

#### Governance projection

The full organizational view remains available:

```text
Hermes Brain
  -> Company Management Loop
       -> Marketing Department Loop
            -> Ads
            -> Content Creation
```

This hierarchy supports rollups and escalations but is not the primary event-routing visualization.

#### Loop logic projection

For one loop:

```text
Trigger -> Observe -> Assess/Prepare -> Verify -> Human Review -> Approved Action
                                      -> Escalation -> Trace -> Improvement
```

This view explains how the loop runs; it is different from organizational containment.

### 12.2 Do not change semantic truth merely for presentation

Keep the synthetic management loop in semantic topology because it supports rollups and escalation. Add a projection/adapter layer that can hide it and synthesize a display-only Company -> Department edge. Mark that edge as structural and non-executable.

### 12.3 Add graph projection options

Add options such as:

- `projection`: design, operating, or loop_logic.
- Add `event_routing` as a fourth projection.
- `layout`: hierarchy or force.
- `includeCatalogLoops`.
- `includeConnections`, `includeMetrics`, `includeReviews`, `includeImprove`.
- `focusSessionId` or `focusProposalIds`.
- `showDrafts` and `showUnaccepted`.

The Company Brain should not mix demo catalog loops into a real local workspace by default. Show catalog content only in an empty workspace or behind an explicit toggle.

### 12.4 Hierarchical layout

Use a deterministic layered layout for the design projection:

- Tier 0: Company Brain.
- Tier 1: selected departments.
- Tier 2: workflow loops.
- Tier 3, optional: connectors and metrics.

Sibling order should be stable by accepted proposal order or explicit `displayOrder`, not model output randomness. Keep the force layout as an exploration mode.

### 12.5 Edge semantics and styles

- Solid structural edge: materialized containment.
- Dashed structural edge: accepted design not yet materialized.
- Highlighted routing edge: an actual committed event-to-loop decision.
- Faint candidate edge: eligible but unselected alternative.
- Solid data edge: connected and healthy read capability.
- Dashed data edge: required but missing/manual fallback.
- Approval edge: always non-executable until a fingerprint-bound decision exists.
- Never treat a display-only Company -> Department edge as runtime orchestration.

### 12.6 Replace the hard-coded event-routing table

Build the table from:

- Active routing cards for “possible routes.”
- Event receipts and routing decisions for “actual routes.”
- Route commits and run outcomes for success/failure.
- Unhandled problems and human corrections for quality gaps.

Add columns for source, problem type, selected loop, confidence, validation state, run status, owner, latency, and correction. The current demo rows can remain only as an explicit empty-state example.

Provide a separate problem inbox grouped by durable problem ID so repeated webhook evidence does not appear as duplicated business work.

### 12.7 Inspector changes

Selecting Ads or Content Creation should show:

- Goal and design rationale.
- Trigger and routine.
- Inputs and actions.
- Verification and metrics.
- Owner and approval rules.
- Readiness and blockers.
- “What you need to connect” checklist.
- Manual fallback option.
- Validate, simulate, view runs, and review actions.

## 13. Local running model

“Run the graph locally” needs two distinct behaviors.

### 13.1 Run the visual workspace

The local studio reads the selected project root and serves discovery plus graph views. In the cloned monorepo, `npm run dev` remains available. The package CLI also provides `loopgraph studio --project ...`, which initializes the selected workspace and launches or describes the local Hermes Brain studio with `LOOPGRAPH_PROJECT_ROOT` bound to that project.

### 13.2 Run an individual workflow loop

The graph is not itself a generic executable DAG. A user runs a selected LoopSpec:

- Validate.
- Simulate using a fixture or a generated starter event.
- Inspect the trace.
- Approve/reject prepared actions.
- Execute only when live mode, connectors, and approvals are enabled.

The graph should expose a Run action that calls the same runtime API as the CLI. It must not invent graph-wide traversal from structural containment edges.

### 13.3 Generate starter fixtures

Each materialized loop should receive:

- A starter fixture schema.
- One synthetic happy-path fixture.
- One missing-context fixture.
- One risk/escalation fixture.

Fixtures must contain synthetic data and be clearly labeled. This makes every new loop locally demonstrable before integrations are connected.

### 13.4 Run routing in shadow mode before automatic triggers

Every new loop starts with `activationMode: shadow` unless the user explicitly selects a stricter manual-only mode. In shadow mode:

- Hermes receives and classifies real or synthetic events.
- Loopgraph validates and records the route it would take.
- No workflow loop starts automatically.
- A human can mark the expected loop or “no loop.”

Promote in stages:

```text
shadow -> recommend -> simulate -> execute_with_approval -> autonomous_low_risk
```

Promotion requires routing evaluation evidence, not just successful LoopSpec validation.

Add local commands/actions to:

- Send a synthetic event through the Hermes webhook route.
- Replay a stored normalized event without reusing raw secrets.
- Compare expected and actual routes.
- Commit a reviewed route in simulate mode.
- Inspect the resulting correlation trace.

Current implementation status: a trusted local operator can run `loopgraph hermes routing simulate --route-commit <id>` or call `loopgraph_route_commit_simulate` through MCP. This links the route commit to the persisted simulation trace without enabling live connector writes and prepares signed run-started, optional escalation-created, and terminal lifecycle callbacks for the dedicated Hermes `loopgraph-lifecycle-events` route.

Current implementation status: a trusted local operator can also run `loopgraph hermes routing evaluate --fixtures <file>` or call `loopgraph_routing_evaluation_run` through MCP. The evaluator persists expected-vs-actual `RouterEvaluation` records, reports precision, recall, false triggers, missed problems, abstention, duplicate suppression, and latency, and returns a shadow-to-recommend promotion gate. Hermes/operator views can inspect saved evidence with `loopgraph_routing_evaluations_get`.

## 14. Detailed implementation roadmap

### Goal 0: Lock the product contract

#### Subgoal 0.1: Write architecture decisions

- Record that core discovery is canonical and the old Design Studio becomes an editor or compatibility layer.
- Record MCP plus Hermes skills as the Hermes integration boundary.
- Record the separation between design reasoning and runtime assessment.
- Record design, operating, and loop-logic graph projections.
- Record local-first storage and explicit project-root scoping.

Acceptance:

- No implementation stream needs to invent a second department schema, question set, or separate Hermes/browser-specific workflow.

#### Subgoal 0.2: Freeze the MVP reference flow

- One company profile.
- One selected department: Marketing.
- Five question bundles plus adaptive follow-ups.
- Two accepted loops: Ads and Content Creation.
- Manual/fixture connectors sufficient for simulation.
- Hermes drives the discovery session through MCP.
- Local Company Brain shows the requested hierarchy.

Acceptance:

- A golden JSON session and expected proposal/LoopSpec/topology snapshots exist.

Current implementation status: the package runtime now includes `fixtures/golden-marketing-reference-flow.json`, a committed golden reference artifact for the Hermes-first Marketing flow. The regression test `golden-marketing-flow.test.ts` reads that JSON fixture, writes a safe local project manifest, confirms detected project context, selects Marketing, submits the five required bundles, compiles the design context, generates the deterministic high-reasoning Ads + Content Creation proposal set, materializes both accepted loops, and locks stable snapshots for the discovery session, design context, proposals, generated LoopSpecs, topology edges, routing catalog IDs, and three starter fixtures per loop.

### Goal 1: Consolidate the domain model

#### Subgoal 1.1: Canonicalize departments

- Export the core department schema through the package public API.
- Replace builder `DepartmentKey` usage or make it an alias of the core type.
- Add migration aliases.
- Update template IDs, filters, registry loading, URL handling, Supabase mapping, and tests.

Acceptance:

- Materialized Ops/Finance, HR/Talent, and Legal/Compliance loops retain their correct department in the local registry and topology.

#### Subgoal 1.2: Move discovery contracts into package-safe core

- Keep schemas under `packages/loopgraph/src/core`.
- Move reusable session services, answer compilation, candidate generation, access planning, metric planning, readiness, and materialization behind package boundaries.
- Inject filesystem/storage and skill-pack repositories rather than importing the Next app.

Acceptance:

- The package CLI and MCP server can run discovery without importing `lib/loop-engineering-builder`, Next, or Supabase.

#### Subgoal 1.3: Define migrations and schema versions

- Add a discovery schema version.
- Add parsers/migrators for old session files and workspace registries.
- Keep migrations idempotent and test fixtures for every prior shape.

Acceptance:

- Existing local demos and registered LoopSpecs still load after the consolidation.

### Goal 2: Make discovery interactive and answer-driven

#### Subgoal 2.1: Implement the discovery state machine

- Define allowed stages and transitions.
- Add optimistic revision checks.
- Add create, resume, abandon, and restart operations.
- Make every mutation idempotent.

Acceptance:

- Hermes and the browser cannot silently overwrite each other's answers; stale writes receive a structured revision error.

#### Subgoal 2.2: Implement the question-bundle engine

- Define universal bundles and department branches in versioned skill packs or question-pack files.
- Compile conditions against confirmed answers.
- Enforce follow-up budget and materialization requirements.
- Return UI metadata and plain-language prompts from the same object.

Acceptance:

- Marketing can be completed in five main turns when answers are complete.
- Missing owner or risky-action policy adds a targeted follow-up.

#### Subgoal 2.3: Compile answers into projections

- Implement `compileDiscoveryProfile(session)`.
- Map confirmed answers into company profile, department profiles, process inventory, department goals, boundaries, and connector hints.
- Preserve user-entered objects and mark inferred objects with evidence/confidence.

Acceptance:

- Changing the biggest problem, tool stack, or ideal metric deterministically changes candidate inputs and recommendation evidence.

#### Subgoal 2.4: Add project inspection

- Detect safe manifests and frameworks within the selected root.
- Add ignore rules and limits.
- Produce evidence references and confidence.
- Require user confirmation.

Acceptance:

- The detector identifies the current Loopgraph repository's Next.js, TypeScript, Supabase, and package workspace hints without reading `.env` contents.

### Goal 3: Introduce the loop-design reasoning layer

#### Subgoal 3.1: Add design schemas and provider interface

- Implement `LoopDesignContext`, `LoopDesignProposalSet`, and `DesignRun` schemas.
- Add `LoopDesignProvider` separate from `AssessmentProvider`.
- Add deterministic-only, Hermes-hosted, and embedded provider modes.

Acceptance:

- Every provider must pass shared structured-output conformance tests.

Current implementation status: `design-service` now exposes a first-class `LoopDesignProvider` contract separate from runtime `AssessmentProvider`, with normalized options for reasoning profile, proposal limits, novelty, provider mode, redaction policy, timeout, and a capped repair-attempt limit. Deterministic local fallback is implemented as `DeterministicLoopDesignProvider`, and `generateLoopDesignWithProvider` runs deterministic or embedded providers through the same schema parsing, validation, metadata capture, `DesignRun` persistence, and proposal-set storage path. Hermes-hosted mode remains the external-brain route: Hermes obtains bounded context/schema through MCP and submits structured proposals back through `submitLoopDesignProposalSet`, which now records Hermes provider metadata without claiming Loopgraph can inspect hidden Hermes reasoning.

#### Subgoal 3.2: Build context compilation

- Select only the chosen department pack and relevant candidates.
- Include confirmed answers and safe project summary.
- Include existing loops and connector status.
- Redact sensitive data and enforce a size budget.

Acceptance:

- Input is reproducible by hash and contains no credential values or unrelated repository contents.

#### Subgoal 3.3: Add semantic proposal validators

- Validate required loop contract fields.
- Validate evidence references.
- Check duplicate IDs and overlapping goals.
- Check connector satisfiability, metric state, owners, approvals, and forbidden actions.
- Generate actionable repair diagnostics.

Acceptance:

- Unsafe marketing proposals that publish content or change budget without approval are rejected.

#### Subgoal 3.4: Add high-reasoning execution and repair

- Implement Hermes-hosted context/schema handoff.
- Implement at least one embedded provider for browser use.
- Map abstract `high` profile to provider configuration.
- Limit to one repair pass and persist validation metadata.

Acceptance:

- The golden Marketing answers produce two valid proposals with evidence-linked rationale and required user actions.

Current implementation status: high-reasoning execution is now architecturally separated into two paths. Hermes-hosted design uses `loopgraph_design_context_get` plus `loopgraph_design_submit`; embedded/browser design can use the exported provider interface and records actual adapter/model metadata in `DesignRun.metadata`. The deterministic provider keeps the open-source local flow usable without an API key and is explicitly marked as fallback metadata. Regression coverage proves a fake embedded provider can produce a valid Marketing proposal through the shared validation/persistence path while normalizing max proposals, timeout, redaction policy, and the one-repair-attempt cap.

### Goal 4: Build the MCP integration surface

#### Subgoal 4.1: Implement a package-safe MCP server

- Add the MCP dependency to the package.
- Implement stdio transport.
- Register the read, mutation, validation, materialization, graph, and simulation tools.
- Expose department and schema resources.
- Bind to explicit project root.

Acceptance:

- A generic MCP test client can initialize, list departments, start a session, submit answers, retrieve design context, submit proposals, materialize, and retrieve topology.

#### Subgoal 4.2: Add permissions and error contracts

- Classify tools as read-only, local-write, approval, or live-execution.
- Require expected revision and request ID on mutations.
- Use typed error codes.
- Keep live connector writes unavailable or disabled in MVP.

Acceptance:

- Replayed mutation requests do not duplicate sessions, answers, or LoopSpecs.

#### Subgoal 4.3: Add CLI command

- Add `loopgraph mcp serve --project <root>`.
- Ensure bundled binary paths work after package installation.
- Add `--stdio` default and diagnostics on stderr.

Acceptance:

- The published package can run the MCP server without importing app-only code.

### Goal 5: Package Hermes integration

#### Subgoal 5.1: Write the Hermes discovery skill

- Implement the exact session protocol.
- Include a high-reasoning design instruction and structured output reference.
- Include safety rules and the marketing example.
- Keep the main skill concise and load references on demand.

Acceptance:

- Hermes follows the five-bundle discovery and acceptance sequence.

Current implementation status: the Hermes skill now includes the package-safe discovery, design, edit, connection-plan, materialization, graph, simulation, review, case-outcome, routing, and webhook-planning tools. It explicitly instructs Hermes to use `loopgraph_design_edit` when the user requests proposal changes before materialization, then explain the newly revalidated design run rather than silently mutating LoopSpecs.

#### Subgoal 5.2: Hermes installer and doctor

- Detect Hermes.
- Add a local stdio MCP configuration.
- Install/link the skill.
- Preserve user config and support clean removal.
- Test tool discovery and workspace inspection.

Acceptance:

- A fresh Hermes installation reaches the department picker from one documented command sequence.

#### Subgoal 5.3: Version compatibility

- Add MCP server and skill protocol versions.
- Doctor reports incompatible versions with upgrade steps.
- Do not allow an older skill to submit a proposal shape the server cannot validate.

Acceptance:

- Compatibility failures are explicit and do not corrupt workspace state.

Current implementation status: the Hermes install state now records the Loopgraph integration schema, MCP protocol, design-skill protocol, event-router-skill protocol, and the exact design/routing schema versions used by the generated skills. The project-local `loopgraph` and `loopgraph-event-router` skills advertise those versions in their frontmatter and reference files. `loopgraph hermes doctor` checks the stored contracts, reports stale skills or schema mismatches with a refresh command, refuses to mark an incompatible install as healthy, and leaves stale metadata untouched.

### Goal 5A: Make Hermes the operational event brain

#### Subgoal 5A.1: Implement event, problem, and routing schemas

- Add `EventEnvelope`, `BusinessProblem`, routing contract, `RoutingCard`, `RoutingDecision`, receipt, attempt, commit, correction, and unhandled-problem schemas.
- Export them through package core.
- Add file and database storage adapters.
- Add schema versions and migrations.

Acceptance:

- External, scheduled, manual, and Loopgraph lifecycle fixtures normalize into the same event contract.

#### Subgoal 5A.2: Compile routing contracts during loop design

- Add routing questions to discovery.
- Generate problem types, accepted event families, required fields, exclusions, mapping, ambiguity, fan-out, cooldown, concurrency, and activation mode.
- Validate positive and negative routing examples.
- Compile bounded routing cards by LoopSpec hash.

Acceptance:

- Ads and Content Creation have distinct routing cards that explain when each should and should not be selected.

#### Subgoal 5A.3: Implement durable event ingest and eligibility

- Add `events_ingest` service and MCP tool.
- Persist before reasoning.
- Perform durable deduplication.
- Detect when a delivery is new evidence for an existing open business problem instead of new work.
- Return only active, input-compatible, ready, non-cooled-down candidates.
- Support an explicit replay mode that creates a new attempt while preserving source lineage.

Acceptance:

- Retried deliveries never produce duplicate route commits or loop runs, and related non-duplicate deliveries can append evidence to one open problem according to its repeat policy.

#### Subgoal 5A.4: Implement the Hermes router skill

- Package a webhook-specific skill separate from design.
- Require structured routing decisions.
- Restrict tools to Loopgraph routing and approved delivery.
- Handle duplicate, no-match, ambiguity, and bounded fan-out states.
- Capture Hermes session/task/model metadata.

Acceptance:

- A generic marketing event is classified without giving the webhook turn terminal or file-write access.

Current implementation status: the MCP server now has explicit `webhook_router` and `lifecycle_router` exposure modes. Webhook-router turns can only list routing cards, ingest normalized events, submit validated routing decisions, inspect bounded routing state, and read the design graph. Lifecycle-router turns can only ingest notification-only lifecycle events and read bounded state/graph resources. Contract tests now deny discovery, project inspection, design submission/editing, connection mutation, materialization, validation/simulation, review/case resolution, replay, human-choice correction, route-commit simulation, routing evaluation, and Hermes webhook sync/test tools from untrusted router exposures.

#### Subgoal 5A.5: Configure Hermes webhook routes

- Generate route plans from connector manifests.
- Configure provider-specific signatures, allowlists, filters, and transforms.
- Load the router skill.
- Add health and synthetic test support.
- Migrate or retire the direct Loopgraph GitHub webhook.
- Measure the acknowledgement behavior against each provider's webhook timeout and retry contract.
- If the native Hermes webhook route does not acknowledge only after a durable receipt or cannot meet the provider deadline, add a Loopgraph Hermes gateway plugin that persists the normalized envelope to a loopback/Unix-socket ingest service, returns success, and starts the Hermes routing turn asynchronously.

Acceptance:

- Every enabled external source posts to Hermes, no production provider points directly at a workflow loop or Loopgraph execution route, and an accepted webhook cannot be lost between HTTP acknowledgement and durable event receipt.

#### Subgoal 5A.6: Validate and commit route decisions

- Recheck catalog version and LoopSpec hash.
- Validate event-to-input mapping.
- Enforce confidence, readiness, policy, cooldown, concurrency, fan-out, tenant, and duplicate rules.
- Canonicalize the proposed problem type, subject, severity, and dedupe-key inputs.
- Atomically create or update the durable problem, create route commits, and queue jobs.
- Return human-choice alternatives when required.

Acceptance:

- Hermes can choose only eligible registered loops; forged loop IDs and stale cards are rejected, and repeated evidence cannot create duplicate open problem work.

Current implementation status: `loopgraph_routing_decision_submit` now validates Hermes-selected route input mappings against the registered `RoutingCard.inputMapping` and the durable normalized `EventEnvelope`. Route commits store Loopgraph's deterministic event-to-input mapping rather than trusting webhook-turn values, contradictory mapped values are rejected, and undeclared injected mapping targets cannot become loop inputs. Hermes also cannot change the business-problem subject during decision submission: a proposed problem subject must match the ingested event subject, and append-evidence decisions are rejected when the existing open problem belongs to another subject. Human-choice alternatives are bounded to registered routing catalog loop IDs before they are shown or committed. The public Hermes MCP schema does not expose caller-supplied routing catalogs, so decision submission recomputes the current project catalog instead of trusting stale or forged cards from the webhook turn. Event ingest now returns a stable digest for its bounded cross-loop learning context; the event-router skill echoes it, submission recompiles the current context and rejects a stale acknowledgement, and the durable attempt stores the exact evidence packet and acknowledgement state for the Management timeline and event-routing graph. The isolated `webhook_router` profile now makes the digest required in its machine-readable tool schema and rejects an omitted or malformed acknowledgement before routing. Trusted admin/legacy calls remain readable as explicitly unacknowledged history, and local shadow simulations exercise the evidence-bound path.

#### Subgoal 5A.7: Add the job queue and routing lifecycle

- Persist queued, claimed, running, waiting-review, completed, failed, and dead-letter states.
- Add leases, retry policy, exponential backoff, and maximum attempts.
- Preserve event correlation through traces and reviews.
- Make run creation idempotent by event, loop, and LoopSpec version.

Acceptance:

- Gateway or worker restarts do not lose accepted routes or start duplicate runs.

Current implementation status: file-backed `RouteJob` records are created for accepted non-shadow routes and survive a restarted `FileRoutingStore`. Helpers can claim due jobs with leases, transition them to running/waiting-review/completed, or fail them through retry/backoff into dead-letter. `loopgraph_route_commit_simulate` updates any linked route job with the resulting persisted run ID and terminal/waiting status.

#### Subgoal 5A.8: Send loop lifecycle events back to Hermes

- Sign Loopgraph lifecycle webhooks.
- Add a dedicated Hermes route and transform.
- Enforce hop, re-entry, and per-correlation visit limits.
- Mark notification-only events.

Acceptance:

- A completed Ads run can notify Hermes without recursively triggering Ads again.

#### Subgoal 5A.9: Add routing evaluation and staged rollout

- Create positive, negative, ambiguous, duplicate, burst, and multi-problem fixtures.
- Run shadow routing against them.
- Track precision, recall, abstention, false-trigger rate, missed-problem rate, and decision latency.
- Store human corrections as evaluation evidence.
- Gate activation-mode promotion on configurable thresholds.

Current implementation status: the local Hermes routing evaluation runner now supports fixture batches with expected actions and expected loop IDs, persists router evaluations, calculates staged-rollout metrics, and blocks promotion from shadow to recommend unless the gate passes. The golden Marketing batch now covers Ads, Content Creation, duplicate delivery suppression, no-match billing events, and ambiguous landing-page conversion drops that must remain unhandled until Hermes receives enough campaign mapping context. The deterministic local-shadow router also requests human/context review when multiple loops are structurally eligible instead of guessing the first match. Evaluation/simulation tools are intentionally trusted-operator tools; untrusted webhook routes do not receive them.

Acceptance:

- A new loop cannot become automatically event-triggered until its routing test suite and shadow gate pass.

#### Subgoal 5A.10: Add event and routing operations UI

- Event inbox and filter.
- Business-problem inbox grouped across related events.
- Routing catalog.
- Decision detail and alternatives.
- Unhandled business problems.
- Human route correction.
- Webhook/transform health.
- Correlation timeline from event to outcome.

Current implementation status: the management page now loads a project-bound Hermes event-routing operations read model instead of rendering a static routing table. The read model composes durable event receipts, business problems, routing attempts, route commits/jobs, human corrections, router evaluations, routing cards, signed Loopgraph lifecycle callbacks, verified `loop.outcome.recorded` callbacks, and non-secret Hermes webhook route health. The browser table shows actual source events, selected loops, confidence, validation, queue/run status, verified outcome summaries, grouped problem inbox, routing catalog, and webhook route plan; example rows are displayed only as an explicitly labeled empty-state preview when no Hermes events exist. The routing catalog now surfaces the route-brain policy Hermes and operators need to understand safe selection: minimum confidence, ambiguity/no-match behavior, fan-out limits, repeat/dedupe behavior, lifecycle callbacks, explicit non-goals, and negative examples. The event inbox supports server-side filters for event ID, source, event type, action, problem status, loop ID, attention-needed rows, and unhandled-only rows. The same filtered view is available as `/api/management/routing`, using the browser-selected project root from the server environment rather than trusting a request-provided path. Each event row includes a decision-detail panel with Hermes-selected routes, evidence-linked route reasons, considered alternatives with confidence and rejection rationale, Loopgraph route commits, durable jobs, redacted Hermes model metadata, a verified outcome panel when present, and a chronological correlation timeline from event receipt through Hermes decision, durable business problem, validation, queueing, corrections, evaluations, lifecycle callbacks, and outcome callback back to Hermes. Rows that need a human route choice or failed an expected route expose a local correction form backed by `/api/management/routing/human-choice`, which records the correction and re-submits through Loopgraph's existing route validator rather than bypassing Hermes/Loopgraph routing policy.

Acceptance:

- An operator can explain why a loop ran, see which events belong to the same problem, correct a wrong route, and identify a missing loop from the browser.

### Goal 6: Build the real browser discovery flow

#### Subgoal 6.1: Replace demo fixture routing

- Add session list/new/resume routes.
- Stop hard-coding `acme-saas-discovery` as the default real session.
- Keep the fixture as an explicitly labeled demo.

Acceptance:

- A fresh local workspace starts empty and creates a persistent real session.

Current implementation status: the package-safe Hermes discovery runtime now lists project-local sessions from `.loopgraph/discovery/sessions`, and the browser `/discovery` home lists real Hermes/browser sessions before the explicitly labeled Acme demo fallback. Browser-created sessions use `createdByActor: browser`, persist through the same runtime that Hermes uses through MCP, and can be resumed through `/discovery?sessionId=...`, `/api/discovery/session`, and `/api/discovery/session/[sessionId]`. Discovery step navigation preserves the selected real `sessionId` across pages.

#### Subgoal 6.2: Build interactive pages

- Project confirmation.
- Department selection.
- Question bundle form/chat-like step.
- Designing progress and validation state.
- Proposal comparison/editor.
- Required-connections checklist.
- Accept/reject/materialize.

Acceptance:

- Browser and agent writes appear immediately in each other's views.

Current implementation status: browser department selection now writes through the package-safe `selectDiscoveryDepartments` service with `actor: browser` and optimistic revision checks, then redirects to `/discovery/questions?sessionId=...`. The Project/Company page now performs the shared safe project-context confirmation step before department selection: it runs allowlisted manifest inspection, shows stack/source-of-truth confirmation fields, stores a confirmed `ProjectProfile` and auditable `project_context.*` answers on the same discovery session, and uses the same `loopgraph_discovery_confirm_project_context` MCP operation Hermes can call. The `/discovery/questions` page renders the active Loopgraph-supplied question bundle, typed fields, bundle progress, and department-specific prompt guidance from the same package runtime that Hermes uses through MCP. Browser answer submission writes through `submitDiscoveryAnswers`, preserves revision safety, advances the active bundle, and keeps the selected `sessionId` in navigation. When the required bundles are complete, the browser now routes to `/discovery/designing`, where it shows the bounded Hermes design context, candidate loops, connector readiness, progress/validation state, and generated `DesignRun` output before review. The package-safe high-reasoning design path's deterministic local fallback persists a `DesignRun` and returns to that Designing page with the run attached. The Create Loops page now stays focused on reviewing the latest Hermes proposal set, showing the Hermes Brain -> Department -> Loop graph preview, listing non-secret required connections, exposing structured edit controls, and materializing explicitly selected proposals through the same materializer exposed to Hermes.

#### Subgoal 6.3: Add proposal editing

- Edit user-facing name, goal, trigger, sources, actions, verifier, metrics, owners, approvals, and connectors.
- Revalidate after every saved edit.
- Preserve design version history.

Acceptance:

- Editing Content Creation to require two approvers updates the generated LoopSpec and graph inspector.

Current implementation status: `editLoopDesignProposal` applies structured edits to a single proposal, refreshes topology/routing connection previews, validates the full proposal set, persists a new `DesignRun` with edit provenance, and appends it to the shared discovery session. The browser proposal editor and the `loopgraph_design_edit` MCP tool both use this package-safe path. Regression coverage proves that editing Content Creation's name, approvers, and connector requirements changes the materialized LoopSpec and routing card.

### Goal 7: Deliver connector registry and readiness

#### Subgoal 7.1: Implement connector manifests and instances

- Add schemas and repository.
- Convert existing mock/GitHub adapters into manifests.
- Add manual file connector.
- Add connection health service.
- Add webhook subscription, signature, filter, transformer, delivery-ID, and event-schema metadata.

Acceptance:

- Access requirements resolve to compatible instances rather than raw enum labels.

Current implementation status: the package core now includes connector manifest, connection instance, webhook metadata, connector suggestion, route hint, and authority schemas. The runtime exposes a default connector manifest catalog for the Marketing MVP path and the existing Engineering/GitHub path, including Google Ads, Meta Ads, product analytics, HubSpot, Notion, GitHub, local Markdown, Webflow CMS drafts, Slack notifications, and manual file import. Manifests describe read/event/draft/approved-write capabilities, minimum scopes, manual fallback text, webhook source/event patterns, signature expectations, transform versions, stable delivery IDs, and subject mapping without storing credentials. GitHub is modeled as Hermes-routed repository/issue-tracker capabilities rather than a special direct webhook execution path.

Connection instances can now be registered and health-checked through trusted Hermes admin MCP tools, the CLI, or the bearer-authenticated measurement API. Metric definitions can be bound to exact read capabilities and provider fields; the hourly authenticated scheduler creates due jobs and reconciliation reports. These operations are absent from webhook-router and lifecycle-router profiles.

#### Subgoal 7.2: Add connection planning UI and MCP tools

- Show missing capability, suggested providers, required scopes, reason, risk, and fallback.
- Allow connected, manual fallback, waived, and blocked states through validated operations.
- Separate “Hermes receives events” from “Loopgraph can read context” and “Loopgraph may write actions.”

Acceptance:

- Ads reports exactly what data is needed from ads, analytics, and CRM and whether each is available.

Current implementation status: `buildConnectionPlan` and the `loopgraph_connections_plan` MCP tool now enrich every required capability with suggested providers, minimum scopes, manual fallback options, compatible local connection instances from `.loopgraph/connections/instances.json`, Hermes webhook route hints, and an authority summary that explicitly separates Hermes event ingress from Loopgraph read/write authority. Existing manual fallback behavior still degrades routing readiness safely; connected non-secret instances can mark a capability connected without treating suggested providers as connected.

#### Subgoal 7.3: Build Marketing MVP adapters

- Manual file/fixture.
- Ads read.
- Analytics read.
- CRM read.
- Content repository read/draft.
- CMS draft.
- Messaging/review notification.

Acceptance:

- Every adapter passes conformance, scope, health, prepare/commit, fingerprint, and redaction tests.

Current implementation status: the SDK adapter catalog now includes local-first Marketing MVP adapters for manual review, manual file import, Google Ads fixture reads, product analytics fixture reads, HubSpot/CRM fixture reads, Notion/content fixture reads and draft preparation, local Markdown draft preparation, Webflow CMS draft payloads, and Slack review-notification payloads. These adapters read only synthetic or redacted fixtures/manual exports, report local simulation health, prepare local-only draft/review actions, and require fingerprint approval before recording a mock/local commit. They are registered by the same IDs used by connector manifests and generated LoopSpec tools, including `manual`, `manual_file`, `google_ads`, `product_analytics`, `hubspot`, `notion`, `local_markdown`, `webflow`, and `slack`.

### Goal 8: Materialize and version multi-loop designs

#### Subgoal 8.1: Proposal-to-LoopSpec mapper

- Map every proposal field to the canonical spec.
- Preserve provenance.
- Produce manual fallback context sources when allowed.
- Set topology department, optional parent loop, tags, and display order.
- Map routing questions into a validated routing contract and compile a routing card.

Acceptance:

- Ads and Content Creation validate with no app-only adapter conversion and expose non-overlapping positive/negative routing examples.

Current implementation status: proposal materialization maps accepted Hermes design proposals into validated LoopSpecs under `.loopgraph/generated/hermes/...`, preserves proposal/design/session provenance in labels and `studioExtension.hermesDesign`, sets `trigger.source: hermes`, maps required connections into the routing contract, and compiles routing cards for Hermes selection. The compiled card now preserves the route-brain policy Hermes needs at runtime: ambiguity/no-match behavior, fan-out limits, cooldown/repeat handling, concurrency strategy, lifecycle events, positive route examples, and negative “do not route” examples.

#### Subgoal 8.2: Atomic materialization

- Add transaction staging.
- Validate all accepted proposals before writing.
- Update registry and session atomically.
- Roll back staging on failure.

Acceptance:

- A failure in either proposal leaves neither partially registered.

Current implementation status: accepted proposals are prepared and validated before final registry writes; repeated materialization of the same design is idempotent, while conflicting pre-existing loop IDs are rejected unless overwrite is explicit. Materialization now stages generated LoopSpecs and starter fixtures under a transaction directory, validates staged specs before promotion, promotes all accepted loop directories together, rolls back promoted files/backups if any promotion or commit step fails, restores the prior workspace/session state, and removes the staging directory. Regression coverage forces the second accepted proposal to fail during promotion and proves the first proposal leaves no final LoopSpec, fixture, registry entry, or stale staging directory. Successful materialization updates the shared discovery session with `createdLoopIds`, `activeStage: materialization`, and `lastActor`, so Hermes and the browser agree on which proposals became local loops.

#### Subgoal 8.3: Fixture generation

- Generate happy, missing-context, and risk fixtures from the proposal schema.
- Validate fixture schema and simulate them.

Acceptance:

- Both reference loops can be simulated immediately after materialization.

Current implementation status: materialization creates happy-path, missing-context, and risk-escalation synthetic Hermes fixtures next to each generated LoopSpec and returns local simulation commands in the browser materialization result. The browser materialization panel now also exposes safe local simulate buttons for those generated fixtures; each run uses `simulateLoopForHermes`, persists a trace in the selected `.loopgraph` workspace, and redirects to the run trace or review queue without touching live provider systems.

### Goal 9: Change graph projections and interaction

#### Subgoal 9.1: Add projection adapters

- Keep semantic topology unchanged for operating truth.
- Add design and loop-logic projection functions.
- Add display-only direct Company -> Department edges when management is hidden.
- Add event-routing projection from Hermes receipt through decision, selected loop, run, and outcome.

Acceptance:

- The design projection returns Hermes Brain -> Marketing -> Ads and Content Creation, and an actual event projection highlights only the committed route.

Current implementation status: `loopgraph_graph_get` now exposes separate design and event-routing projections for Hermes. The design projection reads registered materialized loops and returns the simple authoring hierarchy `Hermes Brain -> Department -> Workflow Loop`, with optional connection nodes for missing/connected/manual-fallback requirements. The event-routing projection reads durable event receipts, Hermes routing attempts, business problems, validated route commits, durable route jobs, linked local runs, and signed lifecycle callbacks, then projects the actual operational path from business source through Hermes Brain, selected loop, run, and lifecycle notification back to Hermes. Regression coverage verifies both the Marketing design branch and an actual event path with route commit, queue job, run, and lifecycle callback.

#### Subgoal 9.2: Add deterministic hierarchy layout

- Use layered tiers and stable sibling order.
- Fit the newly created branch by default.
- Retain force mode as an option.

Acceptance:

- Reopening the same workspace produces the same logical layout without node overlap.

Current implementation status: the browser brain layout now detects direct Hermes Brain design graphs without a management layer and seeds them as stable tiers: Hermes Brain, departments, then workflow loops. The Marketing example is laid out deterministically as `Hermes Brain -> Marketing -> Ads / Content Creation`, while local loop-detail mode still centers the selected workflow and the denser operating topology retains the existing packed/orbit behavior. Regression coverage proves the direct Hermes hierarchy is repeatable and overlap-free.

#### Subgoal 9.3: Remove demo leakage

- Default `includeCatalogLoops` to false when real registered/materialized loops exist.
- Add an explicit catalog toggle.
- Label drafts and demos unmistakably.

Acceptance:

- The new user's graph contains only accepted/materialized user loops.

Current implementation status: `/brain` now loads the Hermes Brain topology with catalog loops hidden by default. Users must explicitly open `/brain?catalog=1` through the "Show catalog preview" control to include template/catalog content. Catalog-derived LoopSpecs are tagged with `source: demo_catalog`, `runtimeLevel`, and `templateOnly` metadata as they enter the semantic topology; visible catalog workflow nodes are prefixed with "Demo:" and their maturity is shown in the subtitle. Regression coverage proves a real local workspace defaults to only its registered loop and that explicit catalog mode marks demo nodes without confusing them with accepted/materialized Hermes loops.

#### Subgoal 9.4: Add connection and readiness inspector

- Show required connections, manual fallbacks, metrics, owners, approvals, and blockers.
- Add validate/simulate actions.

Acceptance:

- The user can determine everything needed to move a loop from draft to simulated or connected without leaving the node inspector.

Current implementation status: workflow nodes in the Hermes Brain graph now carry package-derived runtime metadata for routing readiness, activation mode, problem types, required connections, and generated fixture IDs. The node inspector renders safe local validation and fixture simulation controls for those workflow loops, while still stating that live provider webhooks terminate at Hermes first.

### Goal 10: Local run and governance integration

#### Subgoal 10.1: Unify CLI, browser, and MCP runtime calls

- Use the same validate/simulate/review services.
- Return run IDs and local URLs.
- Persist traces in the selected project root.
- Carry event, route-decision, correlation, and causation IDs into every run.

Acceptance:

- A run selected by Hermes appears in the browser, remains linked to its source event and route decision, and can be reviewed through the existing governance path.

#### Subgoal 10.2: Add run controls to the graph

- Validate.
- Choose fixture/manual event.
- Simulate.
- Show trace status and prepared actions.
- Route review-required results to review UI.

Acceptance:

- No graph action performs a live write in the default local mode.

Current implementation status: materialized-loop run controls exist in both the Create Loops browser flow and the Hermes Brain node inspector. They run generated synthetic Hermes fixtures or a redacted custom manual event JSON object only, reuse the package-safe Hermes simulation service, and route completed runs to `/loops/:loopId/runs/:runId` or approval-gated runs to `/loops/:loopId/reviews?runId=...`. Registered-spec topology now includes recent persisted traces, and workflow inspectors show the latest run status inline. The manual-event path validates JSON shape, requires `eventId` and `simulatedAt`, rejects obvious secret-like keys, and remains local simulation only.

#### Subgoal 10.3: Gate live execution

- Require execute feature flag.
- Require healthy connectors.
- Require policy and fingerprint approval.
- Require customer-facing separation where applicable.
- Record actor, user, and connector provenance.

Acceptance:

- A model or Hermes turn cannot bypass Loopgraph's prepared-action approval by calling a connector through the Loopgraph runtime.

Current implementation status: the package executor now enforces an explicit live execution gate after the global `LOOPGRAPH_EXECUTE_ENABLED=true` flag and before any execute-mode assessment runs. The gate requires a Hermes-auditable routing contract, blocks `shadow`, `recommend`, and `simulate` loops from live execution, rejects direct provider webhook execution unless the source is Hermes-normalized, requires risky write-capable actions to use approval plus fingerprint binding, requires separate customer-facing approval, keeps `autonomous_low_risk` limited to low-risk non-customer-facing writes, and verifies declared routing/execution connector capabilities against a project connection plan with a connected non-simulated instance. Execute-mode run traces can now persist non-secret provenance for the invoker, source, route attempt/commit IDs, live-gate decision, approval-policy snapshot, and connector readiness summaries. Focused regression coverage now proves Hermes cannot turn an incoming event into live connector execution just by selecting a route.

### Goal 11: Testing, security, and release confidence

#### Subgoal 11.1: Golden flow tests

- Marketing two-loop discovery snapshot.
- Hermes/browser resume.
- Proposal validation and repair.
- Atomic materialization.
- Design topology snapshot.
- Three fixtures per loop.
- Expected routing fixtures for Ads, Content Creation, no-match, and ambiguous events.
- End-to-end source event -> Hermes decision -> Loopgraph route commit -> run -> lifecycle event.

Current implementation status: the Hermes local routing suite exercises the Marketing two-loop route set with positive Ads and Content events, duplicate suppression, no-match events, ambiguous landing-page abstention, and a synthetic multi-eligible case that must request human/context confirmation before any loop is triggered. The golden Marketing reference-flow test now also snapshots the package-safe discovery/session state, generated proposals, generated LoopSpecs, design topology, routing catalog IDs, and starter fixture IDs from the committed golden JSON fixture, so the reference Ads + Content Creation path has stable regression evidence before browser or Hermes-specific surfaces render it.

#### Subgoal 11.2: MCP contract tests

- Initialize and capability negotiation.
- Tool/resource schemas.
- Protocol-clean stdout.
- Project-root confinement.
- Idempotency and revision conflicts.
- Error redaction.
- Event receipt, eligible-card, decision submission, stale-catalog, and human-choice contracts.

Current implementation status: MCP tests cover initialize capability negotiation, admin tool/resource schemas, project-bound resources, discovery/design/materialization/runtime/routing tool calls, project-root binding, and the restricted Hermes router exposures. The latest contract coverage proves webhook-router and lifecycle-router exposures advertise only their allowlisted tools and return tool-not-found errors for admin/design/materialization/simulation/evaluation/sync actions, while router resources are limited to event/routing schemas plus the Company Brain graph projection.

#### Subgoal 11.3: Installer tests

- Existing Hermes config is preserved.
- Existing `.mcp.json` is merged.
- Install, doctor, upgrade, and uninstall are reversible.
- Paths with spaces work.
- Webhook route sync preserves unrelated Hermes routes and never writes secret values into `.loopgraph`.

Current implementation status: installer and MCP contract tests cover the Hermes-only tool surface, generated design/router skills, local MCP configuration, doctor checks, webhook sync, and webhook manifest doctor. Webhook sync tests prove that stale Loopgraph-managed manifest entries are removed, unrelated external route references are preserved without copied tokens, dry-run mode does not write `.loopgraph/hermes-routes.json`, a second sync reports no route churn, and doctor catches a missing manifest before provider routes are applied in Hermes.

Current implementation status: local Hermes webhook/events fixture tests verify both halves of a route rehearsal: the fixture must match a planned Hermes route family, and the same normalized event must pass Loopgraph durable ingest, eligibility, route validation, and expected shadow decision checks. Manifest-required tests fail clearly when `.loopgraph/hermes-routes.json` has not been synced, while the underlying shadow route can still prove whether the routing contract itself is valid.

#### Subgoal 11.4: Browser end-to-end tests

- Desktop and mobile discovery.
- Hermes-started session appears in browser.
- Proposal edit and validation.
- Materialization opens focused graph.
- Simulate creates visible trace.
- Event inbox explains an actual Hermes routing decision and supports correction.

Current implementation status: a browser-flow integration regression now starts from a Hermes-created discovery session and proves that the browser can resume it, submit the shared department/question flow, generate the Marketing Ads + Content proposal set, edit a proposal, materialize both loops, render the focused `Hermes Brain -> Marketing -> Ads / Content Engine` graph projection, simulate a generated loop fixture into a visible persisted trace, load an actual Hermes routing decision in the management inbox, and submit a human route correction through the same Loopgraph route validator used by Hermes. Existing targeted tests continue to cover the individual desktop/mobile navigation links, graph controls, management routing filters, and human-choice API error cases.

#### Subgoal 11.5: Threat and privacy tests

- Prompt injection in repository context.
- Secret-like values in detected files/answers.
- Path traversal and symlink escape.
- Malicious MCP client payload.
- Model output attempting forbidden action.
- Connector error leaking tokens.
- Concurrent Hermes/browser writes.
- Validly signed webhook containing prompt-injection instructions.
- Forged, stale, or nonexistent loop IDs in a routing decision.
- Duplicate deliveries outside the Hermes in-memory/TTL window.
- Event storms, fan-out abuse, recursive lifecycle events, and poison messages.
- Cross-workspace or cross-tenant route attempts.

Current implementation status: threat/privacy coverage now spans safe project inspection without secret reads, symlink-escape blocking, project-root binding for MCP and browser APIs, restricted webhook/lifecycle MCP tool exposure, stale/forged/nonexistent loop ID rejection, duplicate delivery persistence beyond gateway memory, open-problem duplicate-work blocking, lifecycle recursion prevention, manual simulation secret-key rejection, and non-secret Hermes manifest sync. A dedicated signed-webhook prompt-injection regression proves that attacker instruction text inside a valid normalized EventEnvelope remains data: it cannot forge a loop ID, cannot create route commits or jobs when validation fails, cannot promote a shadow route into execution, and secret-like model metadata is redacted from the browser event-routing read model.

#### Subgoal 11.6: Routing quality tests

- Positive examples per loop.
- Hard negative examples from the same department.
- Cross-department ambiguity examples.
- Multiple-problem events.
- Missing-field and stale-data events.
- Already-resolved and cooldown events.
- Human-corrected production shadow samples.

Track:

- Route precision and recall.
- False-trigger and missed-problem rates.
- Abstention/human-choice rate.

Current implementation status: fixture-batch metrics now include expected route/no-route counts, duplicate suppression, precision/recall, false-trigger rate, missed-problem rate, abstention rate, and latency. The current Hermes-only golden suite proves that obvious positives route, obvious negatives do not route, duplicate provider deliveries do not create a second route commit, ambiguous landing-page signals are not misrouted to Ads or Content Creation, and multi-eligible route candidates become human/context review instead of automatic fan-out.
- Duplicate suppression rate.
- Event-to-decision and event-to-run latency.
- Outcome success by routed problem type.

Acceptance for Goal 11:

- Typecheck, unit tests, package boundary tests, MCP tests, browser tests, and clean-clone walkthrough all pass.

### Goal 12: Documentation and distribution

#### Subgoal 12.1: Update quickstart

- Clone/install.
- Initialize workspace.
- Connect Hermes.
- Start discovery.
- Open local Company Brain.
- Simulate the generated loop.

#### Subgoal 12.2: Document trust boundaries

- Hermes versus Loopgraph versus connector authority.
- Local file writes versus external writes.
- Manual fallback versus connected data.
- Reasoning summary versus hidden chain-of-thought.

#### Subgoal 12.3: Publish examples

- Marketing Ads + Content Creation.
- One sensitive department example, such as HR or Legal, that demonstrates strict blocking.
- One custom department example.

Current implementation status: `docs/HERMES-QUICKSTART.md` and the package README now describe the Hermes-only path: install/doctor Hermes, start discovery from Hermes, open the local Hermes Brain graph, plan/sync/doctor Hermes webhook route metadata, rehearse a generated event fixture through Hermes-shaped routing, and simulate the generated LoopSpec locally. The clean walkthrough regression in `packages/loopgraph/src/runtime/hermes-clean-walkthrough.test.ts` starts from a temp project containing only `package.json` and proves the Marketing reference flow without manual YAML edits: Hermes integration install/doctor, MCP tool discovery with a restricted webhook-router surface, shared discovery answers, high-profile design context validation, Ads + Content Creation materialization, `Hermes Brain -> Marketing -> ...` graph projection, Hermes route manifest sync/doctor, generated Ads fixture routing, event-routing graph projection, LoopSpec validation, and local simulation. `docs/HERMES-EXAMPLES.md` now publishes the Marketing reference, a strict Legal / Compliance sensitive-department example, and a Custom field-ops example. The new `hermes-published-examples.test.ts` regression materializes the Legal and Custom fixtures, proves their Hermes graph and route contracts, rehearses generated fixtures through the Hermes webhook route manifest, and proves the sensitive Legal loop remains blocked from live execution by shadow activation, approval-gated critical actions, and unconnected live capabilities.

Acceptance:

- A user unfamiliar with the codebase can complete the reference flow without manually editing YAML or configuration files.

## 15. Marketing reference design

This is the target golden scenario, not a hard-coded result for every marketing user.

### 15.1 Example confirmed answers

- Department: Marketing.
- Current stack: Google Ads, product analytics, HubSpot, Notion, Webflow, Slack.
- Biggest problems: campaign decisions rely on click/conversion proxies instead of qualified customers; content ideation and review are slow and inconsistent.
- Useful automation: weekly paid-performance analysis and experiment briefs; content briefs and first drafts based on approved evidence.
- Ideal outcome: faster learning and content throughput without increasing cost per qualified customer, unsupported claims, or review burden.
- Boundaries: no budget change, publication, customer send, or unsupported brand claim without approval.
- Owners: Growth lead for Ads; Content lead for Content Creation; Finance/leadership for material spend changes.

### 15.2 Proposed loop 1: Ads

Goal:

- Improve qualified acquisition efficiency and learning speed.

Trigger:

- Weekly schedule plus optional campaign anomaly event.

Observes:

- Ads spend and campaign performance.
- Analytics conversion and funnel data.
- CRM qualified lead/customer outcomes.
- Prior experiment decisions and outcomes.

Routine:

1. Collect and reconcile current-period signals.
2. Compare upstream performance with qualified downstream outcomes.
3. Detect waste, fatigue, or promising segments.
4. Draft an experiment brief and budget recommendation.
5. Verify evidence, sample size, and guardrails.
6. Route material spend or audience changes for approval.

Allowed initial actions:

- Read data.
- Draft analysis and experiment brief.
- Create a review task.

Forbidden initial actions:

- Change budget, targeting, campaign state, or claims.

Primary metric:

- Cost per qualified customer.

Guardrails:

- Qualified lead rate, payback, activation/retention quality, spend threshold, and human review time.

Required from user:

- Ads account read access or export.
- Analytics read access or export.
- CRM definition and source for “qualified.”
- Spend approval threshold and approver.
- Baseline/target or permission to begin with an undefined baseline.

### 15.3 Proposed loop 2: Content Creation

Goal:

- Increase evidence-backed content throughput while preserving brand quality.

Trigger:

- Weekly content planning plus an approved brief or insight event.

Observes:

- Approved positioning and brand guidelines.
- Product/customer evidence and source material.
- Content backlog and calendar.
- Prior content performance and reviewer feedback.

Routine:

1. Collect approved themes and evidence.
2. Rank candidate topics against the current goal and channel.
3. Draft brief, outline, and first version.
4. Verify claims, citations, voice, format, and duplication.
5. Route draft to the content owner.
6. Prepare a CMS/social draft only after approval.

Allowed initial actions:

- Read approved sources.
- Create local/Notion/Docs draft.
- Create review task.

Forbidden initial actions:

- Publish, send, or make unsupported claims.

Primary metric:

- Approved content pieces per week or content cycle time.

Guardrails:

- Unsupported-claim rate, revision/rework time, downstream qualified engagement, and brand-review rejection rate.

Required from user:

- Approved source repository.
- Brand/claims policy.
- Target formats and channels.
- Draft destination.
- Reviewer and publication approval rule.
- Examples of accepted content for verification calibration.

### 15.4 Expected design graph

```text
Company Brain
  -> Marketing
       -> Ads
       -> Content Creation
```

Optional expanded connection layer:

```text
Ads <- Ads Platform
Ads <- Analytics
Ads <- CRM
Ads -> Growth Lead Review

Content Creation <- Approved Sources
Content Creation <- Content Backlog
Content Creation -> Draft Repository
Content Creation -> Content Lead Review
```

Missing/manual connections are dashed. Connected healthy reads are solid. Review and publishing edges remain approval-gated.

### 15.5 Expected Hermes routing behavior

#### Event A: Ads problem

Normalized event:

```text
source: google_ads_detector
eventType: campaign.performance_anomaly
subject: campaign/campaign_123
signals: spend +18%, cost_per_qualified_customer +31%, qualified_conversion -14%
```

Expected routing:

- Eligible: Ads.
- Selected: Ads.
- Rejected alternative: Content Creation, because the event concerns campaign efficiency and contains no approved content work item.
- Initial action: record shadow decision or start Ads in simulate/recommend mode depending rollout state.

#### Event B: Content problem

Normalized event:

```text
source: notion
eventType: content.brief_approved
subject: content_brief/brief_456
signals: channel=blog, deadline, approved evidence refs, reviewer
```

Expected routing:

- Eligible: Content Creation.
- Selected: Content Creation.
- Rejected alternative: Ads, because no paid campaign performance problem is present.

#### Event C: Ambiguous landing-page problem

Normalized event:

```text
source: analytics
eventType: page.conversion_drop
subject: page/landing_789
signals: conversion down, traffic mix unknown, campaign mapping missing
```

Expected routing:

- Ads may be eligible only if the page maps to an active paid campaign.
- Content Creation should not be selected merely because the subject contains content.
- If the required campaign mapping is missing, Hermes requests context or records an unhandled `landing_page_optimization` problem.
- The event must not fan out to both loops as a guess.

#### Event D: Duplicate delivery

- Hermes gateway may suppress an immediate provider retry.
- Loopgraph's durable receipt store also detects the same source delivery ID.
- No second routing attempt, route commit, or loop run is created.

#### Event E: One event, two independent problems

If an event clearly contains both a campaign-efficiency problem and a separately approved content-production work item, Hermes may propose two routes only when both routing contracts allow independent fan-out. Loopgraph caps the number of routes, creates separate input mappings, shares one correlation ID, and validates each route independently.

## 16. What the user must provide

The product should generate this checklist automatically per proposal. Across departments, the user is normally responsible for:

- Selecting the department and confirming the goal.
- Confirming the detected stack and sources of truth.
- Naming the recurring process and biggest problem.
- Choosing what AI may monitor, draft, recommend, or execute.
- Defining actions that are never autonomous.
- Naming the loop owner, reviewer, and escalation owner.
- Providing or approving metric definitions and baselines.
- Connecting read-only accounts or providing manual exports.
- Identifying which source events or schedules indicate each problem.
- Confirming event ignore conditions, cooldown, ambiguity, and fan-out policy.
- Configuring provider webhook subscriptions to the Hermes route URL.
- Keeping webhook signing secrets in Hermes rather than Loopgraph or chat.
- Approving any upgrade to write scopes.
- Reviewing the proposed LoopSpecs before materialization.
- Supplying representative synthetic or redacted samples when verification cannot be designed from schemas alone.

The user should never be asked to paste API keys into chat.

## 17. MVP cut and deferred work

### MVP

- Canonical department taxonomy.
- Answer-driven discovery state machine.
- Five universal bundles plus all department branches.
- Project inspection and user confirmation.
- Hermes-hosted high-reasoning mode.
- One embedded provider for browser use plus deterministic fallback.
- Local stdio MCP server.
- Hermes discovery skill, Hermes installer, and doctor commands.
- Hermes webhook gateway as the sole external ingress.
- `loopgraph-event-router` skill with a restricted webhook toolset.
- Event envelope, durable receipts, business-problem records, routing contracts/cards/decisions, and route commits.
- Shadow routing, human correction, and golden route fixtures.
- Signed Loopgraph lifecycle events back to Hermes with cycle guards.
- Marketing Ads + Content Creation golden flow.
- Manual/fixture connectors and connection plan.
- Atomic materialization.
- Design hierarchy graph and focused inspector.
- Local simulation and existing review path.

### Next

- Real Marketing connector implementations.
- OAuth connection UI and credential store integrations.
- HTTP MCP transport.
- Event coalescing and streaming/analytics detector services for high-volume signals.
- Versioned Hermes plugin distribution and Hermes skill registry publication.
- Additional provider adapters.
- Multi-department and cross-department loop design.
- Management rollup from newly materialized department loops.
- Live approved writes.

### Explicitly deferred until governance is proven

- Autonomous graph-wide orchestration.
- Unlimited model-selected fan-out or recursive follow-on routing.
- Sending every raw analytics or database change through an LLM without filtering, thresholds, or aggregation.
- Unattended publishing, spend changes, customer sends, employment decisions, payments, legal decisions, merges, deployments, or resource allocation.
- Automatic self-modification of LoopSpecs based only on model output.
- Treating catalog or suggested connectors as connected.

## 18. Definition of done

The goal is achieved when a clean-clone test proves all of the following:

1. The package installs and its tests pass.
2. A local workspace can be initialized against an explicit project root.
3. Hermes can discover the Loopgraph design and administration MCP tools.
4. Hermes can start and resume the discovery session and remains the only production webhook brain.
5. The user sees canonical departments and selects Marketing.
6. Five main question bundles capture the reference answers.
7. A high-reasoning design run proposes Ads and Content Creation with evidence-linked rationale, assumptions, metrics, owners, policies, connectors, and required user actions.
8. Invalid or unsafe model output is rejected before filesystem writes.
9. The user can edit, accept, or reject each proposal.
10. Both accepted proposals materialize atomically into valid LoopSpecs.
11. Each accepted loop has a validated routing contract and versioned routing card.
12. External provider test webhooks terminate at Hermes, are authenticated/transformed, and never call loops directly.
13. Hermes routes Ads, Content Creation, ambiguous, duplicate, and no-match fixtures as expected.
14. Loopgraph rejects nonexistent, stale, incompatible, unready, duplicate, over-limit, and unsafe route selections.
15. Accepted routes survive restarts through a durable queue, preserve event-to-problem-to-run correlation, and group repeated evidence for the same open problem.
16. Loop lifecycle events return to Hermes without recursive re-triggering.
17. The local design graph shows Hermes Brain -> Marketing -> Ads and Content Creation in a stable hierarchy.
18. The event-routing projection explains an actual event, candidates, decision, route validation, run, and outcome.
19. Each loop can be simulated from generated synthetic fixtures.
20. Traces appear in the browser and existing review/escalation behavior still works.
21. No external write occurs without connected capabilities, policy approval, and fingerprint binding.
22. The design flow works from the browser without requiring Hermes, while production webhook routing requires Hermes by design.

Current implementation status: `docs/HERMES-COMPLETION-AUDIT.md` maps the original Hermes-only objective and every definition-of-done item to current files, tests, and validation commands. The clean local Hermes walkthrough regression proves items 2-7, 10-13 for the Marketing happy path, 17-19, and the package-side restricted MCP/tooling trust boundary. Separate focused tests cover invalid design rejection, ambiguous/duplicate/no-match routing, route validation failures, durable queues, lifecycle callbacks, browser resume/edit/materialize/correction behavior, and live execution gates. The published examples suite now covers the sensitive-department and custom-department examples called out in Goal 12, including strict blocking for Legal / Compliance.

## 19. Likely code ownership map

Package core:

- `packages/loopgraph/src/core/department-skills.ts`
- `packages/loopgraph/src/core/discovery.ts`
- `packages/loopgraph/src/core/process-inventory.ts`
- `packages/loopgraph/src/core/loop-recommendation.ts`
- New design, connector, project-profile, question-bundle, event-envelope, routing-contract, routing-decision, and job schemas.

Package runtime:

- Discovery state machine and answer compiler.
- Candidate recommender and design-context compiler.
- Proposal validators and materializer.
- Connector registry/resolver.
- Event receipt store, business-problem repository, eligibility engine, route validator, durable job queue, lifecycle emitter, and router evaluation.
- Existing validate/simulate/review runtime.

Package CLI/MCP:

- `packages/loopgraph/src/cli/index.ts`
- New `packages/loopgraph/src/mcp/*`.
- New Hermes install/doctor services.
- New event-ingest, routing-catalog, decision-submission, replay, and correction tools.

Hermes distribution:

- New `integrations/hermes/loopgraph/*`.
- Hermes config/install helpers.
- A separate `loopgraph-event-router` skill and optional Hermes plugin.
- Hermes webhook route/transform planning and sync helpers.

Web application:

- `app/discovery/*` and server actions/API routes.
- Proposal editor and connector surfaces.
- Event inbox, business-problem inbox, routing catalog, decision detail, unhandled-problem, webhook health, and correlation timeline surfaces.
- `app/brain/page.tsx`, graph adapters, inspector, and layout.

Topology:

- `packages/loopgraph/src/core/graph.ts` for semantic truth.
- New projection layer for design, event routing, operating governance, and loop logic.
- `components/brain/graph-adapter.ts` and layout components for presentation.

Compatibility cleanup:

- `lib/loop-engineering-builder/*` becomes an adapter/editor layer over the core contracts and is reduced over time.

## 20. External integration references

- Hermes's webhook gateway supports authenticated routes, event filters, transform scripts, skill loading, delivery targets, rate limits, idempotency, and payload limits: <https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks/>
- Hermes Agent can consume local stdio or HTTP MCP servers and automatically discovers their tools: <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp>
- Hermes Agent uses standards-compatible `SKILL.md` packages and can install/link external skills: <https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills>
- Hermes plugins can package tools, hooks, commands, skills, gateway integrations, and structured model calls without modifying Hermes core: <https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins>
- Hermes exposes ACP, TUI gateway JSON-RPC, and an OpenAI-compatible API for programmatic control; these are optional administration surfaces, not replacements for webhook ingress: <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md>
- Hermes supports project context files, but the Loopgraph workflow should remain on-demand in a skill: <https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files/>
