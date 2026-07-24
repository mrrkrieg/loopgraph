# Loop Graph Engineering with Hermes Agent

![Loop Graph Engineering with Hermes Agent](assets-improved-v2/01-loop-graph-engineering-cover.png)

A campaign starts wasting money. A customer stops using the product. A deal slips backward. A contract approaches renewal. An invoice falls outside tolerance. A production incident opens.

Most companies experience these moments as notifications.

Someone sees the alert, decides what it means, remembers which department owns it, gathers context from several systems, chooses a process, asks for approval, follows up, and eventually checks whether the problem was actually solved.

Then another signal arrives and the whole process begins again.

This is the invisible work inside every company. It is not simply task execution. It is the continuous act of turning events into problems, problems into ownership, ownership into coordinated action, and action into outcomes the company can learn from.

Today, people carry most of that operating graph in their heads.

We are building a different model: **Hermes Agent receives and interprets company events. It routes each business problem into the right department. Every department owns multiple specialized loops. Loopgraph governs which loop is allowed to run, what it may do, and how the result is recorded.**

We call the discipline behind this model **Loop Graph Engineering**.

It is the shift from automating isolated tasks to engineering how an entire company responds, decides, acts, verifies, and improves.

## A company is not a list of agents

The easiest way to imagine an autonomous company is one giant agent connected to every tool.

That picture is exciting because it looks simple: give the model enough context, enough permissions, and a sufficiently ambitious prompt, then let it run.

But real companies are not simple.

Marketing, Sales, Customer Success, Finance, Operations, Legal, and Engineering do different kinds of work. They use different evidence. They answer to different owners. They operate under different risk limits. They have different definitions of done.

Even inside one department, there is no single workflow.

Marketing may own an Ads Optimization loop, a Content Creation loop, a Lifecycle loop, an SEO loop, and a Launch Coordination loop. Sales may own Lead Qualification, Deal Risk, Follow-Up, Forecast Quality, and Expansion loops. Customer Success may own Onboarding, Adoption Risk, Renewal Risk, and Escalation loops.

A department is an operating boundary. **A loop is a specialized unit of work inside that boundary.**

That distinction matters. If every department points to one generic automation, the architecture only hides complexity behind a larger box. A real operating graph must show that Hermes routes into departments and that each department can own many loops with different jobs, evidence, permissions, and outcomes.

![Most automation is a line while a company is a graph](assets-improved-v2/02-hermes-departments-multiple-loops.png)

Most automation is still designed as a line:

`trigger -> agent -> action`

That can make one task faster. It does not make the company more intelligent.

The company-shaped architecture looks different:

`events -> Hermes Agent -> departments -> multiple governed loops -> outcomes -> evidence`

Hermes is not another department. It is the intelligence that interprets incoming signals and determines where a business problem belongs.

Departments are not executable workflows. They are ownership and policy boundaries.

Loops are the actual operating units. Each loop observes a bounded set of evidence, pursues a defined goal, prepares or performs allowed actions, verifies the result, escalates when human judgment is required, and records what happened.

The model inside a loop can change. The tools can change. The provider can change. The loop still has a stable business contract:

- Why does this loop exist?
- What kind of problem wakes it up?
- What evidence must be available?
- What may it read or change?
- What requires approval?
- What proves the problem was resolved?
- What should be learned from the outcome?

The agent is powerful because it can reason. The loop is trustworthy because its authority is bounded.

## An event is evidence, not an instruction

Traditional automation often hardwires an event directly to an action:

`when X happens, run Y`

That works when the world is clean and every event has exactly one meaning. Companies do not operate in that world.

Ten webhook deliveries may describe one continuing problem. One payload may contain two independent problems. A valid event may arrive while the right loop is disabled, already running, missing data, inside a cooldown window, or outside its approved autonomy level.

Sometimes the correct response is to wait. Sometimes it is to ask for context. Sometimes it is to record the problem without running anything.

Loopgraph therefore separates three objects that most automation systems collapse into one.

**An event is immutable evidence.** It records that something happened, where it came from, when it happened, which subject it concerns, how it was authenticated, and what normalized data was received.

**A business problem is stateful.** It represents the issue the company needs to resolve. It can collect evidence from multiple events over time.

**A loop run is an attempt.** It is one governed effort to resolve the problem. A run can succeed, fail, wait for approval, or produce new evidence without erasing the history that came before it.

![Events, business problems, and loop runs are different objects](assets-improved-v2/03-event-problem-run.png)

Imagine that a paid campaign produces ten anomaly alerts in one hour.

A trigger-based system may start ten optimization jobs. A problem-based system recognizes ten pieces of evidence describing one open campaign-efficiency problem. It appends the new evidence, updates severity, checks whether a loop is already active, and avoids duplicate work.

If the first attempt fails verification, the event is not lost and the problem does not disappear. Another run can be attempted. A human can take ownership. A supporting loop can be introduced. The system remembers the difference between what happened, what the company believed it meant, and what it tried to do.

That is the beginning of organizational memory.

## Hermes interprets and Loopgraph governs

Language judgment and operational authority are different jobs. The architecture separates them deliberately.

Hermes Agent is the visible intelligence at the center of the company graph and the sole external event ingress. Business systems send events to Hermes. Hermes authenticates and filters the route, normalizes provider payloads into bounded event envelopes, interprets the likely business problem, compares eligible loops, and proposes a structured route.

Loopgraph is the governed registry and execution kernel. It owns the approved LoopSpecs, department structure, routing contracts, connector readiness, durable event receipts, business-problem records, cooldowns, concurrency rules, policy checks, queues, traces, reviews, approvals, and outcomes.

The cleanest way to say it is:

> **Hermes proposes. Loopgraph commits.**

![Hermes supplies judgment while Loopgraph holds operational authority](assets-improved-v2/04-hermes-loopgraph-responsibilities.png)

Hermes can infer that a campaign has an acquisition-efficiency problem. It cannot invent a nonexistent loop, ignore a cooldown, bypass an approval, use an unavailable connector, or turn a draft into an autonomous customer-facing action.

Those are not language questions. They are system facts and policy decisions. They belong in deterministic code.

This separation gives us the best properties of both layers:

- Hermes can reason flexibly about messy business context.
- Loopgraph can enforce stable operational boundaries.
- Every decision can be inspected after the fact.
- Models and tools can evolve without silently changing authority.
- A bad inference can be rejected before it becomes a bad action.

The goal is not to make the reasoning layer less intelligent. It is to make intelligence safe enough to use in real operations.

## Routing is a governed decision

When an event arrives, Hermes should not choose from every loop in the company.

Routing happens in two stages.

The first stage is deterministic eligibility. Loopgraph filters the registry to loops that are active, accept the event family, belong to the relevant workspace and department, can map the required fields, have the necessary connectors or manual fallback, are within cooldown and concurrency limits, and have not already committed the same event.

This stage answers:

> **What could run?**

Only then does Hermes compare the eligible Routing Cards. It evaluates the actual business problem, the specificity of each loop, the available evidence, the expected outcome, the risk level, and whether more than one independent problem is present.

This stage answers:

> **What should run?**

Loopgraph validates the proposed route again before committing it.

![Two-stage governed routing](assets-improved-v2/05-two-stage-routing.png)

This architecture has explicit answers for the cases that autonomous systems usually hide.

If no loop is eligible, the problem is recorded as unhandled. Hermes does not improvise a new workflow.

If two loops are similarly plausible, the system asks a human or uses a declared triage loop. It does not guess.

If the same event arrives again for an active problem, it becomes additional evidence. It does not create duplicate work.

If one event contains several genuinely independent problems, the route may fan out—but only when every selected loop permits it and the total number of routes stays bounded.

If a broad loop and a specialist loop both appear relevant, specificity wins. A management loop does not take work merely because it can observe everything.

This is what turns routing from a prompt into an accountable company decision. The system can explain what was eligible, what was rejected, what evidence mattered, what policy was applied, which route was committed, and what happened next.

## One department can own many loops

The department layer is where company ownership becomes visible.

It gives the graph a stable organizational shape without forcing all work through one giant departmental agent. Hermes can route a problem to Marketing, but Marketing still needs to decide which specialized loop owns the outcome.

Our first reference design uses two concrete Marketing loops.

The **Ads loop** watches spend, campaign performance, analytics conversion, CRM-qualified outcomes, and prior experiments. Its goal is not more clicks. Its goal is improved qualified acquisition efficiency and faster learning. It can collect evidence, identify waste or opportunity, and prepare an experiment brief. It cannot silently change budget, targeting, claims, or campaign state.

The **Content loop** watches approved positioning, customer and product evidence, the content backlog, past performance, and reviewer feedback. It can rank topics, prepare a brief, draft content, verify claims and voice, and send the result to review. It cannot publish unsupported claims or send material without the required approval.

Both loops belong to Marketing. They do not own the same problem.

![Hermes routes into Marketing, which owns multiple specialized loops](assets-improved-v2/06-hermes-marketing-multiple-loops.png)

A Google Ads anomaly with spend increasing while qualified conversion falls should route to Ads.

An approved Notion brief with evidence, audience, and a deadline should route to Content.

A landing-page conversion drop without a campaign mapping may route to neither until the missing context is supplied.

The existence of traffic does not automatically justify the Ads loop. The word "page" does not automatically justify the Content loop. The route must match the business problem, not merely the vocabulary inside the event.

As the graph grows, Marketing may add Lifecycle, SEO, Launch Coordination, Creative Testing, and Brand Review loops. Each new loop expands what the department can handle without turning the department itself into an unbounded agent.

That is the pattern we want across the company:

`Hermes Agent -> Department -> Multiple Specialized Loops`

## The graph is the operating model

Most workflow diagrams are drawn after software is built. They describe the system, but they do not govern it.

Loopgraph works in the opposite direction. The graph is derived from the contracts and operational records that make the company run.

The same source of truth can produce several useful views.

The **design view** shows Hermes, departments, loops, and their declared relationships. It helps a team understand the operating model it is building.

The **operating view** adds connector health, ownership, readiness, approvals, metrics, current load, recent traces, and escalations. It helps operators see whether the company is actually ready to run.

The **event view** follows one event through receipt, problem creation, eligibility, routing decision, route commit, loop run, review, and outcome. It answers the question every autonomous system must eventually answer: *Why did this happen?*

The **loop view** opens one specialized workflow and shows its internal logic: observe, assess, prepare, verify, review, act, trace, and improve.

These are not separate diagrams maintained by hand. They are projections of one semantic operating graph.

That matters because a structural edge is not automatically an executable edge. An arrow from Hermes to Marketing expresses routing and ownership. It does not grant permission to run every Marketing loop. An arrow from Marketing to an Ads loop does not bypass missing data, a disabled connector, a cooldown, or an approval boundary.

The graph can remain visually simple while the contracts underneath it remain precise.

## Autonomy is earned with evidence

The fastest way to lose trust in an autonomous system is to give it real authority before the organization can measure its judgment.

Every new loop should begin in shadow mode.

Hermes receives real or synthetic events. Loopgraph records the route it would have taken. Nothing starts automatically. A human marks the expected loop—or marks that no loop should run. Those corrections become routing evidence.

The loop then moves through a deliberate progression:

`shadow -> recommend -> simulate -> execute with approval -> autonomous low risk`

![Autonomy is promoted through evidence rather than switched on](assets-improved-v2/07-autonomy-ladder.png)

Promotion depends on measurable behavior: routing precision, missed-problem rate, false triggers, abstention quality, duplicate suppression, decision latency, outcome quality, review burden, and failure behavior.

The ladder also respects the asymmetry of business risk.

Reading campaign performance is not the same as changing budget. Drafting a customer message is not the same as sending it. Preparing a contract-risk summary is not the same as accepting legal risk. A loop can become highly autonomous in low-risk observation and preparation while permanent human authority remains at the boundary that matters.

Safety is not the opposite of autonomy. **Safety is how autonomy becomes credible.**

## The most valuable output may be the work the graph cannot handle

When no loop can safely own a problem, most automation systems fail quietly. The alert disappears into a log, or an agent improvises.

Loopgraph records an unhandled business problem.

Over time, those records reveal where the company's operating system is incomplete. If the same type of pricing exception, customer risk, campaign anomaly, vendor delay, or compliance request keeps appearing without an owner, the graph has discovered a missing loop.

This turns operational failure into organizational design data.

The graph can show not only the loops the company has, but also the recurring problems the company still does not know how to handle. That unhandled-problem inbox may become the best roadmap for what to automate next.

## Why Loop Graph Engineering is huge

The first wave of AI made individual tasks cheaper.

The next wave will make organizational coordination programmable.

That is a much larger change.

When every recurring process has a contract, the company can see what work exists, why it starts, what evidence it uses, who owns the outcome, where approval is required, and how success is measured.

When Hermes becomes the shared event intelligence layer, every source no longer needs a brittle direct connection to every workflow. New loops can publish routing contracts into the graph. Hermes can reason over the eligible set without receiving unlimited authority.

When departments own multiple specialized loops, the company can increase capability without creating one opaque agent per function. New operating units can be added, tested, compared, paused, or replaced independently.

When every run belongs to a durable business problem, the organization stops confusing activity with progress. Ten alerts are not ten pieces of work. Three failed attempts are not a resolved outcome. A green automation run is not proof that the business problem disappeared.

When every decision leaves a trace, the graph can improve. Human corrections sharpen routing. Review feedback improves verification. Outcome history reveals which loops resolve problems and which create rework. The operating model becomes versioned and learnable.

And when the graph is no longer trapped in people's heads, human attention moves up one level. People define goals, set boundaries, approve risk, resolve ambiguity, exercise judgment, build relationships, and redesign loops when reality changes.

The goal is not to remove people from the company.

The goal is to stop using people as the company's integration layer.

## What exists and what we are building now

Loopgraph already has the foundation: a versioned LoopSpec contract, semantic validation, local simulation, reproducible traces, approval binding for prepared actions, escalation cases, file-backed storage, department skill packs, discovery models, topology generation, a Company Brain view, and an adapter interface.

The current build connects those pieces into a governed event-driven operating system.

We are making Hermes the single external event brain. We are adding durable event receipts, stateful business-problem records, department-aware Routing Cards, structured decisions, atomic route commits, persistent queue behavior, lifecycle events, shadow evaluation, connector readiness, and graph projections that explain both the whole company and one event's path through it.

The first complete proof is deliberately narrow: one Marketing department, two governed loops—Ads and Content—manual or fixture data for local simulation, and a graph that shows exactly how events become problems, problems become routes, and routes become reviewed outcomes.

This is an implementation blueprint, not a claim that every component is already shipped. Publishing the architecture now makes it concrete enough to challenge, test, build, and improve in public.

## The prompt was never the company

A prompt is a request.

An agent is a reasoning engine.

A department is an ownership boundary.

A loop is an operating unit.

A graph is how the company coordinates them.

Loop Graph Engineering is the discipline of making those relationships explicit: the events, problems, departments, loops, evidence, permissions, approvals, outcomes, and feedback that determine how a company actually runs.

The companies that win the next phase of AI will not be the ones with the largest number of agents. They will be the ones that can answer, for every important event:

- What business problem is this?
- Which department owns it?
- Which loops are eligible?
- Which loop is the most specific fit?
- What evidence is missing?
- What is the loop allowed to do?
- Where does human judgment enter?
- Was the problem actually resolved?
- What should the graph learn from the outcome?

Once those answers live in the operating graph, the company stops automating isolated steps and starts compounding operational judgment.

If a process begins with a signal, crosses systems, requires judgment, ends in a measurable outcome, and should improve from experience, it can be loop-graph engineered.

**The future company will not be one enormous agent. It will be a graph of governed loops—with Hermes Agent routing the work and Loopgraph making it safe to run.**

---

## Architecture note

This article is based on the *Hermes Agent Event Brain Integration Plan*, a proposed implementation blueprint for connecting Hermes Agent to Loopgraph's governed loop registry and execution model.
