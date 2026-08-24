# Operate Fair and Accountable People Workflows

This official Loopgraph App gives Hermes five governed HR & Talent loops while keeping employment judgment, sensitive communication, and restricted people data under qualified human control.

Hermes receives normalized people-workflow events, resolves the affected candidate process, onboarding plan, manager review window, retention review case, or performance-review period, and chooses exactly one eligible loop. It may diagnose process friction, assemble minimum evidence, and prepare a review packet. It never ranks, hires, rejects, scores, rates, predicts attrition, changes compensation, recommends discipline, or changes employment state.

## Included loops

- Candidate Pipeline
- Onboarding Progress
- Manager Coaching Preparation
- Retention Signal Review — disabled by default and requires an explicit policy-approved installation choice
- Performance Review Preparation

## Supported stack recipes

- Workday + Greenhouse + Slack
- Rippling + Ashby + Teams

Both recipes are declarative capability mappings. Credentials remain in the Connector Broker and never enter this pack or Hermes context. Connector reads are purpose-bounded, sensitive fields are minimized, and installation starts in shadow mode.

## Safety model

- Candidate, employee, manager, team, plan, task, goal, review-period, and aggregate-survey access is read-only and minimum-necessary.
- Protected attributes, private-message inference, hidden people scores, individual attrition prediction, and unrelated secondary use are forbidden.
- Workflow tasks and sensitive internal drafts require exact prepared-action approval; sending remains separately controlled.
- Ranking, hiring, rejection, performance ratings, compensation, promotion, discipline, termination, and employment changes are forbidden.
- Missing identity, consent, purpose, policy, source provenance, or accountable ownership causes Hermes to abstain.
- Outcomes measure workflow latency, completion, reviewer correction, human effort, boundary violations, and deletion compliance—not agent-created people scores.

Run `loopgraph app validate packs/official/hr-talent/operate-people-workflows` and `loopgraph app test packs/official/hr-talent/operate-people-workflows` before publishing or installing a modified version.
