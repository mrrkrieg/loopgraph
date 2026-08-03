# Loop Graph Engineering: The Operating System for AI-Run Companies

![Loop Graph Engineering: The Operating System for AI-Run Companies](paper-loop-graph-engineering-cover.svg)

A customer stops using the product. The same onboarding complaint appears across five accounts. A deal slips backward. An invoice falls outside tolerance. A production incident threatens a strategic renewal.

The software stack records each moment. The company still has to decide what it means.

Someone must connect the evidence, identify the business problem, determine who owns it, choose the right process, gather context, respect policy, coordinate action, ask for approval, and later establish whether anything improved.

This is the invisible operating work inside every company. It is not one task and it is not one prompt. It is a graph of judgment, ownership, authority, action, and learning.

We began building Loopgraph for our own company because we wanted Hermes to help run recurring processes without turning the company into a prompt or handing one model every credential. That internal constraint led to a larger idea:

> **AI makes reasoning abundant. The next hard problem is making company coordination programmable without making authority ambiguous.**

We call the discipline for solving that problem **Loop Graph Engineering**.

Loop Graph Engineering turns recurring company processes into versioned operating contracts. The Hermes Connector Broker verifies signals and constrains provider access. Hermes Brain determines what happened, which company object is affected, and which loop should respond. Loopgraph independently validates the decision, governs the authority of the work, records execution, measures the outcome, and evolves the graph through accountable transactions.

The short version is:

> **Hermes decides. Loopgraph validates, governs, and records.**

This is the shift from automating isolated tasks to engineering how a company senses, decides, acts, verifies, and improves.

## The company is not one enormous agent

The easiest picture of an AI-run company is one agent connected to every system.

It is also the wrong abstraction.

In that design, the context window becomes company memory. The prompt becomes policy. Tool access becomes authorization. A conversation becomes the audit trail. When the agent is uncertain, the same component that interprets the world also decides how much authority it has.

That may be acceptable for a personal assistant. It is not an operating model for a company.

Real companies contain distinct departments, owners, systems of record, approval boundaries, risk tolerances, and definitions of done. Product evaluates customer evidence differently from Sales. Finance does not share Legal's authority. Engineering incidents can affect Customer Success, but that does not give an incident workflow permission to promise a customer an outcome.

Even one department is not one workflow. Product may own Feedback Clustering, Product Problem, Roadmap Evidence, and Release Learning loops. Customer Success may own Onboarding Progress, Customer Health, Renewal Risk, and Strategic Account Escalation loops. Each exists for a different problem and carries different evidence, actions, owners, and outcome tests.

A department is an ownership boundary. **A loop is a specialized operating unit inside that boundary.**

![A company operating graph has a verified boundary, one semantic brain, departments, and many specialized loops](paper-company-loop-topology.svg)

This is why a company is better represented as a graph than as a list of agents.

The nodes describe durable business concepts: company objects, departments, recurring problems, loops, capabilities, owners, metrics, and policies. The edges describe declared relationships: which evidence a loop may consume, which department owns it, which supporting loop may be invoked, which approval gates an action, and which outcome feeds future decisions.

The graph is not a decorative diagram. It is the operating model.

## An event is evidence, not an instruction

Traditional automation hardwires an event directly to an action:

`when X happens, run Y`

That works when an event has exactly one meaning. Companies rarely operate in that world.

Ten webhook deliveries may describe one continuing problem. One payload may contain several independent problems. A valid event may arrive while the relevant loop is disabled, already active, missing evidence, inside a cooldown window, or outside its approved autonomy level.

The right response may be to act. It may also be to wait, request context, ask a human, attach the event to an existing problem, or deliberately abstain.

Loopgraph therefore separates the objects that trigger-based systems usually collapse.

**An event is immutable evidence.** It records what happened, where it came from, when it happened, how it was verified, and what normalized facts were received.

**A company object anchors meaning.** The same customer, account, campaign, contract, incident, or invoice may appear under different identifiers across several systems. Exact provider aliases resolve those records to one tenant-scoped object before routing. Ambiguous matches stop for review; they are not silently merged by fuzzy inference.

**A business problem has state.** It represents the issue the company needs to resolve and accumulates evidence over time.

**A loop run is an attempt.** It is one governed effort to resolve the problem. A run can succeed, fail, wait, escalate, or add evidence without rewriting the history that came before it.

**An observed outcome is a claim backed by measurement.** It answers whether the intended business condition changed—not merely whether the workflow reached its last step.

![Events become evidence about a company object, a stateful problem, governed attempts, and an observed outcome](paper-operating-objects.svg)

Suppose five customers report the same onboarding failure while product analytics shows a drop at the same activation step. A trigger-based system may create six unrelated jobs. A problem-based system resolves the affected accounts and product surface, attaches the evidence to one product problem, checks whether an appropriate loop is already active, and avoids duplicate work.

That distinction creates organizational memory. The system remembers what happened, what the company believed it meant, what it tried, what changed, and what remains unresolved.

## Three layers turn intelligence into trusted operation

Flexible reasoning, provider authority, and deterministic governance are different jobs. The architecture separates them deliberately.

![The Connector Broker, Hermes Brain, and Loopgraph form three distinct trust layers](paper-three-trust-layers.svg)

The **Hermes Connector Broker** is the boundary to external systems. It verifies provider events, normalizes payloads, protects OAuth and API credentials, and exposes only fixed, capability-scoped provider operations. Hermes receives a bounded capability; it does not receive a reusable provider token or an arbitrary HTTP proxy.

**Hermes Brain** is the semantic intelligence of the company. It determines what business problem occurred, resolves the affected company object, compares the registered routes, selects a primary loop or declared supporting loops, requests missing evidence, and abstains when the problem is ambiguous. When a live job is authorized, Hermes also performs the tasks and tool calls defined by the assignment.

**Loopgraph** is the governed control plane. It owns the company topology, versioned LoopSpecs, routing contracts, readiness, policy, deduplication, cooldowns, concurrency, approvals, durable jobs, immutable assignments, execution evidence, outcomes, and graph-change history. It validates what Hermes decided before work is allowed to proceed.

This boundary is important: **Loopgraph does not become another all-powerful agent, and Hermes does not become its own authorization system.**

The Connector Broker constrains interaction with providers. Hermes supplies judgment and performs assigned work. Loopgraph supplies deterministic authority and a durable system of record.

That separation allows models, prompts, and tools to improve without silently expanding what the company has authorized.

## A loop is a versioned contract for recurring work

A loop is not simply a workflow diagram, a prompt, or a tool chain.

Each versioned LoopSpec answers a complete set of operating questions:

- What recurring business problem does this loop exist to resolve?
- Which company objects and event families does it accept?
- What evidence is required, and what provenance must that evidence carry?
- Which capabilities may it use, and which actions are forbidden?
- What must be prepared for review before an action can be committed?
- Which owner is accountable, and when must the loop escalate?
- What primary outcome, leading indicators, and guardrails define success?
- What exclusions prevent an attractive but incorrect route?
- Which other loops may receive evidence, and when is fan-out permitted?

Because the contract is versioned, the company can inspect exactly which definition governed a decision. A route is bound to the immutable LoopSpec hash that was active at the time. Changing the prompt, evidence requirements, actions, or authority creates a new operational version rather than rewriting history.

The model inside a loop can change. The provider can change. The tools can change. The business contract remains reviewable.

This is the practical meaning of **versioned contracts for recurring AI work**: an AI process becomes a governed company capability with a stable purpose, explicit authority, and measurable completion criteria.

## Routing is a company decision, not a model suggestion

Hermes reasons over the business problem and the registered Routing Cards. It may select one primary loop, invoke explicitly permitted supporting loops, request more context, or abstain.

That decision is not trusted merely because the model produced valid JSON.

Before a route becomes work, Loopgraph verifies that the exact LoopSpec exists and is active; the event and problem types match; the required evidence is present; company-object resolution is unambiguous; connector capabilities are healthy; exclusions do not apply; confidence and risk thresholds are satisfied; cooldown, deduplication, concurrency, and fan-out rules permit the run; and the requested autonomy level is allowed.

If no loop can safely own the problem, the problem is recorded as unhandled. Hermes does not invent a workflow.

If two routes remain genuinely ambiguous, the system requests human judgment. It does not turn confidence theater into authorization.

If a repeated event belongs to an active problem, it becomes additional evidence. It does not create duplicate work.

If one event contains independent problems, fan-out occurs only when every target contract declares it and every route passes its own validation.

The result is a routing decision that can be explained after the fact: what Hermes believed, what alternatives existed, what evidence was used, what policy was applied, what LoopSpec was selected, what Loopgraph rejected, and why the final route was committed.

## Route is not execution

Many AI systems stop their architecture diagram at “agent selected a tool.” Company work begins there.

When Loopgraph accepts a route, it creates a durable job and an immutable assignment for a specific Hermes runtime. That assignment names the company object, business problem, department, LoopSpec hash, allowed capabilities, task plan, approval requirements, and evidence expected in return.

Hermes claims the assignment and performs the work. It can gather evidence, create drafts, call bounded tools through the Connector Broker, pause for approval, and report task, tool, output, escalation, and terminal facts in order.

Loopgraph records those facts into one reproducible trace. It enforces the approval boundary and refuses privileged writes whose prepared action no longer matches the exact reviewed fingerprint. A retry cannot silently become a different action.

This distinction avoids two dangerous shortcuts.

First, the reasoning system never needs broad reusable credentials. Second, the governance system does not pretend that recording a run is the same as performing the real work.

Hermes executes the assigned tasks. The Connector Broker performs permitted provider operations. Loopgraph governs the assignment and preserves the evidence.

## Departments own libraries of loops

The architecture is company-wide, not a single-department demo.

Loopgraph ships a candidate library across Product, Marketing, Sales, Customer Success, Engineering, Operations and Finance, HR and Talent, Legal and Compliance, and Management. A new workspace still begins empty: Hermes proposes relevant loops, and only accepted proposals become part of the company topology.

Product is a useful first example.

Intercom feedback, product analytics, roadmap evidence, CRM account context, and issue-tracker activity reach Hermes as verified events. Hermes resolves the affected customers and product surface, determines whether the evidence belongs to an existing product problem, and chooses among specialized Product loops such as Feedback Clustering, Product Problem, Roadmap Evidence, and Release Learning.

Feedback Clustering can assemble cited themes. Product Problem can turn validated evidence into an owner-reviewed problem brief. Roadmap Evidence can prepare trade-offs without changing roadmap authority. Release Learning can compare adoption, retention, support, and guardrail measurements after a release.

The process is not successful because Hermes produced a polished document. It is successful only when the observed evidence supports the intended product outcome without violating the loop's guardrails.

The same pattern extends across the company. An incident may activate Engineering as the primary owner while sending evidenced customer impact to Customer Success and later returning prevention evidence through Incident Learning. A campaign can connect Marketing performance to qualified pipeline evidence without allowing Marketing to redefine Sales outcomes. A contract exception can inform Deal Risk while legal conclusions remain owned by Legal.

Visual adjacency is never permission. Every cross-department edge must exist in the contracts and pass validation.

## The graph can change, but the model cannot rewrite it

A living operating model must evolve. It must also resist unreviewed mutation.

Loopgraph represents semantic changes as explicit transactions: add, update, split, merge, or retire. Each proposal is bound to the exact base graph hash and the full content of the affected LoopSpecs.

An accountable approval receipt records the actor, role, policy, reason, evidence, decision, and exact operations approved. Application is atomic. A stale proposal fails closed. A failed apply restores the base snapshot. A committed transaction produces a new graph snapshot and operation receipts. Rollback is permitted only while the graph still matches the transaction being reversed.

This is infrastructure-level version control for how the company operates.

Hermes can identify a repeated gap and design a candidate loop. It cannot treat its own recommendation as permission to install that loop, promote its authority, pause an existing process, or retire an owner-controlled capability.

The company can improve its operating model without allowing an agent to silently redefine it.

## Autonomy is promoted, not switched on

Autonomy is not a Boolean setting. It is a sequence of evidence-backed authority levels.

![A loop progresses from simulation to shadow, recommendation, approval-bound execution, and bounded low-risk autonomy](paper-autonomy-ladder.svg)

**Simulate** checks contracts and runs deterministic or redacted fixtures with no external writes.

**Shadow** records what Hermes would select on real events and measures routing quality without starting live work.

**Recommend** prepares a governed decision or artifact for a human owner.

**Execute with approval** allows the exact reviewed action to be committed through a single-use, content-bound approval.

**Autonomous low risk** is reserved for bounded actions whose failure behavior, supervision burden, outcome quality, and rollback path have earned it.

Promotion follows that order. It requires a passing rehearsal report bound to the exact graph, loop, version, and requested next mode. Sensitive departments and high-impact actions can remain permanently below autonomous execution.

Reading an account is not the same as contacting it. Drafting a contract summary is not accepting legal risk. Preparing a budget recommendation is not moving money. The useful question is not “Is the agent autonomous?” It is “Which exact capability has earned which exact level of authority?”

Safety is not the opposite of autonomy. **Safety is how autonomy becomes credible.**

## A completed run is not proof of value

Automation products often measure success at the point where the workflow completes. That is the wrong finish line.

A completed run proves that the system operated. It does not prove that the customer was retained, the incident recurred less often, the campaign produced qualified demand, the invoice was reconciled, or the product change improved activation.

Loopgraph separates three kinds of evidence.

**Observed** means the measurement came from an authoritative outcome source with the required time window and provenance. **Modeled** means the result is an estimate. **Incomplete** means the system still lacks the evidence required to make the claim.

The value ledger then asks a stricter question:

`net value = observed benefit - review - rework - supervision - escalation - governance - connector operations - organizational change`

A loop that saves ten minutes but creates twenty minutes of review burden is not valuable. A loop that completed successfully but has no measured outcome remains unproven. Modeled savings are useful for prioritization; they do not become observed customer value by repetition.

This changes the optimization target from agent activity to company outcomes.

## The operating graph becomes a learning system

Once events, problems, decisions, runs, corrections, outcomes, and costs live in one traceable model, the company can see where its operating system is weak.

Repeated unhandled problems reveal missing loops. Frequent abstentions reveal missing context. Duplicate suppression reveals noisy sources. Approval latency reveals ownership bottlenecks. Negative value reveals loops that should be redesigned. Repeated human corrections reveal a routing contract that is too broad or too vague.

Loopgraph's continuous controller turns that evidence into an accountable improvement cycle:

`business evidence -> outcome evaluation -> opportunity -> Hermes design -> policy decision -> graph transaction -> new evidence`

The controller can request missing evidence, dispatch a bounded design task to Hermes, propose a graph change, or surface a pause or retirement recommendation. Under a strict default policy, only low-risk, non-customer-facing additions can be materialized automatically—and only in shadow mode. Pausing and retiring existing loops remain human-owned decisions.

Learning therefore does not mean that a model silently retrains itself or edits production policy. It means that operating evidence produces inspectable proposals, deterministic policy receipts, versioned changes, rehearsals, and new measurements.

The graph improves without losing accountability.

## Enterprise authority cannot live in a prompt

An AI-run company needs a security model designed for agents, not pasted credentials and optimistic instructions.

The Connector Broker keeps provider tokens outside Hermes, the browser, LoopSpecs, and the Loopgraph database. Provider capabilities use fixed hosts, methods, schemas, scopes, and response limits. Webhook intake checks provider-specific signatures, timestamps, delivery identities, and replay claims before normalization.

Privileged writes use a prepare, approve, and commit sequence bound to the exact action content. Workload identities can be short-lived and issuer-verified. Credential namespaces bind organization, project, environment, provider, and installation. Kill switches can stop a tenant, project, environment, provider, connection, or capability before credentials are resolved. Logs, errors, traces, and metadata are centrally redacted.

These controls are not wrappers around the model. They are the operational boundary that makes model reasoning usable in the first place.

## What is implemented now

This is no longer only an architecture proposal.

The current open-source build includes Hermes-guided department discovery, versioned LoopSpec generation, semantic validation, an editable company topology, routing contracts, exact company-object aliases, local fixtures and simulation, durable route jobs and immutable assignments, Hermes execution events, reproducible traces, approval-bound actions, a multi-department loop library, graph transactions, promotion rehearsals, outcome truth states, a value ledger, opportunity detection, a continuous controller, and an enterprise Connector Broker protocol with security controls.

The local-first workflow is the safest place to begin. Teams can discover recurring processes, materialize accepted loops, inspect the graph, rehearse routing, simulate runs, review evidence, and promote authority deliberately.

Live external execution remains experimental. A real hosted company deployment still requires provider applications and tenant consent, a production vault or cloud secret manager, webhook subscriptions, workload identity, staging migrations, SSO and provisioning where required, alerts and independent audit retention, backup and restore drills, load and recovery validation, and—most importantly—observed evidence that the loops create value in the company's environment.

That boundary matters. We would rather publish an accurate operating model with explicit limits than market a demo as an autonomous company.

## Why this is a large shift

The first wave of AI made individual tasks cheaper.

The next wave makes organizational coordination programmable.

That is a larger change because the unit of automation moves from a task to a recurring business outcome. The interface moves from a prompt to a versioned contract. The scaling unit moves from one agent with more tools to many bounded loops connected by shared company objects and evidence. The system of record expands from “what ran” to “what the company believed, authorized, attempted, observed, and learned.”

As reasoning becomes abundant, the scarce asset is not access to a model. It is a trusted operating graph: the accumulated definitions, ownership, policy, outcome evidence, exceptions, and learning that allow intelligence to act coherently across a real company.

When that graph is trapped in people's heads, every process depends on memory and manual coordination. When it becomes explicit and executable, the company can inspect it, test it, change it, and improve it.

The goal is not to remove people from the company.

The goal is to stop using people as the company's integration layer—and to preserve human authority exactly where judgment, accountability, and risk require it.

## The prompt was never the company

A prompt is a request.

An agent is a reasoning and execution engine.

A capability is bounded access to the outside world.

A department is an ownership boundary.

A loop is a versioned operating unit.

A graph is how the company coordinates them and remembers what happened.

Loop Graph Engineering makes those relationships explicit. For every important signal, the company should be able to answer:

- What happened, and can we trust the evidence?
- Which company object and stateful problem does it concern?
- Which department owns the outcome?
- Which loop is the most specific permitted response?
- What evidence is missing?
- What can Hermes do, and through which bounded capability?
- Where must a human decide?
- Which exact contract and policy authorized the work?
- Did the business condition improve?
- What did the work cost?
- What should change in the graph?

Once those answers live in the operating graph, AI stops being a collection of disconnected automations and becomes part of a governable company system.

If a process begins with a signal, crosses systems, requires judgment, ends in a measurable outcome, and should improve from experience, it can be loop-graph engineered.

> **The future company will not be one enormous agent. It will be a living graph of governed loops—with Hermes supplying intelligence and Loopgraph turning that intelligence into accountable operation.**

---

## Architecture note

This paper describes the architecture implemented in the Loopgraph open-source repository as of August 2026. Local discovery, design, simulation, governance, and evidence workflows are available now. Production provider setup and live external actions require the enterprise controls and deployment work described above.
