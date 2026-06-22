import type { GeneratedArtifact } from "./types";
import type { LoopSpec } from "./loop-spec-schema";

export function generateImplementationArtifacts(spec: LoopSpec): GeneratedArtifact[] {
  return [
    generateSupabaseSchema(spec),
    generateVercelPlan(spec),
    generateCronPlan(spec),
    generateUiPlan(spec),
    generateAgentPrompt(spec),
    generateVerificationRubric(spec),
    generateImplementationPlan(spec),
    generateManagementSummary(spec)
  ];
}

export function generateSupabaseSchema(spec: LoopSpec): GeneratedArtifact {
  const content = `-- ${spec.name} implementation tables
-- Core tables are provided by the base migration. This extension captures loop-specific trace payloads without creating department-specific tables.

insert into loop_requirements (loop_id, category, title, description, requirement_type, priority)
values
  ('${spec.id}', 'trace', 'Trace schema for ${spec.name}', 'Store observed signals, routine steps, verification, escalation, human review, and final outcome in loop_runs and loop_run_steps.', 'schema', 'high'),
  ('${spec.id}', 'measurement', 'Measurement plan for ${spec.name}', 'Track baseline time, loop-assisted time, review, rework, botsitting, escalation, quality, and business value.', 'schema', 'high');
`;

  return artifact("supabase_schema", "Supabase schema recommendation", content);
}

export function generateVercelPlan(spec: LoopSpec): GeneratedArtifact {
  const content = `API routes for ${spec.name}

/api/loops/${spec.id}/run
  Starts a manual or scheduled run, records input snapshot, step traces, verification result, and review requirement.

/api/loops/${spec.id}/artifacts
  Returns generated implementation artifacts for copying into the target product.

/api/cron/management-review
  Weekly rollup across active loops, failed runs, open reviews, open improvements, and metrics.
`;

  return artifact("vercel_plan", "Vercel API route plan", content);
}

export function generateCronPlan(spec: LoopSpec): GeneratedArtifact {
  const content = `Recommended cron plan

Primary cadence: ${spec.cadence}
Management rollup: ${spec.managementReviewOutput.cadence}

Vercel cron entry:
{
  "path": "/api/cron/management-review",
  "schedule": "0 15 * * 1"
}

The loop itself should remain manual in V1 until data source quality, escalation ownership, and verification pass rates are stable.
`;

  return artifact("cron_plan", "Vercel cron plan", content);
}

export function generateUiPlan(spec: LoopSpec): GeneratedArtifact {
  const content = `UI screens for ${spec.name}

Overview
  Goal, business outcome, target metric, status, owner, autonomy level, cadence.

Questions
  Grouped department-specific answers with missing required fields.

Spec
  Readable loop spec sections: inputs, data sources, routine, verification, escalation, trace schema, metrics, measurement plan.

Implementation
  Copyable Supabase schema, Vercel route plan, cron plan, agent prompt, verification rubric, escalation rules, trace schema, and management review plan.

Runs
  Run status, trigger, snapshots, verification, step traces, errors.

Reviews
  Human review queue with approve, reject, edit, escalate, and notes.

Metrics
  Baseline time, loop-assisted time, review, rework, escalation, governance, botsitting, quality, business value, relationship-time redeployment.

Improvements
  Failure modes, recommendations, owners, status, and created date.
`;

  return artifact("ui_plan", "UI screen plan", content);
}

export function generateAgentPrompt(spec: LoopSpec): GeneratedArtifact {
  const content = `You are the Loop Engineering Architect Agent.

Design and review the "${spec.name}" loop for ${spec.department}.

Goal:
${spec.goal}

Target metric:
${spec.targetMetric}

Business outcome:
${spec.businessOutcome}

Routine:
${spec.routine.map((step, index) => `${index + 1}. ${step.description}`).join("\n")}

Verification:
${spec.verification.map((check) => `- ${check.description}`).join("\n")}

Escalation:
${spec.escalation.map((rule) => `- ${rule.condition}: ${rule.reason}`).join("\n")}

Rules:
- Use the configured data sources or mark missing data as an assumption.
- Do not present automation as free labor.
- Always track review, rework, escalation, governance, and botsitting costs.
- Escalate when the output requires human judgment, risk ownership, approval, or relationship context.
- Record trace fields after every run.
`;

  return artifact("agent_prompt", "Agent prompt", content);
}

export function generateVerificationRubric(spec: LoopSpec): GeneratedArtifact {
  const content = `Verification rubric for ${spec.name}

${spec.verification
  .map(
    (check, index) => `${index + 1}. ${check.name}
Type: ${check.checkType}
Description: ${check.description}
Pass criteria: ${check.passCriteria}`
  )
  .join("\n\n")}

Required hidden-labor fields:
- Review time
- Rework time
- Escalation time
- Governance time
- Botsitting time
`;

  return artifact("verification_rubric", "Verification rubric", content);
}

export function generateImplementationPlan(spec: LoopSpec): GeneratedArtifact {
  const content = `Implementation plan for ${spec.name}

Start with manual runs.
Capture input snapshots from configured sources or manual paste.
Execute each routine step as a traceable step.
Run the verification rubric before exposing results to downstream systems.
Create a human review when an escalation condition matches.
Create improvement items from failed runs, rejected reviews, edited outputs, and recurring human corrections.
Feed weekly rollups into the management review dashboard.

Completion gates:
- Loop spec validates with Zod.
- Required questions are answered.
- Implementation artifacts are generated.
- Manual run stores traces.
- Escalation creates a human review.
- Improvement items can be created from failure or review feedback.
`;

  return artifact("implementation_plan", "Implementation plan", content);
}

export function generateManagementSummary(spec: LoopSpec): GeneratedArtifact {
  const content = `Management review plan for ${spec.name}

Cadence: ${spec.managementReviewOutput.cadence}

Questions:
${spec.managementReviewOutput.questions.map((question) => `- ${question}`).join("\n")}

Decisions needed:
${spec.managementReviewOutput.decisionsNeeded.map((decision) => `- ${decision}`).join("\n")}

Rollup metrics:
${spec.managementReviewOutput.rollupMetrics.map((metric) => `- ${metric}`).join("\n")}
`;

  return artifact("management_summary", "Management review output", content);
}

function artifact(
  artifactType: GeneratedArtifact["artifactType"],
  title: string,
  content: string
): GeneratedArtifact {
  return {
    artifactType,
    title,
    content,
    version: 1
  };
}
