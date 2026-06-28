# Loopgraph v1 Launch Context Plan — Developer-First Open Source Wedge

**Status:** Authoritative build and launch contract  
**Last updated:** 2026-06-27  
**Supersedes:** `V1-LAUNCH-CONTEXT-PLAN.md`  
**Purpose:** Turn Loopgraph from a strong company-loop design prototype into a credible, code-first open-source project while preserving the visual topology, blueprint, governance, and measurement work already in the repository.

---

## 0. Read this first: what changed and why

The previous V1 plan was strong on product design, topology, loop blueprints, simulated runs, review, and hidden-labor measurement. It was weaker on the precise thing that makes an open-source developer project adoptable:

- a **code-first source of truth**;
- a small, durable, portable **LoopSpec contract**;
- deterministic local execution and fixtures;
- reproducible context and replayable traces;
- strict action/approval semantics;
- a concrete recurring loop that a developer immediately understands;
- an explicit answer to “why not LangGraph / Mastra / Langfuse / HumanLayer?”

This document preserves the existing Next.js application and its V1 usability work. It changes the public product thesis and implementation sequence.

### The corrective decision

**Do not launch the existing topology-and-blueprint app as the entire Loopgraph open-source thesis.**

It is useful, but on its own it is primarily a company-loop design studio. Developers can reasonably ask why they need it instead of a workflow diagram, an internal prompt document, or an existing agent framework.

Instead, Loopgraph V1 must be:

> **A code-first control plane for recurring AI-human loops: define the loop, compile its context, constrain its actions, require approval where policy requires it, and replay exactly what happened.**

The visual topology, blueprint generator, review UI, and hidden-labor measurement remain important. They become the **operating map and debugger around the contract**, rather than the product’s only source of truth.

### What stays from the prior plan

- The current Next.js 15 single-app architecture remains acceptable for V1.
- Supabase remains optional persistence for the Design Studio and local demo workspace.
- React Flow + ELK remains the topology experience.
- The existing question engine, template system, LoopSpec generator, implementation artifacts, simulated run UI, review UI, improvement items, and management rollup are valuable.
- The existing Acme Loops company topology remains a strong visual product demo.
- The hidden-labor model remains differentiated and should remain visible.
- Real enterprise integrations and a large monorepo are still deferred.

### What is added or re-scoped

1. **LoopSpec becomes canonical.** TypeScript and YAML/JSON LoopSpec files are the source of truth. The graph is generated from them.
2. **A minimal local runtime is V1.** It must validate and simulate a loop with deterministic fixtures. This is not a full distributed workflow engine.
3. **The CLI is no longer fully deferred.** A small CLI is a launch requirement because it makes the project legible and testable for backend developers.
4. **Context must be reproducible.** Every run stores a context snapshot, provenance, timestamp, sensitivity metadata, and hash.
5. **Approval binds to an exact prepared action.** Approval cannot mean “allow the agent to think again and do something roughly similar.”
6. **A standard `EscalationCase` contract is introduced.** This is the bridge from a simple developer workflow to the broader company-operating-system thesis.
7. **Two first-class templates are required.**
   - `github-issue-triage` is the developer onboarding / teaching template.
   - `strategic-account-escalation` proves the company-operating-system thesis.
8. **The company hierarchy is a template layer, not a mandatory core abstraction.** Company, Department, Management Loop, and Department Loop remain useful but optional.

---

## 1. Product thesis and positioning

### The product in one sentence

**Loopgraph is an open-source, code-first framework for defining, simulating, governing, tracing, and improving recurring AI-human loops.**

### The user-facing promise

> Define an AI loop once. Inspect the exact context it receives, constrain what it can do, route risky actions to the right person, and replay the evidence, policy, verification, approval, and outcome of every run.

### The developer-facing promise

A backend or platform engineer should be able to:

1. clone the repo;
2. initialize a template;
3. inspect a `loopgraph.yaml` or TypeScript `LoopSpec`;
4. validate it locally;
5. simulate a real-looking event with fixtures;
6. inspect compiled context and the structured proposed actions;
7. approve or reject an exact action;
8. replay the complete trace;
9. extend the loop with a custom adapter later.

### What Loopgraph is

| Loopgraph is | Why it matters |
|---|---|
| A versioned LoopSpec contract | The loop can be reviewed in code, stored in Git, diffed, tested, and shared. |
| A control plane for policy-governed AI actions | The system separates model suggestions from deterministic policy and approval decisions. |
| A reproducible context package | Operators can see why a model had the information it did. |
| A trace and evidence model | Teams can inspect inputs, sources, actions, checks, human decisions, and outcomes. |
| A reusable escalation model | Frontline loops can create standardized cases that management and other teams can consume. |
| An operating map / debugger | The visual topology makes loops, dependencies, owners, health, and review pressure understandable. |
| A template ecosystem | Users begin from working examples instead of generic agent primitives. |

### What Loopgraph is not

| Loopgraph is not | Why this boundary matters |
|---|---|
| A replacement for LangGraph, Temporal, Inngest, Trigger.dev, or a queue | Those projects solve durable execution and scheduling at a much deeper level. |
| A replacement for Langfuse or a general LLM observability product | General LLM telemetry and evals are a separate category. |
| A generic chatbot builder | The primary artifact is a recurring, governed loop—not a conversational interface. |
| A generic no-code automation canvas | The visual topology is not the source of truth. |
| A fully autonomous company operating system in V1 | V1 proves the contracts and templates that can eventually support that vision. |
| A connector marketplace in V1 | Mock/local adapters demonstrate the contract before real integrations are added. |

### The defensible differentiation

Do **not** position Loopgraph by claiming that it alone provides traces, human approval, verification, workflow state, or agent tools. Existing projects already provide many of those primitives.

The defensible claim is:

> Existing agent and workflow frameworks provide building blocks for agents, tools, durable workflows, observability, and human pauses. Loopgraph provides the **opinionated contract, escalation semantics, evidence model, templates, topology, and management handoff** needed to turn recurring AI work into accountable company operations.

This must be true in the code and the examples. It cannot just be README language.

---

## 2. Market reality and competitive boundaries

The following projects are adjacent, not targets to imitate feature-for-feature.

| Category | Representative projects | Their strong suit | Loopgraph’s distinct responsibility |
|---|---|---|---|
| Agent/workflow runtime | LangGraph, Mastra, Hatchet/Pickaxe, Trigger.dev, Inngest | Stateful or durable execution, agent/tool orchestration, pause/resume, retries | Define the organization-facing loop contract, context evidence, policy decisions, escalation cases, and outcomes |
| Human-in-the-loop infrastructure | HumanLayer and similar approval systems | Routing questions/approvals to people and resuming work | Make review an explicit part of a standardized operational case, not merely a paused function call |
| LLM observability | Langfuse and similar products | Traces, prompts, evals, datasets, monitoring | Capture loop-level business evidence, policy, approvals, owner decisions, and operational outcome |
| Generic workflow/no-code tools | n8n, Zapier, Pipedream, internal workflow builders | Broad connector coverage and visual automation | Code-first recurring loops with governance, reusable templates, and a management escalation protocol |
| Internal “agent platform” projects | Custom frameworks built inside companies | Fit to one company’s stack | A portable public contract that teams can adapt to their own systems of record |

### Design implication

Loopgraph should integrate with or sit alongside these categories in the future. It should not rebuild all their strengths immediately.

For example:

```text
LangGraph / Mastra / Temporal / Inngest
                ↓
       executes or hosts steps
                ↓
            Loopgraph
  defines loop contract + policy + evidence +
  approval + escalation + operational trace
                ↓
         Langfuse / OpenTelemetry
       general telemetry export
```

This is a conceptual architecture, not an initial integration requirement.

### Public reference set

Maintain these references in the README / docs as comparative context, not as adversarial competitors:

- [LangGraph](https://github.com/langchain-ai/langgraph)
- [Mastra](https://github.com/mastra-ai/mastra)
- [Langfuse](https://github.com/langfuse/langfuse)
- [HumanLayer’s original HN launch](https://news.ycombinator.com/item?id=42247368)

Review these periodically before public launch. Do not make claims about their capabilities without current verification.

---

## 3. V1 north star

### V1 north star

**Prove that a developer can define a recurring AI-human loop as code, simulate it locally with fixtures, inspect exactly what it observed and why it escalated, approve or reject an exact proposed action, and see how the resulting case rolls up into a company operating model.**

### The two connected demo paths

#### Path A — Developer teaching demo: GitHub Issue Triage

This is the immediate, obvious developer demo.

```text
GitHub issue opened
→ load repository policy + issue context
→ classify severity and issue type
→ propose labels / response / follow-up task
→ verify required evidence and schema
→ security-sensitive issues require review
→ approve exact prepared action
→ trace event, context, proposal, policy, review, and outcome
```

Why this must be included:

- Developers understand the trigger instantly.
- It is a true recurring loop.
- It proves context, tools, policy, verification, review, and trace.
- It can run entirely with local fixtures.
- It does not require a prospect to accept the company-topology thesis before seeing value.

#### Path B — Company operating-system demo: Strategic Account Escalation

This shows why Loopgraph is more than a generic agent workflow.

```text
Support ticket / customer signal
→ account, renewal, usage, incident, and history context
→ evidence-backed assessment
→ deterministic escalation policy
→ standardized EscalationCase
→ human decision
→ approved internal response actions
→ parent management loop receives the case
→ outcome and improvement signals feed back into the system
```

Why this must be included:

- It makes the organization-level thesis tangible.
- It shows a reusable cross-functional contract.
- It demonstrates that company topology has a real semantic purpose.
- It ties customer support, customer success, engineering, sales, leadership, and management into an accountable process.

### Important scope discipline

The two templates do **not** require live GitHub, Zendesk, Salesforce, Linear, Slack, or product-analytics credentials in V1.

They require:

- local fixtures;
- mock adapters;
- deterministic policy;
- structured simulation;
- inspectable traces;
- a future adapter interface that makes live integration possible without redefining the loop.

---

## 4. The core architectural decision: code first, graph derived

### Source of truth

The source of truth is:

- `loopgraph.yaml` / JSON, or
- a TypeScript object that validates against the public `LoopSpec` schema.

The source of truth is **not** a manually drawn graph.

### Role of the topology

The topology is generated from LoopSpecs, bindings, templates, and runtime traces. It is a:

- design view;
- operating map;
- dependency map;
- debugging surface;
- management rollup;
- review-pressure visualization.

It is not initially a general workflow editor.

### V1 file layout

The repository can remain a single Next.js application while creating boundaries that make later extraction straightforward.

```text
loopgraph/
├── app/                                  # Existing Next.js routes and API endpoints
├── components/                           # Existing topology, inspector, review, trace UI
├── lib/
│   ├── loopgraph-core/
│   │   ├── loop-spec.ts                  # Zod schema + TS types + JSON Schema export
│   │   ├── policy.ts                     # Deterministic policy evaluator
│   │   ├── graph.ts                      # Generated topology model
│   │   ├── context.ts                    # Context compiler for local simulation
│   │   ├── trace.ts                      # Trace types + writer
│   │   ├── review.ts                     # Exact-action approval model
│   │   ├── escalation.ts                 # EscalationCase contract
│   │   └── schemas/
│   ├── loopgraph-runtime/
│   │   ├── simulator.ts                  # Deterministic local execution
│   │   ├── fixture-loader.ts
│   │   ├── tool-runner.ts
│   │   ├── verifier-runner.ts
│   │   └── state-machine.ts
│   ├── loopgraph-sdk/
│   │   ├── adapters.ts                   # Minimal public interfaces
│   │   ├── providers.ts
│   │   ├── verifiers.ts
│   │   └── conformance.ts
│   └── loop-engineering-builder/         # Existing Design Studio logic, gradually migrated
├── examples/
│   ├── github-issue-triage/
│   ├── strategic-account-escalation/
│   └── acme-company-topology/
├── fixtures/
│   ├── github-issue-triage/
│   └── strategic-account-escalation/
├── scripts/
│   └── loopgraph.ts                      # Minimal CLI entry point
├── supabase/
├── docs/
└── README.md
```

A monorepo remains a V2 extraction decision. Do not block V1 on Turborepo, Redis, worker processes, or packages published to npm.

---

## 5. V1 product surface

### The public V1 artifact

A fresh user should be able to run:

```bash
git clone <repo>
cd loopgraph
npm install
npm run dev

# In a second terminal:
npm run loopgraph -- validate examples/github-issue-triage
npm run loopgraph -- simulate examples/github-issue-triage \
  --fixture fixtures/github-issue-triage/security-issue.json
```

The exact command format can change. The requirement cannot: a developer must be able to validate and simulate without clicking around the UI first.

### Required minimal CLI commands

| Command | Required V1 behavior |
|---|---|
| `loopgraph init <template>` | Copies a local template into a working directory or creates a new LoopSpec skeleton |
| `loopgraph validate <path>` | Validates LoopSpec, schemas, policies, and template bindings |
| `loopgraph simulate <path> --fixture <file>` | Runs deterministic fixture-driven simulation with no external writes |
| `loopgraph trace <run-id>` | Prints or opens a readable trace summary |
| `loopgraph export-graph <path>` | Emits the derived topology JSON |
| `loopgraph adapter test <adapter-path>` | Runs a minimal adapter conformance suite; may be introduced as experimental if time is constrained |

Do not add `dev`, production deployment, scheduling, or live execution semantics until the first five commands work cleanly.

### Required V1 web experience

| Screen | V1 requirement |
|---|---|
| Topology | Generated operating map with loop status, open reviews, pending escalations, run health, and links to inspectors |
| Loop detail | Spec, context package, policy, verifier, action policy, trace history, and artifacts |
| Context inspector | Exact context snapshot, source provenance, freshness, sensitivity, redaction state, token budget, and hash |
| Trace viewer | Event, inputs, context snapshot, tool calls, proposed actions, policy checks, verifier results, reviews, outcome |
| Human review | Evidence-backed decision packet; approve/reject/edit/reassign/request more evidence |
| Escalation case page | Cross-functional ownership, deadline, decisions required, response plan, outcome tracker |
| Design Studio | Existing company/department/template question flow, explicitly labeled as an optional blueprint-building layer |

### Existing V1 Design Studio remains useful

The current “vague goal → questions → LoopSpec → implementation artifacts → simulated run → review → improvement” journey remains in scope. It should be called **Design Studio** in the UI and docs, not treated as the only way to author a loop.

Developer-authored LoopSpecs and Design Studio-generated LoopSpecs must converge on the same schema.

---

## 6. Canonical LoopSpec

### Design requirements

The public schema must be:

- versioned;
- serializable;
- language-neutral;
- exportable as JSON Schema;
- usable from TypeScript;
- validated without a running web app;
- readable in a pull request;
- strict about action policies and output schemas;
- permissive enough that not every user must model an entire company.

### V1 LoopSpec shape

```ts
export type LoopSpec = {
  apiVersion: "loopgraph/v1alpha1"
  kind: "Loop"

  metadata: {
    id: string
    name: string
    version: string
    description?: string
    labels?: Record<string, string>
    owner?: OwnerRef
  }

  trigger: TriggerSpec

  input: {
    schema: JSONSchema
    fixtures?: FixtureRef[]
  }

  output: {
    schema: JSONSchema
  }

  context: {
    sources: ContextSource[]
    precedence: ContextPrecedenceRule[]
    tokenBudget?: TokenBudget
    redactionPolicy?: RedactionPolicy
  }

  routine: {
    steps: RoutineStep[]
  }

  tools: ToolBinding[]

  policy: {
    allowedActions: ActionPolicy[]
    forbiddenActions?: ForbiddenActionRule[]
    escalationRules: EscalationRule[]
    riskLimits?: RiskLimit[]
  }

  verification: VerifierBinding[]

  approval: ApprovalPolicy

  persistence: {
    idempotency: IdempotencyPolicy
    timeout?: TimeoutPolicy
    retry?: RetryPolicy
  }

  trace: {
    captureContextSnapshot: true
    captureToolInputOutput: true
    evidenceRequired: boolean
    exportOpenTelemetry?: boolean
  }

  topology?: {
    parentLoopId?: string
    department?: string
    tags?: string[]
  }
}
```

### Mandatory design rules

1. `apiVersion`, `kind`, `metadata.id`, and `metadata.version` are always required.
2. Each tool has an explicit action schema and risk classification.
3. A loop cannot define a write-capable tool without an action policy.
4. An action requiring approval must be prepared and fingerprinted before review.
5. A loop cannot claim evidence-backed output without defining evidence requirements.
6. An escalation rule must identify route, owner role, deadline policy, and decision requirements.
7. A run must record the exact LoopSpec version and a content hash.
8. The Context Compiler must record source provenance and content hashes.
9. Free-form prose can supplement structured output but cannot replace it.

### Structured agent output

Do not require or store raw model chain-of-thought. Require an auditable structured artifact:

```ts
export type AgentRunOutput = {
  decisionSummary: string
  assumptions: Assumption[]
  proposedActions: ProposedAction[]
  evidence: EvidenceRef[]
  policyInputs: PolicyInput[]
  verificationRequest: VerificationRequest
  escalationRequest?: EscalationRequest
  memoryWrites?: MemoryWrite[]
  metricUpdates?: MetricUpdate[]
}
```

---

## 7. Runtime modes and state machine

### Four named modes

| Mode | External reads | External writes | V1 status | Purpose |
|---|---:|---:|---|---|
| `validate` | No | No | Required | Static schema, contract, policy, and template validation |
| `simulate` | Fixture only | No | Required | Deterministic local run; primary V1 demo |
| `dry-run` | Read-only adapters allowed | No | Defined, may be experimental | Test live context without side effects |
| `execute` | Policy-controlled | Policy-controlled | Deferred | Production execution with real integrations |

### V1 state machine

```text
DRAFT
→ VALIDATED
→ READY
→ SIMULATING
→ PROPOSED_ACTIONS
→ VERIFYING
→ WAITING_FOR_REVIEW
→ APPROVED
→ COMMITTED
→ COMPLETED

Alternate outcomes:
→ FAILED_VALIDATION
→ FAILED_VERIFICATION
→ ESCALATED
→ REJECTED
→ BLOCKED_BY_POLICY
→ CANCELLED
```

### Non-negotiable runtime semantics

#### Idempotency

Every trigger event must carry an idempotency key. Re-running the same event must not silently create duplicate external actions in future live mode.

```ts
idempotencyKey = hash(loopSpecVersion + triggerSource + sourceEventId)
```

#### Event depth and loops

V1 should prevent recursive storms before they exist:

- maximum parent/child run depth;
- maximum escalation re-entry depth;
- deduplicated event IDs;
- no auto-execution of `learns_from` or `reports_to` graph edges;
- all derived parent-management updates are explicit events.

#### Exact-action approval binding

The approval flow is:

```text
Agent proposes action
→ runtime prepares exact mutation payload
→ payload receives action fingerprint
→ policy evaluates risk and approval requirement
→ human reviews that exact payload
→ approval signs or references fingerprint
→ runtime commits exact payload
→ result is traced
```

The system must reject a commit if the prepared action payload differs from the approved fingerprint.

#### No hidden re-planning after approval

A reviewer approves a concrete action, not a broad permission for the model to generate new behavior after it resumes.

---

## 8. Reproducible context and evidence model

### Context is a first-class product surface

The context compiler is one of Loopgraph’s most valuable technical ideas. Its output must be inspectable, deterministic within a defined snapshot, and safe to use.

### Context compilation order

```text
1. Global system policy
2. Organization policy
3. Company / account context when supplied
4. Parent loop context
5. Current loop context
6. Integration variables and source data
7. Relevant trace summaries
8. Scoped memory entries
9. Current event
10. Available tools and action policies
11. Verifier rubric
12. Escalation and approval rules
```

### Context snapshot requirements

```ts
export type ContextSnapshot = {
  id: string
  loopId: string
  loopSpecVersion: string
  createdAt: string
  contentHash: string
  tokenEstimate: number

  entries: Array<{
    sourceId: string
    sourceType: "policy" | "fixture" | "integration" | "memory" | "event" | "trace"
    title: string
    value: unknown
    retrievedAt?: string
    freshness?: "realtime" | "hourly" | "daily" | "manual" | "fixture"
    sensitivity: "public" | "internal" | "confidential" | "restricted"
    trusted: boolean
    redactionApplied?: boolean
    contentHash: string
  }>

  compiledPrompt?: string
}
```

### Context security requirements

- Untrusted external text must be marked as untrusted.
- Tool instructions embedded in tickets, documents, messages, or issue bodies cannot override system/loop policy.
- Restricted data must be redacted or excluded according to the loop’s redaction policy.
- Context precedence is explicit.
- Context snapshots are immutable after a run starts.
- Every output claim requiring evidence must cite an `EvidenceRef`.

---

## 9. Trace, verification, review, and measurement

### Required V1 trace contract

```ts
export type LoopRunTrace = {
  id: string
  loopId: string
  loopSpecVersion: string
  loopSpecHash: string
  parentRunId?: string

  mode: "validate" | "simulate" | "dry-run" | "execute"
  status: RunStatus

  trigger: TriggerRef
  idempotencyKey: string

  contextSnapshot: ContextSnapshot
  inputs: InputSnapshot[]

  proposedActions: ProposedAction[]
  preparedActions: PreparedAction[]
  toolCalls: ToolCallTrace[]

  policyDecisions: PolicyDecision[]
  verificationResults: VerificationResult[]

  escalationCases: string[]
  humanReviews: HumanReviewTrace[]

  outputs: OutputArtifact[]
  metrics: MetricUpdate[]
  errors: RunError[]

  startedAt: string
  completedAt?: string
  latencyMs?: number
  estimatedCost?: number
}
```

### Basic V1 verifiers

| Verifier | Required behavior |
|---|---|
| Schema verifier | Ensures structured output conforms to the declared output schema |
| Policy verifier | Ensures every proposed action conforms to allowed/forbidden action policy |
| Evidence/citation verifier | Ensures high-impact claims and escalation criteria reference accepted evidence |
| Numeric threshold verifier | Checks policy thresholds deterministically |
| Approval-required verifier | Detects any action that must enter human review |
| Mock judge verifier | Optional, fixture-driven quality score; never the sole basis for a high-risk decision |

### Human review roles

The model must not flatten all human involvement into “HITL.”

| Role | Responsibility |
|---|---|
| Approver | Authorizes a prepared action or decision |
| Reviewer | Evaluates evidence and output quality |
| Owner | Accountable for completion and follow-through |
| Teacher | Explains correction that should influence future template/policy changes |
| Executor | Carries out an approved action when automation is not allowed |
| Accountability holder | Owns business outcome after the loop has completed |

### Hidden labor measurement

Keep the existing hidden-labor concept, but distinguish **observed** values from **modeled estimates**.

```text
net_saved_minutes =
gross_saved_minutes
- review_minutes
- rework_minutes
- botsitting_minutes
- escalation_minutes
- governance_minutes
```

Rules:

- In V1 simulation, baseline time and gross savings are estimates and must be labeled as such.
- Review, rework, botsitting, escalation, and governance minutes entered by humans are observed values.
- Negative net saved is valid and useful.
- Do not claim causal productivity improvement before outcome data exists.

---

## 10. Standardized EscalationCase contract

### Why it exists

The EscalationCase is the bridge between a single useful developer loop and the company-operating-system thesis.

A GitHub triage loop, customer-risk loop, security incident loop, sales-risk loop, product-risk loop, finance-risk loop, or compliance loop can all emit the same durable business object.

A management loop can then consume the object without re-running or reinterpreting every underlying workflow.

### Canonical schema

```ts
export type EscalationCase = {
  id: string
  sourceRunId: string
  sourceLoopId: string
  createdAt: string

  category:
    | "customer_risk"
    | "service_incident"
    | "security"
    | "revenue_risk"
    | "legal_risk"
    | "product_gap"
    | "operational_blocker"

  severity: "P0" | "P1" | "P2" | "P3"
  confidence: number

  affectedEntities: {
    companyId?: string
    accountId?: string
    accountName?: string
    repository?: string
    contacts?: string[]
    contractValue?: number
    renewalDate?: string
    productAreas?: string[]
  }

  summary: string
  customerImpact?: string
  businessImpact?: string
  suspectedCause?: string

  evidence: EvidenceRef[]
  unresolvedQuestions: string[]

  recommendedActions: ProposedAction[]
  decisionsRequired: DecisionRequest[]

  routing: {
    primaryOwner: RoleRef
    reviewers: RoleRef[]
    informed: RoleRef[]
    escalationDeadline: string
    nextUpdateDueAt?: string
  }

  responsePlan: {
    internalActions: PreparedAction[]
    customerFacingDraft?: PreparedAction
    successCriteria: string[]
  }

  status:
    | "open"
    | "under_review"
    | "approved"
    | "in_progress"
    | "resolved"
    | "closed"
    | "rejected"

  outcome?: {
    resolutionSummary: string
    resolvedAt?: string
    businessResult?: string
    customerResult?: string
    classificationCorrect?: boolean
    followUpRequired?: boolean
  }
}
```

### Required invariants

- An escalation case cannot have `severity` without evidence.
- A high-severity case must have a primary owner, response deadline, and decisions required.
- A case with customer-facing or commercial commitments must separate internal approval from external message approval.
- The management loop consumes the case; it does not recreate the original classification from scratch.
- Outcome data must be written back to the trace and improvement queue.

---

## 11. Template 1: GitHub Issue Triage

### Purpose

Teach developers how Loopgraph works with a familiar recurring event, using local fixtures and no external dependencies.

### Trigger

```yaml
trigger:
  type: webhook
  source: github
  event: issues.opened
```

### Inputs

- issue title;
- issue body;
- repository metadata;
- existing labels;
- recent related issues;
- repository policy;
- code-of-conduct / security escalation rules;
- optional fixture-based file ownership metadata.

### Allowed actions

- propose labels;
- draft a maintainer response;
- create a follow-up task;
- route an issue to a code owner;
- create a Security EscalationCase.

### Forbidden actions in V1

- close an issue;
- merge code;
- create or modify pull requests;
- publish a public advisory;
- make security claims without human review.

### Example policy

```yaml
policy:
  escalationRules:
    - id: possible-security-issue
      when:
        any:
          - issue.labels contains "security"
          - issue.body matches "(credential|vulnerability|exploit|CVE|token leak)"
      createEscalationCase:
        category: security
        severity: P1
      routeTo:
        primaryOwner: security_owner
        reviewers: [maintainer]
      requiresApproval:
        - customer_or_public_response
        - issue_label_mutation
```

### Minimum fixture set

```text
fixtures/github-issue-triage/
├── normal-bug.json
├── duplicate-feature-request.json
├── security-issue.json
├── unclear-reproduction.json
└── expected-traces/
```

### Acceptance criteria

- `normal-bug.json` produces labels, a response draft, and no escalation.
- `security-issue.json` produces an EscalationCase and requires review.
- Every classifier claim includes issue evidence.
- The trace shows repository policy, issue content, policy decision, review, and final outcome.
- A reviewer can approve exactly one prepared label/comment action.
- A changed payload invalidates approval.

---

## 12. Template 2: Strategic Account Escalation

### Purpose

Turn scattered customer-risk signals into a structured, evidence-backed, policy-governed response plan with accountable ownership, deadlines, approvals, and a traceable outcome.

### The core user story

An enterprise customer opens a support ticket:

> “Your platform has been failing intermittently all morning. We have our board meeting tomorrow and cannot use the reporting dashboard. If this is not resolved today, we will need to evaluate alternatives.”

Loopgraph should not send a generic automated reply, notify everyone, or autonomously make commercial commitments.

It should:

1. identify the account;
2. assemble the relevant account and incident context;
3. classify customer and business severity;
4. validate evidence against deterministic thresholds;
5. create an EscalationCase;
6. route the exact decisions and internal actions to the correct owners;
7. track response and resolution;
8. send outcome information to the parent management loop;
9. create improvement signals if the classification, context, policy, or handoff was weak.

### Trigger sources

The V1 template can support all of these through fixtures, while only one trigger needs to be implemented:

- support ticket created or updated;
- customer success note;
- product incident;
- renewal-risk signal;
- executive escalation email;
- NPS / survey response;
- account health score change.

### Context sources

```ts
const contextSources = [
  "support.ticket.current",
  "support.ticket.history_90d",
  "crm.account",
  "crm.contract",
  "crm.renewal",
  "product.usage_30d",
  "status.incidents.current",
  "customer_success.account_plan",
  "customer_success.commitments",
  "loopgraph.account_memory",
]
```

In V1, each source is a fixture or mock adapter. Do not require live Zendesk, Salesforce, Segment, Datadog, Slack, Linear, or Jira.

### Required structured assessment

```ts
export type CustomerEscalationAssessment = {
  account: {
    id: string
    name: string
    segment: "enterprise" | "mid_market" | "smb"
    arr?: number
    renewalDate?: string
    customerHealth?: "healthy" | "watch" | "at_risk"
  }

  incident: {
    category:
      | "service_outage"
      | "product_defect"
      | "security_concern"
      | "billing_dispute"
      | "support_failure"
      | "commercial_risk"
      | "feature_gap"

    severity: "P0" | "P1" | "P2" | "P3"
    confidence: number
  }

  evidence: EvidenceRef[]

  customerImpact: {
    summary: string
    blockedWorkflow?: string
    affectedUsers?: number
    statedDeadline?: string
  }

  businessImpact: {
    renewalRisk: "low" | "medium" | "high"
    revenueAtRisk?: number
    executiveEscalationRisk: "low" | "medium" | "high"
    reputationalRisk: "low" | "medium" | "high"
  }

  recommendedActions: {
    internal: ProposedAction[]
    customerFacing: ProposedAction[]
  }

  decisionsRequired: DecisionRequest[]

  escalationRecommendation: {
    shouldEscalate: boolean
    routingTier: "cs_only" | "cross_functional" | "leadership"
    rationale: string
  }
}
```

### Example deterministic policy

```yaml
version: loopgraph/v1alpha1
name: strategic-account-escalation-policy

rules:
  - id: strategic-account-service-failure
    when:
      all:
        - account.segment in ["enterprise", "strategic"]
        - incident.category == "service_outage"
        - incident.severity in ["P0", "P1"]
    action:
      createEscalationCase: true
      routeTo:
        primaryOwner: customer_success_owner
        reviewers:
          - engineering_incident_owner
          - account_executive
      responseSla: "15m"
      customerUpdateSla: "30m"
      requiresHumanApproval:
        - external_customer_message
        - commercial_commitment
        - public_status_update

  - id: renewal-risk
    when:
      all:
        - account.renewalDaysRemaining <= 90
        - businessImpact.renewalRisk == "high"
    action:
      createEscalationCase: true
      routeTo:
        primaryOwner: customer_success_owner
        reviewers:
          - account_executive
          - sales_owner
      responseSla: "60m"
      requiresHumanApproval:
        - discount_offer
        - contract_change
        - executive_outreach

  - id: low-risk-support-case
    when:
      all:
        - incident.severity in ["P2", "P3"]
        - businessImpact.renewalRisk == "low"
    action:
      createEscalationCase: false
      allow:
        - draft_internal_reply
        - create_follow_up_task
      requiresHumanApproval:
        - customer_message
```

### Review packet requirements

The reviewer must receive a decision packet, not a vague “AI thinks this is urgent” alert.

```text
Strategic Account Escalation: Acme Corp
Severity: P1
Confidence: 0.91
Potential revenue at risk: $180,000 ARR
Renewal date: August 14, 2026
Primary issue: Reporting dashboard unavailable during board-preparation period

Evidence:
- Support ticket cites a board meeting tomorrow
- A current incident affects dashboard exports
- Two related tickets opened in the last four hours
- Account usage declined 31% over the prior 30 days
- Contract renewal is within 48 days

Recommended internal actions:
1. Page Engineering Incident Owner
2. Create a P1 incident task
3. Assign the CSM to send a customer update within 30 minutes
4. Ask the Account Executive to prepare executive outreach if unresolved by 14:00

Decision required:
Approve the internal escalation package and the specific internal action payloads.

Customer-facing message:
Draft only. It requires a separate approval before sending.
```

### Parent management-loop handoff

The Customer Escalation Loop answers:

> What is happening to this customer, how serious is it, what evidence supports that judgment, and what should happen next?

The Management Escalation Loop answers:

> Does this require cross-functional resource allocation, executive involvement, deadline management, a policy change, or a broader operational response?

The management loop must consume the EscalationCase. It must not re-classify raw support data.

### Example management-loop output

```json
{
  "resourceDecision": {
    "engineeringPriority": "P1",
    "customerSuccessCoverage": "executive_sponsor_required",
    "salesInvolvement": true
  },
  "crossFunctionalDependencies": [
    "Engineering must confirm root cause by 13:30",
    "Customer Success must send an update by 13:45",
    "Sales must prepare a renewal-risk recovery plan if unresolved today"
  ],
  "leadershipDecisionRequired": false,
  "monitoringPlan": {
    "nextReviewAt": "2026-06-27T14:00:00Z",
    "successCriteria": [
      "Service restored",
      "Customer updated within SLA",
      "Root cause documented",
      "Renewal-risk owner assigned"
    ]
  }
}
```

### Required fixture set

```text
fixtures/strategic-account-escalation/
├── enterprise-outage-near-renewal.json
├── low-risk-product-question.json
├── billing-dispute-without-renewal-risk.json
├── executive-escalation.json
├── incomplete-account-context.json
└── expected-traces/
```

### Acceptance criteria

- Enterprise outage near renewal creates a P1 EscalationCase.
- A low-risk question does not escalate to a cross-functional review.
- Missing CRM / renewal context lowers confidence and creates a “need more evidence” review state rather than a fabricated claim.
- Customer-facing language is always a separately prepared and separately approved action.
- The management loop consumes the normalized case and produces an ownership/dependency plan.
- Resolution writes outcome and improvement signals back to the case and originating run.

---

## 13. Company topology and hierarchy

### Core vs optional organizational model

The following objects are useful but not mandatory for every LoopSpec:

- Company
- Department
- Management Loop
- Department Loop
- Workflow Loop
- Task Loop

A developer can run GitHub Issue Triage without defining a company. An organization can attach the loop to a company/department hierarchy later.

### Topology node semantics in V1

Only these relationships have meaningful operational semantics in V1:

| Edge type | V1 behavior |
|---|---|
| `observes` | Declares a context or signal dependency |
| `calls` | May create an explicit child run; no automatic recursion |
| `verifies_with` | Associates a verifier binding |
| `requires_approval` | Routes prepared actions to review |
| `escalates_to` | Emits or routes an EscalationCase |
| `writes_trace_to` | Shows trace persistence destination |

The following remain visual/informational until exact runtime semantics exist:

- `reports_to`
- `learns_from`
- `depends_on`
- `blocks`
- `updates_metric`
- `owns`
- `contains`

### Topology UI requirements

The topology must answer:

- What loops exist?
- What signals and systems do they observe?
- Which loops have failed or are blocked?
- Which cases need human review?
- Who owns the next decision?
- Which traces created the current state?
- Which escalation cases are open?
- Which loops have a concerning review / botsitting burden?

It must not initially be sold as a drag-and-drop workflow-authoring environment.

---

## 14. Integration, provider, verifier, and storage interfaces

### V1 interface goal

Define stable interfaces now. Ship mock/local implementations only. Do not build a large marketplace or OAuth flow.

```ts
export interface IntegrationAdapter {
  id: string
  name: string
  version: string

  getConfigSchema(): JSONSchema
  getAuthSchema(): JSONSchema

  listVariables(config: IntegrationConfig): Promise<VariableDefinition[]>
  listActions(config: IntegrationConfig): Promise<ActionDefinition[]>
  listSignals(config: IntegrationConfig): Promise<SignalDefinition[]>

  readVariable(input: ReadVariableInput): Promise<VariableValue>
  prepareAction(input: PrepareActionInput): Promise<PreparedAction>
  commitPreparedAction(input: CommitPreparedActionInput): Promise<ActionResult>

  healthCheck(config: IntegrationConfig): Promise<HealthCheckResult>
}
```

### Important change from the original interface

Use `prepareAction` and `commitPreparedAction`, not only `executeAction`.

This makes human approval enforceable against the exact mutation payload.

### Required mock/local adapters

| Adapter | Required purpose |
|---|---|
| `mock-github` | GitHub Issue Triage template |
| `mock-support` | Customer ticket source |
| `mock-crm` | Account, contract, renewal, ARR context |
| `mock-product-analytics` | Usage and account-health signal |
| `mock-status` | Current incident context |
| `mock-linear` | Prepared / approved internal task action |
| `local-json` | General fixture-backed adapter |
| `webhook` | Trigger shape and local event injection |

### Minimal provider and verifier interfaces

```ts
export interface LLMProvider {
  id: string
  generateObject<T>(input: LLMStructuredInput, schema: JSONSchema): Promise<T>
}

export interface Verifier {
  id: string
  verify(input: VerificationInput): Promise<VerificationResult>
}

export interface StorageAdapter {
  saveRun(trace: LoopRunTrace): Promise<void>
  getRun(runId: string): Promise<LoopRunTrace | null>
  saveReview(review: HumanReview): Promise<void>
  saveEscalationCase(caseItem: EscalationCase): Promise<void>
}
```

### V1 implementation

- Deterministic fixture provider required.
- Optional “mock LLM provider” allowed for rich demo language.
- SQLite/file storage for standalone examples is preferred.
- Supabase remains the persisted Design Studio implementation.
- Real model providers are optional and must be visibly labeled experimental.
- No real external write-capable adapter is required for V1.

---

## 15. Existing application work that remains required

The prior plan’s implementation work remains valid. It now supports both the Design Studio and the code-first core.

### P0 launch blockers carried forward

| ID | Issue | Required resolution |
|---|---|---|
| P0-1 | Supabase configured but empty DB silently falls back to demo | Show explicit empty workspace; never mix persisted and demo data silently |
| P0-2 | `createLoop()` creates a new org every time | Attach to existing org/workspace |
| P0-3 | Template picker only lists marketing loops | Dynamic department template loading |
| P0-4 | Hidden-labor values may not alter health | Use latest review values in all health/net-saved calculations |
| P0-5 | Runs page shows only latest run | Show full run history and trace links |
| P0-6 | UI implies live automation | Apply simulated / blueprint / fixture indicators consistently |
| P0-7 | Supabase seed lacks demo-equivalent workspace | Seed full Acme topology or provide an idempotent seed script |
| P0-8 | Non-marketing DB templates are empty | Wire real templates or label them honestly as starters |

### New P0 blockers created by the developer-first wedge

| ID | Issue | Required resolution |
|---|---|---|
| P0-9 | LoopSpec only exists as app-internal generated data | Export a public schema and support file-based specs |
| P0-10 | Graph can be treated as primary source of truth | Generate topology from LoopSpecs; document this invariant |
| P0-11 | Simulation cannot be run outside the UI | Add validate + simulate CLI/script path |
| P0-12 | Context is represented as static artifacts without provenance | Implement immutable local ContextSnapshot with hashes and source metadata |
| P0-13 | Approval is not bound to exact mutation payload | Implement prepared-action fingerprint / approval binding |
| P0-14 | Trace does not record policy / evidence / prepared actions consistently | Expand trace schema and viewer |
| P0-15 | No standardized case handoff across loops | Add EscalationCase schema and demo template |
| P0-16 | The README does not explain why Loopgraph exists beside existing frameworks | Add clear competitive boundary and “what we own” section |

### P1 launch-quality work carried forward

- Generate separate `agent.md`, `routine.md`, `verifier.md`, `escalation.md`, `metrics.md`, and `tools.md` artifacts.
- Parameterize implementation artifacts with real loop identifiers, owners, metrics, and policy conditions.
- Surface `loop_requirements` in a checklist UI.
- Persist management rollup output to `management_reviews`.
- Add GitHub Actions for install, typecheck, test, and build.
- Add a second and third polished Design Studio template: Sales Pipeline Learning and Strategic Account Escalation.
- Document all environment variables, especially any unused `OPENAI_API_KEY` as reserved / experimental.
- Add license and contributor guidance.

---

## 16. Revised epics and build order

### Epic 0 — Lock decisions before building

**Goal:** Avoid implementing contradictory product models.

#### Decisions to make

1. Product/repo/CLI name: **Loopgraph**.
2. Source of truth: **LoopSpec file**, not canvas.
3. V1 runtime: **validate + deterministic simulate**, not distributed execution.
4. V1 storage: **local file/SQLite for examples; Supabase optional for Design Studio**.
5. Hero templates: **GitHub Issue Triage** and **Strategic Account Escalation**.
6. Company hierarchy: **optional topology package / metadata**, not required to create a loop.
7. V1 live integrations: **none required**.
8. V1 approval semantics: **prepared action fingerprinting required**.
9. V1 LLM usage: **fixture provider required; live provider optional and clearly experimental**.
10. Public license: choose and commit before launch.

#### Acceptance criteria

- A one-page architecture decision record exists for all ten decisions.
- All docs use “Loopgraph”; remove or demote “LoopCraft” unless it is intentionally retained as an internal codename.
- No open task contradicts the decisions above.

---

### Epic 1 — Public LoopSpec and file-based authoring

**Goal:** Make the loop a real, portable developer artifact.

#### Work

- Extract / rewrite LoopSpec Zod schema into `lib/loopgraph-core/loop-spec.ts`.
- Export TypeScript types and JSON Schema.
- Add version validation and migration placeholder.
- Add YAML/JSON loader.
- Define output, evidence, action, policy, approval, verifier, context, and trace contracts.
- Add `examples/github-issue-triage/loopgraph.yaml`.
- Add `examples/strategic-account-escalation/loopgraph.yaml`.
- Modify existing Design Studio generator so it emits valid public LoopSpecs.

#### Acceptance criteria

- Both templates validate outside the browser.
- A Design Studio-generated loop can be exported as a LoopSpec file and re-imported without loss of required semantics.
- Invalid write action without policy fails validation.
- Escalation rule without owner or deadline policy fails validation.

---

### Epic 2 — Deterministic simulator, fixtures, and minimal CLI

**Goal:** Let developers experience Loopgraph without a deployment or API keys.

#### Work

- Implement `validate` and `simulate` command path.
- Implement fixture loader and mock provider.
- Implement mock/local adapters.
- Implement state machine with terminal outcomes.
- Implement idempotency key generation.
- Build stable, snapshot-tested expected traces.
- Emit trace JSON and a readable terminal summary.

#### Acceptance criteria

- `github-issue-triage` runs against at least four fixtures.
- `strategic-account-escalation` runs against at least five fixtures.
- Simulation never performs an external write.
- The same input fixture produces the same structured trace in deterministic mode.
- Trace includes spec version/hash, context snapshot hash, evidence, policy decisions, verification, reviews, and result.

---

### Epic 3 — Prepared actions, verification, and human review

**Goal:** Prove Loopgraph’s governance model is meaningful, not an approval button.

#### Work

- Implement `PreparedAction`.
- Implement action fingerprint calculation.
- Implement review object and status state transitions.
- Implement schema/policy/evidence/numeric/approval verifiers.
- Update review UI to show exact action payload and evidence.
- Reject modified action payload after approval unless it is re-reviewed.
- Capture teacher feedback and review labor.

#### Acceptance criteria

- A reviewer can approve individual internal actions without approving all proposed actions.
- Customer-facing messages require separate review from internal actions.
- A payload change invalidates the approval.
- Reject/edit/escalate creates a linked improvement item.
- The trace indicates reviewer role, decision, time, and comment.

---

### Epic 4 — EscalationCase and company handoff

**Goal:** Connect the developer loop to the company-operating-system thesis.

#### Work

- Implement EscalationCase schema, persistence, route/view, and fixture output.
- Implement Strategic Account Escalation template.
- Implement a constrained Management Escalation Loop consumer that takes an EscalationCase and creates ownership/dependency plan.
- Add topology edges from source loop → EscalationCase → management loop.
- Add management dashboard case summary.

#### Acceptance criteria

- Enterprise outage fixture creates a visible P1 EscalationCase.
- Low-risk fixture does not create a cross-functional escalation.
- Management consumer uses case fields, not raw ticket fields.
- Case has owners, deadlines, decisions required, evidence, and success criteria.
- Outcome is writable and produces an improvement signal.

---

### Epic 5 — Context inspector, trace viewer, and topology alignment

**Goal:** Make Loopgraph inspectable enough to earn developer trust.

#### Work

- Build ContextSnapshot viewer with source metadata.
- Expand trace viewer with all contract sections.
- Generate graph from LoopSpecs / cases / runs.
- Keep existing React Flow and ELK UI.
- Add filters for open reviews, escalations, failed verification, blocked policy, and high hidden labor.
- Ensure new loops appear in topology.
- Preserve graph view state in Supabase where supported.

#### Acceptance criteria

- A developer can trace one claim to its source evidence.
- A reviewer can see why a proposed action required approval.
- Topology shows source loop, context systems, verifier, review, EscalationCase, management loop, and outcome state.
- The graph never implies edges execute automatically when they are informational only.

---

### Epic 6 — Design Studio parity and existing app hardening

**Goal:** Preserve the visual product and prevent demo/persistence confusion.

#### Work

- Complete all carried-forward P0 items.
- Preserve Acme Loops topology with 8 departments.
- Make 3 Design Studio templates genuinely complete: Marketing Campaign Learning, Sales Pipeline Learning, Strategic Account Escalation.
- Improve context document artifacts.
- Wire hidden labor to metrics and health.
- Persist management reviews.
- Seed full demo-equivalent Supabase data.
- Make simulation labels unmissable.

#### Acceptance criteria

- Clean clone without `.env` works in Demo Mode.
- Fresh Supabase setup works without fallback confusion.
- Existing Acme topology and code-first template topology tell the same story.
- Hidden-labor numbers change after review input.
- No screen claims live integration where only fixtures exist.

---

### Epic 7 — Documentation, CI, and public release package

**Goal:** Make the project easy to evaluate and difficult to misunderstand.

#### Work

- Rewrite README around the developer promise and first 10 minutes.
- Add `docs/loop-spec.md`, `docs/context-snapshots.md`, `docs/trace-model.md`, `docs/approval-model.md`, `docs/escalation-case.md`, `docs/template-authoring.md`, and `docs/roadmap.md`.
- Add comparison / interoperability boundary doc.
- Add CI: install, typecheck, tests, build, fixture snapshots.
- Add CONTRIBUTING.md, license, issue templates, and security policy.
- Add screenshots/GIFs of the two demos.
- Add manual QA script.
- Explain V1 vs V1.1 vs V2 honestly.

#### Acceptance criteria

- A new developer can complete GitHub Issue Triage locally in under ten minutes.
- A new evaluator can understand the Strategic Account Escalation loop in under fifteen minutes.
- CI tests both hero templates on every PR.
- README clearly explains the boundary with existing agent/workflow/observability tools.
- Public roadmap makes deferrals explicit.

---

## 17. Acceptance tests for public launch

### Code-first core

- [ ] `LoopSpec` validates from TypeScript and YAML/JSON.
- [ ] Public JSON Schema is generated and documented.
- [ ] The same LoopSpec compiles from Design Studio and from file authoring.
- [ ] Invalid tool action without policy fails validation.
- [ ] Invalid escalation without route/owner/deadline fails validation.

### Local demo

- [ ] `loopgraph init github-issue-triage` creates a runnable sample.
- [ ] `loopgraph validate` succeeds for both hero templates.
- [ ] `loopgraph simulate` succeeds without external API keys.
- [ ] Fixture outputs are deterministic.
- [ ] `loopgraph trace` displays a readable full trace.
- [ ] No simulation performs external writes.

### Context and evidence

- [ ] Every run records immutable ContextSnapshot.
- [ ] Context entries expose provenance, timestamp/freshness, sensitivity, and content hash.
- [ ] Every high-impact claim in a case has evidence references.
- [ ] Untrusted source text is visibly marked.
- [ ] Context inspector explains source precedence.

### Action and review governance

- [ ] Every action is classified by risk.
- [ ] Approval-required actions use PreparedAction fingerprinting.
- [ ] Changed payload invalidates approval.
- [ ] Review can approve/reject/edit/reassign/request evidence.
- [ ] Internal and customer-facing actions can be approved independently.
- [ ] Review data contributes to hidden-labor measurement.

### Escalation and operating model

- [ ] Customer template creates a typed EscalationCase.
- [ ] Case has evidence, severity, owner, deadlines, action plan, and decisions required.
- [ ] Management loop consumes EscalationCase rather than raw source data.
- [ ] Resolution writes an outcome and an improvement signal.
- [ ] Topology visibly connects source loop, case, human review, management loop, and outcome.

### Existing application quality

- [ ] Demo Mode and Supabase Mode clearly differ and never silently mix data.
- [ ] All department template pickers work.
- [ ] New loops attach to the correct organization.
- [ ] Run history displays all runs.
- [ ] Hidden labor changes health/net saved calculation.
- [ ] Weekly management rollup persists.
- [ ] No UI implies live integrations where none exist.

### Release quality

- [ ] `npm run typecheck`, `npm run test`, `npm run build` pass in CI.
- [ ] Fixture snapshot tests pass in CI.
- [ ] README has a <10-minute quickstart.
- [ ] License, CONTRIBUTING, SECURITY, and issue templates exist.
- [ ] Public demo is available or the local demo is sufficient and documented.

---

## 18. Roles and ownership

Do not split the contracts below across unrelated owners. They form one coherent system.

| Workstream | Single accountable owner | Key output |
|---|---|---|
| Product thesis and scope control | Product/technical architect | Scope decisions, positioning, non-goals, template quality bar |
| LoopSpec and schema contracts | Platform/backend owner | Public schema, JSON Schema export, migrations, validation |
| Policy, approval, and review semantics | Platform/backend owner | PreparedAction fingerprinting, policy evaluation, review state machine |
| Context compiler and trace model | Platform/backend owner | ContextSnapshot, evidence provenance, trace schema |
| Simulator and mock adapters | Runtime/backend owner | Deterministic fixtures, simulation engine, adapter conformance |
| GitHub Issue Triage template | Developer experience owner | First-ten-minute demo and docs |
| Strategic Account Escalation template | Product systems owner | EscalationCase, management handoff, review packet |
| Topology, inspector, trace, review UX | Frontend/product design owner | Debuggable operating map and decision UI |
| Design Studio and generated artifacts | Product/full-stack owner | Goal-to-LoopSpec builder / artifact quality |
| Docs, CI, contributor experience | Developer experience owner | README, docs, tests, release workflow |

### Do not delegate without clear ownership

- LoopSpec.
- Context precedence/provenance.
- Action approval binding.
- EscalationCase.
- Runtime state machine.

These are the core intellectual property of the project. If they drift, Loopgraph becomes a collection of screens and templates.

---

## 19. Recommended build sequence

### Phase 1 — Make one loop real in code

Build in this order:

1. `LoopSpec` schema and JSON Schema export.
2. `PreparedAction`, policy, review, and trace types.
3. `github-issue-triage` template with JSON fixtures.
4. `validate` and `simulate` script.
5. Full trace JSON plus terminal summary.
6. ContextSnapshot with source hashes.
7. Existing web UI reads the trace and spec.

At this point, a developer can already understand what Loopgraph is.

### Phase 2 — Make the company thesis real

8. `EscalationCase` schema.
9. `strategic-account-escalation` template and fixtures.
10. Human review decision packet.
11. Constrained management case consumer.
12. Generated topology: source loop → case → management loop.

At this point, a developer understands why Loopgraph is more than a generic workflow engine.

### Phase 3 — Make it launchable as an open-source project

13. Preserve / harden Design Studio.
14. Fix Demo Mode / Supabase Mode parity and all carried-forward P0s.
15. Improve docs, CI, screenshots, manual QA.
16. Release public alpha.
17. Collect developer feedback before building live connectors or distributed runtime.

---

## 20. Scope boundaries

### In scope for V1 public alpha

- Public LoopSpec and JSON Schema.
- File-based and Design Studio authoring.
- Local deterministic validate + simulate.
- Mock/local adapters.
- Context snapshot/provenance.
- Structured output, verifier, policy, prepared action, human review, trace.
- GitHub Issue Triage template.
- Strategic Account Escalation template.
- EscalationCase and management case consumer.
- Generated topology / inspector / trace viewer / review UI.
- Existing hidden-labor measurement and improvement signals.
- Optional Supabase Design Studio persistence.
- CI, docs, templates, and a clean local quickstart.

### Explicitly deferred

- Real GitHub/Zendesk/Salesforce/Slack/Linear OAuth connectors.
- Production LLM provider requirement.
- Distributed worker architecture.
- Scheduler, retries across processes, and queue infrastructure.
- Full monorepo/published-package architecture.
- Multi-tenant auth/RLS and enterprise SSO.
- Full company onboarding wizard.
- Drag-and-drop topology authoring.
- General-purpose graph execution semantics for every edge type.
- Automated improvement loop that edits loop specs.
- Marketplace.
- ROI claims based on real production outcomes.
- Fully autonomous external customer communications.
- Auto-approving high-risk action categories.

### V1.1 candidate work

- SQLite-backed local persistence.
- A real GitHub read-only adapter.
- A real Linear/Jira prepared-action adapter.
- More templates: sales pipeline risk, incident response, compliance review.
- Org-wide review inbox.
- More granular policy packs.
- OpenTelemetry/Langfuse export.
- Docker Compose quickstart.
- Optional OpenAI/Anthropic provider adapters behind explicit feature flags.

### V2 platform work

- Separate packages / monorepo.
- Durable runtime with production execution.
- Scheduler, queue, retries, cancellation, long-lived pauses.
- Adapter registry and marketplace.
- Full company/department operating model.
- Improvement loop proposals and controlled spec changes.
- Enterprise identity, RBAC, audit controls, and deployment modes.

---

## 21. README positioning draft

Use this as the conceptual opening, then make it shorter in the actual README:

> # Loopgraph
>
> Open-source infrastructure for defining and operating recurring AI-human loops.
>
> A Loopgraph loop is more than a prompt or a tool chain. It defines what event starts work, what evidence it may observe, which actions it may propose, what policy and verification must pass, when a human must decide, and how the outcome is recorded.
>
> Start with a local template. Inspect the exact context. Simulate a run. Review a prepared action. Replay the trace.
>
> Loopgraph does not replace your workflow engine, agent framework, or observability platform. It provides the operating contract around recurring AI work: context, policy, evidence, approval, escalation, and outcome.

### First 10 minutes in README

```bash
git clone <repo>
cd loopgraph
npm install

npm run loopgraph -- validate examples/github-issue-triage
npm run loopgraph -- simulate examples/github-issue-triage \
  --fixture fixtures/github-issue-triage/security-issue.json

npm run dev
# Open the generated trace and topology in the web UI.
```

The README should visibly answer:

1. What does Loopgraph do?
2. What problem does it solve that existing tools do not solve alone?
3. What runs locally with no credentials?
4. What is simulated vs real?
5. How do I define a loop?
6. How do I add an adapter later?
7. Why does the Strategic Account Escalation template matter?
8. What is intentionally not built yet?

---

## 22. Manual public-alpha QA script

### Clean developer path

- [ ] Clone into a clean directory.
- [ ] `npm install` succeeds.
- [ ] `npm run loopgraph -- validate examples/github-issue-triage` succeeds.
- [ ] `npm run loopgraph -- simulate ... security-issue.json` produces a review-required trace.
- [ ] `npm run loopgraph -- trace <runId>` shows event, evidence, policy, action, verifier, review, and outcome.
- [ ] Start web app with no environment variables.
- [ ] Open trace and context snapshot.
- [ ] Confirm no live integration claim appears.

### Strategic Account Escalation path

- [ ] Simulate enterprise outage near renewal.
- [ ] Confirm EscalationCase appears with a P1 severity, evidence, owner, deadline, and separate customer-message approval.
- [ ] Reject one internal action and confirm trace state / improvement item update.
- [ ] Approve an internal action and confirm payload fingerprint.
- [ ] Change payload and confirm approval invalidation.
- [ ] Open management consumer and confirm it uses case-level fields.
- [ ] Mark case resolved and confirm outcome / improvement update.

### Design Studio path

- [ ] Demo Mode has clear persistence warning.
- [ ] Fresh Supabase has clear empty state or one-command seeded workspace.
- [ ] Create Sales and Customer Success loops under same org.
- [ ] Generate a LoopSpec and export it.
- [ ] Import or validate exported spec from file.
- [ ] Review hidden labor and confirm metrics update.
- [ ] Confirm topology shows all new loops / reviews / cases.

---

## 23. Final decision checklist before implementation begins

- [ ] Confirm **Loopgraph** is the only public product and CLI name.
- [ ] Confirm GitHub Issue Triage is the primary developer learning template.
- [ ] Confirm Strategic Account Escalation is the primary company-operating-system template.
- [ ] Confirm the existing Marketing Campaign Learning loop remains a Design Studio hero but not the sole OSS wedge.
- [ ] Confirm `LoopSpec` file is canonical.
- [ ] Confirm topology is derived, not canonical.
- [ ] Confirm V1 means local `validate` + deterministic `simulate`, not a production runtime.
- [ ] Confirm a human approves a fingerprinted prepared action, not an open-ended agent.
- [ ] Confirm every escalated case is evidence-backed and has owner/deadline/decision requirements.
- [ ] Confirm no real external writes are required for public alpha.
- [ ] Confirm the release will describe what Loopgraph interoperates with rather than falsely claiming it replaces all existing frameworks.

---

## Appendix A — Relationship to the original full Loopgraph vision

The earlier broad product vision remains valid as a long-term destination:

```text
Company operating intent
→ management loops
→ department loops
→ workflow loops
→ task loops
→ signals, integrations, verifiers, people, memory, metrics
→ traces, improvement items, and operating learning
```

This V1 does not abandon that vision. It changes the order of proof:

```text
Portable LoopSpec
→ local simulation
→ context + policy + review + trace
→ standardized EscalationCase
→ management handoff
→ organization topology
→ real integrations and durable runtime
→ broader company operating system
```

This order creates an artifact developers can adopt early, while preserving a coherent path toward the full system.

---

## Appendix B — Existing routes and code areas to retain / modify

### Existing areas to retain

| Area | Current value |
|---|---|
| `components/topology-workspace.tsx` | Foundation for operating map and generated topology |
| `lib/loop-engineering-builder/graph.ts` | Starting point for derived graph model |
| `lib/loop-engineering-builder/question-engine.ts` | Design Studio loop discovery |
| `lib/loop-engineering-builder/spec-generator.ts` | Convert questions into public LoopSpec |
| `lib/loop-engineering-builder/implementation-generator.ts` | Context docs and blueprint artifacts |
| `lib/loop-engineering-builder/agent.ts` | Refactor toward deterministic simulator |
| `lib/loop-engineering-builder/templates/index.ts` | Template catalog / Design Studio inputs |
| `lib/loop-engineering-builder/workspace.ts` | Fix persistence and workspace behavior |
| `app/loops/[loopId]/runs/page.tsx` | Trace and run-history view |
| `app/loops/[loopId]/implementation/page.tsx` | Context document / artifact viewer |
| `app/loops/[loopId]/metrics/page.tsx` | Hidden labor and outcome assumptions |
| `app/management/page.tsx` | Management EscalationCase rollup |
| `supabase/seed.sql` | Demo parity and strategic escalation fixtures |
| `README.md` | Public framing and quickstart |

### New files expected

```text
lib/loopgraph-core/loop-spec.ts
lib/loopgraph-core/context.ts
lib/loopgraph-core/policy.ts
lib/loopgraph-core/trace.ts
lib/loopgraph-core/review.ts
lib/loopgraph-core/escalation.ts
lib/loopgraph-runtime/simulator.ts
lib/loopgraph-runtime/state-machine.ts
lib/loopgraph-runtime/fixture-loader.ts
lib/loopgraph-sdk/adapters.ts
lib/loopgraph-sdk/conformance.ts
examples/github-issue-triage/loopgraph.yaml
examples/strategic-account-escalation/loopgraph.yaml
fixtures/github-issue-triage/*
fixtures/strategic-account-escalation/*
scripts/loopgraph.ts
docs/loop-spec.md
docs/context-snapshots.md
docs/approval-model.md
docs/escalation-case.md
docs/template-authoring.md
.github/workflows/ci.yml
CONTRIBUTING.md
SECURITY.md
```

---

*End of authoritative V1 Launch Context Plan.*
